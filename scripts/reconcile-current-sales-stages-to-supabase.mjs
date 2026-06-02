#!/usr/bin/env node

// Audit/reconcile job only. Raycast Scout Prep actions write Laravel and Supabase at action time.
// Keep this for external/manual Laravel state, calendar/event-title outcomes, and repair.

import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto';
import { buildMeetingOutcomeFact } from '../src/domain/call-tracker-facts.ts';
import {
  upsertPendingClientWatchlistRows,
  upsertPostMeetingOutcomeFacts,
} from '../src/domain/supabase-persistence.ts';
import {
  buildPendingClientWatchlistRow,
  buildPendingClientEvidenceDescription,
  classifyPendingClientActionTag,
  classifyPendingClientLifecycle,
  findPendingClientSignals,
  selectLatestPendingClientNote,
  selectLatestPendingClientReviewEvent,
} from '../src/domain/pending-client-watchlist.ts';
import {
  appointmentStatusForTitleOrStage,
  crmStageForOutcome,
  isPostMeetingLifecycleStage,
  lifecycleTextIncludesAny,
  normalizeCrmSalesStage,
  normalizeLifecycleText,
  parseAppointmentTitleOutcome,
  shouldArchiveReconciledState,
  taskStatusForTitleOrStage,
} from '../src/domain/supabase-lifecycle-translator.ts';
import { resolveCallTrackerOwnership } from './call-tracker-ownership.mjs';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const LOCAL_TIME_ZONE = 'America/New_York';
const TRACKED_OWNER_NAME = process.env.CALL_TRACKER_OWNER || 'Jerami Singleton';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
process.env.TZ ||= LOCAL_TIME_ZONE;
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
const RUN_ID = randomUUID();

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

function parseLooseDate(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = trimmed.match(
    /^(?:[A-Za-z]{3}\s+)?(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i,
  );
  if (!match) return null;

  const month = Number.parseInt(match[1], 10) - 1;
  const day = Number.parseInt(match[2], 10);
  const yearValue = Number.parseInt(match[3], 10);
  const year = match[3].length === 2 ? 2000 + yearValue : yearValue;
  let hour = match[4] ? Number.parseInt(match[4], 10) : 0;
  const minute = match[5] ? Number.parseInt(match[5], 10) : 0;
  const meridiem = String(match[6] || '').toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  const parsed = new Date(year, month, day, hour, minute);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysOldFrom(value, nowMs = Date.now()) {
  const parsed = parseLooseDate(value);
  if (!parsed) return 0;
  return Math.floor((nowMs - parsed.getTime()) / MS_PER_DAY);
}

function latestTaskDate(task) {
  return (
    task?.due_date ||
    task?.updated_at ||
    task?.created_at ||
    task?.completion_date ||
    null
  );
}

function staleActiveStateDecision(args) {
  const { row, selectedStageLabel, parsedTitle, bookedMeeting, latestTask } = args;
  const stageText = normalizeLifecycleText(
    [
      selectedStageLabel,
      row.crm_stage,
      row.task_status,
      row.current_task_title,
      latestTask?.title,
    ].filter(Boolean).join(' '),
  );
  const eventAge = daysOldFrom(bookedMeeting?.end || bookedMeeting?.start || row.updated_at);
  const taskAge = daysOldFrom(latestTaskDate(latestTask) || row.updated_at);

  if (parsedTitle && shouldArchiveReconciledState(parsedTitle.outcome)) {
    return {
      shouldArchive: true,
      reason: `archived_${parsedTitle.outcome}`,
    };
  }

  if (stageText.includes('never spoke to') || row.task_status === 'call_attempt_3') {
    return {
      shouldArchive: taskAge >= 3,
      reason: taskAge >= 3 ? 'stale_never_spoke_to_3_days' : 'keep_never_spoke_to',
    };
  }

  if (stageText.includes('no show') || row.task_status === 'no_show') {
    return {
      shouldArchive: eventAge >= 7 || taskAge >= 7,
      reason: eventAge >= 7 || taskAge >= 7 ? 'stale_no_show_7_days' : 'keep_no_show_under_7_days',
    };
  }

  if (lifecycleTextIncludesAny(stageText, ['canceled', 'cancelled']) || row.task_status === 'canceled') {
    return {
      shouldArchive: eventAge >= 21 || taskAge >= 21,
      reason: eventAge >= 21 || taskAge >= 21 ? 'stale_canceled_21_days' : 'keep_canceled_under_21_days',
    };
  }

  if (stageText.includes('follow up') || row.task_status === 'meeting_follow_up') {
    return {
      shouldArchive: eventAge >= 7 || taskAge >= 7,
      reason: eventAge >= 7 || taskAge >= 7 ? 'stale_follow_up_7_days' : 'keep_follow_up_under_7_days',
    };
  }

  if (stageText.includes('rescheduled') || stageText.includes('res pending') || stageText.includes('reschedule pending')) {
    const hasFutureBookedMeeting = parseLooseDate(bookedMeeting?.start)?.getTime() > Date.now();
    return {
      shouldArchive: !hasFutureBookedMeeting && (eventAge >= 21 || taskAge >= 21),
      reason: !hasFutureBookedMeeting && (eventAge >= 21 || taskAge >= 21)
        ? 'stale_reschedule_21_days_without_future_meeting'
        : 'keep_reschedule_pending',
    };
  }

  return { shouldArchive: false, reason: 'keep_active_state' };
}

function parseMeetingEnd(event) {
  const rawEnd = String(event?.end || '').trim();
  if (!rawEnd) return null;
  const parsed = new Date(rawEnd);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventHasEnded(event, now = new Date()) {
  const parsedEnd = parseMeetingEnd(event);
  return Boolean(parsedEnd && parsedEnd.getTime() <= now.getTime());
}

function selectEndedMeetingForMonitoring(events, storedAppointmentId) {
  const candidates = (Array.isArray(events) ? events : [])
    .map((event) => {
      const endedAt = parseMeetingEnd(event);
      return {
        event,
        endedAt,
        exactMatch:
          storedAppointmentId &&
          String(event?.event_id || '').trim() === String(storedAppointmentId || '').trim(),
      };
    })
    .filter((entry) => entry.endedAt && entry.endedAt.getTime() <= Date.now());

  if (!candidates.length) return null;
  return candidates.sort((left, right) => {
    if (left.exactMatch !== right.exactMatch) return left.exactMatch ? -1 : 1;
    return right.endedAt.getTime() - left.endedAt.getTime();
  })[0];
}

function outcomePriority(outcome) {
  switch (outcome) {
    case 'terminal_enrollment':
      return 100;
    case 'terminal_close_lost':
      return 90;
    case 'reschedule_pending':
      return 80;
    case 'soft_archive_no_show':
      return 70;
    case 'soft_archive_canceled':
      return 60;
    case 'soft_archive_follow_up':
      return 50;
    default:
      return 0;
  }
}

function selectReconciliationEvent(events, storedAppointmentId, selectedStage) {
  const selectedLifecycle = normalizeCrmSalesStage(selectedStage);
  const candidates = (Array.isArray(events) ? events : [])
    .map((event) => ({
      event,
      parsedTitle: parseAppointmentTitleOutcome(event?.title),
      ended: eventHasEnded(event),
      exactMatch:
        storedAppointmentId &&
        String(event?.event_id || '').trim() === String(storedAppointmentId || '').trim(),
    }))
    .filter((entry) => entry.ended);

  if (!candidates.length) return null;

  const exact = candidates.find(
    (entry) =>
      entry.exactMatch &&
      (
        outcomePriority(entry.parsedTitle.outcome) > 0 ||
        isPostMeetingLifecycleStage(selectedLifecycle)
      ),
  );
  if (exact) {
    return { ...exact, matchStrategy: 'stored_event_id' };
  }

  const outcomeMatches = candidates
    .filter((entry) => outcomePriority(entry.parsedTitle.outcome) > 0)
    .sort((left, right) => outcomePriority(right.parsedTitle.outcome) - outcomePriority(left.parsedTitle.outcome));

  // Post-meeting precedence:
  // 1. Sales stage says Actual Meeting - Close Won.
  // 2. Event/tab title can confirm it with an ENR prefix and optional price.
  // 3. Commission sync can later enrich the same deduped fact with paid revenue.
  if (selectedLifecycle === 'closed_won') {
    const enrollment = outcomeMatches.find(
      (entry) => entry.parsedTitle.outcome === 'terminal_enrollment',
    );
    if (enrollment) {
      return { ...enrollment, matchStrategy: 'close_won_enrollment_prefix' };
    }
  }

  if (outcomeMatches[0]) {
    return { ...outcomeMatches[0], matchStrategy: 'outcome_prefix' };
  }

  if (isPostMeetingLifecycleStage(selectedLifecycle)) {
    return { ...candidates[0], matchStrategy: 'selected_stage_post_meeting' };
  }

  return null;
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

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Accept-Profile': SUPABASE_SCHEMA,
      'Content-Profile': SUPABASE_SCHEMA,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${pathname} failed: ${response.status} ${text.slice(0, 300)}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function supabaseWrite(table, rows, { onConflict } = {}) {
  if (!rows.length) return;
  const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  await supabaseRequest(`${encodeURIComponent(table)}${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: onConflict ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
}

async function supabasePatch(table, matchColumn, matchValue, row) {
  await supabaseRequest(
    `${encodeURIComponent(table)}?${encodeURIComponent(matchColumn)}=eq.${encodeURIComponent(matchValue)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    },
  );
}

function getSelectedSalesStage(payload) {
  const options = Array.isArray(payload?.options) ? payload.options : [];
  const selected = options.find((option) => option?.selected);
  const label = String(selected?.label || selected?.value || '').trim();
  return {
    label: label || null,
    value: String(selected?.value || selected?.label || '').trim() || label || null,
  };
}

async function fetchAthleteBookedMeetings(row) {
  const payload = await apiFetch(
    `/calendar/athlete-booked-meetings?athlete_id=${encodeURIComponent(row.athlete_id)}&athlete_main_id=${encodeURIComponent(row.athlete_main_id)}`,
  ).catch(() => ({ events: [] }));
  return Array.isArray(payload.events) ? payload.events : [];
}

async function fetchAthleteTasks(row) {
  const payload = await apiFetch('/tasks/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: row.athlete_id,
      athlete_main_id: row.athlete_main_id,
    }),
  }).catch(() => ({ tasks: [] }));
  return Array.isArray(payload.tasks) ? payload.tasks : [];
}

async function fetchAthleteNotes(row) {
  const payload = await apiFetch('/notes/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: row.athlete_id,
      athlete_main_id: row.athlete_main_id,
    }),
  }).catch(() => ({ notes: [] }));
  return Array.isArray(payload.notes) ? payload.notes : [];
}

async function fetchAthleteProfile(row) {
  return apiFetch(`/athlete/${encodeURIComponent(row.athlete_id)}/resolve?force_refresh=true`).catch(() => ({}));
}

const [lifecycleEventRows, athleteRows] = await Promise.all([
  supabaseRequest(
    [
      'lifecycle_events?select=athlete_key,athlete_id,athlete_main_id,crm_stage,task_status,event_type,payload_json,created_at',
      'order=created_at.desc',
      'limit=1000',
    ].join('&'),
  ),
  supabaseRequest('athletes?select=athlete_key,athlete_name&limit=1000'),
]);

const athleteNameByKey = new Map(
  [
    ...(Array.isArray(athleteRows) ? athleteRows : []),
  ].map((row) => [String(row.athlete_key || '').trim(), String(row.athlete_name || '').trim()]),
);
const lifecycleEvents = [];
const postMeetingOutcomeFacts = [];
const pendingClientWatchlistRows = [];
const pendingClientWatchlistSourceIds = new Set();
const stateDeletes = [];
const appointmentPatches = [];
const failures = [];
const updated = [];
const unchanged = [];
const cleaned = [];
const appointmentRepairs = [];
const now = new Date().toISOString();

const pastAppointmentRows = await supabaseRequest(
  [
    'appointments?select=id,athlete_key,athlete_id,athlete_main_id,head_scout,starts_at,status,post_meeting_result,status_reason,operator_owner,operator_owner_key,source_event_id',
    `starts_at=lt.${encodeURIComponent(now)}`,
    'status=in.(scheduled,awaiting_post_meeting_update,rescheduled,reschedule_pending,closed_won,closed_lost,follow_up,no_show,canceled)',
    'order=starts_at.desc',
    'limit=500',
  ].join('&'),
);
const pastAppointments = Array.isArray(pastAppointmentRows) ? pastAppointmentRows : [];

function queueAppointmentPatch(appointmentId, row) {
  const id = String(appointmentId || '').trim();
  if (!id) return;
  const existingIndex = appointmentPatches.findIndex((patch) => patch.appointmentId === id);
  if (existingIndex >= 0) {
    appointmentPatches[existingIndex] = {
      appointmentId: id,
      row: {
        ...appointmentPatches[existingIndex].row,
        ...row,
      },
    };
    return;
  }
  appointmentPatches.push({ appointmentId: id, row });
}

function uniqueRowsByField(rows, field) {
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.[field] || '').trim();
    if (!key) continue;
    byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

function postMeetingResultForAppointmentStatus(status) {
  switch (String(status || '').trim()) {
    case 'closed_won':
      return 'closed_won';
    case 'closed_lost':
      return 'closed_lost';
    case 'follow_up':
      return 'follow_up';
    case 'reschedule_pending':
      return 'reschedule_pending';
    case 'rescheduled':
      return 'rescheduled';
    case 'no_show':
      return 'no_show';
    case 'canceled':
      return 'canceled';
    case 'awaiting_post_meeting_update':
      return 'awaiting_post_meeting_update';
    default:
      return null;
  }
}

function shouldQueuePendingClientForStage(stage) {
  const normalized = normalizeCrmSalesStage(stage);
  return (
    normalized === 'meeting_follow_up' ||
    normalized === 'reschedule_pending' ||
    normalized === 'canceled'
  );
}

function findAppointmentEvent(appointment, bookedMeetings) {
  const appointmentId = String(appointment?.source_event_id || appointment?.id || '').trim();
  return (
    (Array.isArray(bookedMeetings) ? bookedMeetings : []).find(
      (event) => String(event?.event_id || '').trim() === appointmentId,
    ) || {
      event_id: appointmentId,
      title: String(appointment?.head_scout || '').trim()
        ? `Post Meeting - ${appointment.head_scout}`
        : 'Post Meeting',
      assigned_owner: appointment?.head_scout || null,
      start: appointment?.starts_at || null,
      end: appointment?.starts_at || null,
      date_time_label: appointment?.starts_at || null,
      description: null,
    }
  );
}

function firstPayloadText(payload, fields) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  for (const field of fields) {
    const value = String(payload[field] || '').trim();
    if (value) return value;
  }
  return null;
}

function latestPostMeetingLifecycleRows(rows) {
  const latestByAthleteKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const athleteKey = String(row?.athlete_key || '').trim();
    if (!athleteKey || latestByAthleteKey.has(athleteKey)) continue;
    const normalizedStage = normalizeCrmSalesStage(row?.crm_stage || row?.task_status || row?.event_type);
    if (normalizedStage !== 'meeting_follow_up' && normalizedStage !== 'reschedule_pending') continue;
    latestByAthleteKey.set(athleteKey, {
      ...row,
      normalized_stage: normalizedStage,
    });
  }
  return Array.from(latestByAthleteKey.values());
}

function lifecycleEventRowToPipelineState(row) {
  const athleteKey = String(row?.athlete_key || '').trim();
  const athleteId = String(row?.athlete_id || '').trim();
  const athleteMainId = String(row?.athlete_main_id || '').trim();
  const payload = row?.payload_json && typeof row.payload_json === 'object' ? row.payload_json : {};
  const appointmentId = String(
    firstPayloadText(payload, [
      'current_appointment_id',
      'appointment_id',
      'booked_event_id',
      'live_event_id',
      'source_event_id',
    ]) || '',
  ).trim();
  if (!athleteKey || !athleteId || !athleteMainId || !appointmentId) return null;
  const crmStage = String(row.crm_stage || '').trim() || null;
  const taskStatus = String(row.task_status || row.normalized_stage || '').trim() || null;

  return {
    athlete_key: athleteKey,
    athlete_id: athleteId,
    athlete_main_id: athleteMainId,
    crm_stage: crmStage,
    task_status: taskStatus,
    head_scout: firstPayloadText(payload, ['head_scout', 'booked_owner', 'assigned_owner']),
    current_task_id: null,
    current_task_title: taskStatus || crmStage || String(row.event_type || '').trim() || null,
    current_appointment_id: appointmentId,
    updated_at: row.created_at || now,
  };
}

function currentStateRowsFromLifecycleEvents(lifecycleRows) {
  const rows = [];
  const seen = new Set();
  const add = (row) => {
    if (!row) return;
    const athleteKey = String(row.athlete_key || '').trim();
    const appointmentId = String(row.current_appointment_id || '').trim();
    const key = `${athleteKey}:${appointmentId || 'no-current-appointment'}`;
    if (!athleteKey || seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  (Array.isArray(lifecycleRows) ? lifecycleRows : []).forEach((row) => {
    const lifecycleRow = lifecycleEventRowToPipelineState(row);
    if (!lifecycleRow) return;
    add(lifecycleRow);
  });
  return rows;
}

const stateRows = currentStateRowsFromLifecycleEvents(
  latestPostMeetingLifecycleRows(lifecycleEventRows),
);

function queueStateDelete(athleteKey, reason) {
  const key = String(athleteKey || '').trim();
  if (!key) return;
  if (stateDeletes.some((entry) => entry.athleteKey === key)) return;
  stateDeletes.push({ athleteKey: key, reason });
}

function queueLifecycleStateEvent(row, args) {
  lifecycleEvents.push({
    id: randomUUID(),
    athlete_key: row.athlete_key,
    athlete_id: row.athlete_id,
    athlete_main_id: row.athlete_main_id,
    event_type: args.eventType || 'current_sales_stage_reconciled',
    crm_stage: args.crmStage || null,
    task_status: args.taskStatus || null,
    payload_json: {
      reconcile_run_id: RUN_ID,
      source: 'legacy_sales_stage_current',
      reason: args.reason || null,
      previous_crm_stage: row.crm_stage || null,
      previous_task_status: row.task_status || null,
      current_appointment_id: args.appointmentId || row.current_appointment_id || null,
      live_event_id: args.liveEventId || null,
      current_task_id: row.current_task_id || null,
      current_task_title: row.current_task_title || null,
    },
    created_at: now,
  });
}

function enqueuePendingClientWatchlistRow(args) {
  const {
    row,
    athleteName,
    crmStage,
    selectedStageLabel,
    bookedMeeting,
    bookedMeetings,
    notes,
  } = args;
  const notesTabEntry = selectLatestPendingClientNote(notes);
  const pendingClientDecision = classifyPendingClientLifecycle({
    crmStage,
    reviewEventTitle: notesTabEntry?.metadata || bookedMeeting?.title || null,
    reviewDescription: notesTabEntry?.description || '',
  });
  if (!pendingClientDecision.eligible) return;

  const sourceEventId = `pending-client:${row.athlete_key}`;
  if (pendingClientWatchlistSourceIds.has(sourceEventId)) return;

  const reviewEvent = selectLatestPendingClientReviewEvent(bookedMeeting, bookedMeetings);
  const description = buildPendingClientEvidenceDescription({
    notesTabEntry,
    reviewEvent,
    missingMessage: 'No usable Notes tab or post-meeting event-list entry found for this post-meeting state.',
  });
  const hasEvidence = Boolean(notesTabEntry || reviewEvent);
  const matchedSignals = findPendingClientSignals(description);
  const actionTag = classifyPendingClientActionTag({
    normalizedStage: pendingClientDecision.normalizedStage,
    description,
    matchedSignals,
    hasEvidence,
  });
  pendingClientWatchlistSourceIds.add(sourceEventId);
  pendingClientWatchlistRows.push(
    buildPendingClientWatchlistRow({
      event: {
        event_id: sourceEventId,
        title: notesTabEntry?.metadata || reviewEvent?.title || bookedMeeting?.title || crmStage,
        assigned_owner: reviewEvent?.assigned_owner || bookedMeeting?.assigned_owner || row.head_scout,
        start: reviewEvent?.start || bookedMeeting?.start,
        end: reviewEvent?.end || bookedMeeting?.end || null,
        date_time_label: reviewEvent?.date_time_label || bookedMeeting?.date_time_label || null,
      },
      description: [
        `Sales Stage: ${crmStage || selectedStageLabel || 'Unknown'}`,
        `Lifecycle: ${pendingClientDecision.normalizedStage}`,
        `Pending Tag: ${actionTag}`,
        reviewEvent?.title ? `Event List: ${reviewEvent.title}` : null,
        notesTabEntry?.title ? `Notes Tab: ${notesTabEntry.title}` : 'Notes Tab: missing',
        notesTabEntry?.metadata ? `Scout Note: ${notesTabEntry.metadata}` : null,
        description,
      ].filter(Boolean).join('\n\n'),
      matchedSignals,
      actionTag,
      aiVerdict: 'pending_client',
      athleteId: row.athlete_id,
      athleteMainId: row.athlete_main_id,
      athleteName,
    }),
  );
}

for (const [index, row] of (Array.isArray(stateRows) ? stateRows : []).entries()) {
  const athleteName = athleteNameByKey.get(String(row.athlete_key || '').trim()) || '';
  console.error(`[${index + 1}/${stateRows.length}] ${athleteName || row.athlete_key}`);

  try {
    const [stagePayload, bookedMeetings, tasks, notes, resolvedProfile] = await Promise.all([
      apiFetch(`/sales/stages/${encodeURIComponent(row.athlete_id)}`),
      fetchAthleteBookedMeetings(row),
      fetchAthleteTasks(row),
      fetchAthleteNotes(row),
      fetchAthleteProfile(row),
    ]);
    const selectedStage = getSelectedSalesStage(stagePayload);
    const selectedStageLabel = selectedStage.label;
    const latestTask = tasks.find((task) => !String(task?.completion_date || '').trim()) || tasks[0] || null;
    const reconciliationEvent = selectReconciliationEvent(
      bookedMeetings,
      row.current_appointment_id,
      selectedStageLabel,
    );
    const endedMeetingForMonitoring = selectEndedMeetingForMonitoring(
      bookedMeetings,
      row.current_appointment_id,
    );
    const fallbackRetention = staleActiveStateDecision({
      row,
      selectedStageLabel,
      parsedTitle: { outcome: 'active' },
      bookedMeeting: null,
      latestTask,
    });
    const trackerOwnership = resolveCallTrackerOwnership({
      trackedOwnerName: TRACKED_OWNER_NAME,
      athleteId: row.athlete_id,
      athleteMainId: row.athlete_main_id,
      athleteName,
      tasks,
      currentTaskId: row.current_task_id,
      bookedMeeting: reconciliationEvent?.event || null,
      resolvedProfile,
      pipelineState: row,
      appointmentId: row.current_appointment_id,
      liveEventId: reconciliationEvent?.event?.event_id || null,
    });

    if (!selectedStageLabel && !reconciliationEvent) {
      if (!trackerOwnership.isTrackedOwner || fallbackRetention.shouldArchive) {
        const reason = !trackerOwnership.isTrackedOwner ? 'not_tracked_owner' : fallbackRetention.reason;
        queueStateDelete(row.athlete_key, reason);
        cleaned.push({
          athlete_key: row.athlete_key,
          athlete_name: athleteName,
          reason,
          resolved_owner: trackerOwnership.context.resolvedOwnerName,
          owner_source_field: trackerOwnership.context.resolvedFromField,
          materialization_reason: trackerOwnership.materializationReason,
        });
        continue;
      }
      unchanged.push({
        athlete_key: row.athlete_key,
        athlete_name: athleteName,
        reason: 'missing_selected_stage_and_ended_event',
      });
      continue;
    }

    if (!reconciliationEvent) {
      if (
        trackerOwnership.isTrackedOwner &&
        endedMeetingForMonitoring &&
        normalizeCrmSalesStage(selectedStageLabel) === 'meeting_set'
      ) {
        const monitorEvent = endedMeetingForMonitoring.event;
        const liveEventId = String(monitorEvent?.event_id || row.current_appointment_id || '').trim() || null;
        queueLifecycleStateEvent(row, {
          eventType: 'post_meeting_update_pending',
          crmStage: 'Meeting Set - Awaiting Post Meeting Result',
          taskStatus: 'post_meeting_update_pending',
          appointmentId: liveEventId || row.current_appointment_id || null,
          liveEventId,
          reason: 'awaiting_post_meeting_update',
        });
        if (liveEventId) {
          queueAppointmentPatch(liveEventId, {
            status: 'awaiting_post_meeting_update',
            post_meeting_result: 'awaiting_post_meeting_update',
            status_reason: 'awaiting_post_meeting_update',
            starts_at: String(monitorEvent?.start || '').trim() || undefined,
            updated_at: now,
          });
        }
        cleaned.push({
          athlete_key: row.athlete_key,
          athlete_name: athleteName,
          reason: 'awaiting_post_meeting_update',
          selected_sales_stage: selectedStageLabel,
          live_event_id: liveEventId,
          booked_event_title: monitorEvent?.title || null,
        });
        continue;
      }

      if (!trackerOwnership.isTrackedOwner || fallbackRetention.shouldArchive) {
        const reason = !trackerOwnership.isTrackedOwner ? 'not_tracked_owner' : fallbackRetention.reason;
        queueStateDelete(row.athlete_key, reason);
        cleaned.push({
          athlete_key: row.athlete_key,
          athlete_name: athleteName,
          reason,
          selected_sales_stage: selectedStageLabel,
          resolved_owner: trackerOwnership.context.resolvedOwnerName,
          owner_source_field: trackerOwnership.context.resolvedFromField,
          materialization_reason: trackerOwnership.materializationReason,
          latest_task_owner: latestTask?.assigned_owner || null,
        });
        continue;
      }
      unchanged.push({
        athlete_key: row.athlete_key,
        athlete_name: athleteName,
        reason: 'no_ended_live_event',
        selected_sales_stage: selectedStageLabel,
      });
      continue;
    }

    const bookedMeeting = reconciliationEvent.event;
    const parsedTitle = reconciliationEvent.parsedTitle;
    const nextCrmStage = crmStageForOutcome(parsedTitle.outcome, selectedStageLabel);
    const bookedTitle = parsedTitle.originalTitle || null;
    const nextTaskStatus = taskStatusForTitleOrStage(bookedTitle, nextCrmStage, row.task_status);
    const appointmentStatus = appointmentStatusForTitleOrStage(nextCrmStage, bookedTitle);
    const revenueCents = parsedTitle.revenueCents;
    const liveEventId = String(bookedMeeting?.event_id || '').trim() || null;
    const stageChanged =
      String(nextCrmStage || '').trim() !== String(row.crm_stage || '').trim() ||
      String(nextTaskStatus || '').trim() !== String(row.task_status || '').trim();
    const liveEventChanged =
      liveEventId && liveEventId !== String(row.current_appointment_id || '').trim();
    const shouldArchiveActiveState = shouldArchiveReconciledState(parsedTitle.outcome);
    const retentionDecision = staleActiveStateDecision({
      row,
      selectedStageLabel,
      parsedTitle,
      bookedMeeting,
      latestTask,
    });

    if (!trackerOwnership.isTrackedOwner) {
      queueStateDelete(row.athlete_key, 'not_tracked_owner');
      cleaned.push({
        athlete_key: row.athlete_key,
        athlete_name: athleteName,
        reason: 'not_tracked_owner',
        resolved_owner: trackerOwnership.context.resolvedOwnerName,
        owner_source_field: trackerOwnership.context.resolvedFromField,
        materialization_reason: trackerOwnership.materializationReason,
        booked_event_owner: bookedMeeting?.assigned_owner || null,
        latest_task_owner: latestTask?.assigned_owner || null,
      });
      continue;
    }

    if (!shouldArchiveActiveState && !retentionDecision.shouldArchive) {
      enqueuePendingClientWatchlistRow({
        row,
        athleteName,
        crmStage: nextCrmStage,
        selectedStageLabel,
        bookedMeeting,
        bookedMeetings,
        appointmentId: liveEventId || row.current_appointment_id,
        notes,
      });
    }

    if (!stageChanged && !liveEventChanged && !shouldArchiveActiveState && !retentionDecision.shouldArchive) {
      unchanged.push({
        athlete_key: row.athlete_key,
        athlete_name: athleteName,
        crm_stage: row.crm_stage,
        task_status: row.task_status,
      });
      continue;
    }

    if (row.current_appointment_id && appointmentStatus) {
      queueAppointmentPatch(row.current_appointment_id, {
        status: appointmentStatus,
        post_meeting_result: postMeetingResultForAppointmentStatus(appointmentStatus),
        status_reason: `live_sales_stage:${nextCrmStage}`,
        starts_at: String(bookedMeeting?.start || '').trim() || undefined,
        updated_at: now,
      });
    }

    const rawEventType = 'post_meeting_outcome';

    if (shouldArchiveActiveState || retentionDecision.shouldArchive) {
      queueStateDelete(
        row.athlete_key,
        shouldArchiveActiveState ? `archived_${parsedTitle.outcome}` : retentionDecision.reason,
      );
    }

    lifecycleEvents.push({
      id: randomUUID(),
      athlete_key: row.athlete_key,
      athlete_id: row.athlete_id,
      athlete_main_id: row.athlete_main_id,
      event_type: rawEventType,
      crm_stage: nextCrmStage,
      task_status: nextTaskStatus,
      payload_json: {
        reconcile_run_id: RUN_ID,
        source: 'legacy_sales_stage_current',
        match_strategy: reconciliationEvent.matchStrategy,
        previous_crm_stage: row.crm_stage,
        previous_task_status: row.task_status,
        selected_sales_stage: selectedStageLabel,
        selected_sales_stage_value: selectedStage.value,
        stored_appointment_id: row.current_appointment_id || null,
        live_event_id: liveEventId,
        booked_event_title: bookedTitle,
        clean_booked_event_title: parsedTitle.cleanTitle || null,
        booked_event_outcome: parsedTitle.outcome,
        booked_event_start: bookedMeeting?.start || null,
        booked_event_end: bookedMeeting?.end || null,
        booked_event_owner: bookedMeeting?.assigned_owner || null,
        latest_task_id: latestTask?.task_id || null,
        latest_task_title: latestTask?.title || null,
        latest_task_owner: latestTask?.assigned_owner || null,
        tracker_owner: TRACKED_OWNER_NAME,
        resolved_owner: trackerOwnership.context.resolvedOwnerName,
        owner_source_field: trackerOwnership.context.resolvedFromField,
        materialization_status: trackerOwnership.materializationStatus,
        materialization_reason: trackerOwnership.materializationReason,
        appointment_status: appointmentStatus,
        revenue_cents: revenueCents,
      },
      created_at: now,
    });

    postMeetingOutcomeFacts.push(buildMeetingOutcomeFact({
      athleteId: row.athlete_id,
      athleteMainId: row.athlete_main_id,
      athleteName: athleteName || null,
      source: 'legacy_sales_stage_current',
      rawCrmStage: nextCrmStage,
      rawTaskStatus: nextTaskStatus,
      rawEventType,
      dedupeOutcome: appointmentStatus || nextTaskStatus,
      appointmentId: row.current_appointment_id || null,
      liveEventId,
      bookedEventTitle: bookedTitle,
      revenueCents,
      occurredAt: now,
      ownerInput: {
        purpose: 'meeting_outcome',
        athleteId: row.athlete_id,
        athleteMainId: row.athlete_main_id,
        athleteName,
        tasks,
        currentTaskId: row.current_task_id,
        bookedMeeting,
        resolvedProfile,
        pipelineState: row,
        appointmentId: row.current_appointment_id,
        liveEventId,
      },
      ownerContext: trackerOwnership.context,
      payload: {
        reconcile_run_id: RUN_ID,
        match_strategy: reconciliationEvent.matchStrategy,
        previous_crm_stage: row.crm_stage,
        previous_task_status: row.task_status,
        stored_appointment_id: row.current_appointment_id || null,
        live_event_id: liveEventId,
        clean_booked_event_title: parsedTitle.cleanTitle || null,
        booked_event_start: bookedMeeting?.start || null,
        booked_event_end: bookedMeeting?.end || null,
        booked_event_outcome: parsedTitle.outcome,
        appointment_status: appointmentStatus,
        tracker_owner: TRACKED_OWNER_NAME,
      },
    }));

    updated.push({
      athlete_key: row.athlete_key,
      athlete_name: athleteName,
      previous_crm_stage: row.crm_stage,
      crm_stage: nextCrmStage,
      previous_task_status: row.task_status,
      task_status: nextTaskStatus,
      appointment_status: appointmentStatus,
      stored_appointment_id: row.current_appointment_id || null,
      live_event_id: liveEventId,
      match_strategy: reconciliationEvent.matchStrategy,
      booked_event_title: bookedTitle,
      revenue_cents: revenueCents,
      resolved_owner: trackerOwnership.context.resolvedOwnerName,
      owner_source_field: trackerOwnership.context.resolvedFromField,
      materialization_status: trackerOwnership.materializationStatus,
      materialization_reason: trackerOwnership.materializationReason,
    });

    if (shouldArchiveActiveState || retentionDecision.shouldArchive) {
      cleaned.push({
        athlete_key: row.athlete_key,
        athlete_name: athleteName,
        reason: shouldArchiveActiveState ? `archived_${parsedTitle.outcome}` : retentionDecision.reason,
        crm_stage: nextCrmStage,
        task_status: nextTaskStatus,
        live_event_id: liveEventId,
        booked_event_title: bookedTitle,
      });
    }
  } catch (error) {
    failures.push({
      athlete_key: row.athlete_key,
      athlete_name: athleteName,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`  failed: ${failures[failures.length - 1].error}`);
  }
}

for (const [index, appointment] of pastAppointments.entries()) {
  const athleteKey = String(appointment.athlete_key || '').trim();
  const athleteName = athleteNameByKey.get(athleteKey) || '';
  console.error(`[appointment ${index + 1}/${pastAppointments.length}] ${athleteName || athleteKey}`);

  try {
    const row = {
      athlete_key: athleteKey,
      athlete_id: appointment.athlete_id,
      athlete_main_id: appointment.athlete_main_id,
      crm_stage: null,
      task_status: null,
      head_scout: appointment.head_scout || null,
      current_task_id: null,
      current_task_title: null,
      current_appointment_id: appointment.id,
      updated_at: appointment.starts_at || now,
    };
    if (!row.athlete_key || !row.athlete_id || !row.athlete_main_id || !row.current_appointment_id) continue;

    const [stagePayload, bookedMeetings, tasks, notes, resolvedProfile] = await Promise.all([
      apiFetch(`/sales/stages/${encodeURIComponent(row.athlete_id)}`),
      fetchAthleteBookedMeetings(row),
      fetchAthleteTasks(row),
      fetchAthleteNotes(row),
      fetchAthleteProfile(row),
    ]);
    const selectedStage = getSelectedSalesStage(stagePayload);
    const selectedStageLabel = selectedStage.label;
    const bookedMeeting = findAppointmentEvent(appointment, bookedMeetings);
    const parsedTitle = parseAppointmentTitleOutcome(bookedMeeting?.title);
    if (!isPostMeetingLifecycleStage(selectedStageLabel) && parsedTitle.outcome === 'active') continue;

    const nextCrmStage = crmStageForOutcome(parsedTitle.outcome, selectedStageLabel);
    const appointmentStatus = appointmentStatusForTitleOrStage(nextCrmStage, bookedMeeting?.title);
    const postMeetingResult = postMeetingResultForAppointmentStatus(appointmentStatus);
    if (!appointmentStatus || !postMeetingResult) continue;

    const nextTaskStatus = taskStatusForTitleOrStage(bookedMeeting?.title, nextCrmStage, null);
    const statusReason =
      parsedTitle.outcome === 'active'
        ? `live_sales_stage:${selectedStageLabel}`
        : `live_event_title:${parsedTitle.prefix || parsedTitle.outcome}`;
    const trackerOwnership = resolveCallTrackerOwnership({
      trackedOwnerName: TRACKED_OWNER_NAME,
      athleteId: row.athlete_id,
      athleteMainId: row.athlete_main_id,
      athleteName,
      tasks,
      currentTaskId: null,
      bookedMeeting,
      resolvedProfile,
      pipelineState: row,
      appointmentId: appointment.id,
      liveEventId: bookedMeeting?.event_id || appointment.source_event_id || appointment.id,
    });
    const appointmentNeedsPatch =
      String(appointment.status || '').trim() !== appointmentStatus ||
      String(appointment.post_meeting_result || '').trim() !== postMeetingResult ||
      String(appointment.status_reason || '').trim() !== statusReason;

    if (trackerOwnership.isTrackedOwner && shouldQueuePendingClientForStage(nextCrmStage)) {
      enqueuePendingClientWatchlistRow({
        row,
        athleteName,
        crmStage: nextCrmStage,
        selectedStageLabel,
        bookedMeeting,
        bookedMeetings,
        appointmentId: appointment.id,
        notes,
      });
    }

    if (!appointmentNeedsPatch) continue;

    queueAppointmentPatch(appointment.id, {
      status: appointmentStatus,
      post_meeting_result: postMeetingResult,
      status_reason: statusReason,
      updated_at: now,
    });
    if (shouldArchiveReconciledState(parsedTitle.outcome)) {
      queueStateDelete(row.athlete_key, `archived_${parsedTitle.outcome}`);
    }

    const rawEventType = 'post_meeting_outcome';
    lifecycleEvents.push({
      id: randomUUID(),
      athlete_key: row.athlete_key,
      athlete_id: row.athlete_id,
      athlete_main_id: row.athlete_main_id,
      event_type: rawEventType,
      crm_stage: nextCrmStage,
      task_status: nextTaskStatus,
      payload_json: {
        reconcile_run_id: RUN_ID,
        source: parsedTitle.outcome === 'active' ? 'legacy_sales_stage_current' : 'calendar_event_title',
        match_strategy:
          parsedTitle.outcome === 'active'
            ? 'past_appointment_live_stage_repair'
            : 'past_appointment_event_title_repair',
        selected_sales_stage: selectedStageLabel,
        selected_sales_stage_value: selectedStage.value,
        resolved_crm_stage: nextCrmStage,
        title_outcome: parsedTitle.outcome,
        title_prefix: parsedTitle.prefix,
        stored_appointment_id: appointment.id,
        live_event_id: bookedMeeting?.event_id || appointment.source_event_id || appointment.id,
        booked_event_title: bookedMeeting?.title || null,
        booked_event_start: bookedMeeting?.start || appointment.starts_at || null,
        booked_event_end: bookedMeeting?.end || null,
        booked_event_owner: bookedMeeting?.assigned_owner || appointment.head_scout || null,
        tracker_owner: TRACKED_OWNER_NAME,
        resolved_owner: trackerOwnership.context.resolvedOwnerName,
        owner_source_field: trackerOwnership.context.resolvedFromField,
        materialization_status: trackerOwnership.materializationStatus,
        materialization_reason: trackerOwnership.materializationReason,
        appointment_status: appointmentStatus,
        post_meeting_result: postMeetingResult,
      },
      created_at: now,
    });

    postMeetingOutcomeFacts.push(buildMeetingOutcomeFact({
      athleteId: row.athlete_id,
      athleteMainId: row.athlete_main_id,
      athleteName: athleteName || null,
      source: parsedTitle.outcome === 'active' ? 'legacy_sales_stage_current' : 'calendar_event_title',
      rawCrmStage: nextCrmStage,
      rawTaskStatus: nextTaskStatus,
      rawEventType,
      dedupeOutcome: appointmentStatus,
      appointmentId: appointment.id,
      liveEventId: bookedMeeting?.event_id || appointment.source_event_id || appointment.id,
      bookedEventTitle: bookedMeeting?.title || null,
      revenueCents: null,
      occurredAt: now,
      ownerInput: {
        purpose: 'meeting_outcome',
        athleteId: row.athlete_id,
        athleteMainId: row.athlete_main_id,
        athleteName,
        tasks,
        currentTaskId: null,
        bookedMeeting,
        resolvedProfile,
        pipelineState: row,
        appointmentId: appointment.id,
        liveEventId: bookedMeeting?.event_id || appointment.source_event_id || appointment.id,
      },
      ownerContext: trackerOwnership.context,
      payload: {
        reconcile_run_id: RUN_ID,
        match_strategy:
          parsedTitle.outcome === 'active'
            ? 'past_appointment_live_stage_repair'
            : 'past_appointment_event_title_repair',
        selected_sales_stage: selectedStageLabel,
        resolved_crm_stage: nextCrmStage,
        title_outcome: parsedTitle.outcome,
        title_prefix: parsedTitle.prefix,
        stored_appointment_id: appointment.id,
        live_event_id: bookedMeeting?.event_id || appointment.source_event_id || appointment.id,
        appointment_status: appointmentStatus,
        post_meeting_result: postMeetingResult,
        tracker_owner: TRACKED_OWNER_NAME,
      },
    }));

    appointmentRepairs.push({
      athlete_key: row.athlete_key,
      athlete_name: athleteName,
      appointment_id: appointment.id,
      previous_status: appointment.status,
      status: appointmentStatus,
      post_meeting_result: postMeetingResult,
      selected_sales_stage: selectedStageLabel,
      resolved_crm_stage: nextCrmStage,
      title_outcome: parsedTitle.outcome,
      materialization_status: trackerOwnership.materializationStatus,
    });
  } catch (error) {
    failures.push({
      athlete_key: appointment.athlete_key,
      athlete_name: athleteName,
      appointment_id: appointment.id,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`  failed: ${failures[failures.length - 1].error}`);
  }
}

if (failures.length) {
  console.error(JSON.stringify({ runId: RUN_ID, failures }, null, 2));
  throw new Error(`Current sales-stage reconciliation failed before writes: ${failures.length} unresolved row(s)`);
}

for (const patch of appointmentPatches) {
  await supabasePatch('appointments', 'id', patch.appointmentId, patch.row);
}

await supabaseWrite('lifecycle_events', lifecycleEvents);
const uniquePostMeetingOutcomeFacts = uniqueRowsByField(postMeetingOutcomeFacts, 'dedupe_key');
await upsertPostMeetingOutcomeFacts(SUPABASE_CONFIG, uniquePostMeetingOutcomeFacts);
await upsertPendingClientWatchlistRows(SUPABASE_CONFIG, pendingClientWatchlistRows);

for (const deletion of stateDeletes) {
  await supabasePatch('athlete_contact_cache', 'athlete_key', deletion.athleteKey, {
    cache_status: 'inactive',
    inactive_reason: deletion.reason,
    inactive_at: now,
    updated_at: now,
  });
}

console.log(
  JSON.stringify(
    {
      runId: RUN_ID,
      inspected: Array.isArray(stateRows) ? stateRows.length : 0,
      updatedCount: updated.length,
      unchangedCount: unchanged.length,
      lifecycleEventsInserted: lifecycleEvents.length,
      postMeetingOutcomeFactsUpserted: uniquePostMeetingOutcomeFacts.length,
      postMeetingOutcomeFactsDeduped: postMeetingOutcomeFacts.length - uniquePostMeetingOutcomeFacts.length,
      pendingClientWatchlistUpserted: pendingClientWatchlistRows.length,
      appointmentRepairsApplied: appointmentRepairs.length,
      contactCacheInactivated: stateDeletes.length,
      failures,
      cleaned,
      updated,
      appointmentRepairs,
    },
    null,
    2,
  ),
);
