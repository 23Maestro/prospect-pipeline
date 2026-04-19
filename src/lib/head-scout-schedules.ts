import { apiFetch } from './fastapi-client';
import { searchLogger } from './logger';
import { getNaturalZoneLabel, resolveTimezone } from './scout-prep-ai';

const FEATURE = 'head-scout-schedules';
export const HEAD_SCOUT_TIMEZONE = 'EST';

export type HeadScoutSlot = {
  id: string;
  start: string;
  end: string;
  scout_name: string;
};

export type HeadScoutSchedule = {
  scout_name: string;
  city: string;
  state: string;
  calendar_owner_id: string;
  meeting_for: string;
  slot_count: number;
  slots: HeadScoutSlot[];
};

export type HeadScoutSlotsResponse = {
  success: boolean;
  week_start: string;
  week_end: string;
  timezone_label: string;
  scouts: HeadScoutSchedule[];
};

export type OpenMeetingSlot = {
  open_event_id: string;
  date_time_label: string;
  title: string;
  assigned_owner: string;
  start_time: string;
};

export type OpenMeetingsResponse = {
  success: boolean;
  meeting_for: string;
  count: number;
  slots: OpenMeetingSlot[];
};

export type BookedMeetingEvent = {
  event_id: string;
  title: string;
  assigned_owner: string;
  start: string;
  end: string;
  date_time_label: string;
};

export type BookedMeetingLookupResponse = {
  success: boolean;
  calendar_owner_id: string;
  title_query: string;
  start: string;
  end: string;
  count: number;
  event?: BookedMeetingEvent | null;
};

type TimezoneDisplay = {
  dateLabel: string;
  timeRangeLabel: string;
  zoneLabel: string;
};

export const HEAD_SCOUT_ORDER = [
  {
    scout_name: 'Jeffrey Stein',
    city: 'Wexford',
    state: 'PA',
    calendar_owner_id: 'OrJsV8nhBouEzKY',
    meeting_for: '1418529',
  },
  {
    scout_name: 'Luther Winfield',
    city: 'Columbia',
    state: 'SC',
    calendar_owner_id: 'bMBrA26OElRUwPs',
    meeting_for: '370959',
  },
  {
    scout_name: 'Ryan Lietz',
    city: 'Gilbert',
    state: 'AZ',
    calendar_owner_id: 'nhVvYOz8bAaL57c',
    meeting_for: '1354049',
  },
  {
    scout_name: 'James Holcomb',
    city: 'Phoenix',
    state: 'AZ',
    calendar_owner_id: '56',
    meeting_for: '56',
  },
] as const;

function logInfo(
  event: string,
  step: string,
  status: 'start' | 'success',
  context?: Record<string, unknown>,
) {
  searchLogger.info(event, {
    event,
    step,
    status,
    feature: FEATURE,
    context: context || {},
  });
}

function logFailure(event: string, step: string, error: string, context?: Record<string, unknown>) {
  searchLogger.error(event, {
    event,
    step,
    status: 'failure',
    feature: FEATURE,
    error,
    context: context || {},
  });
}

function getEasternParts(date: Date): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const output: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      output[part.type] = part.value;
    }
  }
  return output;
}

function buildIsoDateFromUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildHeadScoutWeekWindow(
  weekOffset = 0,
  now = new Date(),
): {
  start: string;
  end: string;
} {
  const parts = getEasternParts(now);
  const year = Number.parseInt(parts.year || '0', 10);
  const month = Number.parseInt(parts.month || '1', 10);
  const day = Number.parseInt(parts.day || '1', 10);
  const estDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = estDate.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStartDate = new Date(estDate);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() + mondayOffset + weekOffset * 7);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);

  return {
    start: buildIsoDateFromUtc(weekStartDate),
    end: buildIsoDateFromUtc(weekEndDate),
  };
}

export function getCurrentEasternSlotStamp(now = new Date()): string {
  const parts = getEasternParts(now);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function filterVisibleHeadScoutSlots(
  slots: HeadScoutSlot[],
  weekOffset = 0,
  now = new Date(),
): HeadScoutSlot[] {
  if (weekOffset > 0) {
    return [...slots];
  }
  const currentStamp = getCurrentEasternSlotStamp(now);
  return slots.filter((slot) => slot.start >= currentStamp);
}

export function formatHeadScoutSlotDate(isoDateTime: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(isoDateTime)) {
    return 'Unknown Date';
  }
  const [datePart] = isoDateTime.split('T');
  const [year, month, day] = datePart.split('-').map((value) => Number.parseInt(value, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) {
    return 'Unknown Date';
  }
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatTimePart(value: string): string {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return 'Unknown Time';
  }
  const [hourText, minuteText] = value.split(':');
  const hour24 = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function formatHeadScoutSlotTimeRange(start: string, end: string): string {
  const startTime = (start.split('T')[1] || '').slice(0, 5);
  const endTime = (end.split('T')[1] || '').slice(0, 5);
  if (!startTime || !endTime) {
    return `Unknown Time ${HEAD_SCOUT_TIMEZONE}`;
  }
  return `${formatTimePart(startTime)} - ${formatTimePart(endTime)} ${HEAD_SCOUT_TIMEZONE}`;
}

export function formatHeadScoutWeekLabel(start: string, end: string): string {
  const startLabel = formatHeadScoutSlotDate(`${start}T00:00`).replace(/^[A-Za-z]{3},\s*/, '');
  const endDate = new Date(`${end}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const endLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(endDate);
  return `${startLabel} - ${endLabel}`;
}

export function buildCalendarMonthWindow(date: Date): { start: string; end: string } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  const toIsoDate = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

export async function fetchBookedMeeting(args: {
  calendarOwnerId: string;
  title: string;
  start: string;
  end: string;
}): Promise<BookedMeetingLookupResponse> {
  logInfo('BOOKED_MEETING_LOOKUP', 'request', 'start', {
    calendarOwnerId: args.calendarOwnerId,
    title: args.title,
    start: args.start,
    end: args.end,
  });

  const response = await apiFetch(
    `/calendar/booked-meeting?calendar_owner_id=${encodeURIComponent(args.calendarOwnerId)}&title=${encodeURIComponent(args.title)}&start=${encodeURIComponent(args.start)}&end=${encodeURIComponent(args.end)}`,
  );

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Booked meeting HTTP ${response.status}`;
    logFailure('BOOKED_MEETING_LOOKUP', 'request', message, {
      calendarOwnerId: args.calendarOwnerId,
      title: args.title,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json()) as BookedMeetingLookupResponse;
  logInfo('BOOKED_MEETING_LOOKUP', 'parse', 'success', {
    calendarOwnerId: args.calendarOwnerId,
    title: args.title,
    count: payload.count,
    found: Boolean(payload.event),
  });
  return payload;
}

function getOffsetMinutesForZone(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  });
  const zonePart = formatter
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = zonePart?.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) {
    return 0;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3] || '0', 10);
  return sign * (hours * 60 + minutes);
}

function getPartsForZone(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const output: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      output[part.type] = part.value;
    }
  }
  return output;
}

export function easternLocalIsoToDate(isoDateTime: string): Date | null {
  const match = isoDateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const easternOffsetMinutes = getOffsetMinutesForZone(utcGuess, 'America/New_York');
  return new Date(utcGuess.getTime() - easternOffsetMinutes * 60_000);
}

export function formatHeadScoutSlotForTimezone(
  start: string,
  end: string,
  timeZone?: string | null,
): TimezoneDisplay {
  if (!timeZone) {
    return {
      dateLabel: formatHeadScoutSlotDate(start),
      timeRangeLabel: formatHeadScoutSlotTimeRange(start, end),
      zoneLabel: HEAD_SCOUT_TIMEZONE,
    };
  }

  const startDate = easternLocalIsoToDate(start);
  const endDate = easternLocalIsoToDate(end);
  if (!startDate || !endDate) {
    return {
      dateLabel: formatHeadScoutSlotDate(start),
      timeRangeLabel: formatHeadScoutSlotTimeRange(start, end),
      zoneLabel: HEAD_SCOUT_TIMEZONE,
    };
  }

  const startParts = getPartsForZone(startDate, timeZone);
  const endParts = getPartsForZone(endDate, timeZone);
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(startDate);
  const zoneLabel = getNaturalZoneLabel(timeZone);

  return {
    dateLabel,
    timeRangeLabel: `${formatTimePart(`${startParts.hour}:${startParts.minute}`)} - ${formatTimePart(`${endParts.hour}:${endParts.minute}`)} ${zoneLabel}`,
    zoneLabel,
  };
}

export function buildHeadScoutScriptMarkdown(args: {
  baseMarkdown: string;
  scoutName: string;
  slotLabels: string[];
}): string {
  const [slot1, slot2] = args.slotLabels;
  return args.baseMarkdown
    .replace(/\[Scout Name\]/g, args.scoutName)
    .replace(/\[Day\/Time Option 1\]/g, slot1 || '[Day/Time Option 1]')
    .replace(/\[Day\/Time Option 2\]/g, slot2 || '[Day/Time Option 2]');
}

export function resolveAthleteTimezone(city?: string | null, state?: string | null): string | null {
  return resolveTimezone(city, state);
}

export async function fetchHeadScoutSlots(
  weekOffset = 0,
  now = new Date(),
): Promise<HeadScoutSlotsResponse> {
  const week = buildHeadScoutWeekWindow(weekOffset, now);
  logInfo('HEAD_SCOUT_SLOTS_FETCH', 'request', 'start', {
    start: week.start,
    end: week.end,
    weekOffset,
  });
  const response = await apiFetch(
    `/calendar/head-scout-slots?start=${encodeURIComponent(week.start)}&end=${encodeURIComponent(week.end)}`,
  );

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Head scout slots HTTP ${response.status}`;
    logFailure('HEAD_SCOUT_SLOTS_FETCH', 'request', message, {
      start: week.start,
      end: week.end,
      weekOffset,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json()) as HeadScoutSlotsResponse;
  logInfo('HEAD_SCOUT_SLOTS_GROUP', 'parse', 'success', {
    start: payload.week_start,
    end: payload.week_end,
    scoutCount: payload.scouts?.length || 0,
    slotCount: (payload.scouts || []).reduce((sum, scout) => sum + scout.slot_count, 0),
  });
  return payload;
}

export async function fetchOpenMeetings(meetingFor: string): Promise<OpenMeetingsResponse> {
  logInfo('OPEN_MEETINGS_FETCH', 'request', 'start', {
    meetingFor,
  });
  const response = await apiFetch(
    `/calendar/open-meetings?meeting_for=${encodeURIComponent(meetingFor)}`,
  );

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Open meetings HTTP ${response.status}`;
    logFailure('OPEN_MEETINGS_FETCH', 'request', message, {
      meetingFor,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json()) as OpenMeetingsResponse;
  logInfo('OPEN_MEETINGS_FETCH', 'parse', 'success', {
    meetingFor: payload.meeting_for,
    count: payload.count,
  });
  return payload;
}
