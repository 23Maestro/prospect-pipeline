#!/usr/bin/env node

import fetch from 'node-fetch';
import { buildMeetingOutcomeFact } from '../src/domain/call-tracker-facts.ts';
import { upsertPostMeetingOutcomeFacts } from '../src/domain/supabase-persistence.ts';
import {
  appointmentStatusForTitleOrStage,
  crmStageForOutcome,
  taskStatusForTitleOrStage,
} from '../src/domain/supabase-lifecycle-translator.ts';
import { resolveCallTrackerOwnership } from './call-tracker-ownership.mjs';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const TRACKED_OWNER_NAME = process.env.CALL_TRACKER_OWNER || 'Jerami Singleton';
const {
  projectRef,
  url: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  schema: SUPABASE_SCHEMA,
} = resolveSupabaseCredentials();
const SUPABASE_CONFIG = {
  url: SUPABASE_URL,
  key: SUPABASE_SERVICE_ROLE_KEY,
  schema: SUPABASE_SCHEMA,
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    [
      'Missing Supabase credentials.',
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY, or authenticate the Supabase CLI so the linked project can provide them.',
      `Linked project ref: ${projectRef || 'missing'}`,
    ].join(' '),
  );
  process.exit(1);
}

if (projectRef && !SUPABASE_URL.includes(projectRef)) {
  console.error(
    `Supabase URL ${SUPABASE_URL} does not match linked project ref ${projectRef}. Refusing to write to the wrong project.`,
  );
  process.exit(1);
}

function commissionPeriodForDate(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const start = new Date(year, month, day <= 15 ? 1 : 16);
  const end = day <= 15 ? new Date(year, month, 15) : new Date(year, month + 1, 0);
  return `${start.toISOString().slice(0, 10)}~${end.toISOString().slice(0, 10)}`;
}

function previousCommissionPeriodForDate(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  if (day <= 15) {
    const previousMonthEnd = new Date(year, month, 0);
    const previousStart = new Date(previousMonthEnd.getFullYear(), previousMonthEnd.getMonth(), 16);
    return `${previousStart.toISOString().slice(0, 10)}~${previousMonthEnd.toISOString().slice(0, 10)}`;
  }
  const start = new Date(year, month, 1);
  const end = new Date(year, month, 15);
  return `${start.toISOString().slice(0, 10)}~${end.toISOString().slice(0, 10)}`;
}

function commissionPeriodsToSync(date = new Date()) {
  if (process.env.COMMISSION_PERIOD) return [process.env.COMMISSION_PERIOD];
  return Array.from(new Set([
    commissionPeriodForDate(date),
    previousCommissionPeriodForDate(date),
  ]));
}

function normalizeIsoValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseCommissionDate(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i);
  if (!match) return null;
  const month = Number.parseInt(match[1], 10) - 1;
  const day = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  let hour = match[4] ? Number.parseInt(match[4], 10) : 0;
  const minute = match[5] ? Number.parseInt(match[5], 10) : 0;
  const meridiem = String(match[6] || '').toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  const parsed = new Date(year, month, day, hour, minute);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function apiFetch(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_BASE}${pathname}`, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${pathname} -> HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${pathname} -> request timed out after 20s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(pathname, payload) {
  return apiFetch(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function pickClosedWonMeeting(events, paidAt) {
  const paidAtMs = paidAt ? new Date(paidAt).getTime() : Date.now();
  const candidates = (Array.isArray(events) ? events : [])
    .map((event) => {
      const end = normalizeIsoValue(event?.end);
      const start = normalizeIsoValue(event?.start);
      const endMs = end ? new Date(end).getTime() : Number.NaN;
      return { event, end, start, endMs };
    })
    .filter((entry) => !Number.isNaN(entry.endMs) && entry.endMs <= paidAtMs)
    .sort((left, right) => right.endMs - left.endMs);
  return candidates[0]?.event || (Array.isArray(events) ? events[0] : null) || null;
}

function pickCurrentTask(tasks) {
  return (Array.isArray(tasks) ? tasks : []).find((task) =>
    String(task?.title || '').toLowerCase().includes('confirmation call')
  ) || (Array.isArray(tasks) ? tasks[0] : null) || null;
}

const commissionPeriods = commissionPeriodsToSync();
const commissionPayloads = await Promise.all(
  commissionPeriods.map((commperiod) => postJson('/commissions/stripe', { commperiod })),
);
// Stripe commission rows are paid close-won evidence, not call activity. They confirm or enrich
// the same post_meeting_outcome fact selected by sales stage/event title when the title
// lacks an ENR dollar prefix. Default sync checks the current and previous half-month period so
// a newly paid post-meeting result is not missed immediately after a period boundary.
const commissionEntries = commissionPayloads.flatMap((payload) =>
  (Array.isArray(payload.entries) ? payload.entries : []).map((entry) => ({
    ...entry,
    __commissionPayload: payload,
  })),
);
const paidEntries = commissionEntries
  .filter((entry) => {
    const status = String(entry?.status || '').trim().toLowerCase();
    return !status || status === 'paid';
  })
  .filter((entry) => String(entry?.athlete_id || '').trim() && String(entry?.athlete_main_id || '').trim())
  .sort((left, right) => {
    const leftPaidAt = parseCommissionDate(left?.paid_at) || '';
    const rightPaidAt = parseCommissionDate(right?.paid_at) || '';
    return leftPaidAt.localeCompare(rightPaidAt);
  });

async function fetchExistingClosedWonRows(athleteId, athleteMainId) {
  const params = new URLSearchParams({
    select: 'dedupe_key,appointment_id,live_event_id,booked_event_title,reporting_at,source_system',
    tracker_outcome: 'eq.closed_won',
    athlete_id: `eq.${athleteId}`,
    athlete_main_id: `eq.${athleteMainId}`,
    order: 'reporting_at.asc',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/call_log?${params.toString()}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Accept-Profile': SUPABASE_SCHEMA,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`call_log closed-won lookup failed: HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

function athleteKey(athleteId, athleteMainId) {
  return `${athleteId}:${athleteMainId}`;
}

const postMeetingOutcomeFacts = [];
const skipped = [];
const failures = [];
const selectedClosedWonByAthlete = new Map();

for (const entry of paidEntries) {
  const athleteId = String(entry.athlete_id || '').trim();
  const athleteMainId = String(entry.athlete_main_id || '').trim();
  try {
    const [tasksPayload, meetingsPayload, resolvedProfile] = await Promise.all([
      postJson('/tasks/list', { athlete_id: athleteId, athlete_main_id: athleteMainId }).catch(() => ({ tasks: [] })),
      apiFetch(`/calendar/athlete-booked-meetings?athlete_id=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(athleteMainId)}`).catch(() => ({ events: [] })),
      apiFetch(`/athlete/${encodeURIComponent(athleteId)}/resolve?force_refresh=true`).catch(() => ({})),
    ]);
    const tasks = Array.isArray(tasksPayload.tasks) ? tasksPayload.tasks : [];
    const meetings = Array.isArray(meetingsPayload.events) ? meetingsPayload.events : [];
    const paidAt = parseCommissionDate(entry.paid_at) || new Date().toISOString();
    const bookedMeeting = pickClosedWonMeeting(meetings, paidAt);
    const currentTask = pickCurrentTask(tasks);
    const appointmentId = String(bookedMeeting?.event_id || '').trim() || String(entry.account_id || '').trim() || null;
    if (!appointmentId) {
      skipped.push({ athlete_id: athleteId, athlete_main_id: athleteMainId, reason: 'missing_commission_or_meeting_id' });
      continue;
    }
    const existingClosedWonRows = await fetchExistingClosedWonRows(athleteId, athleteMainId);
    const knownClosedWon = selectedClosedWonByAthlete.get(athleteKey(athleteId, athleteMainId)) || existingClosedWonRows[0] || null;
    if (
      knownClosedWon?.appointment_id &&
      String(knownClosedWon.appointment_id) !== appointmentId
    ) {
      skipped.push({
        athlete_id: athleteId,
        athlete_main_id: athleteMainId,
        athlete_name: entry.athlete_name,
        reason: 'existing_closed_won_enrollment',
        existing_appointment_id: String(knownClosedWon.appointment_id),
        candidate_appointment_id: appointmentId,
        commission_account_id: entry.account_id,
        commission_paid_at: entry.paid_at,
      });
      continue;
    }
    const trackerOwnership = resolveCallTrackerOwnership({
      trackedOwnerName: TRACKED_OWNER_NAME,
      athleteId,
      athleteMainId,
      athleteName: entry.athlete_name,
      tasks,
      currentTaskId: String(currentTask?.task_id || '').trim() || null,
      bookedMeeting,
      resolvedProfile,
      pipelineState: {
        head_scout: String(entry.scout || resolvedProfile.head_scout || '').trim() || null,
      },
      appointmentId,
      liveEventId: String(bookedMeeting?.event_id || '').trim() || null,
    });
    if (!trackerOwnership.isTrackedOwner) {
      skipped.push({
        athlete_id: athleteId,
        athlete_main_id: athleteMainId,
        athlete_name: entry.athlete_name,
        reason: 'not_tracked_owner',
        resolved_owner: trackerOwnership.context.resolvedOwnerName,
        materialization_reason: trackerOwnership.materializationReason,
      });
      continue;
    }

    const closeWonCrmStage = crmStageForOutcome('terminal_enrollment');
    const closeWonTaskStatus =
      taskStatusForTitleOrStage('(ENR)', closeWonCrmStage, 'closed_won') || 'closed_won';
    const closeWonOutcome =
      appointmentStatusForTitleOrStage(closeWonCrmStage, '(ENR)') || closeWonTaskStatus;

    const postMeetingOutcomeFact = buildMeetingOutcomeFact({
      athleteId,
      athleteMainId,
      athleteName: entry.athlete_name,
      occurredAt: paidAt,
      source: 'stripe_commissions',
      rawCrmStage: closeWonCrmStage,
      rawTaskStatus: closeWonTaskStatus,
      rawEventType: 'post_meeting_outcome',
      dedupeOutcome: closeWonOutcome,
      appointmentId,
      liveEventId: String(bookedMeeting?.event_id || '').trim() || null,
      bookedEventTitle:
        String(bookedMeeting?.title || '').trim() ||
        [entry.product, entry.subscription_name].filter(Boolean).join(' - ') ||
        null,
      revenueCents: entry.amount_cents,
      ownerInput: {
        purpose: 'meeting_outcome',
        athleteId,
        athleteMainId,
        athleteName: entry.athlete_name,
        tasks,
        currentTaskId: String(currentTask?.task_id || '').trim() || null,
        bookedMeeting,
        resolvedProfile,
        pipelineState: {
          head_scout: String(entry.scout || resolvedProfile.head_scout || '').trim() || null,
        },
        appointmentId,
        liveEventId: String(bookedMeeting?.event_id || '').trim() || null,
      },
      ownerContext: trackerOwnership.context,
      payload: {
        source: 'stripe_commissions',
        commission_source_view: entry.__commissionPayload?.source,
        commperiod: entry.__commissionPayload?.commperiod,
        commission_status: entry.status,
        commission_account_id: entry.account_id,
        commission_paid_at: entry.paid_at,
        commission_amount_cents: entry.amount_cents,
        commission_plan_price_cents: entry.plan_price_cents,
        commission_product: entry.product,
        commission_subscription_name: entry.subscription_name,
        commission_duplicate_key: entry.duplicate_key,
        commission_possible_duplicate: entry.possible_duplicate,
      },
    });
    postMeetingOutcomeFacts.push(postMeetingOutcomeFact);
    selectedClosedWonByAthlete.set(athleteKey(athleteId, athleteMainId), {
      appointment_id: appointmentId,
      dedupe_key: postMeetingOutcomeFact.dedupe_key,
      reporting_at: postMeetingOutcomeFact.occurred_at,
      source_system: 'stripe_commissions',
    });
  } catch (error) {
    failures.push({
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
      athlete_name: entry.athlete_name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (failures.length) {
  console.error(JSON.stringify({ commissionPeriods, failures }, null, 2));
  throw new Error(`Commission sync failed before writes: ${failures.length} unresolved row(s)`);
}

await upsertPostMeetingOutcomeFacts(SUPABASE_CONFIG, postMeetingOutcomeFacts);

console.log(JSON.stringify({
  commissionPeriods,
  sourceRows: commissionEntries.length,
  paidRows: paidEntries.length,
  postMeetingOutcomeFactsUpserted: postMeetingOutcomeFacts.length,
  duplicateEvidenceRows: commissionEntries.filter((entry) => entry.possible_duplicate).length,
  skipped,
}, null, 2));
