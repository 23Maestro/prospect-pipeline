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

type TemporalInput = Date | string | number;

function toDate(value: TemporalInput): Date {
  return value instanceof Date ? value : new Date(value);
}

function resolveIanaTimeZone(timezoneLabel?: string | null): string {
  const normalized = String(timezoneLabel || '').trim().toUpperCase();
  return TIMEZONE_LABEL_TO_IANA[normalized] || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
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

export function getMeetingTimeOfDayBucket(
  meetingStart: TemporalInput,
  meetingTimezone?: string | null,
): 'morning' | 'afternoon' | 'evening' {
  const hour = getParts(meetingStart, meetingTimezone).hour;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function getRelativeMeetingDayPhrase(args: {
  meetingStart: TemporalInput;
  now?: TemporalInput;
  meetingTimezone?: string | null;
}): string {
  const now = args.now || new Date();
  const bucket = getMeetingTimeOfDayBucket(args.meetingStart, args.meetingTimezone);
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

export function getReminderTimeLabel(args: {
  meetingStart: TemporalInput;
  meetingTimezone?: string | null;
}): string {
  const timeLabel = formatTimeLabel(args.meetingStart, args.meetingTimezone);
  const zoneWord =
    TIMEZONE_LABEL_TO_WORD[
      String(args.meetingTimezone || '')
        .trim()
        .toUpperCase()
    ] || '';
  return zoneWord ? `${timeLabel} ${zoneWord}` : timeLabel;
}
