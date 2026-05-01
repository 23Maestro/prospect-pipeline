#!/usr/bin/env node

import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const LOCAL_TIME_ZONE = 'America/New_York';
const TRACKED_OWNER_NAME = process.env.CALL_TRACKER_OWNER || 'Jerami Singleton';
process.env.TZ ||= LOCAL_TIME_ZONE;
const {
  projectRef,
  url: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  schema: SUPABASE_SCHEMA,
} = resolveSupabaseCredentials();
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

function normalizeOwnerName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isTrackedOwner(value) {
  return normalizeOwnerName(value) === normalizeOwnerName(TRACKED_OWNER_NAME);
}

function resolveTrackerOwnership(tasks) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const trackedTask = taskList.find((task) => isTrackedOwner(task?.assigned_owner));
  const latestOwnerTask =
    taskList.find((task) => !String(task?.completion_date || '').trim() && String(task?.assigned_owner || '').trim()) ||
    taskList.find((task) => String(task?.assigned_owner || '').trim()) ||
    null;

  return {
    isTrackedOwner: Boolean(trackedTask),
    sourceOwner:
      String(trackedTask?.assigned_owner || latestOwnerTask?.assigned_owner || '').trim() || null,
  };
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

  const enrollmentMatch = originalTitle.match(/^\s*\(ENR(?:\s+\$?([0-9]+(?:\.[0-9]{1,2})?))?\)\s*/i);
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
  if (
    includesAny(normalized, ['closed lost', 'close lost']) ||
    normalized === 'spoke to not interested' ||
    normalized === 'not interested'
  ) {
    return 'closed_lost';
  }
  if (includesAny(normalized, ['inactive', 'dead lead', 'archived', 'too young'])) return 'inactive';
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

  const exact = candidates.find((entry) => entry.exactMatch);
  if (exact) {
    return { ...exact, matchStrategy: 'stored_event_id' };
  }

  const selectedLifecycle = normalizeCrmSalesStage(selectedStage);
  const outcomeMatches = candidates
    .filter((entry) => outcomePriority(entry.parsedTitle.outcome) > 0)
    .sort((left, right) => outcomePriority(right.parsedTitle.outcome) - outcomePriority(left.parsedTitle.outcome));

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

  return { ...candidates[0], matchStrategy: 'ended_event_fallback' };
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

function buildDedupeKey(args) {
  return [
    args.source,
    args.athleteKey,
    args.liveEventId || args.appointmentId || 'missing-event',
    args.rawEventType,
    args.outcome,
  ]
    .map((value) => String(value || '').trim())
    .join(':');
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
const callEvents = [];
const statePatches = [];
const appointmentPatches = [];
const failures = [];
const updated = [];
const unchanged = [];
const now = new Date().toISOString();

for (const [index, row] of (Array.isArray(stateRows) ? stateRows : []).entries()) {
  const athleteName = athleteNameByKey.get(String(row.athlete_key || '').trim()) || '';
  console.error(`[${index + 1}/${stateRows.length}] ${athleteName || row.athlete_key}`);

  try {
    const [stagePayload, bookedMeetings, tasks] = await Promise.all([
      apiFetch(`/sales/stages/${encodeURIComponent(row.athlete_id)}`),
      fetchAthleteBookedMeetings(row),
      fetchAthleteTasks(row),
    ]);
    const selectedStage = getSelectedSalesStage(stagePayload);
    const selectedStageLabel = selectedStage.label;
    const reconciliationEvent = selectReconciliationEvent(
      bookedMeetings,
      row.current_appointment_id,
      selectedStageLabel,
    );

    if (!selectedStageLabel && !reconciliationEvent) {
      unchanged.push({
        athlete_key: row.athlete_key,
        athlete_name: athleteName,
        reason: 'missing_selected_stage_and_ended_event',
      });
      continue;
    }

    if (!reconciliationEvent) {
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
    const hasOutcome = parsedTitle.outcome !== 'active';

    if (!stageChanged && !liveEventChanged && !hasOutcome) {
      unchanged.push({
        athlete_key: row.athlete_key,
        athlete_name: athleteName,
        crm_stage: row.crm_stage,
        task_status: row.task_status,
      });
      continue;
    }

    statePatches.push({
      athleteKey: row.athlete_key,
      row: {
        crm_stage: nextCrmStage,
        task_status: nextTaskStatus,
        updated_at: now,
      },
    });

    if (row.current_appointment_id && appointmentStatus) {
      appointmentPatches.push({
        appointmentId: row.current_appointment_id,
        row: {
          status: appointmentStatus,
          updated_at: now,
        },
      });
    }

    const rawEventType = 'sales_stage_reconciled';
    const dedupeKey = buildDedupeKey({
      source: 'legacy_sales_stage_current',
      athleteKey: row.athlete_key,
      liveEventId,
      appointmentId: row.current_appointment_id,
      rawEventType,
      outcome: appointmentStatus || nextTaskStatus,
    });
    const latestTask = tasks.find((task) => !String(task?.completion_date || '').trim()) || tasks[0] || null;
    const trackerOwnership = resolveTrackerOwnership(tasks);

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
        tracker_source_owner: trackerOwnership.sourceOwner,
        is_tracked_owner: trackerOwnership.isTrackedOwner,
        appointment_status: appointmentStatus,
        revenue_cents: revenueCents,
      },
      created_at: now,
    });

    callEvents.push({
      id: randomUUID(),
      athlete_key: row.athlete_key,
      athlete_id: row.athlete_id,
      athlete_main_id: row.athlete_main_id,
      athlete_name: athleteName || null,
      occurred_at: now,
      source: 'legacy_sales_stage_current',
      raw_crm_stage: nextCrmStage,
      raw_task_status: nextTaskStatus,
      raw_event_type: rawEventType,
      appointment_id: row.current_appointment_id || null,
      live_event_id: liveEventId,
      booked_event_title: bookedTitle,
      revenue_cents: revenueCents,
      source_owner: trackerOwnership.sourceOwner,
      is_tracked_owner: trackerOwnership.isTrackedOwner,
      dedupe_key: dedupeKey,
      payload_json: {
        reconcile_run_id: RUN_ID,
        match_strategy: reconciliationEvent.matchStrategy,
        previous_crm_stage: row.crm_stage,
        previous_task_status: row.task_status,
        stored_appointment_id: row.current_appointment_id || null,
        live_event_id: liveEventId,
        clean_booked_event_title: parsedTitle.cleanTitle || null,
        booked_event_outcome: parsedTitle.outcome,
        appointment_status: appointmentStatus,
        tracker_owner: TRACKED_OWNER_NAME,
        tracker_source_owner: trackerOwnership.sourceOwner,
        is_tracked_owner: trackerOwnership.isTrackedOwner,
      },
    });

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
      source_owner: trackerOwnership.sourceOwner,
      is_tracked_owner: trackerOwnership.isTrackedOwner,
    });
  } catch (error) {
    failures.push({
      athlete_key: row.athlete_key,
      athlete_name: athleteName,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`  failed: ${failures[failures.length - 1].error}`);
  }
}

for (const patch of statePatches) {
  await supabasePatch('athlete_pipeline_state', 'athlete_key', patch.athleteKey, patch.row);
}

for (const patch of appointmentPatches) {
  await supabasePatch('appointments', 'id', patch.appointmentId, patch.row);
}

await supabaseWrite('lifecycle_events', lifecycleEvents);
await supabaseWrite('call_events', callEvents, { onConflict: 'dedupe_key' });

console.log(
  JSON.stringify(
    {
      runId: RUN_ID,
      inspected: Array.isArray(stateRows) ? stateRows.length : 0,
      updatedCount: updated.length,
      unchangedCount: unchanged.length,
      lifecycleEventsInserted: lifecycleEvents.length,
      callEventsInserted: callEvents.length,
      failures,
      updated,
    },
    null,
    2,
  ),
);
