#!/usr/bin/env node

import fetch from 'node-fetch';
import { existsSync, readFileSync } from 'node:fs';
import { buildSetMeetingConfirmationCacheRows } from '../src/domain/set-meeting-confirmation-cache.ts';
import { supabaseRequest } from '../src/domain/supabase-persistence.ts';
import { getGreetingForLocalTime } from '../src/domain/outreach-time-wording.ts';
import { buildConfirmationMessage } from '../src/lib/scout-follow-up-templates.ts';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

function loadEnvFallback() {
  for (const envPath of ['.env', 'npid-api-layer/.env']) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      if (process.env[key]) continue;
      process.env[key] = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
}

loadEnvFallback();

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const API_TOKEN = String(
  process.env.PROSPECT_API_TOKEN ||
    process.env.INTERNAL_API_SECRET ||
    process.env.CALL_TRACKER_SYNC_SECRET ||
    '',
).trim();
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const EASTERN_TIME_ZONE = 'America/New_York';
const DEFAULT_OPERATOR_KEY = 'tim_risner';

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

if (!API_TOKEN) {
  console.error('Missing PROSPECT_API_TOKEN for Tim Lite mobile sync.');
  process.exit(1);
}

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

function easternDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    year: Number.parseInt(value('year'), 10),
    month: Number.parseInt(value('month'), 10),
    day: Number.parseInt(value('day'), 10),
    weekday: value('weekday'),
  };
}

function formatDateKey(date) {
  const parts = easternDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function buildWeekWindow(week = process.env.WEEK || 'this', now = new Date()) {
  const startOverride = String(process.env.START_DATE || '').trim();
  const endOverride = String(process.env.END_DATE || '').trim();
  if (startOverride && endOverride) return { start: startOverride, end: endOverride };

  const parts = easternDateParts(now);
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const mondayOffset = weekdayIndex === 0 ? -6 : 1 - weekdayIndex;
  const weekOffset = week === 'next' ? 1 : 0;
  const localNoon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 16, 0, 0));
  const start = new Date(localNoon);
  start.setUTCDate(localNoon.getUTCDate() + mondayOffset + weekOffset * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start: formatDateKey(start), end: formatDateKey(end) };
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
    hour12: false,
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

function parseMeetingDateInTimezone(value, timeZone) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (/(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, year, month, day, hour, minute, second] = match;
  return zonedWallTimeToUtcDate({
    year: Number.parseInt(year, 10),
    month: Number.parseInt(month, 10),
    day: Number.parseInt(day, 10),
    hour: Number.parseInt(hour, 10),
    minute: Number.parseInt(minute, 10),
    second: Number.parseInt(second || '0', 10),
    timeZone,
  });
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length === 10 ? digits : '';
}

function normalizeTimezone(value, label) {
  const raw = String(value || '').trim();
  if (raw.includes('/')) return raw;
  const key = `${raw} ${label || ''}`.trim().toLowerCase();
  if (/\b(cst|central|ct)\b/.test(key)) return 'America/Chicago';
  if (/\b(mst|mountain|mt)\b/.test(key)) return 'America/Denver';
  if (/\b(pst|pacific|pt)\b/.test(key)) return 'America/Los_Angeles';
  if (/\b(ast|atlantic)\b/.test(key)) return 'America/Puerto_Rico';
  return EASTERN_TIME_ZONE;
}

function timezoneLabel(timeZone) {
  if (timeZone === 'America/Chicago') return 'CT';
  if (timeZone === 'America/Denver') return 'MT';
  if (timeZone === 'America/Los_Angeles') return 'PT';
  if (timeZone === 'America/Puerto_Rico') return 'AST';
  return 'ET';
}

function relationshipLabel(recipient) {
  return String(recipient?.relationship || recipient?.role || 'Contact').trim() || 'Contact';
}

function buildTimAppointmentRow(event, generatedAt) {
  const appointmentId = String(event.appointment_id || event.event_id || '').trim();
  const meetingTimezone = normalizeTimezone(
    event.contact_timezone || event.meeting_timezone,
    event.contact_timezone_label || event.meeting_timezone_label,
  );
  const startsAtDate = parseMeetingDateInTimezone(event.start || event.meeting_starts_at, meetingTimezone);
  const endsAtDate =
    parseMeetingDateInTimezone(event.end || event.meeting_ends_at, meetingTimezone) ||
    (startsAtDate ? new Date(startsAtDate.getTime() + 60 * 60_000) : null);
  return {
    id: appointmentId,
    operator_key: DEFAULT_OPERATOR_KEY,
    appointment_id: appointmentId,
    source_event_id: String(event.event_id || '').trim() || appointmentId,
    athlete_key: `${event.athlete_id || ''}:${event.athlete_main_id || ''}`,
    athlete_id: String(event.athlete_id || '').trim() || null,
    athlete_main_id: String(event.athlete_main_id || '').trim() || null,
    athlete_name: String(event.athlete_name || 'Student Athlete').trim(),
    head_scout_name: String(event.head_scout_name || event.assigned_owner || '').trim() || null,
    starts_at: startsAtDate?.toISOString() || null,
    ends_at: endsAtDate?.toISOString() || null,
    meeting_timezone: meetingTimezone,
    meeting_timezone_label: timezoneLabel(meetingTimezone),
    status: 'scheduled',
    admin_url: String(event.admin_url || '').trim() || null,
    task_url: String(event.task_url || '').trim() || null,
    source: 'tim_lite_sync',
    source_payload: event,
    last_synced_at: generatedAt,
    created_at: generatedAt,
    updated_at: generatedAt,
  };
}

function buildTimConfirmationRows(event, generatedAt) {
  const appointment = buildTimAppointmentRow(event, generatedAt);
  const recipient = event.confirmation_recipient || {};
  const recipientPhone = normalizePhone(recipient.phone);
  const recipientName = String(recipient.name || '').trim();
  if (!appointment.appointment_id) throw new Error('missing appointment id');
  if (!appointment.athlete_id || !appointment.athlete_main_id) throw new Error('missing athlete ids');
  if (!appointment.starts_at) throw new Error('missing meeting start');
  if (!recipientPhone) throw new Error('missing confirmation recipient phone');
  if (!recipientName) throw new Error('missing confirmation recipient name');

  const startsAtDate = new Date(appointment.starts_at);
  const durationMinutes = appointment.ends_at
    ? Math.max(Math.round((new Date(appointment.ends_at).getTime() - startsAtDate.getTime()) / 60_000), 1)
    : 60;
  const greeting = getGreetingForLocalTime({
    now: new Date(),
    meetingTimezone: appointment.meeting_timezone,
  });
  const message = (variant) =>
    buildConfirmationMessage({
      variant,
      headScoutName: appointment.head_scout_name,
      dueAt: startsAtDate,
      meetingTimezone: appointment.meeting_timezone,
      recipientNames: [recipientName],
      greetingOverride: greeting,
      now: new Date(),
    });
  const baseRows = buildSetMeetingConfirmationCacheRows({
    appointmentId: appointment.appointment_id,
    athleteId: appointment.athlete_id,
    athleteMainId: appointment.athlete_main_id,
    athleteName: appointment.athlete_name,
    recipientName,
    recipientPhone,
    recipientContacts: [
      {
        label: relationshipLabel(recipient),
        name: recipientName,
        phone: recipientPhone,
      },
    ],
    headScoutName: appointment.head_scout_name || 'Scout',
    meetingStartsAt: appointment.starts_at,
    meetingTimezone: appointment.meeting_timezone,
    meetingDurationMinutes: durationMinutes,
    confirmation1Message: message('confirmation_1'),
    confirmation2Message: message('confirmation_2'),
    adminUrl: appointment.admin_url || '',
    taskUrl: appointment.task_url || '',
    generatedAt,
    source: 'tim_lite_sync',
  });

  return baseRows.map((row) => {
    const dedupeKey = `tim_lite:${appointment.appointment_id}:${row.kind}:${recipientPhone}`;
    return {
      id: dedupeKey,
      operator_key: DEFAULT_OPERATOR_KEY,
      appointment_id: appointment.appointment_id,
      kind: row.kind,
      status: 'cached',
      dedupe_key: dedupeKey,
      athlete_key: appointment.athlete_key,
      athlete_id: appointment.athlete_id,
      athlete_main_id: appointment.athlete_main_id,
      athlete_name: appointment.athlete_name,
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      normalized_phone: recipientPhone,
      relationship_label: relationshipLabel(recipient),
      head_scout_name: appointment.head_scout_name,
      meeting_starts_at: appointment.starts_at,
      meeting_ends_at: appointment.ends_at,
      meeting_timezone: appointment.meeting_timezone,
      meeting_timezone_label: appointment.meeting_timezone_label,
      message_body: row.message_body,
      admin_url: appointment.admin_url,
      task_url: appointment.task_url,
      source: 'tim_lite_sync',
      source_payload: {
        ...event,
        confirmation_kind: row.kind,
      },
      generated_at: generatedAt,
      created_at: generatedAt,
      updated_at: generatedAt,
    };
  });
}

async function apiFetch(pathname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${API_BASE}${pathname}`, {
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${pathname} -> HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${pathname} -> request timed out after 30s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function writeRows(table, rows, onConflict) {
  if (!rows.length) return { table, count: 0 };
  await supabaseRequest(SUPABASE_CONFIG, {
    table,
    rows,
    onConflict,
  });
  return { table, count: rows.length };
}

async function run() {
  const generatedAt = new Date().toISOString();
  const windowRange = buildWeekWindow();
  const taskRange = process.env.TASK_RANGE || (process.env.WEEK === 'next' ? 'nextWeek' : 'thisWeek');
  const params = new URLSearchParams({
    start: windowRange.start,
    end: windowRange.end,
    task_range: taskRange,
  });
  const payload = await apiFetch(`/mobile/coach-risner/set-meetings?${params.toString()}`);
  const events = Array.isArray(payload.events) ? payload.events : [];
  const appointmentRows = [];
  const confirmationRows = [];
  const failures = [];

  for (const event of events) {
    try {
      appointmentRows.push(buildTimAppointmentRow(event, generatedAt));
      confirmationRows.push(...buildTimConfirmationRows(event, generatedAt));
    } catch (error) {
      failures.push({
        event_id: String(event?.event_id || event?.appointment_id || '').trim(),
        athlete_name: String(event?.athlete_name || '').trim(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!DRY_RUN) {
    await writeRows('tim_lite_appointments', appointmentRows, 'id');
    await writeRows('tim_lite_confirmation_cache', confirmationRows, 'dedupe_key');
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        window: windowRange,
        taskRange,
        sourceCount: events.length,
        appointmentRowsPrepared: appointmentRows.length,
        confirmationRowsPrepared: confirmationRows.length,
        appointmentsWritten: DRY_RUN ? 0 : appointmentRows.length,
        confirmationRowsWritten: DRY_RUN ? 0 : confirmationRows.length,
        failures,
      },
      null,
      2,
    ),
  );
}

await run();
