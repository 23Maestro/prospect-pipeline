import type { ScoutPortalTask } from '../features/scout-prep/types';
import type { BookedMeetingEvent } from '../lib/head-scout-schedules';
import type { HeadScoutFollowUpCandidate } from '../lib/head-scout-follow-ups';
import { buildWeeklyOperatorMeetingSetCandidates, isActualSetMeetingTitle } from './booked-meeting-source';
import { stripMoveThisTaskPrefix } from './scout-task-selection';

const DASHBOARD_BASE_URL = 'https://dashboard.nationalpid.com';

function buildAdminUrl(athleteId: string, athleteMainId: string): string {
  return `${DASHBOARD_BASE_URL}/admin/athletes?contactid=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(athleteMainId)}`;
}

function buildTaskUrl(athleteId: string, athleteMainId: string): string {
  return `${buildAdminUrl(athleteId, athleteMainId)}&tasktab=1`;
}

export function buildMeetingDayLabel(candidate: Pick<HeadScoutFollowUpCandidate, 'bookedMeeting'>): string {
  const raw = candidate.bookedMeeting?.start || '';
  const parsed = raw ? new Date(raw) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
    }).format(parsed);
  }

  const fallback = candidate.bookedMeeting?.date_time_label || '';
  const match = fallback.match(/^[A-Za-z]{3}\s+\d{2}\/\d{2}\/\d{2}/);
  if (match) {
    const value = new Date(match[0]);
    if (!Number.isNaN(value.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'numeric',
        day: 'numeric',
      }).format(value);
    }
  }

  return 'No date';
}

export function getMeetingSortValue(candidate: HeadScoutFollowUpCandidate): number {
  const currentMeeting = candidate.bookedMeeting ? new Date(candidate.bookedMeeting.start) : null;
  if (currentMeeting && !Number.isNaN(currentMeeting.getTime())) {
    return currentMeeting.getTime();
  }
  const dueValue = Date.parse(String(candidate.dueDate || '').trim());
  return Number.isNaN(dueValue) ? Number.POSITIVE_INFINITY : dueValue;
}

export function getMeetingSortBucket(candidate: HeadScoutFollowUpCandidate, now = new Date()): number {
  const currentMeeting = candidate.bookedMeeting ? new Date(candidate.bookedMeeting.start) : null;
  const meetingTs = currentMeeting?.getTime() || Number.NaN;
  const soonCutoff = now.getTime() + 72 * 60 * 60 * 1000;

  if (!Number.isNaN(meetingTs) && meetingTs >= now.getTime() && meetingTs <= soonCutoff) {
    return 0;
  }
  if (candidate.lifecycleState === 'rescheduled' && candidate.needsConfirmationText) {
    return 1;
  }
  if (
    candidate.needsManualReview ||
    candidate.oldFollowUpDateDetected ||
    candidate.lifecycleState === 'follow_up_due'
  ) {
    return 2;
  }
  if (!Number.isNaN(meetingTs) && meetingTs >= now.getTime()) {
    return 3;
  }
  return 4;
}

export function sortSetMeetingCandidates(
  candidates: HeadScoutFollowUpCandidate[],
  now = new Date(),
): HeadScoutFollowUpCandidate[] {
  return [...candidates].sort((left, right) => {
    const bucketDiff = getMeetingSortBucket(left, now) - getMeetingSortBucket(right, now);
    if (bucketDiff !== 0) {
      return bucketDiff;
    }
    const timeDiff = getMeetingSortValue(left) - getMeetingSortValue(right);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return left.athleteName.localeCompare(right.athleteName);
  });
}

export function buildSetMeetingCandidate(args: {
  athleteKey: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  taskId: string;
  taskTitle?: string | null;
  taskDescription?: string | null;
  taskDueDate?: string | null;
  taskCompletionDate?: string | null;
  taskAssignedOwner?: string | null;
  bookedMeeting: {
    eventId: string;
    title: string;
    assignedOwner?: string | null;
    start: string;
    end?: string | null;
    dateTimeLabel?: string | null;
  };
}): HeadScoutFollowUpCandidate {
  return {
    key: args.athleteKey,
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName,
    dueDate: args.taskDueDate || args.bookedMeeting.start,
    stage: 'Meeting Set',
    currentTask: stripMoveThisTaskPrefix(args.taskTitle || '') || 'Confirmation Call',
    taskId: args.taskId,
    adminUrl: buildAdminUrl(args.athleteId, args.athleteMainId),
    taskUrl: buildTaskUrl(args.athleteId, args.athleteMainId),
    source: 'website',
    crmSalesStage: 'Meeting Set',
    headScoutName: args.bookedMeeting.assignedOwner,
    bookedMeetingTitle: args.bookedMeeting.title,
    bookedMeeting: {
      event_id: args.bookedMeeting.eventId,
      title: args.bookedMeeting.title,
      assigned_owner: args.bookedMeeting.assignedOwner || '',
      start: args.bookedMeeting.start,
      end: args.bookedMeeting.end || '',
      date_time_label: args.bookedMeeting.dateTimeLabel || '',
    },
    previousMeeting: null,
    followUpTask: {
      taskId: args.taskId,
      title: args.taskTitle || null,
      description: args.taskDescription || null,
      dueDate: args.taskDueDate || null,
      completionDate: args.taskCompletionDate || null,
      assignedOwner: args.taskAssignedOwner || null,
    },
    lifecycleState: 'scheduled',
    needsConfirmationText: true,
    needsManualReview: false,
    reason: 'Weekly booked meeting assigned to Jerami confirmation queue.',
    operatorStatus: 'active_meeting_queue',
    badges: [],
    currentMeetingLabel: args.bookedMeeting.dateTimeLabel || '',
    oldFollowUpDateDetected: false,
    meetingTimezone: null,
  };
}

export function buildSetMeetingCandidatesFromBookedMeetings(args: {
  bookedMeetings: BookedMeetingEvent[];
  tasks: ScoutPortalTask[];
  operatorName: string;
}): HeadScoutFollowUpCandidate[] {
  return buildWeeklyOperatorMeetingSetCandidates({
    bookedMeetings: args.bookedMeetings,
    tasks: args.tasks,
    operatorName: args.operatorName,
  }).map((candidate) => buildSetMeetingCandidate(candidate));
}

export function buildSetMeetingCandidatesFromSupabaseFallback(
  candidates: HeadScoutFollowUpCandidate[],
): HeadScoutFollowUpCandidate[] {
  return candidates;
}

export function enrichSetMeetingCandidate(candidate: HeadScoutFollowUpCandidate): HeadScoutFollowUpCandidate {
  return candidate;
}

export function filterWeeklySetMeetingCandidates(args: {
  candidates: HeadScoutFollowUpCandidate[];
  scoutName?: string;
  weeklyMeetingsOnly?: boolean;
  weekStart: string;
  weekEnd: string;
}): HeadScoutFollowUpCandidate[] {
  return args.candidates.filter((candidate) => {
    if (
      args.scoutName &&
      String(candidate.headScoutName || '')
        .trim()
        .toLowerCase() !== args.scoutName.trim().toLowerCase()
    ) {
      return false;
    }

    if (!args.weeklyMeetingsOnly) {
      return true;
    }

    const currentMeeting = candidate.bookedMeeting ? new Date(candidate.bookedMeeting.start) : null;
    if (!currentMeeting || Number.isNaN(currentMeeting.getTime())) {
      return false;
    }
    if (candidate.bookedMeeting && !isActualSetMeetingTitle(candidate.bookedMeeting.title)) {
      return false;
    }

    const meetingDate = currentMeeting.toISOString().slice(0, 10);
    return meetingDate >= args.weekStart && meetingDate < args.weekEnd;
  });
}
