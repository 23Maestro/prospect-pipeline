import type { SalesStageOption } from '../features/scout-prep/types';
import { apiFetch } from './fastapi-client';
import {
  buildBookedMeetingLookupWindow,
  easternLocalIsoToDate,
  fetchBookedMeeting,
  formatHeadScoutSlotDate,
  formatHeadScoutSlotTimeRange,
  HEAD_SCOUT_ORDER,
  type BookedMeetingEvent,
} from './head-scout-schedules';
import { mapTimezoneToLegacyRecruitZone } from './scout-prep-contact';
import { resolveTimezone } from './scout-prep-ai';

const STATE_ABBREVIATIONS: Record<string, string> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
};

type LiveAthleteResolve = {
  athlete_id?: string;
  athlete_main_id?: string | null;
  grad_year?: string | null;
  city?: string | null;
  state?: string | null;
  sport?: string | null;
  head_scout?: string | null;
};

export type AppointmentLifecycleState =
  | 'ready_to_call'
  | 'scheduled'
  | 'rescheduled'
  | 'confirmation_due'
  | 'confirmed'
  | 'completed'
  | 'missed'
  | 'needs_manual_reconciliation';

export type AppointmentLifecycleBadge = {
  label: string;
};

export type AppointmentTaskSnapshot = {
  taskId?: string | null;
  title?: string | null;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  completionDate?: string | null;
  assignedOwner?: string | null;
};

export type ResolvedAppointment = {
  athleteId?: string;
  athleteName: string;
  crmSalesStage?: string;
  lifecycleState: AppointmentLifecycleState;
  assignedScout?: string;
  calendarOwnerId?: string;
  currentMeeting?: BookedMeetingEvent | null;
  previousMeeting?: BookedMeetingEvent | null;
  followUpTask?: AppointmentTaskSnapshot | null;
  needsConfirmationText: boolean;
  needsManualReview: boolean;
  reason: string;
  bookedMeetingTitle?: string | null;
  meetingTimezone?: string | null;
  currentMeetingDate?: Date | null;
  currentMeetingLabel?: string | null;
  oldFollowUpDateDetected: boolean;
  operatorStatus: string;
  badges: AppointmentLifecycleBadge[];
};

export type HydrateResolvedAppointmentArgs = {
  athleteId: string;
  athleteName: string;
  crmSalesStage?: string | null;
  followUpTask?: AppointmentTaskSnapshot | null;
  headScoutName?: string | null;
  sport?: string | null;
  gradYear?: string | null;
  state?: string | null;
  city?: string | null;
  bookedMeetings?: BookedMeetingEvent[] | null;
  now?: Date;
};

function normalizeStage(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function isRescheduledStage(value?: string | null): boolean {
  return normalizeStage(value) === 'rescheduled';
}

export function isAppointmentLifecycleCrmStage(value?: string | null): boolean {
  const normalized = normalizeStage(value);
  return normalized === 'meeting set' || normalized === 'rescheduled';
}

export function getSelectedSalesStageLabel(options: SalesStageOption[]): string | null {
  return (
    options.find((option) => option.selected)?.label ||
    options.find((option) => option.selected)?.value ||
    null
  );
}

function parseTaskDueDate(value?: string | null): Date | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  const match = trimmed.match(
    /^(?:[A-Za-z]{3}\s+)?(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?$/i,
  );
  if (!match) return null;
  const month = Number.parseInt(match[1], 10) - 1;
  const day = Number.parseInt(match[2], 10);
  const yearValue = Number.parseInt(match[3], 10);
  const year = match[3].length === 2 ? 2000 + yearValue : yearValue;
  let hour = 0;
  let minute = 0;
  if (match[4] && match[5]) {
    hour = Number.parseInt(match[4], 10);
    minute = Number.parseInt(match[5], 10);
    const meridiem = String(match[6] || '').toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
  }
  const parsedMatch = new Date(year, month, day, hour, minute);
  return Number.isNaN(parsedMatch.getTime()) ? null : parsedMatch;
}

function formatCurrentMeetingLabel(meeting?: BookedMeetingEvent | null): string | null {
  if (!meeting?.start || !meeting?.end) {
    return null;
  }
  return `Current: ${formatHeadScoutSlotDate(meeting.start)} ${formatHeadScoutSlotTimeRange(
    meeting.start,
    meeting.end,
  ).split(' - ')[0]}`;
}

function getTaskTypeLabel(task?: AppointmentTaskSnapshot | null): 'Call' | 'Follow Up' | 'Confirm' {
  const title = `${task?.title || ''} ${task?.description || ''}`.toLowerCase();
  if (title.includes('confirm')) return 'Confirm';
  if (title.includes('follow')) return 'Follow Up';
  return 'Call';
}

function compareMeetingDate(left: BookedMeetingEvent, right: BookedMeetingEvent): number {
  return left.start.localeCompare(right.start);
}

export function selectAppointmentMeetings(args: {
  meetings?: BookedMeetingEvent[] | null;
  now?: Date;
}): { currentMeeting: BookedMeetingEvent | null; previousMeeting: BookedMeetingEvent | null } {
  const meetings = [...(args.meetings || [])].sort(compareMeetingDate).reverse();
  if (!meetings.length) {
    return { currentMeeting: null, previousMeeting: null };
  }

  const nowValue = args.now || new Date();
  const currentMeeting =
    meetings.find((meeting) => {
      const parsed = easternLocalIsoToDate(meeting.start);
      return parsed && parsed.getTime() >= nowValue.getTime();
    }) || null;

  if (currentMeeting) {
    const previousMeeting =
      meetings.find((meeting) => meeting.event_id !== currentMeeting.event_id) || null;
    return { currentMeeting, previousMeeting };
  }

  return { currentMeeting: null, previousMeeting: meetings[0] || null };
}

function hasOldFollowUpDate(args: {
  followUpTask?: AppointmentTaskSnapshot | null;
  currentMeeting?: BookedMeetingEvent | null;
}): boolean {
  const currentMeetingDate = easternLocalIsoToDate(String(args.currentMeeting?.start || '').trim());
  const taskDueDate = parseTaskDueDate(args.followUpTask?.dueDate);
  if (!currentMeetingDate || !taskDueDate) {
    return false;
  }

  return (
    taskDueDate.getFullYear() !== currentMeetingDate.getFullYear() ||
    taskDueDate.getMonth() !== currentMeetingDate.getMonth() ||
    taskDueDate.getDate() !== currentMeetingDate.getDate()
  );
}

export function buildBookedMeetingTitle(args: {
  athleteName?: string | null;
  sport?: string | null;
  gradYear?: string | null;
  state?: string | null;
}): string {
  const athleteName = String(args.athleteName || '').trim();
  const sport = String(args.sport || '').trim();
  const gradYear = String(args.gradYear || '').trim();
  const rawState = String(args.state || '').trim();
  const upperState = rawState.toUpperCase();
  const state =
    STATE_ABBREVIATIONS[upperState] || (upperState.length === 2 ? upperState : rawState);
  return [athleteName, sport, gradYear, state].filter(Boolean).join(' ').trim();
}

export function findHeadScoutSchedule(headScoutName?: string | null) {
  const normalized = String(headScoutName || '').trim().toLowerCase();
  if (!normalized) return null;
  return (
    HEAD_SCOUT_ORDER.find((scout) => scout.scout_name.trim().toLowerCase() === normalized) || null
  );
}

export async function fetchLiveAppointmentResolve(
  athleteId: string,
): Promise<LiveAthleteResolve | null> {
  const response = await apiFetch(
    `/athlete/${encodeURIComponent(athleteId)}/resolve?force_refresh=true`,
  );
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json().catch(() => ({}))) as LiveAthleteResolve;
  return payload && typeof payload === 'object' ? payload : null;
}

function buildBadges(result: {
  crmSalesStage?: string | null;
  currentMeetingLabel?: string | null;
  oldFollowUpDateDetected: boolean;
  needsConfirmationText: boolean;
  needsManualReview: boolean;
}): AppointmentLifecycleBadge[] {
  const badges: AppointmentLifecycleBadge[] = [];
  if (isRescheduledStage(result.crmSalesStage)) {
    badges.push({ label: 'Rescheduled' });
  }
  if (result.currentMeetingLabel) {
    badges.push({ label: result.currentMeetingLabel });
  }
  if (result.oldFollowUpDateDetected) {
    badges.push({ label: 'Old follow-up date detected' });
  }
  if (result.needsConfirmationText) {
    badges.push({ label: 'Needs confirmation text' });
  }
  if (result.needsManualReview) {
    badges.push({ label: 'Needs manual reconciliation' });
  }
  return badges;
}

export function resolveAppointmentLifecycle(args: {
  athleteId?: string;
  athleteName: string;
  crmSalesStage?: string | null;
  assignedScout?: string | null;
  calendarOwnerId?: string | null;
  bookedMeetingTitle?: string | null;
  bookedMeetings?: BookedMeetingEvent[] | null;
  followUpTask?: AppointmentTaskSnapshot | null;
  meetingTimezone?: string | null;
  now?: Date;
}): ResolvedAppointment {
  const now = args.now || new Date();
  const { currentMeeting, previousMeeting } = selectAppointmentMeetings({
    meetings: args.bookedMeetings,
    now,
  });
  const currentMeetingDate = currentMeeting ? easternLocalIsoToDate(currentMeeting.start) : null;
  const crmSalesStage = String(args.crmSalesStage || '').trim() || null;
  const oldFollowUpDateDetected = hasOldFollowUpDate({
    followUpTask: args.followUpTask,
    currentMeeting,
  });
  const taskCompleted = Boolean(String(args.followUpTask?.completionDate || '').trim());
  const meetingIsPast =
    Boolean(currentMeetingDate) && Boolean(currentMeetingDate && currentMeetingDate.getTime() < now.getTime());

  let lifecycleState: AppointmentLifecycleState = 'ready_to_call';
  let needsManualReview = false;
  let needsConfirmationText = false;
  let reason = 'Warm lead with no current booked meeting.';

  if (taskCompleted && currentMeeting) {
    lifecycleState = 'completed';
    reason = 'Follow-up task is completed for the resolved appointment.';
  } else if (isRescheduledStage(crmSalesStage)) {
    if (currentMeeting) {
      lifecycleState = 'rescheduled';
      needsConfirmationText = !meetingIsPast;
      reason = oldFollowUpDateDetected
        ? 'CRM stage is Rescheduled and a newer booked meeting replaced the old follow-up date.'
        : 'CRM stage is Rescheduled and the latest booked meeting is active.';
    } else {
      lifecycleState = 'needs_manual_reconciliation';
      needsManualReview = true;
      reason = 'Rescheduled stage, no current booked meeting found.';
    }
  } else if (currentMeeting) {
    if (meetingIsPast) {
      lifecycleState = 'missed';
      reason = 'Current booked meeting is in the past and still needs resolution.';
    } else {
      lifecycleState = 'confirmation_due';
      needsConfirmationText = true;
      reason = oldFollowUpDateDetected
        ? 'Booked meeting is current, but the follow-up task still points to the old date.'
        : 'Current booked meeting is active and needs confirmation.';
    }
  } else if (isAppointmentLifecycleCrmStage(crmSalesStage)) {
    lifecycleState = 'needs_manual_reconciliation';
    needsManualReview = true;
    reason = `CRM stage is ${crmSalesStage}, but no current booked meeting was found.`;
  }

  const operatorStatus = needsManualReview
    ? 'Manual Review'
    : needsConfirmationText
      ? 'Confirm'
      : lifecycleState === 'missed'
        ? 'Follow Up'
        : lifecycleState === 'completed'
          ? 'Done'
          : getTaskTypeLabel(args.followUpTask);
  const currentMeetingLabel = formatCurrentMeetingLabel(currentMeeting);

  return {
    athleteId: args.athleteId,
    athleteName: args.athleteName,
    crmSalesStage: crmSalesStage || undefined,
    lifecycleState,
    assignedScout: String(args.assignedScout || '').trim() || undefined,
    calendarOwnerId: String(args.calendarOwnerId || '').trim() || undefined,
    currentMeeting,
    previousMeeting,
    followUpTask: args.followUpTask || null,
    needsConfirmationText,
    needsManualReview,
    reason,
    bookedMeetingTitle: args.bookedMeetingTitle || null,
    meetingTimezone: args.meetingTimezone || null,
    currentMeetingDate,
    currentMeetingLabel,
    oldFollowUpDateDetected,
    operatorStatus,
    badges: buildBadges({
      crmSalesStage,
      currentMeetingLabel,
      oldFollowUpDateDetected,
      needsConfirmationText,
      needsManualReview,
    }),
  };
}

export async function hydrateResolvedAppointment(
  args: HydrateResolvedAppointmentArgs,
): Promise<ResolvedAppointment> {
  const liveResolve = await fetchLiveAppointmentResolve(args.athleteId);
  const resolvedCity = String(liveResolve?.city || args.city || '').trim();
  const resolvedState = String(liveResolve?.state || args.state || '').trim();
  const resolvedSport = String(liveResolve?.sport || args.sport || '').trim();
  const resolvedGradYear = String(liveResolve?.grad_year || args.gradYear || '').trim();
  const assignedScout =
    String(liveResolve?.head_scout || args.headScoutName || '').trim() || null;
  const headScout = findHeadScoutSchedule(assignedScout);
  const bookedMeetingTitle = buildBookedMeetingTitle({
    athleteName: args.athleteName,
    sport: resolvedSport,
    gradYear: resolvedGradYear,
    state: resolvedState,
  });
  let bookedMeetings = args.bookedMeetings || null;

  if (!bookedMeetings && headScout && bookedMeetingTitle) {
    const anchorDate = parseTaskDueDate(args.followUpTask?.dueDate);
    const window = buildBookedMeetingLookupWindow(anchorDate, args.now);
    try {
      const booked = await fetchBookedMeeting({
        calendarOwnerId: headScout.calendar_owner_id,
        title: bookedMeetingTitle,
        start: window.start,
        end: window.end,
      });
      bookedMeetings =
        booked.events && booked.events.length
          ? booked.events
          : booked.event
            ? [booked.event]
            : [];
    } catch {
      bookedMeetings = [];
    }
  }

  const meetingTimezone =
    mapTimezoneToLegacyRecruitZone(resolveTimezone(resolvedCity, resolvedState)) || 'EST';

  return resolveAppointmentLifecycle({
    athleteId: args.athleteId,
    athleteName: args.athleteName,
    crmSalesStage: args.crmSalesStage,
    assignedScout,
    calendarOwnerId: headScout?.calendar_owner_id,
    bookedMeetingTitle,
    bookedMeetings,
    followUpTask: args.followUpTask,
    meetingTimezone,
    now: args.now,
  });
}

