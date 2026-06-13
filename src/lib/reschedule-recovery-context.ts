import type { ScoutPortalTask, ScoutPrepContext } from '../features/scout-prep/types';
import {
  easternLocalIsoToDate,
  fetchHeadScoutSlots,
  filterVisibleHeadScoutSlots,
  formatHeadScoutNaturalSlotLabel,
  formatHeadScoutWeekLabel,
  displayHeadScoutZoneLabel,
  type HeadScoutSlot,
} from './head-scout-schedules';
import {
  resolveBookedMeetingDetailsForForm,
  type ResolvedBookedMeetingDetails,
} from './booked-meeting-details-resolver';
import { resolveTimezone } from './scout-prep-ai';
import { resolveIanaTimeZoneFromLegacyLabel } from '../domain/outreach-time-wording';

export type RescheduleRecoverySlotOption = {
  id: string;
  title: string;
  subtitle?: string | null;
  scoutName: string;
  messageLabel: string;
  isPreviousScout: boolean;
  dateLabel: string;
  timeLabel: string;
  zoneLabel: string;
  weekLabel: string;
  start: string;
  end: string;
  openEventId: string;
};

export type RescheduleRecoverySlotPlan = {
  previousMeeting: ResolvedBookedMeetingDetails | null;
  previousMeetingText: string;
  previousHeadScoutName: string | null;
  clientTimezone: string | null;
  clientTimezoneLabel: string | null;
  slots: RescheduleRecoverySlotOption[];
  suggestedSlots: RescheduleRecoverySlotOption[];
  weekLabel: string | null;
};

export type RescheduleRecoveryIdentity = {
  athleteId?: string | null;
  athleteMainId?: string | null;
  city?: string | null;
  state?: string | null;
  fallbackTimezone?: string | null;
  fallbackTimezoneLabel?: string | null;
  fallbackHeadScoutName?: string | null;
};

export type RescheduleRecoveryMeetingSource =
  | 'appointment_truth'
  | 'latest_appointment_truth'
  | 'booked_meetings';

type CachedMeetingDescriptionGetter = NonNullable<
  Parameters<typeof resolveBookedMeetingDetailsForForm>[1]['getCachedMeetingDescription']
>;

const RESCHEDULE_SLOT_DIFFERENT_SCOUT_PENALTY = 2_500;
const RESCHEDULE_SLOT_SHORT_NOTICE_HOURS = 24;
const RESCHEDULE_SLOT_SHORT_NOTICE_PENALTY = 8_000;
const RESCHEDULE_SLOT_SAME_WEEKEND_ON_LATE_WEEK_PENALTY = 1_500;
const RESCHEDULE_SLOT_EARLIER_THAN_PREVIOUS_TIME_PENALTY = 45;

export function normalizeRescheduleRecoveryNameKey(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^coach\s+/i, '')
    .replace(/\s+/g, ' ');
}

export function buildPreviousMeetingTextForReschedule(
  resolved: ResolvedBookedMeetingDetails | null,
  identity: Pick<RescheduleRecoveryIdentity, 'city' | 'state' | 'fallbackTimezone'>,
): string | null {
  const meeting = resolved?.bookedMeeting;
  if (!meeting) {
    return null;
  }

  const athleteTimezone =
    resolved.meetingTimezone ||
    identity.fallbackTimezone ||
    resolveTimezone(identity.city, identity.state);
  if (!athleteTimezone) {
    throw new Error('Missing client timezone for Reschedule Pending');
  }
  const slotLabel =
    meeting.start && meeting.end
      ? formatHeadScoutNaturalSlotLabel(meeting.start, meeting.end, athleteTimezone).messageLabel
      : String(meeting.date_time_label || '').trim();
  const scoutName = String(meeting.assigned_owner || '').trim();

  return [slotLabel, scoutName].filter(Boolean).join(' • ') || null;
}

function inferTimezoneLabel(timezone?: string | null): string | null {
  if (!timezone) return null;
  try {
    return (
      displayHeadScoutZoneLabel(
        new Intl.DateTimeFormat('en-US', {
          timeZone: resolveIanaTimeZoneFromLegacyLabel(timezone),
          timeZoneName: 'short',
        })
          .formatToParts(new Date())
          .find((part) => part.type === 'timeZoneName')?.value,
      ) || null
    );
  } catch {
    return null;
  }
}

function resolveClientTimezone(
  identity: RescheduleRecoveryIdentity,
  previousMeeting?: ResolvedBookedMeetingDetails | null,
): { timezone: string | null; label: string | null } {
  const timezone =
    String(
      previousMeeting?.meetingTimezone ||
        identity.fallbackTimezone ||
        resolveTimezone(identity.city, identity.state) ||
        '',
    ).trim() || null;
  const explicitLabel = displayHeadScoutZoneLabel(identity.fallbackTimezoneLabel);
  return {
    timezone,
    label: explicitLabel || inferTimezoneLabel(timezone) || (timezone ? null : 'Eastern'),
  };
}

async function resolveCachedMeetingDescriptionGetter(): Promise<
  CachedMeetingDescriptionGetter | undefined
> {
  try {
    const module = await import('./booked-meeting-description-cache');
    return module.getCachedBookedMeetingDescription;
  } catch {
    return undefined;
  }
}

function localMinutesForEasternStamp(start: string, timeZone?: string | null): number | null {
  const parsed = easternLocalIsoToDate(start);
  if (!parsed) return null;
  const renderTimeZone = resolveIanaTimeZoneFromLegacyLabel(timeZone || 'America/New_York');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: renderTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed);
  const hour = Number.parseInt(parts.find((part) => part.type === 'hour')?.value || '', 10);
  const minute = Number.parseInt(parts.find((part) => part.type === 'minute')?.value || '', 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour === 24 ? 0 : hour) * 60 + minute;
}

function localWeekdayForDate(date: Date, timeZone?: string | null): number | null {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'America/New_York',
    weekday: 'short',
  }).format(date);
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return weekdays[weekday] ?? null;
}

function hoursUntilDate(date: Date, now = new Date()): number {
  return (date.getTime() - now.getTime()) / (60 * 60 * 1000);
}

export function scoreRescheduleRecoverySlot(args: {
  slot: HeadScoutSlot & { scout_name: string };
  previousHeadScoutName: string | null;
  targetMinutes: number | null;
  clientTimezone: string | null;
  weekOffset: number;
  now?: Date;
}): number {
  const sameScout =
    args.previousHeadScoutName &&
    normalizeRescheduleRecoveryNameKey(args.slot.scout_name) ===
      normalizeRescheduleRecoveryNameKey(args.previousHeadScoutName)
      ? 0
      : RESCHEDULE_SLOT_DIFFERENT_SCOUT_PENALTY;
  const slotMinutes = localMinutesForEasternStamp(args.slot.start, args.clientTimezone);
  const timeDistance =
    slotMinutes !== null && args.targetMinutes !== null
      ? Math.abs(slotMinutes - args.targetMinutes)
      : 1_000;
  const earlierThanPreviousTime =
    slotMinutes !== null && args.targetMinutes !== null && slotMinutes < args.targetMinutes
      ? RESCHEDULE_SLOT_EARLIER_THAN_PREVIOUS_TIME_PENALTY
      : 0;
  const slotDate = easternLocalIsoToDate(args.slot.start);
  const noticeHours = slotDate ? hoursUntilDate(slotDate, args.now) : null;
  const shortNotice =
    noticeHours !== null && noticeHours < RESCHEDULE_SLOT_SHORT_NOTICE_HOURS
      ? RESCHEDULE_SLOT_SHORT_NOTICE_PENALTY
      : 0;
  const currentWeekday = localWeekdayForDate(args.now || new Date(), args.clientTimezone);
  const slotWeekday = slotDate ? localWeekdayForDate(slotDate, args.clientTimezone) : null;
  const rushedWeekend =
    args.weekOffset === 0 &&
    currentWeekday !== null &&
    currentWeekday >= 5 &&
    (slotWeekday === 0 || slotWeekday === 6)
      ? RESCHEDULE_SLOT_SAME_WEEKEND_ON_LATE_WEEK_PENALTY
      : 0;
  return (
    sameScout +
    args.weekOffset * 100 +
    timeDistance +
    earlierThanPreviousTime +
    shortNotice +
    rushedWeekend
  );
}

export async function buildRescheduleRecoverySlotPlan(args: {
  identity: RescheduleRecoveryIdentity;
  requirePreviousMeeting?: boolean;
  weekOffsets?: number[];
  previousMeetingSource?: RescheduleRecoveryMeetingSource;
  now?: Date;
}): Promise<RescheduleRecoverySlotPlan> {
  const mustHavePreviousMeeting = args.requirePreviousMeeting !== false;
  const athleteId = String(args.identity.athleteId || '').trim();
  const athleteMainId = String(args.identity.athleteMainId || '').trim();
  const source = args.previousMeetingSource || 'latest_appointment_truth';
  const getCachedMeetingDescription = await resolveCachedMeetingDescriptionGetter();
  const previousMeeting =
    mustHavePreviousMeeting && athleteId && athleteMainId
      ? await resolveBookedMeetingDetailsForForm(
          { athleteId, athleteMainId, source },
          getCachedMeetingDescription ? { getCachedMeetingDescription } : {},
        )
      : null;
  if (mustHavePreviousMeeting && !previousMeeting) {
    throw new Error('Missing booked meeting for Reschedule Pending');
  }

  const clientTimezone = resolveClientTimezone(args.identity, previousMeeting);
  const previousHeadScoutName =
    String(previousMeeting?.bookedMeeting.assigned_owner || '').trim() ||
    String(args.identity.fallbackHeadScoutName || '').trim() ||
    null;
  const targetMinutes = previousMeeting?.bookedMeeting.start
    ? localMinutesForEasternStamp(previousMeeting.bookedMeeting.start, clientTimezone.timezone)
    : null;
  const previousMeetingText =
    (mustHavePreviousMeeting && previousMeeting
      ? buildPreviousMeetingTextForReschedule(previousMeeting, {
          city: args.identity.city,
          state: args.identity.state,
          fallbackTimezone: clientTimezone.timezone,
        })
      : null) ||
    [previousHeadScoutName, previousMeeting?.bookedMeeting.start].filter(Boolean).join(' • ');
  const now = args.now || new Date();
  const weekOffsets = args.weekOffsets?.length ? args.weekOffsets : [0, 1];

  const slotPayloads = await Promise.all(
    weekOffsets.map((weekOffset) => fetchHeadScoutSlots(weekOffset)),
  );
  const payloadWeekLabels = slotPayloads
    .map((payload) => formatHeadScoutWeekLabel(payload.week_start, payload.week_end))
    .filter(Boolean);
  const scoredSlots = slotPayloads.flatMap((payload, payloadIndex) => {
    const weekOffset = weekOffsets[payloadIndex] ?? payloadIndex;
    const rawSlots = (payload.scouts || []).flatMap((schedule) =>
      (schedule.slots || []).map((slot) => ({
        ...slot,
        scout_name: slot.scout_name || schedule.scout_name,
      })),
    );
    return filterVisibleHeadScoutSlots(rawSlots).map((slot) => ({ slot, weekOffset }));
  });

  const slots = scoredSlots
    .sort((left, right) => {
      const leftScore = scoreRescheduleRecoverySlot({
        slot: left.slot,
        previousHeadScoutName,
        targetMinutes,
        clientTimezone: clientTimezone.timezone,
        weekOffset: left.weekOffset,
        now,
      });
      const rightScore = scoreRescheduleRecoverySlot({
        slot: right.slot,
        previousHeadScoutName,
        targetMinutes,
        clientTimezone: clientTimezone.timezone,
        weekOffset: right.weekOffset,
        now,
      });
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.slot.start.localeCompare(right.slot.start);
    })
    .map(({ slot, weekOffset }) => {
      const display = formatHeadScoutNaturalSlotLabel(
        slot.start,
        slot.end,
        clientTimezone.timezone,
      );
      const isPreviousScout = Boolean(
        previousHeadScoutName &&
          normalizeRescheduleRecoveryNameKey(slot.scout_name) ===
            normalizeRescheduleRecoveryNameKey(previousHeadScoutName),
      );
      return {
        id: `${slot.scout_name}:${slot.id}`,
        title: display.messageLabel,
        subtitle: slot.scout_name,
        scoutName: slot.scout_name,
        messageLabel: display.messageLabel,
        isPreviousScout,
        dateLabel: display.dateLabel,
        timeLabel: display.timeLabel,
        zoneLabel: display.zoneLabel,
        weekLabel: weekOffset > 0 ? 'next week' : 'this week',
        start: slot.start,
        end: slot.end,
        openEventId: slot.id,
      };
    });

  const suggestedSlots = slots
    .slice(0, 2)
    .sort((left, right) => left.start.localeCompare(right.start));

  if (suggestedSlots.length < 2) {
    throw new Error('Missing two reschedule slot options');
  }

  return {
    previousMeeting,
    previousMeetingText,
    previousHeadScoutName,
    clientTimezone: clientTimezone.timezone,
    clientTimezoneLabel: clientTimezone.label,
    slots,
    suggestedSlots,
    weekLabel:
      payloadWeekLabels.length > 1
        ? `${payloadWeekLabels[0]} / ${payloadWeekLabels[payloadWeekLabels.length - 1]}`
        : payloadWeekLabels[0] || null,
  };
}

export async function buildRankedRescheduleSlotPlan(args: {
  task: ScoutPortalTask;
  context: ScoutPrepContext;
  requirePreviousMeeting?: boolean;
  weekOffsets?: number[];
  now?: Date;
}): Promise<RescheduleRecoverySlotPlan> {
  return buildRescheduleRecoverySlotPlan({
    identity: {
      athleteId: args.task.contact_id || args.context.task.contact_id,
      athleteMainId: args.context.resolved.athlete_main_id || args.task.athlete_main_id,
      city: args.context.resolved.city,
      state: args.context.resolved.state,
      fallbackTimezone: args.context.resolved.timezone,
      fallbackTimezoneLabel: args.context.resolved.timezone_label,
      fallbackHeadScoutName: args.context.resolved.head_scout,
    },
    requirePreviousMeeting: args.requirePreviousMeeting,
    weekOffsets: args.weekOffsets,
    previousMeetingSource: 'latest_appointment_truth',
    now: args.now,
  });
}
