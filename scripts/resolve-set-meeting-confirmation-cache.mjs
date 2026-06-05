#!/usr/bin/env node

import fetch from 'node-fetch';
import { buildWeeklyOperatorMeetingSetCandidates } from '../src/domain/booked-meeting-source.ts';
import { buildAppointmentSnapshot } from '../src/domain/call-tracker-facts.ts';
import { resolveOwnerByName } from '../src/domain/owners.ts';
import { buildSetMeetingConfirmationCacheRows } from '../src/domain/set-meeting-confirmation-cache.ts';
import {
  deleteRows,
  readRows,
  upsertAppointments,
  upsertSetMeetingConfirmationCacheRows,
} from '../src/domain/supabase-persistence.ts';
import { getGreetingForLocalTime } from '../src/domain/outreach-time-wording.ts';
import { buildConfirmationMessage } from '../src/lib/scout-follow-up-templates.ts';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const TRACKED_OPERATOR_NAME = process.env.CALL_TRACKER_OWNER || 'Jerami Singleton';
const LIMIT = Math.max(Number.parseInt(process.env.LIMIT || '11', 10) || 11, 1);
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const EASTERN_TIME_ZONE = 'America/New_York';
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

function buildTodayThroughNextSundayWindow(now = new Date()) {
  const startOverride = String(process.env.START_DATE || '').trim();
  const endOverride = String(process.env.END_DATE || '').trim();
  if (startOverride && endOverride) {
    return { start: startOverride, end: endOverride };
  }

  const parts = easternDateParts(now);
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const daysUntilSunday = weekdayIndex <= 0 ? 7 : 7 - weekdayIndex;
  const nextSundayOffset = daysUntilSunday <= 1 ? daysUntilSunday + 7 : daysUntilSunday;
  const localNoonToday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 16, 0, 0));
  const end = new Date(localNoonToday);
  end.setUTCDate(localNoonToday.getUTCDate() + nextSundayOffset);
  return {
    start: formatDateKey(localNoonToday),
    end: formatDateKey(end),
  };
}

function getWallParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
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
    weekday: value('weekday'),
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

function buildMeetingSetConfirmationIntendedSendDate(args) {
  const meetingParts = getWallParts(args.meetingDate, args.meetingTimezone);
  const meetingLocalNoon = new Date(
    Date.UTC(meetingParts.year, meetingParts.month - 1, meetingParts.day, 12, 0, 0),
  );
  const sendLocalNoon = new Date(meetingLocalNoon);
  if (meetingParts.weekday === 'Sat' || meetingParts.weekday === 'Sun') {
    sendLocalNoon.setUTCDate(sendLocalNoon.getUTCDate() - 1);
  }

  return zonedWallTimeToUtcDate({
    year: sendLocalNoon.getUTCFullYear(),
    month: sendLocalNoon.getUTCMonth() + 1,
    day: sendLocalNoon.getUTCDate(),
    hour: 9,
    minute: 0,
    timeZone: args.meetingTimezone,
  });
}

function normalizeIsoValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizePhoneForMessages(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits;
}

function pickConfirmationRecipient(contactInfo) {
  const parent1Phone = normalizePhoneForMessages(contactInfo?.parent1?.phone);
  const parent2Phone = normalizePhoneForMessages(contactInfo?.parent2?.phone);
  const parent1Name = String(contactInfo?.parent1?.name || '').trim();
  const parent2Name = String(contactInfo?.parent2?.name || '').trim();
  if (parent1Phone) {
    return {
      phone: parent1Phone,
      names: [parent1Name, parent2Name].filter(Boolean),
      name: parent1Name,
    };
  }
  if (parent2Phone) {
    return {
      phone: parent2Phone,
      names: [parent2Name].filter(Boolean),
      name: parent2Name,
    };
  }
  const studentPhone = normalizePhoneForMessages(contactInfo?.studentAthlete?.phone);
  const studentName = String(contactInfo?.studentAthlete?.name || '').trim();
  return studentPhone
    ? { phone: studentPhone, names: [studentName].filter(Boolean), name: studentName }
    : null;
}

function calculateDurationMinutes(startValue, endValue) {
  const start = new Date(String(startValue || '').trim());
  const end = new Date(String(endValue || '').trim());
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return 60;
  }
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function buildAthleteAdminUrl(athleteId, athleteMainId) {
  const params = new URLSearchParams({ contactid: String(athleteId || '').trim() });
  const normalizedAthleteMainId = String(athleteMainId || '').trim();
  if (normalizedAthleteMainId) {
    params.set('athlete_main_id', normalizedAthleteMainId);
  }
  return `https://dashboard.nationalpid.com/admin/athletes?${params.toString()}`;
}

function buildTaskUrl(taskId) {
  const normalized = String(taskId || '').trim();
  return normalized
    ? `https://dashboard.nationalpid.com/admin/tasks/${encodeURIComponent(normalized)}`
    : '';
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

async function verifyCandidateBookedMeeting(candidate) {
  const athleteMeetings = await apiFetch(
    `/calendar/athlete-booked-meetings?athlete_id=${encodeURIComponent(candidate.athleteId)}&athlete_main_id=${encodeURIComponent(candidate.athleteMainId)}`,
  ).catch(() => ({ events: [] }));

  return (
    (Array.isArray(athleteMeetings.events) ? athleteMeetings.events : []).find(
      (meetingCandidate) =>
        String(meetingCandidate?.event_id || '').trim() === candidate.bookedMeeting.eventId ||
        (String(meetingCandidate?.title || '')
          .trim()
          .toLowerCase() === candidate.bookedMeeting.title.trim().toLowerCase() &&
          String(meetingCandidate?.start || '').trim() === candidate.bookedMeeting.start),
    ) || null
  );
}

async function fetchContactInfo(candidate) {
  return apiFetch(
    `/contacts/${encodeURIComponent(candidate.athleteId)}/enriched?athlete_main_id=${encodeURIComponent(candidate.athleteMainId)}`,
  );
}

async function fetchAthleteContactTimezone(candidate) {
  const athleteKey = `${String(candidate.athleteId || '').trim()}:${String(candidate.athleteMainId || '').trim()}`;
  if (!athleteKey.includes(':') || athleteKey.startsWith(':') || athleteKey.endsWith(':')) {
    return null;
  }
  const rows = await readRows(
    SUPABASE_CONFIG,
    'athlete_contact_cache',
    [
      'select=timezone,timezone_label',
      `athlete_key=eq.${encodeURIComponent(athleteKey)}`,
      'limit=5',
    ].join('&'),
  );
  for (const row of rows) {
    const timezone = String(row.timezone || row.timezone_label || '').trim();
    if (timezone) return timezone;
  }
  return null;
}

const windowRange = buildTodayThroughNextSundayWindow();
const [scoutTaskPayload, bookedMeetingsPayload] = await Promise.all([
  apiFetch('/scout/tasks?range=thisWeek').catch(() => ({ tasks: [] })),
  apiFetch(
    `/calendar/booked-meetings?start=${encodeURIComponent(windowRange.start)}&end=${encodeURIComponent(windowRange.end)}`,
  ),
]);

const weeklyTasks = Array.isArray(scoutTaskPayload.tasks) ? scoutTaskPayload.tasks : [];
const bookedMeetings = Array.isArray(bookedMeetingsPayload.events)
  ? bookedMeetingsPayload.events
  : [];
const candidates = buildWeeklyOperatorMeetingSetCandidates({
  bookedMeetings,
  tasks: weeklyTasks,
  operatorName: TRACKED_OPERATOR_NAME,
}).slice(0, LIMIT);

const rows = [];
const appointmentRows = [];
const resolved = [];
const failures = [];
const generatedAt = new Date().toISOString();
const trackedOperator = resolveOwnerByName(TRACKED_OPERATOR_NAME);

for (const [index, candidate] of candidates.entries()) {
  try {
    console.error(`[${index + 1}/${candidates.length}] ${candidate.bookedMeeting.title}`);
    const verifiedMeeting = await verifyCandidateBookedMeeting(candidate);
    if (!verifiedMeeting) {
      throw new Error('Candidate task athlete does not expose this booked meeting');
    }

    const contactInfo = await fetchContactInfo(candidate);
    const recipient = pickConfirmationRecipient(contactInfo);
    if (!recipient?.phone) {
      throw new Error('No parent/student phone found for confirmation cache');
    }

    const startsAt = normalizeIsoValue(candidate.bookedMeeting.start);
    if (!startsAt) {
      throw new Error('Booked meeting has no valid start time');
    }
    const meetingDate = new Date(startsAt);
    const headScoutName = String(candidate.bookedMeeting.assignedOwner || '').trim();
    const meetingTimezone = await fetchAthleteContactTimezone(candidate);
    if (!meetingTimezone) {
      throw new Error('No athlete contact timezone found for confirmation cache');
    }
    const intendedSendAt = buildMeetingSetConfirmationIntendedSendDate({
      meetingDate,
      meetingTimezone,
    });
    const confirmation1Message = buildConfirmationMessage({
      variant: 'confirmation_1',
      headScoutName,
      dueAt: meetingDate,
      meetingTimezone,
      recipientNames: recipient.names,
      greetingOverride: getGreetingForLocalTime({ now: intendedSendAt, meetingTimezone }),
      now: intendedSendAt,
    });
    const confirmation2Message = buildConfirmationMessage({
      variant: 'confirmation_2',
      headScoutName,
      dueAt: meetingDate,
      meetingTimezone,
      recipientNames: recipient.names,
      greetingOverride: getGreetingForLocalTime({ now: intendedSendAt, meetingTimezone }),
      now: intendedSendAt,
    });

    rows.push(
      ...buildSetMeetingConfirmationCacheRows({
        appointmentId: candidate.bookedMeeting.eventId,
        athleteId: candidate.athleteId,
        athleteMainId: candidate.athleteMainId,
        athleteName: candidate.athleteName,
        recipientName: recipient.name || recipient.names[0] || '',
        recipientPhone: recipient.phone,
        headScoutName,
        meetingStartsAt: startsAt,
        meetingTimezone,
        meetingDurationMinutes: calculateDurationMinutes(
          candidate.bookedMeeting.start,
          candidate.bookedMeeting.end,
        ),
        confirmation1Message,
        confirmation2Message,
        adminUrl: buildAthleteAdminUrl(candidate.athleteId, candidate.athleteMainId),
        taskUrl: buildTaskUrl(candidate.taskId),
        generatedAt,
        source: 'set_meetings_confirmation',
      }),
    );
    appointmentRows.push(
      buildAppointmentSnapshot({
        athleteId: candidate.athleteId,
        athleteMainId: candidate.athleteMainId,
        appointmentId: candidate.bookedMeeting.eventId,
        sourceEventId: candidate.bookedMeeting.eventId,
        headScout: headScoutName,
        startsAt,
        status: 'scheduled',
        meetingTimezone,
        meetingTimezoneLabel: meetingTimezone,
        originalAppointmentId: candidate.bookedMeeting.eventId,
        rescheduleSequence: 0,
        operatorOwner: TRACKED_OPERATOR_NAME,
        operatorOwnerKey: trackedOperator?.ownerKey || null,
        appointmentRole: 'unknown',
        statusReason: 'set_meeting_confirmation_cache_verified_live_booking',
        sourceSystem: 'set_meeting_confirmation_cache',
        sourcePayload: {
          generated_at: generatedAt,
          booked_event_id: candidate.bookedMeeting.eventId,
          booked_event_title: candidate.bookedMeeting.title,
          meeting_timezone_source: 'athlete_contact_cache',
          writer: 'resolve_set_meeting_confirmation_cache',
        },
        updatedAt: generatedAt,
      }),
    );
    resolved.push({
      appointmentId: candidate.bookedMeeting.eventId,
      athleteName: candidate.athleteName,
      meetingStartsAt: startsAt,
      title: candidate.bookedMeeting.title,
    });
  } catch (error) {
    failures.push({
      title: String(candidate.bookedMeeting?.title || '').trim(),
      athleteName: candidate.athleteName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (!DRY_RUN && rows.length) {
  const appointmentIds = [
    ...new Set(rows.map((row) => String(row.appointment_id || '').trim()).filter(Boolean)),
  ];
  for (const appointmentId of appointmentIds) {
    await deleteRows(SUPABASE_CONFIG, 'set_meeting_confirmation_cache', 'appointment_id', appointmentId);
  }
  await upsertAppointments(SUPABASE_CONFIG, appointmentRows);
  await upsertSetMeetingConfirmationCacheRows(SUPABASE_CONFIG, rows);
}

console.log(
  JSON.stringify(
    {
      dryRun: DRY_RUN,
      window: windowRange,
      operatorName: TRACKED_OPERATOR_NAME,
      limit: LIMIT,
      bookedMeetingCount: bookedMeetings.length,
      operatorMatchedMeetingCount: candidates.length,
      candidateCount: candidates.length,
      cacheRowsPrepared: rows.length,
      appointmentsResolved: resolved.length,
      appointmentsWritten: DRY_RUN ? 0 : appointmentRows.length,
      resolved,
      failures,
    },
    null,
    2,
  ),
);
