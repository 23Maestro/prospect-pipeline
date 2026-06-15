#!/usr/bin/env node

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fetch from 'node-fetch';
import { buildAthleteKey } from '../src/domain/athlete-identity.ts';
import { ACTIVE_APPOINTMENT_STATUSES } from '../src/domain/appointment-truth.ts';
import { buildMeetingOutcomeFact } from '../src/domain/call-tracker-facts.ts';
import { buildPendingClientWatchlistRow } from '../src/domain/pending-client-watchlist.ts';
import { resolveOwnerContext } from '../src/domain/owner-resolution.ts';
import {
  readRows,
  supabaseRequest,
  upsertPendingClientWatchlistRows,
  upsertPostMeetingOutcomeFacts,
} from '../src/domain/supabase-persistence.ts';
import {
  isPostMeetingLifecycleStage,
  normalizeCrmSalesStage,
  postMeetingResultForTitleOrStage,
  taskStatusForStage,
} from '../src/domain/supabase-lifecycle-translator.ts';
import { resolveWorkflowContext } from '../src/domain/workflow-context.ts';
import { lifecycleSalesStage } from '../src/lib/supabase-lifecycle.ts';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const WINDOW_DAYS = Number.parseInt(process.env.WINDOW_DAYS || '7', 10) || 7;
const LIMIT = Number.parseInt(process.env.LIMIT || '50', 10) || 50;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const LOCK_DIR = process.env.ENDED_MEETING_WATCH_LOCK_DIR || '/tmp/prospect-pipeline-ended-meeting-watch.lock';
const TRACKED_OWNER_NAME = process.env.CALL_TRACKER_OWNER || 'Jerami Singleton';

const POST_MEETING_PENDING_RESULTS = new Set(['follow_up', 'reschedule_pending', 'no_show', 'canceled']);

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

export function parseArgs(argv) {
  const args = { dryRun: DRY_RUN, windowDays: WINDOW_DAYS, limit: LIMIT, appointmentId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--write') {
      args.dryRun = false;
    } else if (arg === '--window-days') {
      args.windowDays = Number.parseInt(argv[index + 1] || '', 10) || args.windowDays;
      index += 1;
    } else if (arg.startsWith('--window-days=')) {
      args.windowDays = Number.parseInt(arg.slice('--window-days='.length), 10) || args.windowDays;
    } else if (arg === '--limit') {
      args.limit = Number.parseInt(argv[index + 1] || '', 10) || args.limit;
      index += 1;
    } else if (arg.startsWith('--limit=')) {
      args.limit = Number.parseInt(arg.slice('--limit='.length), 10) || args.limit;
    } else if (arg === '--appointment-id') {
      args.appointmentId = normalizeText(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--appointment-id=')) {
      args.appointmentId = normalizeText(arg.slice('--appointment-id='.length));
    }
  }
  return args;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeIsoValue(value) {
  const trimmed = normalizeText(value);
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function quotePostgrestInValue(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function appointmentEndIso(appointment, fallbackMinutes = 60) {
  const explicitEnd = normalizeIsoValue(appointment?.ends_at || appointment?.source_payload?.ends_at);
  if (explicitEnd) return explicitEnd;
  const startsAt = normalizeIsoValue(appointment?.starts_at);
  if (!startsAt) return null;
  return new Date(new Date(startsAt).getTime() + fallbackMinutes * 60_000).toISOString();
}

export function isWatchCandidate(appointment, now = new Date(), windowDays = WINDOW_DAYS) {
  if (!ACTIVE_APPOINTMENT_STATUSES.includes(String(appointment?.status || '').trim())) return false;
  if (normalizeText(appointment?.post_meeting_result)) return false;
  if (!normalizeText(appointment?.athlete_id) || !normalizeText(appointment?.athlete_main_id)) return false;
  const endIso = appointmentEndIso(appointment);
  if (!endIso) return false;
  const endMs = new Date(endIso).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(endMs) || endMs > nowMs) return false;
  return endMs >= nowMs - windowDays * 24 * 60 * 60 * 1000;
}

export function selectedStageFromPayload(payload) {
  const options = Array.isArray(payload?.options) ? payload.options : [];
  const selected = options.find((option) => option?.selected);
  return normalizeText(selected?.label || selected?.value || payload?.selected_label) || null;
}

export function resolveWatcherDecision(args) {
  const selectedStage = normalizeText(args.selectedStage);
  const liveEventTitle = normalizeText(args.liveEvent?.title);
  const normalizedStage = normalizeCrmSalesStage(selectedStage);
  if (normalizedStage === 'meeting_set') {
    return { action: 'still_waiting', selectedStage, postMeetingResult: null, taskStatus: 'confirmation_call' };
  }

  const postMeetingResult = postMeetingResultForTitleOrStage(selectedStage, null);
  const taskStatus = taskStatusForStage(selectedStage, null);
  if (!postMeetingResult || !isPostMeetingLifecycleStage(selectedStage)) {
    return {
      action: 'no_post_meeting_change',
      selectedStage,
      postMeetingResult: null,
      taskStatus,
    };
  }

  if (postMeetingResult === 'rescheduled') {
    const liveEventId = normalizeText(args.liveEvent?.event_id);
    const appointmentId = normalizeText(args.appointment?.id);
    if (!liveEventId || liveEventId === appointmentId) {
      return {
        action: 'needs_reschedule_event_review',
        selectedStage,
        postMeetingResult,
        taskStatus,
      };
    }
  }

  return {
    action: 'write_post_meeting_result',
    selectedStage,
    postMeetingResult,
    taskStatus,
  };
}

function readLockPid() {
  try {
    const pid = Number.parseInt(readFileSync(join(LOCK_DIR, 'pid'), 'utf8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      writeFileSync(join(LOCK_DIR, 'pid'), `${process.pid}\n`, { flag: 'wx' });
      return { acquired: true };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const pid = readLockPid();
      if (pid && isProcessAlive(pid)) {
        return { acquired: false, reason: 'ended_meeting_watch_already_running', pid };
      }
      rmSync(LOCK_DIR, { recursive: true, force: true });
    }
  }
}

function releaseLock() {
  rmSync(LOCK_DIR, { recursive: true, force: true });
}

async function apiFetch(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_BASE}${pathname}`, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${pathname} -> HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
}

async function readCandidateAppointments(args) {
  if (args.appointmentId) {
    return readRows(
      SUPABASE_CONFIG,
      'appointments',
      [
        'select=id,athlete_key,athlete_id,athlete_main_id,head_scout,starts_at,status,source_event_id,operator_owner,operator_owner_key,meeting_timezone,meeting_timezone_label,post_meeting_result,source_payload',
        `id=eq.${encodeURIComponent(args.appointmentId)}`,
        'limit=1',
      ].join('&'),
    );
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - args.windowDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = await readRows(
    SUPABASE_CONFIG,
    'appointments',
    [
      'select=id,athlete_key,athlete_id,athlete_main_id,head_scout,starts_at,status,source_event_id,operator_owner,operator_owner_key,meeting_timezone,meeting_timezone_label,post_meeting_result,source_payload',
      `starts_at=gte.${encodeURIComponent(windowStart)}`,
      `starts_at=lte.${encodeURIComponent(now.toISOString())}`,
      `status=in.(${ACTIVE_APPOINTMENT_STATUSES.map(quotePostgrestInValue).join(',')})`,
      'or=(post_meeting_result.is.null,post_meeting_result.eq.)',
      'order=starts_at.asc',
      `limit=${args.limit}`,
    ].join('&'),
  );
  return rows.filter((row) => isWatchCandidate(row, now, args.windowDays));
}

async function fetchTasks(athleteId, athleteMainId) {
  const payload = await apiFetch('/tasks/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ athlete_id: athleteId, athlete_main_id: athleteMainId }),
  }).catch(() => ({ tasks: [] }));
  return Array.isArray(payload.tasks) ? payload.tasks : [];
}

async function fetchLiveEvent(appointment) {
  const sourceEventId = normalizeText(appointment.source_event_id || appointment.id);
  if (!sourceEventId) return null;
  const payload = await apiFetch(
    `/calendar/athlete-booked-meetings?athlete_id=${encodeURIComponent(appointment.athlete_id)}&athlete_main_id=${encodeURIComponent(appointment.athlete_main_id)}`,
  ).catch(() => ({ events: [] }));
  const events = Array.isArray(payload.events) ? payload.events : [];
  return events.find((event) => normalizeText(event?.event_id) === sourceEventId) || events[0] || null;
}

async function fetchSelectedSalesStage(athleteId) {
  return apiFetch(`/sales/stages/${encodeURIComponent(athleteId)}`)
    .then(selectedStageFromPayload)
    .catch(() => null);
}

function buildAthleteName(appointment, profile) {
  return normalizeText(profile?.athlete_name || appointment?.source_payload?.athlete_name) ||
    normalizeText(appointment?.athlete_name) ||
    buildAthleteKey(appointment.athlete_id, appointment.athlete_main_id);
}

async function deleteConflictingWatcherOutcomeFacts(args) {
  await supabaseRequest(SUPABASE_CONFIG, {
    method: 'DELETE',
    table: 'call_log',
    query: [
      `appointment_id=eq.${encodeURIComponent(args.appointmentId)}`,
      'fact_type=eq.post_meeting_outcome',
      'source_system=eq.ended_meeting_outcome_watch',
      `tracker_outcome=neq.${encodeURIComponent(args.trackerOutcome)}`,
    ].join('&'),
    rows: [],
  });
}

async function processAppointment(appointment, args) {
  const athleteId = normalizeText(appointment.athlete_id);
  const athleteMainId = normalizeText(appointment.athlete_main_id);
  const [selectedStage, liveEvent, tasks, profile] = await Promise.all([
    fetchSelectedSalesStage(athleteId),
    fetchLiveEvent(appointment),
    fetchTasks(athleteId, athleteMainId),
    apiFetch(`/athlete/${encodeURIComponent(athleteId)}/resolve?force_refresh=true`).catch(() => ({})),
  ]);
  const decision = resolveWatcherDecision({ appointment, selectedStage, liveEvent });
  const athleteName = buildAthleteName(appointment, profile);
  const currentTask = tasks.find((task) => normalizeText(task?.title).toLowerCase().includes('confirmation call')) || tasks[0] || null;
  const workflowContext = resolveWorkflowContext({
    athleteId,
    athleteMainId,
    athleteName,
    sport: profile?.sport,
    gradYear: profile?.grad_year || profile?.gradYear,
    state: profile?.state,
    salesStage: selectedStage,
    taskStatus: decision.taskStatus,
    appointmentId: appointment.id,
    appointmentStatus: appointment.status,
    meetingTitle: liveEvent?.title || appointment.source_payload?.meeting_name,
  });
  const baseResult = {
    appointmentId: appointment.id,
    athleteKey: buildAthleteKey(athleteId, athleteMainId),
    athleteName,
    selectedStage,
    liveEventId: normalizeText(liveEvent?.event_id),
    liveEventTitle: normalizeText(liveEvent?.title),
    decision,
  };

  if (decision.action !== 'write_post_meeting_result') {
    return baseResult;
  }

  const ownerContext = resolveOwnerContext({
    purpose: 'meeting_outcome',
    athleteId,
    athleteMainId,
    athleteName,
    tasks,
    currentTaskId: normalizeText(currentTask?.task_id),
    bookedMeeting: liveEvent || {
      event_id: appointment.source_event_id || appointment.id,
      assigned_owner: appointment.head_scout,
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
    },
    matchedAppointment: appointment,
    resolvedProfile: profile,
    pipelineState: { head_scout: appointment.head_scout },
    appointmentId: appointment.id,
    liveEventId: liveEvent?.event_id || appointment.source_event_id || appointment.id,
  });
  const eventAt = normalizeIsoValue(appointment.starts_at);
  const occurredAt = new Date().toISOString();
  const outcomeFact = buildMeetingOutcomeFact({
    athleteId,
    athleteMainId,
    athleteName,
    source: 'ended_meeting_outcome_watch',
    rawCrmStage: selectedStage,
    rawTaskStatus: decision.taskStatus || decision.postMeetingResult,
    rawEventType: 'post_meeting_outcome',
    dedupeOutcome: decision.postMeetingResult,
    appointmentId: appointment.id,
    liveEventId: liveEvent?.event_id || appointment.source_event_id || appointment.id,
    bookedEventTitle: liveEvent?.title || appointment.source_payload?.meeting_name || null,
    occurredAt,
    eventAt,
    reportingAt: eventAt,
    ownerInput: { purpose: 'meeting_outcome', athleteId, athleteMainId },
    ownerContext,
    payload: {
      source: 'ended_meeting_outcome_watch',
      workflow_context: workflowContext,
      tracker_outcome: decision.postMeetingResult,
      selected_sales_stage: selectedStage,
      watched_appointment_id: appointment.id,
      live_event: liveEvent || null,
    },
  });
  const pendingClientRows = POST_MEETING_PENDING_RESULTS.has(decision.postMeetingResult)
    ? [
        buildPendingClientWatchlistRow({
          event: {
            event_id: `appointment:${appointment.id}`,
            title: workflowContext.meeting_title_current || workflowContext.meeting_title_base || athleteName,
            assigned_owner: appointment.head_scout,
            start: appointment.starts_at,
            end: appointmentEndIso(appointment),
          },
          description: `Pending client review from ended meeting watcher: ${decision.postMeetingResult}.`,
          matchedSignals: [decision.postMeetingResult],
          actionTag: 'Operator Input',
          aiVerdict: 'pending_client',
          athleteId,
          athleteMainId,
          athleteName,
        }),
      ]
    : [];

  if (!args.dryRun) {
    await lifecycleSalesStage({
      sourcePost: '/sales/stage',
      athleteId,
      athleteMainId,
      athleteName,
      crmStage: selectedStage,
      taskStatus: decision.taskStatus || decision.postMeetingResult,
      taskId: normalizeText(currentTask?.task_id),
      taskTitle: normalizeText(currentTask?.title),
      taskAssignedOwner: normalizeText(currentTask?.assigned_owner),
      appointmentId: appointment.id,
      payload: {
        source: 'ended_meeting_outcome_watch',
        workflow_context: workflowContext,
        post_meeting_result: decision.postMeetingResult,
        live_event_id: liveEvent?.event_id || appointment.source_event_id || appointment.id,
      },
    });
    await deleteConflictingWatcherOutcomeFacts({
      appointmentId: appointment.id,
      trackerOutcome: decision.postMeetingResult,
    });
    await upsertPostMeetingOutcomeFacts(SUPABASE_CONFIG, [outcomeFact]);
    await upsertPendingClientWatchlistRows(SUPABASE_CONFIG, pendingClientRows);
  }

  return {
    ...baseResult,
    dryRun: args.dryRun,
    wouldWrite: args.dryRun,
    postMeetingOutcomeFacts: 1,
    pendingClientRows: pendingClientRows.length,
  };
}

export async function runEndedMeetingOutcomeWatch(args = parseArgs(process.argv.slice(2))) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(`Missing Supabase credentials. Linked project: ${projectRef || 'missing'}`);
  }
  if (projectRef && !SUPABASE_URL.includes(projectRef)) {
    throw new Error(`Supabase URL ${SUPABASE_URL} does not match linked project ref ${projectRef}.`);
  }

  const lock = acquireLock();
  if (!lock.acquired) {
    return { skipped: true, reason: lock.reason, pid: lock.pid };
  }
  try {
    const appointments = await readCandidateAppointments(args);
    const results = [];
    const failures = [];
    for (const appointment of appointments) {
      try {
        results.push(await processAppointment(appointment, args));
      } catch (error) {
        failures.push({
          appointmentId: appointment.id,
          athleteId: appointment.athlete_id,
          athleteMainId: appointment.athlete_main_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      dryRun: args.dryRun,
      windowDays: args.windowDays,
      candidates: appointments.length,
      results,
      failures,
      decisions: results.reduce((counts, result) => {
        const action = result.decision?.action || 'unknown';
        counts[action] = (counts[action] || 0) + 1;
        return counts;
      }, {}),
    };
  } finally {
    releaseLock();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEndedMeetingOutcomeWatch()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (Array.isArray(summary.failures) && summary.failures.length) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack || error.message : String(error));
      process.exitCode = 1;
    });
}
