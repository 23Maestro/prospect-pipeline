#!/usr/bin/env node

import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto';
import { buildMeetingOutcomeFact } from '../src/domain/call-tracker-facts.ts';
import { upsertPostMeetingOutcomeFacts } from '../src/domain/supabase-persistence.ts';
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

function normalizeStageText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/[.,:]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function includesAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle));
}

function parseAppointmentTitleOutcome(title) {
  const originalTitle = String(title || '').trim();
  const active = {
    originalTitle,
    cleanTitle: originalTitle,
    outcome: 'active',
    revenueCents: null,
    prefix: null,
  };
  if (!originalTitle) return active;

  // Prospect ID win titles may be "(ENR)", "(ENR $99)", or "(ENR $99 - Post Date)".
  // Any ENR prefix is a terminal close-won signal; the dollar amount is optional evidence.
  const enrollmentMatch = originalTitle.match(/^\s*\(ENR(?:\s+\$?([0-9]+(?:\.[0-9]{1,2})?))?[^)]*\)\s*/i);
  if (enrollmentMatch) {
    const revenue = enrollmentMatch[1] ? Number.parseFloat(enrollmentMatch[1]) : Number.NaN;
    return {
      originalTitle,
      cleanTitle: originalTitle.replace(enrollmentMatch[0], '').trim(),
      outcome: 'terminal_enrollment',
      revenueCents: Number.isFinite(revenue) ? Math.round(revenue * 100) : null,
      prefix: enrollmentMatch[0].trim(),
    };
  }

  const prefixRules = [
    { pattern: /^\s*\(RSP\)(?:\*\d+)?\s*/i, outcome: 'reschedule_pending' },
    { pattern: /^\s*\(CL\)(?:\*\d+)?\s*/i, outcome: 'terminal_close_lost' },
    { pattern: /^\s*\(FU\)(?:\*\d+)?\s*/i, outcome: 'soft_archive_follow_up' },
    { pattern: /^\s*\(CAN\)(?:\*\d+)?\s*/i, outcome: 'soft_archive_canceled' },
    { pattern: /^\s*\(NS\)(?:\*\d+)?\s*/i, outcome: 'soft_archive_no_show' },
  ];

  for (const rule of prefixRules) {
    const match = originalTitle.match(rule.pattern);
    if (match) {
      return {
        originalTitle,
        cleanTitle: originalTitle.replace(match[0], '').trim(),
        outcome: rule.outcome,
        revenueCents: null,
        prefix: match[0].trim(),
      };
    }
  }

  return active;
}

function normalizeCrmSalesStage(rawCrmStage) {
  const normalized = normalizeStageText(rawCrmStage);
  if (!normalized) return 'unknown';
  if (normalized === 'new opportunity') return 'new_opportunity';
  if (
    normalized === 'left voice mail 1' ||
    normalized === 'left voicemail 1' ||
    normalized === 'left voice mail 2' ||
    normalized === 'left voicemail 2' ||
    normalized === 'never spoke to' ||
    normalized === 'called unable to leave vm' ||
    normalized === 'unable to leave vm' ||
    normalized === 'spoke to athlete not parent' ||
    normalized === 'athlete not parent'
  ) {
    return 'call_attempt';
  }
  if (includesAny(normalized, ['closed won', 'close won'])) return 'closed_won';
  if (includesAny(normalized, ['closed lost', 'close lost'])) {
    return 'closed_lost';
  }
  if (includesAny(normalized, ['inactive', 'dead lead', 'archived', 'not interested', 'too young'])) return 'inactive';
  if (includesAny(normalized, ['no show', 'noshow'])) return 'no_show';
  if (
    includesAny(normalized, [
      'reschedule pending',
      'rescheduled pending',
      'meeting result res pending',
      'meeting result canceled',
      'actual meeting canceled',
    ])
  ) {
    return 'reschedule_pending';
  }
  if (includesAny(normalized, ['meeting result rescheduled', 'actual meeting rescheduled'])) {
    return 'rescheduled';
  }
  if (normalized === 'rescheduled') return 'rescheduled';
  if (normalized === 'meeting set') return 'meeting_set';
  if (
    includesAny(normalized, [
      'actual meeting follow up',
      'spoke to i need to follow up',
      'spoke to follow up',
      'meeting follow up',
      'follow up',
      'awaiting close',
      'close pending',
      'close follow up',
    ])
  ) {
    return 'meeting_follow_up';
  }
  return 'unknown';
}

function taskStatusForStage(rawCrmStage, existingTaskStatus) {
  const normalizedText = normalizeStageText(rawCrmStage);
  const normalizedStage = normalizeCrmSalesStage(rawCrmStage);

  if (normalizedText === 'left voice mail 1' || normalizedText === 'left voicemail 1') {
    return 'call_attempt_1';
  }
  if (normalizedText === 'left voice mail 2' || normalizedText === 'left voicemail 2') {
    return 'call_attempt_2';
  }
  if (normalizedText === 'never spoke to') return 'call_attempt_3';
  if (normalizedText === 'called unable to leave vm' || normalizedText === 'unable to leave vm') {
    return 'unable_to_leave_vm';
  }
  if (normalizedStage === 'meeting_set') return 'confirmation_call';
  if (normalizedStage === 'reschedule_pending') return 'reschedule_pending';
  if (normalizedStage === 'rescheduled') return 'confirmation_call';
  if (normalizedStage === 'no_show') return 'no_show';
  if (normalizedStage === 'meeting_follow_up') return 'meeting_follow_up';
  if (normalizedStage === 'closed_won') return 'closed_won';
  if (normalizedStage === 'closed_lost') return 'closed_lost';
  if (normalizedStage === 'inactive') return 'inactive';

  return String(existingTaskStatus || '').trim() || 'needs_manual_review';
}

function taskStatusForTitleOrStage(bookedEventTitle, rawCrmStage, existingTaskStatus) {
  const normalizedTitle = String(bookedEventTitle || '').trim().toLowerCase();
  if (normalizedTitle.startsWith('(enr')) return 'closed_won';
  if (normalizedTitle.startsWith('(cl)')) return 'closed_lost';
  if (normalizedTitle.startsWith('(rsp)')) return 'reschedule_pending';
  if (normalizedTitle.startsWith('(can)')) return 'reschedule_pending';
  if (normalizedTitle.startsWith('(ns)')) return 'no_show';
  if (normalizedTitle.startsWith('(fu)')) return 'meeting_follow_up';
  return taskStatusForStage(rawCrmStage, existingTaskStatus);
}

function appointmentStatusForTitleOrStage(rawCrmStage, bookedEventTitle) {
  const normalizedTitle = String(bookedEventTitle || '').trim().toLowerCase();
  if (normalizedTitle.startsWith('(enr')) return 'closed_won';
  if (normalizedTitle.startsWith('(cl)')) return 'closed_lost';
  if (normalizedTitle.startsWith('(rsp)')) return 'reschedule_pending';
  if (normalizedTitle.startsWith('(can)')) return 'canceled';
  if (normalizedTitle.startsWith('(ns)')) return 'no_show';
  if (normalizedTitle.startsWith('(fu)')) return 'follow_up';

  const normalizedStage = normalizeCrmSalesStage(rawCrmStage);
  if (normalizedStage === 'closed_won') return 'closed_won';
  if (normalizedStage === 'closed_lost') return 'closed_lost';
  if (normalizedStage === 'reschedule_pending') return 'reschedule_pending';
  if (normalizedStage === 'rescheduled') return 'rescheduled';
  if (normalizedStage === 'no_show') return 'no_show';
  if (normalizedStage === 'meeting_follow_up') return 'follow_up';
  if (normalizedStage === 'meeting_set') return 'scheduled';
  return null;
}

function crmStageForOutcome(titleOutcome, selectedStage) {
  const trimmedStage = String(selectedStage || '').trim();
  if (trimmedStage) return trimmedStage;
  if (titleOutcome === 'terminal_enrollment') return 'Actual Meeting - Close Won';
  if (titleOutcome === 'terminal_close_lost') return 'Actual Meeting - Close Lost';
  if (titleOutcome === 'reschedule_pending') return 'Meeting Result - Res. Pending';
  if (titleOutcome === 'soft_archive_no_show') return 'Meeting Result - No Show';
  if (titleOutcome === 'soft_archive_canceled') return 'Meeting Result - Canceled';
  if (titleOutcome === 'soft_archive_follow_up') return 'Actual Meeting - Follow Up';
  return trimmedStage;
}

function shouldArchiveReconciledState(titleOutcome) {
  return new Set([
    'terminal_enrollment',
    'terminal_close_lost',
    'soft_archive_no_show',
    'soft_archive_canceled',
    'soft_archive_follow_up',
  ]).has(titleOutcome);
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
  const stageText = normalizeStageText(
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

  if (includesAny(stageText, ['canceled', 'cancelled']) || row.task_status === 'canceled') {
    return {
      shouldArchive: eventAge >= 10 || taskAge >= 10,
      reason: eventAge >= 10 || taskAge >= 10 ? 'stale_canceled_10_days' : 'keep_canceled_under_10_days',
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
      shouldArchive: !hasFutureBookedMeeting && (eventAge >= 7 || taskAge >= 7),
      reason: !hasFutureBookedMeeting && (eventAge >= 7 || taskAge >= 7)
        ? 'stale_reschedule_7_days_without_future_meeting'
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

function isPostMeetingLifecycleStage(stage) {
  return new Set([
    'closed_won',
    'closed_lost',
    'reschedule_pending',
    'rescheduled',
    'no_show',
    'meeting_follow_up',
  ]).has(stage);
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

async function supabaseDelete(table, matchColumn, matchValue) {
  await supabaseRequest(
    `${encodeURIComponent(table)}?${encodeURIComponent(matchColumn)}=eq.${encodeURIComponent(matchValue)}`,
    {
      method: 'DELETE',
      headers: {
        Prefer: 'return=minimal',
      },
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

async function fetchAthleteProfile(row) {
  return apiFetch(`/athlete/${encodeURIComponent(row.athlete_id)}/resolve?force_refresh=true`).catch(() => ({}));
}

const [stateRows, athleteRows] = await Promise.all([
  supabaseRequest(
    [
      'athlete_pipeline_state?select=athlete_key,athlete_id,athlete_main_id,crm_stage,task_status,head_scout,current_task_id,current_task_title,current_appointment_id,updated_at',
      'order=updated_at.desc',
      'limit=1000',
    ].join('&'),
  ),
  supabaseRequest('athletes?select=athlete_key,athlete_name&limit=1000'),
]);

const athleteNameByKey = new Map(
  (Array.isArray(athleteRows) ? athleteRows : []).map((row) => [
    String(row.athlete_key || '').trim(),
    String(row.athlete_name || '').trim(),
  ]),
);
const lifecycleEvents = [];
const postMeetingOutcomeFacts = [];
const statePatches = [];
const stateDeletes = [];
const appointmentPatches = [];
const failures = [];
const updated = [];
const unchanged = [];
const cleaned = [];
const now = new Date().toISOString();

function queueStateDelete(athleteKey, reason) {
  const key = String(athleteKey || '').trim();
  if (!key) return;
  if (stateDeletes.some((entry) => entry.athleteKey === key)) return;
  stateDeletes.push({ athleteKey: key, reason });
}

for (const [index, row] of (Array.isArray(stateRows) ? stateRows : []).entries()) {
  const athleteName = athleteNameByKey.get(String(row.athlete_key || '').trim()) || '';
  console.error(`[${index + 1}/${stateRows.length}] ${athleteName || row.athlete_key}`);

  try {
    const [stagePayload, bookedMeetings, tasks, resolvedProfile] = await Promise.all([
      apiFetch(`/sales/stages/${encodeURIComponent(row.athlete_id)}`),
      fetchAthleteBookedMeetings(row),
      fetchAthleteTasks(row),
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
        statePatches.push({
          athleteKey: row.athlete_key,
          row: {
            crm_stage: 'Meeting Set - Awaiting Post Meeting Result',
            task_status: 'post_meeting_update_pending',
            current_appointment_id: liveEventId || row.current_appointment_id || null,
            updated_at: now,
          },
        });
        if (liveEventId) {
          appointmentPatches.push({
            appointmentId: liveEventId,
            row: {
              status: 'awaiting_post_meeting_update',
              starts_at: String(monitorEvent?.start || '').trim() || undefined,
              updated_at: now,
            },
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
      appointmentPatches.push({
        appointmentId: row.current_appointment_id,
        row: {
          status: appointmentStatus,
          starts_at: String(bookedMeeting?.start || '').trim() || undefined,
          updated_at: now,
        },
      });
    }

    const rawEventType = 'post_meeting_outcome';

    if (shouldArchiveActiveState || retentionDecision.shouldArchive) {
      queueStateDelete(
        row.athlete_key,
        shouldArchiveActiveState ? `archived_${parsedTitle.outcome}` : retentionDecision.reason,
      );
    } else {
      statePatches.push({
        athleteKey: row.athlete_key,
        row: {
          crm_stage: nextCrmStage,
          task_status: nextTaskStatus,
          current_appointment_id: liveEventId || row.current_appointment_id || null,
          updated_at: now,
        },
      });
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

if (failures.length) {
  console.error(JSON.stringify({ runId: RUN_ID, failures }, null, 2));
  throw new Error(`Current sales-stage reconciliation failed before writes: ${failures.length} unresolved row(s)`);
}

for (const patch of statePatches) {
  await supabasePatch('athlete_pipeline_state', 'athlete_key', patch.athleteKey, patch.row);
}

for (const patch of appointmentPatches) {
  await supabasePatch('appointments', 'id', patch.appointmentId, patch.row);
}

await supabaseWrite('lifecycle_events', lifecycleEvents);
await upsertPostMeetingOutcomeFacts(SUPABASE_CONFIG, postMeetingOutcomeFacts);

for (const deletion of stateDeletes) {
  await supabaseDelete('athlete_pipeline_state', 'athlete_key', deletion.athleteKey);
}

console.log(
  JSON.stringify(
    {
      runId: RUN_ID,
      inspected: Array.isArray(stateRows) ? stateRows.length : 0,
      updatedCount: updated.length,
      unchangedCount: unchanged.length,
      lifecycleEventsInserted: lifecycleEvents.length,
      postMeetingOutcomeFactsUpserted: postMeetingOutcomeFacts.length,
      activeStateDeleted: stateDeletes.length,
      failures,
      cleaned,
      updated,
    },
    null,
    2,
  ),
);
