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
  upsertAppointments,
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
let repoEnvCache = null;

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

function readRepoEnv() {
  if (repoEnvCache) return repoEnvCache;
  repoEnvCache = {};
  try {
    const text = readFileSync(join(process.cwd(), '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      repoEnvCache[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
    }
  } catch {
    // Local env is optional; production should provide process.env.
  }
  return repoEnvCache;
}

function envValue(name) {
  return normalizeText(process.env[name]) || normalizeText(readRepoEnv()[name]);
}

function isAthleteKeyText(value) {
  return /^\d+:\d+$/.test(normalizeText(value));
}

function realName(value) {
  const text = normalizeText(value);
  if (!text || isAthleteKeyText(text)) return null;
  return text;
}

export function athleteNameFromMeetingTitle(title) {
  const cleaned = normalizeText(title)
    .replace(/^Follow Up -\s*/i, '')
    .replace(/^\([^)]+\)(?:\*\d+)?\s*/i, '')
    .trim();
  if (!cleaned || isAthleteKeyText(cleaned)) return null;
  const match = cleaned.match(/^(.+?)\s+\S+\s+(?:19|20)\d{2}\s+[A-Z]{2}\b/i);
  return realName(match?.[1]) || null;
}

export function athleteIdentityFromAppointment(appointment) {
  const key =
    normalizeText(appointment?.athlete_key) ||
    normalizeText(appointment?.source_payload?.athlete_key);
  const keyMatch = key.match(/^(\d+):(\d+)$/);
  const athleteId = normalizeText(appointment?.athlete_id) || normalizeText(keyMatch?.[1]);
  const athleteMainId =
    normalizeText(appointment?.athlete_main_id) || normalizeText(keyMatch?.[2]);
  return {
    athleteId,
    athleteMainId,
    athleteKey: athleteId && athleteMainId ? buildAthleteKey(athleteId, athleteMainId) : key,
  };
}

async function readRowsSafe(table, query) {
  return readRows(SUPABASE_CONFIG, table, query).catch(() => []);
}

export async function readSupabaseAthleteContext(athleteKey) {
  const key = normalizeText(athleteKey);
  if (!key) return {};
  const encodedKey = encodeURIComponent(key);
  const [athleteRows, contactRows, confirmationRows, callLogRows, appointmentRows] = await Promise.all([
    readRowsSafe('athletes', `select=athlete_name&athlete_key=eq.${encodedKey}&limit=1`),
    readRowsSafe(
      'athlete_contact_cache',
      `select=athlete_name&athlete_key=eq.${encodedKey}&order=updated_at.desc&limit=5`,
    ),
    readRowsSafe(
      'set_meeting_confirmation_cache',
      `select=athlete_name&athlete_key=eq.${encodedKey}&order=updated_at.desc&limit=5`,
    ),
    readRowsSafe(
      'call_log',
      `select=athlete_name&athlete_key=eq.${encodedKey}&order=updated_at.desc&limit=5`,
    ),
    readRowsSafe(
      'appointments',
      [
        'select=id,athlete_key,athlete_id,athlete_main_id,head_scout,starts_at,status,source_event_id,operator_owner,operator_owner_key,meeting_timezone,meeting_timezone_label,previous_appointment_id,original_appointment_id,reschedule_sequence,source_payload',
        `athlete_key=eq.${encodedKey}`,
        'order=starts_at.desc',
        'limit=10',
      ].join('&'),
    ),
  ]);

  return {
    athleteName: athleteRows.find((row) => realName(row?.athlete_name))?.athlete_name || null,
    contactCacheAthleteName: contactRows.find((row) => realName(row?.athlete_name))?.athlete_name || null,
    confirmationCacheAthleteName:
      confirmationRows.find((row) => realName(row?.athlete_name))?.athlete_name || null,
    callLogAthleteName: callLogRows.find((row) => realName(row?.athlete_name))?.athlete_name || null,
    appointmentRows,
  };
}

export function hydrateWatcherAppointmentFromSupabaseContext(appointment, supabaseContext = {}) {
  const identity = athleteIdentityFromAppointment(appointment);
  const sameKeyAppointments = Array.isArray(supabaseContext?.appointmentRows)
    ? supabaseContext.appointmentRows
    : [];
  const sameAppointment =
    sameKeyAppointments.find((row) => normalizeText(row?.id) === normalizeText(appointment?.id)) ||
    {};
  const sourcePayload =
    appointment?.source_payload && typeof appointment.source_payload === 'object'
      ? appointment.source_payload
      : {};
  const sameAppointmentPayload =
    sameAppointment?.source_payload && typeof sameAppointment.source_payload === 'object'
      ? sameAppointment.source_payload
      : {};

  return {
    ...appointment,
    athlete_key: identity.athleteKey || normalizeText(sameAppointment?.athlete_key) || null,
    athlete_id: identity.athleteId || normalizeText(sameAppointment?.athlete_id) || null,
    athlete_main_id:
      identity.athleteMainId || normalizeText(sameAppointment?.athlete_main_id) || null,
    head_scout: normalizeText(appointment?.head_scout) || normalizeText(sameAppointment?.head_scout) || null,
    source_event_id:
      normalizeText(appointment?.source_event_id) || normalizeText(sameAppointment?.source_event_id) || null,
    operator_owner:
      normalizeText(appointment?.operator_owner) || normalizeText(sameAppointment?.operator_owner) || null,
    operator_owner_key:
      normalizeText(appointment?.operator_owner_key) ||
      normalizeText(sameAppointment?.operator_owner_key) ||
      null,
    meeting_timezone:
      normalizeText(appointment?.meeting_timezone) ||
      normalizeText(sameAppointment?.meeting_timezone) ||
      null,
    meeting_timezone_label:
      normalizeText(appointment?.meeting_timezone_label) ||
      normalizeText(sameAppointment?.meeting_timezone_label) ||
      null,
    previous_appointment_id:
      normalizeText(appointment?.previous_appointment_id) ||
      normalizeText(sameAppointment?.previous_appointment_id) ||
      null,
    original_appointment_id:
      normalizeText(appointment?.original_appointment_id) ||
      normalizeText(sameAppointment?.original_appointment_id) ||
      null,
    reschedule_sequence:
      appointment?.reschedule_sequence ?? sameAppointment?.reschedule_sequence ?? null,
    source_payload: {
      ...sameAppointmentPayload,
      ...sourcePayload,
      athlete_key: identity.athleteKey || sourcePayload.athlete_key || sameAppointmentPayload.athlete_key || null,
    },
  };
}

function normalizeIsoValue(value) {
  const trimmed = normalizeText(value);
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getWallParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  const hour = Number.parseInt(value('hour'), 10);
  return {
    year: Number.parseInt(value('year'), 10),
    month: Number.parseInt(value('month'), 10),
    day: Number.parseInt(value('day'), 10),
    hour: hour === 24 ? 0 : hour,
    minute: Number.parseInt(value('minute'), 10) || 0,
    second: Number.parseInt(value('second'), 10) || 0,
  };
}

function zonedWallTimeToUtcDate(args) {
  const expectedWallUtc = Date.UTC(
    args.year,
    args.month - 1,
    args.day,
    args.hour,
    args.minute,
    args.second || 0,
  );
  const initial = new Date(expectedWallUtc);
  const actualWall = getWallParts(initial, args.timeZone);
  const actualWallUtc = Date.UTC(
    actualWall.year,
    actualWall.month - 1,
    actualWall.day,
    actualWall.hour,
    actualWall.minute,
    actualWall.second,
  );
  return new Date(initial.getTime() - (actualWallUtc - expectedWallUtc));
}

export function parseLiveEventTimeAsEastern(value) {
  const trimmed = normalizeText(value);
  if (!trimmed) return null;
  if (/(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) return normalizeIsoValue(trimmed);

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return normalizeIsoValue(trimmed);

  return zonedWallTimeToUtcDate({
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
    hour: Number.parseInt(match[4], 10),
    minute: Number.parseInt(match[5], 10),
    second: Number.parseInt(match[6] || '0', 10),
    timeZone: 'America/New_York',
  }).toISOString();
}

export function buildReplacementAppointmentRow(args) {
  const appointment = args.appointment || {};
  const liveEvent = args.liveEvent || {};
  const replacementId = normalizeText(liveEvent.event_id);
  const previousAppointmentId = normalizeText(appointment.id);
  const startsAt = parseLiveEventTimeAsEastern(liveEvent.start);
  if (!replacementId || !previousAppointmentId || replacementId === previousAppointmentId || !startsAt) {
    return null;
  }

  const endsAt = parseLiveEventTimeAsEastern(liveEvent.end);
  const previousSequence = Number.parseInt(normalizeText(appointment.reschedule_sequence || '0'), 10);
  const originalAppointmentId =
    normalizeText(appointment.original_appointment_id) ||
    normalizeText(appointment.previous_appointment_id) ||
    previousAppointmentId;
  return {
    id: replacementId,
    athlete_key: args.athleteKey,
    athlete_id: normalizeText(appointment.athlete_id),
    athlete_main_id: normalizeText(appointment.athlete_main_id),
    head_scout: normalizeText(liveEvent.assigned_owner) || normalizeText(appointment.head_scout) || null,
    starts_at: startsAt,
    status: 'rescheduled',
    source_event_id: replacementId,
    meeting_timezone: 'America/New_York',
    meeting_timezone_label: 'EST',
    previous_appointment_id: previousAppointmentId,
    original_appointment_id: originalAppointmentId,
    reschedule_sequence: Number.isFinite(previousSequence) ? previousSequence + 1 : 1,
    operator_owner: normalizeText(appointment.operator_owner) || null,
    operator_owner_key: normalizeText(appointment.operator_owner_key) || null,
    appointment_role: 'reschedule',
    status_reason: 'watcher_live_replacement_written',
    source_system: 'ended_meeting_outcome_watch',
    source_payload: {
      writer: 'ended_meeting_outcome_watch',
      watched_appointment_id: previousAppointmentId,
      previous_appointment_id: previousAppointmentId,
      source_event_id: replacementId,
      booked_event_id: replacementId,
      booked_event_title: normalizeText(liveEvent.title) || null,
      meeting_name: normalizeText(liveEvent.title) || normalizeText(appointment.source_payload?.meeting_name) || null,
      meeting_timezone_source: 'live_calendar_assumed_eastern',
      live_event: liveEvent,
      ...(endsAt ? { ends_at: endsAt } : {}),
    },
    post_meeting_result: null,
  };
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
  const identity = athleteIdentityFromAppointment(appointment);
  if (!identity.athleteId || !identity.athleteMainId) return false;
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
        'select=id,athlete_key,athlete_id,athlete_main_id,head_scout,starts_at,status,source_event_id,operator_owner,operator_owner_key,meeting_timezone,meeting_timezone_label,post_meeting_result,previous_appointment_id,original_appointment_id,reschedule_sequence,source_payload',
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
      'select=id,athlete_key,athlete_id,athlete_main_id,head_scout,starts_at,status,source_event_id,operator_owner,operator_owner_key,meeting_timezone,meeting_timezone_label,post_meeting_result,previous_appointment_id,original_appointment_id,reschedule_sequence,source_payload',
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

export function buildAthleteName(appointment, profile, liveEvent = null, supabaseContext = {}) {
  const athleteName =
    realName(supabaseContext?.athleteName) ||
    realName(supabaseContext?.contactCacheAthleteName) ||
    realName(supabaseContext?.confirmationCacheAthleteName) ||
    realName(supabaseContext?.callLogAthleteName) ||
    realName(profile?.athlete_name) ||
    realName(profile?.athleteName) ||
    realName(appointment?.source_payload?.athlete_name) ||
    realName(appointment?.athlete_name) ||
    athleteNameFromMeetingTitle(liveEvent?.title) ||
    athleteNameFromMeetingTitle(appointment?.source_payload?.meeting_name) ||
    athleteNameFromMeetingTitle(appointment?.source_payload?.booked_event_title);

  if (!athleteName) {
    throw new Error(
      `Missing real athlete name for ${buildAthleteKey(appointment.athlete_id, appointment.athlete_main_id)}`,
    );
  }
  return athleteName;
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

export function buildWatcherFailureEmail(args) {
  const failures = Array.isArray(args?.failures) ? args.failures : [];
  const subject = `Prospect Pipeline watcher failed: ${failures.length} row${failures.length === 1 ? '' : 's'}`;
  const renderedFailures = failures.slice(0, 10).map((failure, index) => {
    const athleteKey =
      normalizeText(failure.athleteId) && normalizeText(failure.athleteMainId)
        ? `${normalizeText(failure.athleteId)}:${normalizeText(failure.athleteMainId)}`
        : 'unknown';
    return [
      `${index + 1}. Appointment ${normalizeText(failure.appointmentId) || 'unknown'}`,
      `   Athlete key: ${athleteKey}`,
      `   Error: ${normalizeText(failure.error) || 'unknown'}`,
      '   Meaning: required same-key Supabase context was missing or invalid, so the watcher refused to write fallback data.',
      '   Check first: athletes, athlete_contact_cache, set_meeting_confirmation_cache, appointments, call_log.',
    ].join('\n');
  });
  const body = [
    'Prospect Pipeline bug notification',
    '',
    'What happened',
    'The ended-meeting watcher stopped on one or more rows instead of writing arbitrary fallback data.',
    '',
    'Why this matters',
    'This protects Supabase truth from key-shaped or fabricated values leaking into athlete names, meeting titles, workflow context, or reporting facts.',
    '',
    'Run context',
    `- Script: scripts/watch-ended-meeting-outcomes.mjs`,
    `- Mode: ${args?.dryRun ? 'dry-run' : 'write'}`,
    `- Window days: ${args?.windowDays ?? 'unknown'}`,
    `- Candidate count: ${args?.candidates ?? 'unknown'}`,
    `- Failure count: ${failures.length}`,
    '',
    'Failed rows',
    ...renderedFailures,
    failures.length > 10 ? `...and ${failures.length - 10} more` : null,
    '',
    'Related code and contract',
    '- scripts/watch-ended-meeting-outcomes.mjs: watcher, same-key Supabase context lookup, and bug notification sender',
    '- scripts/watch-ended-meeting-outcomes.test.mjs: regression coverage for no key-shaped names and notification text',
    '- docs/architecture/scout-prep-supabase-source-of-truth.md: no arbitrary fallback rule and BUG_NOTIFICATIONS_* channel',
    '',
    'Operator action',
    'Fix the missing Supabase/source-domain value for the listed athlete key or appointment. Do not add broad fallback guesses.',
  ]
    .filter(Boolean)
    .join('\n');
  return { subject, body };
}

async function sendWatcherFailureEmail(summary) {
  if (!Array.isArray(summary.failures) || !summary.failures.length) return null;
  const apiKey = envValue('BUG_NOTIFICATIONS_RESEND_API_KEY') || envValue('RESEND_API_KEY');
  const from = envValue('BUG_NOTIFICATIONS_FROM');
  const to = envValue('BUG_NOTIFICATIONS_TO');
  if (!apiKey || !from || !to) {
    return { sent: false, reason: 'missing_bug_notifications_env' };
  }

  const email = buildWatcherFailureEmail(summary);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: to.split(',').map((value) => value.trim()).filter(Boolean),
      subject: email.subject,
      text: email.body,
    }),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`Resend alert failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  return { sent: true };
}

async function processAppointment(appointment, args) {
  const initialIdentity = athleteIdentityFromAppointment(appointment);
  const initialSupabaseContext = await readSupabaseAthleteContext(initialIdentity.athleteKey);
  appointment = hydrateWatcherAppointmentFromSupabaseContext(appointment, initialSupabaseContext);
  const { athleteId, athleteMainId, athleteKey } = athleteIdentityFromAppointment(appointment);
  const [selectedStage, liveEvent, tasks, profile, supabaseContext] = await Promise.all([
    fetchSelectedSalesStage(athleteId),
    fetchLiveEvent(appointment),
    fetchTasks(athleteId, athleteMainId),
    apiFetch(`/athlete/${encodeURIComponent(athleteId)}/resolve?force_refresh=true`).catch(() => ({})),
    initialSupabaseContext,
  ]);
  const decision = resolveWatcherDecision({ appointment, selectedStage, liveEvent });
  const athleteName = buildAthleteName(appointment, profile, liveEvent, supabaseContext);
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
    athleteKey,
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
  const replacementAppointmentRow =
    decision.postMeetingResult === 'rescheduled'
      ? buildReplacementAppointmentRow({ appointment, liveEvent, athleteKey })
      : null;

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
    if (replacementAppointmentRow) {
      await upsertAppointments(SUPABASE_CONFIG, [replacementAppointmentRow]);
    }
    await upsertPostMeetingOutcomeFacts(SUPABASE_CONFIG, [outcomeFact]);
    await upsertPendingClientWatchlistRows(SUPABASE_CONFIG, pendingClientRows);
  }

  return {
    ...baseResult,
    dryRun: args.dryRun,
    wouldWrite: args.dryRun,
    postMeetingOutcomeFacts: 1,
    replacementAppointments: replacementAppointmentRow ? 1 : 0,
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
    const summary = {
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
    if (failures.length) {
      try {
        summary.notification = await sendWatcherFailureEmail(summary);
      } catch (error) {
        summary.notification = {
          sent: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return summary;
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
