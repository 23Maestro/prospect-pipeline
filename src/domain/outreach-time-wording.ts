const TIMEZONE_LABEL_TO_WORD: Record<string, string> = {
  EST: 'eastern',
  CST: 'central',
  MST: 'mountain',
  PST: 'pacific',
  AKST: 'alaska',
  HST: 'hawaii',
  AST: 'atlantic',
};

const TIMEZONE_LABEL_TO_IANA: Record<string, string> = {
  EST: 'America/New_York',
  CST: 'America/Chicago',
  MST: 'America/Denver',
  PST: 'America/Los_Angeles',
  AKST: 'America/Anchorage',
  HST: 'Pacific/Honolulu',
  AST: 'America/Puerto_Rico',
};


const HUMAN_TIMEZONE_LABEL_TO_IANA: Record<string, string> = {
  EASTERN: 'America/New_York',
  ET: 'America/New_York',
  CENTRAL: 'America/Chicago',
  CT: 'America/Chicago',
  MOUNTAIN: 'America/Denver',
  MT: 'America/Denver',
  PACIFIC: 'America/Los_Angeles',
  PT: 'America/Los_Angeles',
  ARIZONA: 'America/Phoenix',
};

const IANA_TO_TIMEZONE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(TIMEZONE_LABEL_TO_IANA).map(([label, iana]) => [iana, label]),
);
IANA_TO_TIMEZONE_LABEL['America/Phoenix'] = 'MST';

const TIMEZONE_LABEL_TO_CONFIRMATION_ABBREVIATION: Record<string, string> = {
  EST: 'ET',
  CST: 'CT',
  MST: 'MT',
  PST: 'PT',
};

type TemporalInput = Date | string | number;
type TimeOfDayBucket = 'morning' | 'afternoon' | 'evening';

function toDate(value: TemporalInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function resolveIanaTimeZoneFromLegacyLabel(timezoneLabel?: string | null): string {
  const trimmed = String(timezoneLabel || '').trim();
  if (!trimmed) {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  }
  const normalized = trimmed.toUpperCase();
  if (TIMEZONE_LABEL_TO_IANA[normalized]) {
    return TIMEZONE_LABEL_TO_IANA[normalized];
  }
  if (HUMAN_TIMEZONE_LABEL_TO_IANA[normalized]) {
    return HUMAN_TIMEZONE_LABEL_TO_IANA[normalized];
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  }
}

export function resolveLegacyTimezoneLabelFromIana(timezone?: string | null): string | null {
  const trimmed = String(timezone || '').trim();
  if (!trimmed) {
    return null;
  }
  const upper = trimmed.toUpperCase();
  if (TIMEZONE_LABEL_TO_IANA[upper]) {
    return upper;
  }
  return IANA_TO_TIMEZONE_LABEL[trimmed] || null;
}

function resolveIanaTimeZone(timezoneLabel?: string | null): string {
  return resolveIanaTimeZoneFromLegacyLabel(timezoneLabel);
}

function resolveLegacyTimezoneLabel(timezone?: string | null): string | null {
  const trimmed = String(timezone || '').trim();
  if (!trimmed) {
    return null;
  }
  return resolveLegacyTimezoneLabelFromIana(trimmed) || trimmed.toUpperCase();
}

function getParts(dateInput: TemporalInput, timezoneLabel?: string | null) {
  const date = toDate(dateInput);
  const timeZone = resolveIanaTimeZone(timezoneLabel);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  const year = Number.parseInt(value('year'), 10);
  const month = Number.parseInt(value('month'), 10);
  const day = Number.parseInt(value('day'), 10);
  const hour = Number.parseInt(value('hour'), 10);
  const minute = Number.parseInt(value('minute'), 10);

  return {
    year,
    month,
    day,
    weekday: value('weekday'),
    hour: hour === 24 ? 0 : hour,
    minute: Number.isNaN(minute) ? 0 : minute,
  };
}

function calendarDayValue(dateInput: TemporalInput, timezoneLabel?: string | null): number {
  const parts = getParts(dateInput, timezoneLabel);
  if (Number.isNaN(parts.year) || Number.isNaN(parts.month) || Number.isNaN(parts.day)) {
    const date = toDate(dateInput);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function dayDiffInMeetingTimeZone(args: {
  meetingStart: TemporalInput;
  now: TemporalInput;
  meetingTimezone?: string | null;
}): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round(
    (calendarDayValue(args.meetingStart, args.meetingTimezone) -
      calendarDayValue(args.now, args.meetingTimezone)) /
      dayMs,
  );
}

function formatDateLabel(meetingStart: TemporalInput, meetingTimezone?: string | null): string {
  const date = toDate(meetingStart);
  const timeZone = resolveIanaTimeZone(meetingTimezone);
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

function formatTimeLabel(meetingStart: TemporalInput, meetingTimezone?: string | null): string {
  const date = toDate(meetingStart);
  const timeZone = resolveIanaTimeZone(meetingTimezone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value || '12';
  const minute = parts.find((part) => part.type === 'minute')?.value || '00';
  const dayPeriod = (parts.find((part) => part.type === 'dayPeriod')?.value || 'AM').toLowerCase();
  return `${hour}:${minute}${dayPeriod}`;
}

export function getTimeOfDayBucket(
  meetingStart: TemporalInput,
  meetingTimezone?: string | null,
): TimeOfDayBucket {
  const hour = getParts(meetingStart, meetingTimezone).hour;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function getMeetingTimeOfDayBucket(
  meetingStart: TemporalInput,
  meetingTimezone?: string | null,
): TimeOfDayBucket {
  return getTimeOfDayBucket(meetingStart, meetingTimezone);
}

export function getMeetingTimeOfDayPhrase(args: {
  meetingStart: TemporalInput;
  meetingTimezone?: string | null;
}): TimeOfDayBucket {
  return getTimeOfDayBucket(args.meetingStart, args.meetingTimezone);
}

export function getGreetingForLocalTime(args: {
  now?: TemporalInput;
  meetingTimezone?: string | null;
}): 'Good morning' | 'Good afternoon' | 'Good evening' {
  const parts = getParts(args.now || new Date(), args.meetingTimezone);
  if (parts.hour < 12) return 'Good morning';
  if (parts.hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function getRelativeMeetingDayPhrase(args: {
  meetingStart: TemporalInput;
  now?: TemporalInput;
  meetingTimezone?: string | null;
}): string {
  const now = args.now || new Date();
  const bucket = getTimeOfDayBucket(args.meetingStart, args.meetingTimezone);
  const dayDiff = dayDiffInMeetingTimeZone({
    meetingStart: args.meetingStart,
    now,
    meetingTimezone: args.meetingTimezone,
  });

  if (dayDiff === 0) {
    if (bucket === 'morning') return 'this morning';
    if (bucket === 'afternoon') return 'this afternoon';
    return 'tonight';
  }

  if (dayDiff === 1) {
    return `tomorrow ${bucket}`;
  }

  const weekday = getParts(args.meetingStart, args.meetingTimezone).weekday || 'the scheduled day';
  return `on ${weekday} ${bucket}`;
}

export function getConfirmationDayPhrase(args: {
  meetingStart: TemporalInput;
  now?: TemporalInput;
  meetingTimezone?: string | null;
}): string {
  return getRelativeMeetingDayPhrase(args);
}

export function getConfirmationDatePhrase(args: {
  meetingStart: TemporalInput;
  now?: TemporalInput;
  meetingTimezone?: string | null;
}): string {
  return `${getRelativeMeetingDayPhrase(args)} ${formatDateLabel(args.meetingStart, args.meetingTimezone)}`;
}

export function getConfirmationClockLabel(args: {
  meetingStart: TemporalInput;
  meetingTimezone?: string | null;
}): string {
  const date = toDate(args.meetingStart);
  const timeZone = resolveIanaTimeZone(args.meetingTimezone);
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function getConfirmationTimezoneLabel(timezone?: string | null): string {
  const legacy = resolveLegacyTimezoneLabel(timezone);
  if (!legacy) {
    return '';
  }
  return TIMEZONE_LABEL_TO_CONFIRMATION_ABBREVIATION[legacy] || legacy;
}

export function getReminderTimeLabel(args: {
  meetingStart: TemporalInput;
  meetingTimezone?: string | null;
}): string {
  const timeLabel = formatTimeLabel(args.meetingStart, args.meetingTimezone);
  const legacy = resolveLegacyTimezoneLabel(args.meetingTimezone);
  const zoneWord = legacy ? TIMEZONE_LABEL_TO_WORD[legacy] || '' : '';
  return zoneWord ? `${timeLabel} ${zoneWord}` : timeLabel;
}

export function getMeetingReminderPhrase(args: {
  meetingStart: TemporalInput;
  now?: TemporalInput;
  meetingTimezone?: string | null;
}): string {
  return `${getReminderTimeLabel(args)} ${getRelativeMeetingDayPhrase(args)}`;
}
