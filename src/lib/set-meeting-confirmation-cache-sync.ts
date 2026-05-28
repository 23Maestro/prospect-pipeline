import type { MeetingSetSubmitResponse, ScoutPrepContext } from '../features/scout-prep/types';
import {
  buildConfirmationMessage,
  type ConfirmationFollowUpVariant,
} from './scout-follow-up-templates';
import { getMeetingReminderRecipient } from '../domain/scout-contact-selection';
import { getGreetingForLocalTime } from '../domain/outreach-time-wording';
import { buildSetMeetingConfirmationCacheRows } from '../domain/set-meeting-confirmation-cache';
import {
  deleteRows,
  upsertSetMeetingConfirmationCacheRows,
  type SupabasePersistenceConfig,
} from '../domain/supabase-persistence';
import { getSupabasePersistenceConfig } from './supabase-lifecycle';

export type MeetingSetConfirmationCacheInput = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  context: ScoutPrepContext;
  meetingSet: {
    openEventId?: string | null;
    startsAt?: string | null;
    startTime?: string | null;
    meetingTimezone?: string | null;
    meetingLength?: string | null;
    bookedMeetingAssignedOwner?: string | null;
    headScout?: string | null;
  };
  meetingSetResult?: Partial<MeetingSetSubmitResponse> | null;
  generatedAt?: string;
};

const LEGACY_TIMEZONE_TO_IANA: Record<string, string> = {
  EST: 'America/New_York',
  CST: 'America/Chicago',
  MST: 'America/Denver',
  PST: 'America/Los_Angeles',
  AKST: 'America/Anchorage',
  HST: 'Pacific/Honolulu',
  AST: 'America/Puerto_Rico',
  ET: 'America/New_York',
  EASTERN: 'America/New_York',
  CT: 'America/Chicago',
  CENTRAL: 'America/Chicago',
  MT: 'America/Denver',
  MOUNTAIN: 'America/Denver',
  PT: 'America/Los_Angeles',
  PACIFIC: 'America/Los_Angeles',
  ARIZONA: 'America/Phoenix',
};

function clean(value?: string | null): string {
  return String(value || '').trim();
}

function buildAthleteAdminUrl(athleteId: string, athleteMainId?: string | null): string {
  const params = new URLSearchParams({
    contactid: clean(athleteId),
  });
  const normalizedAthleteMainId = clean(athleteMainId);
  if (normalizedAthleteMainId) {
    params.set('athlete_main_id', normalizedAthleteMainId);
  }
  return `https://dashboard.nationalpid.com/admin/athletes?${params.toString()}`;
}

export function getSetMeetingConfirmationSupabaseConfig(): SupabasePersistenceConfig | null {
  return getSupabasePersistenceConfig();
}

function parseMeetingDate(value?: string | null): Date | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveRequiredIanaTimeZone(timezone?: string | null): string {
  const trimmed = clean(timezone);
  if (!trimmed) {
    throw new Error('Missing required Meeting Set confirmation cache fields: meetingTimezone');
  }
  const legacy = LEGACY_TIMEZONE_TO_IANA[trimmed.toUpperCase()];
  if (legacy) return legacy;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    throw new Error(`Invalid Meeting Set confirmation cache timezone: ${trimmed}`);
  }
}

function getWallParts(date: Date, timeZone: string) {
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
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '';
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

function zonedWallTimeToUtcDate(args: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
  timeZone: string;
}): Date {
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

function parseMeetingDateInTimezone(value: string, timeZone: string): Date | null {
  const trimmed = clean(value);
  const hasExplicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  if (hasExplicitZone) return parseMeetingDate(trimmed);

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return parseMeetingDate(trimmed);

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

export function buildMeetingSetConfirmationIntendedSendDate(args: {
  meetingDate: Date;
  meetingTimezone: string;
}): Date {
  const timeZone = resolveRequiredIanaTimeZone(args.meetingTimezone);
  const meetingDate = args.meetingDate;
  const meetingParts = getWallParts(meetingDate, timeZone);
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
    timeZone,
  });
}

function parseRequiredMeetingLengthMinutes(value?: string | null): number {
  const trimmed = clean(value);
  if (!trimmed) {
    throw new Error('Missing required Meeting Set confirmation cache fields: meetingLength');
  }
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid Meeting Set confirmation cache meeting length: ${trimmed}`);
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const total = hours * 60 + minutes;
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(`Invalid Meeting Set confirmation cache meeting length: ${trimmed}`);
  }
  return total;
}

export function buildMeetingSetConfirmationCacheRowsFromScoutPrep(
  args: MeetingSetConfirmationCacheInput,
) {
  const appointmentId =
    clean(args.meetingSetResult?.open_event_id) || clean(args.meetingSet.openEventId);
  const meetingTimezone = clean(args.meetingSet.meetingTimezone);
  const ianaTimeZone = resolveRequiredIanaTimeZone(meetingTimezone);
  const meetingStartsAt =
    clean(args.meetingSet.startsAt) ||
    clean(args.meetingSet.startTime) ||
    clean(args.meetingSetResult?.created_task?.due_date);
  const meetingDate = meetingStartsAt
    ? parseMeetingDateInTimezone(meetingStartsAt, ianaTimeZone)
    : null;
  const reminderRecipient = getMeetingReminderRecipient(args.context);
  const recipientPhone = reminderRecipient?.phones[0] || '';
  const recipientName = reminderRecipient?.recipientNames[0] || '';
  const headScoutName =
    clean(args.meetingSet.headScout) ||
    clean(args.meetingSet.bookedMeetingAssignedOwner) ||
    clean(args.context.resolved.head_scout);
  const missing = [
    !appointmentId ? 'appointmentId' : null,
    !clean(args.athleteId) ? 'athleteId' : null,
    !clean(args.athleteMainId) ? 'athleteMainId' : null,
    !clean(args.athleteName) ? 'athleteName' : null,
    !meetingStartsAt ? 'meetingStartsAt' : null,
    !meetingDate ? 'parseableMeetingStartsAt' : null,
    !meetingTimezone ? 'meetingTimezone' : null,
    !headScoutName ? 'headScoutName' : null,
    !reminderRecipient ? 'reminderRecipient' : null,
    !recipientName ? 'recipientName' : null,
    !recipientPhone ? 'recipientPhone' : null,
    !clean(args.context.task.athlete_task_url) ? 'taskUrl' : null,
  ].filter((value): value is string => Boolean(value));
  if (missing.length) {
    throw new Error(
      `Missing required Meeting Set confirmation cache fields: ${missing.join(', ')}`,
    );
  }

  const generatedAt = args.generatedAt || new Date().toISOString();
  const intendedSendAt = buildMeetingSetConfirmationIntendedSendDate({
    meetingDate,
    meetingTimezone,
  });
  const meetingDurationMinutes = parseRequiredMeetingLengthMinutes(args.meetingSet.meetingLength);
  const confirmation = (variant: ConfirmationFollowUpVariant) =>
    buildConfirmationMessage({
      variant,
      headScoutName,
      dueAt: meetingDate,
      meetingTimezone,
      recipientNames: reminderRecipient.recipientNames,
      greetingOverride: getGreetingForLocalTime({ now: intendedSendAt, meetingTimezone }),
      now: intendedSendAt,
    });

  const rows = buildSetMeetingConfirmationCacheRows({
    appointmentId,
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName,
    recipientName,
    recipientPhone,
    headScoutName,
    meetingStartsAt: meetingDate.toISOString(),
    meetingTimezone,
    meetingDurationMinutes,
    confirmation1Message: confirmation('confirmation_1'),
    confirmation2Message: confirmation('confirmation_2'),
    adminUrl: buildAthleteAdminUrl(args.athleteId, args.athleteMainId),
    taskUrl: clean(args.context.task.athlete_task_url),
    generatedAt,
    source: 'set_meetings_confirmation',
  });
  if (rows.length !== 2) {
    throw new Error(`Meeting Set confirmation cache expected 2 rows, built ${rows.length}`);
  }
  return rows;
}

export async function syncMeetingSetConfirmationCacheFromScoutPrep(
  args: MeetingSetConfirmationCacheInput,
  config: SupabasePersistenceConfig | null = getSetMeetingConfirmationSupabaseConfig(),
): Promise<{ enabled: boolean; count: number }> {
  if (!config) {
    throw new Error('Missing Supabase config for Meeting Set confirmation cache write');
  }
  const rows = buildMeetingSetConfirmationCacheRowsFromScoutPrep(args);
  if (rows.length !== 2) {
    throw new Error(`Meeting Set confirmation cache expected 2 rows, built ${rows.length}`);
  }
  await deleteRows(
    config,
    'set_meeting_confirmation_cache',
    'appointment_id',
    rows[0].appointment_id,
  );
  await upsertSetMeetingConfirmationCacheRows(config, rows);
  return { enabled: true, count: rows.length };
}
