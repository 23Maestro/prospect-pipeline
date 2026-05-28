import { apiFetch } from './fastapi-client';
import { searchLogger } from './logger';
import { getNaturalZoneLabel, resolveTimezone } from './scout-prep-ai';
import type { AppointmentTitlePrefix } from './head-scout-event-prefix';
import { HEAD_SCOUT_ORDER } from '../domain/owners';

const FEATURE = 'head-scout-schedules';
export const HEAD_SCOUT_TIMEZONE = 'EST';
export const BOOKED_MEETING_LOOKBACK_DAYS = 45;
export const BOOKED_MEETING_LOOKAHEAD_DAYS = 120;

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
  description?: string | null;
};

export type BookedMeetingLookupResponse = {
  success: boolean;
  calendar_owner_id: string;
  title_query: string;
  start: string;
  end: string;
  count: number;
  event?: BookedMeetingEvent | null;
  events?: BookedMeetingEvent[];
};

export type AthleteBookedMeetingsResponse = {
  success: boolean;
  athlete_id: string;
  athlete_main_id: string;
  count: number;
  events: BookedMeetingEvent[];
};

export type HeadScoutBookedMeetingsResponse = {
  success: boolean;
  week_start: string;
  week_end: string;
  count: number;
  events: BookedMeetingEvent[];
};

export type BookedMeetingTitleUpdateResponse = {
  success: boolean;
  event_id: string;
  prefix: AppointmentTitlePrefix;
  original_title: string;
  updated_title: string;
  message: string;
};

export type BookedMeetingDetailsResponse = {
  success: boolean;
  event_id: string;
  title: string;
  description: string;
  form_data?: Record<string, string | number | boolean | null | undefined>;
};

export type BookedMeetingDescriptionUpdateResponse = {
  success: boolean;
  event_id: string;
  original_description: string;
  updated_description: string;
  message: string;
};

type TimezoneDisplay = {
  dateLabel: string;
  timeRangeLabel: string;
  zoneLabel: string;
};

export { HEAD_SCOUT_ORDER };

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

export function compactHeadScoutZoneLabel(value?: string | null): string {
  const rawZone = String(value || '').trim();
  if (rawZone === 'Eastern' || rawZone === 'EST' || rawZone === 'EDT') return 'ET';
  if (rawZone === 'Central' || rawZone === 'CST' || rawZone === 'CDT') return 'CT';
  if (rawZone === 'Mountain' || rawZone === 'MST' || rawZone === 'MDT') return 'MT';
  if (rawZone === 'Pacific' || rawZone === 'PST' || rawZone === 'PDT') return 'PT';
  return rawZone;
}

export function displayHeadScoutZoneLabel(value?: string | null): string {
  const rawZone = String(value || '').trim();
  if (rawZone === 'ET' || rawZone === 'EST' || rawZone === 'EDT') return 'Eastern';
  if (rawZone === 'CT' || rawZone === 'CST' || rawZone === 'CDT') return 'Central';
  if (rawZone === 'MT' || rawZone === 'MST' || rawZone === 'MDT') return 'Mountain';
  if (rawZone === 'PT' || rawZone === 'PST' || rawZone === 'PDT') return 'Pacific';
  return rawZone;
}

export function formatHeadScoutSlotStartLabel(timeRangeLabel: string, zoneLabel: string): string {
  const [startRaw, rest = ''] = timeRangeLabel.split(/\s+-\s+/, 2);
  const start = String(startRaw || '')
    .trim()
    .replace(/^0?(\d{1,2}):00\s*(AM|PM)$/i, '$1$2')
    .replace(/^0?(\d{1,2}):([1-5]\d)\s*(AM|PM)$/i, '$1:$2$3')
    .replace(/\b(am|pm)\b/i, (match) => match.toUpperCase());
  const period = /(AM|PM)$/i.test(start) ? '' : rest.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase();
  const rawZone =
    zoneLabel || rest.match(/\b(Eastern|Central|Mountain|Pacific|[A-Z]{2,4})\b$/i)?.[1] || '';
  const zone = compactHeadScoutZoneLabel(rawZone);
  return [start, period, zone].filter(Boolean).join(' ');
}

function formatCompactClockLabel(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value || '';
  const minute = parts.find((part) => part.type === 'minute')?.value || '00';
  const dayPeriod = parts.find((part) => part.type === 'dayPeriod')?.value?.toUpperCase() || '';
  return minute === '00' ? `${hour}${dayPeriod}` : `${hour}:${minute}${dayPeriod}`;
}

export function formatHeadScoutNaturalSlotLabel(
  start: string,
  end: string,
  timeZone?: string | null,
): { dateLabel: string; timeLabel: string; messageLabel: string; zoneLabel: string } {
  const display = formatHeadScoutSlotForTimezone(start, end, timeZone);
  const renderTimeZone = timeZone || 'America/New_York';
  const parsedStart = easternLocalIsoToDate(start);
  if (!parsedStart) {
    const dateLabel =
      display.dateLabel === 'Unknown Date'
        ? display.dateLabel
        : display.dateLabel.replace(/^[A-Za-z]{3},\s*/, '');
    const timeLabel = formatHeadScoutSlotStartLabel(display.timeRangeLabel, display.zoneLabel);
    return {
      dateLabel,
      timeLabel,
      messageLabel: `${dateLabel} at ${timeLabel}`,
      zoneLabel: compactHeadScoutZoneLabel(display.zoneLabel),
    };
  }

  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: renderTimeZone,
  }).format(parsedStart);
  const zoneLabel = compactHeadScoutZoneLabel(display.zoneLabel);
  const timeLabel = `${formatCompactClockLabel(parsedStart, renderTimeZone)} ${zoneLabel}`;
  return {
    dateLabel,
    timeLabel,
    messageLabel: `${dateLabel} at ${timeLabel}`,
    zoneLabel,
  };
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

export function buildBookedMeetingLookupWindow(
  anchorDate?: Date | null,
  now: Date = new Date(),
): { start: string; end: string } {
  const safeAnchor = anchorDate && !Number.isNaN(anchorDate.getTime()) ? anchorDate : now;
  const earliest = safeAnchor.getTime() < now.getTime() ? safeAnchor : now;
  const latest = safeAnchor.getTime() > now.getTime() ? safeAnchor : now;
  const start = new Date(earliest);
  start.setDate(start.getDate() - BOOKED_MEETING_LOOKBACK_DAYS);
  const end = new Date(latest);
  end.setDate(end.getDate() + BOOKED_MEETING_LOOKAHEAD_DAYS);
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

export async function fetchAthleteBookedMeetings(args: {
  athleteId: string;
  athleteMainId: string;
}): Promise<AthleteBookedMeetingsResponse> {
  logInfo('ATHLETE_BOOKED_MEETINGS_LOOKUP', 'request', 'start', {
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
  });

  const response = await apiFetch(
    `/calendar/athlete-booked-meetings?athlete_id=${encodeURIComponent(args.athleteId)}&athlete_main_id=${encodeURIComponent(args.athleteMainId)}`,
  );

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Athlete booked meetings HTTP ${response.status}`;
    logFailure('ATHLETE_BOOKED_MEETINGS_LOOKUP', 'request', message, {
      athleteId: args.athleteId,
      athleteMainId: args.athleteMainId,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json()) as AthleteBookedMeetingsResponse;
  logInfo('ATHLETE_BOOKED_MEETINGS_LOOKUP', 'parse', 'success', {
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    count: payload.count,
  });
  return payload;
}

export async function fetchHeadScoutBookedMeetings(
  weekOffset = 0,
  now = new Date(),
): Promise<HeadScoutBookedMeetingsResponse> {
  const week = buildHeadScoutWeekWindow(weekOffset, now);
  return fetchHeadScoutBookedMeetingsWindow({ ...week, weekOffset });
}

export async function fetchHeadScoutBookedMeetingsWindow(args: {
  start: string;
  end: string;
  weekOffset?: number;
}): Promise<HeadScoutBookedMeetingsResponse> {
  logInfo('HEAD_SCOUT_BOOKED_MEETINGS_LOOKUP', 'request', 'start', {
    start: args.start,
    end: args.end,
    weekOffset: args.weekOffset ?? null,
  });

  const response = await apiFetch(
    `/calendar/booked-meetings?start=${encodeURIComponent(args.start)}&end=${encodeURIComponent(args.end)}`,
  );

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Head scout booked meetings HTTP ${response.status}`;
    logFailure('HEAD_SCOUT_BOOKED_MEETINGS_LOOKUP', 'request', message, {
      start: args.start,
      end: args.end,
      weekOffset: args.weekOffset ?? null,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json()) as HeadScoutBookedMeetingsResponse;
  logInfo('HEAD_SCOUT_BOOKED_MEETINGS_LOOKUP', 'parse', 'success', {
    start: payload.week_start,
    end: payload.week_end,
    count: payload.count,
  });
  return payload;
}

export async function updateBookedMeetingTitlePrefix(args: {
  eventId: string;
  eventDate: string;
  prefix: AppointmentTitlePrefix;
}): Promise<BookedMeetingTitleUpdateResponse> {
  logInfo('BOOKED_MEETING_TITLE_UPDATE', 'request', 'start', {
    eventId: args.eventId,
    eventDate: args.eventDate,
    prefix: args.prefix,
  });

  const response = await apiFetch('/calendar/booked-meeting/title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: args.eventId,
      event_date: args.eventDate,
      prefix: args.prefix,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message =
      errorText.slice(0, 200) || `Booked meeting title update HTTP ${response.status}`;
    logFailure('BOOKED_MEETING_TITLE_UPDATE', 'request', message, {
      eventId: args.eventId,
      eventDate: args.eventDate,
      prefix: args.prefix,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json()) as BookedMeetingTitleUpdateResponse;
  logInfo('BOOKED_MEETING_TITLE_UPDATE', 'response', 'success', {
    eventId: args.eventId,
    prefix: args.prefix,
    originalTitle: payload.original_title,
    updatedTitle: payload.updated_title,
  });
  return payload;
}

export async function fetchBookedMeetingDetails(args: {
  eventId: string;
  eventDate: string;
}): Promise<BookedMeetingDetailsResponse> {
  logInfo('BOOKED_MEETING_DETAILS', 'request', 'start', {
    eventId: args.eventId,
    eventDate: args.eventDate,
  });

  const params = new URLSearchParams({
    event_id: args.eventId,
    event_date: args.eventDate,
  });
  const response = await apiFetch(`/calendar/booked-meeting/details?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Booked meeting details HTTP ${response.status}`;
    logFailure('BOOKED_MEETING_DETAILS', 'request', message, {
      eventId: args.eventId,
      eventDate: args.eventDate,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json()) as BookedMeetingDetailsResponse;
  logInfo('BOOKED_MEETING_DETAILS', 'response', 'success', {
    eventId: args.eventId,
    title: payload.title,
    descriptionLength: payload.description.length,
  });
  return payload;
}

export async function updateBookedMeetingDescription(args: {
  eventId: string;
  eventDate: string;
  description: string;
}): Promise<BookedMeetingDescriptionUpdateResponse> {
  logInfo('BOOKED_MEETING_DESCRIPTION_UPDATE', 'request', 'start', {
    eventId: args.eventId,
    eventDate: args.eventDate,
    descriptionLength: args.description.length,
  });

  const response = await apiFetch('/calendar/booked-meeting/description', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: args.eventId,
      event_date: args.eventDate,
      description: args.description,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message =
      errorText.slice(0, 200) || `Booked meeting description update HTTP ${response.status}`;
    logFailure('BOOKED_MEETING_DESCRIPTION_UPDATE', 'request', message, {
      eventId: args.eventId,
      eventDate: args.eventDate,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json()) as BookedMeetingDescriptionUpdateResponse;
  logInfo('BOOKED_MEETING_DESCRIPTION_UPDATE', 'response', 'success', {
    eventId: args.eventId,
    originalDescriptionLength: payload.original_description.length,
    updatedDescriptionLength: payload.updated_description.length,
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
