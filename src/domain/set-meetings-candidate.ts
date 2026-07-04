import type { ScoutPortalTask } from '../features/scout-prep/types';
import type { BookedMeetingEvent } from '../lib/head-scout-schedules';
import type { HeadScoutFollowUpCandidate } from '../lib/head-scout-follow-ups';
import { buildWeeklyOperatorMeetingSetCandidates, isActualSetMeetingTitle } from './booked-meeting-source';
import { stripMoveThisTaskPrefix } from './scout-task-selection';

const DASHBOARD_BASE_URL = 'https://legacy-dashboard.example.com';

function buildAdminUrl(athleteId: string, athleteMainId: string): string {
  return `${DASHBOARD_BASE_URL}/admin/athletes?contactid=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(athleteMainId)}`;
}

function buildTaskUrl(athleteId: string, athleteMainId: string): string {
  return `${buildAdminUrl(athleteId, athleteMainId)}&tasktab=1`;
}

function formatAppointmentDateTimeLabel(start?: string | null, end?: string | null): string {
  const startDate = new Date(String(start || '').trim());
  if (Number.isNaN(startDate.getTime())) return '';
  const endDate = new Date(
    !Number.isNaN(Date.parse(String(end || '').trim()))
      ? String(end || '').trim()
      : startDate.getTime() + 60 * 60 * 1000,
  );
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    timeZone: 'America/New_York',
  }).format(startDate);
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  });
  return `${dateLabel} ${timeFormatter.format(startDate)} - ${timeFormatter.format(endDate)}`;
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

function getMeetingEndValue(candidate: HeadScoutFollowUpCandidate): number {
  const startValue = Date.parse(String(candidate.bookedMeeting?.start || '').trim());
  if (Number.isNaN(startValue)) return Number.NaN;
  const endValue = Date.parse(String(candidate.bookedMeeting?.end || '').trim());
  return Number.isNaN(endValue) ? startValue + 60 * 60 * 1000 : endValue;
}

function isCurrentMeetingWindow(candidate: HeadScoutFollowUpCandidate, now = new Date()): boolean {
  const endValue = getMeetingEndValue(candidate);
  return !Number.isNaN(endValue) && endValue > now.getTime();
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

function cleanIdentityPart(value?: string | number | null): string {
  return String(value || '').trim();
}

export function buildSetMeetingCandidateIdentityKey(candidate: HeadScoutFollowUpCandidate): string {
  const athleteKey =
    cleanIdentityPart(candidate.key) ||
    [candidate.athleteId, candidate.athleteMainId].map(cleanIdentityPart).filter(Boolean).join(':') ||
    cleanIdentityPart(candidate.athleteName) ||
    'unknown-athlete';
  const eventId = cleanIdentityPart(candidate.bookedMeeting?.event_id);
  if (eventId) {
    return `${athleteKey}:event:${eventId}`;
  }

  const start = cleanIdentityPart(candidate.bookedMeeting?.start);
  if (start) {
    return `${athleteKey}:start:${start}`;
  }

  const taskId = cleanIdentityPart(candidate.taskId);
  if (taskId) {
    return `${athleteKey}:task:${taskId}`;
  }

  return athleteKey;
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

export type WeeklyAppointmentSetMeetingRow = {
  id: string;
  athleteId: string;
  athleteMainId: string;
  athleteName?: string | null;
  headScout?: string | null;
  startsAt: string;
  endsAt?: string | null;
  sourceEventId?: string | null;
  meetingTitle?: string | null;
  dateTimeLabel?: string | null;
  status?: string | null;
  postMeetingResult?: string | null;
  previousAppointmentId?: string | null;
  originalAppointmentId?: string | null;
  rescheduleSequence?: number | null;
};

function normalizeSetMeetingText(value?: string | number | null): string {
  return String(value || '').trim().toLowerCase();
}

function hasPostMeetingResult(row: WeeklyAppointmentSetMeetingRow): boolean {
  return Boolean(normalizeSetMeetingText(row.postMeetingResult));
}

function getAppointmentRowAthleteKey(row: WeeklyAppointmentSetMeetingRow): string {
  return [row.athleteId, row.athleteMainId].map(cleanIdentityPart).filter(Boolean).join(':');
}

function getAppointmentRowStartValue(row: WeeklyAppointmentSetMeetingRow): number {
  const parsed = Date.parse(String(row.startsAt || '').trim());
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function isRescheduledSourceRow(row: WeeklyAppointmentSetMeetingRow): boolean {
  return (
    normalizeSetMeetingText(row.postMeetingResult) === 'rescheduled' ||
    normalizeSetMeetingText(row.status) === 'rescheduled'
  );
}

function hasRescheduleLinkTo(
  source: WeeklyAppointmentSetMeetingRow,
  candidate: WeeklyAppointmentSetMeetingRow,
): boolean {
  const sourceId = cleanIdentityPart(source.id);
  const candidateId = cleanIdentityPart(candidate.id);
  if (!sourceId || !candidateId || sourceId === candidateId) return false;

  const candidatePrevious = cleanIdentityPart(candidate.previousAppointmentId);
  if (candidatePrevious && candidatePrevious === sourceId) return true;

  const sourceOriginal = cleanIdentityPart(source.originalAppointmentId);
  const candidateOriginal = cleanIdentityPart(candidate.originalAppointmentId);
  if (sourceOriginal && candidateOriginal && sourceOriginal === candidateOriginal) {
    return true;
  }

  const sourceSequence = Number(source.rescheduleSequence || 0);
  const candidateSequence = Number(candidate.rescheduleSequence || 0);
  return candidateSequence > sourceSequence && getAppointmentRowStartValue(candidate) >= getAppointmentRowStartValue(source);
}

export function selectCurrentSetMeetingAppointmentRows(
  appointments: WeeklyAppointmentSetMeetingRow[],
): WeeklyAppointmentSetMeetingRow[] {
  const activeRows = appointments.filter((row) => !hasPostMeetingResult(row));
  const rowsByAthlete = new Map<string, WeeklyAppointmentSetMeetingRow[]>();
  for (const row of activeRows) {
    const athleteKey = getAppointmentRowAthleteKey(row);
    if (!athleteKey) continue;
    rowsByAthlete.set(athleteKey, [...(rowsByAthlete.get(athleteKey) || []), row]);
  }

  const suppressedIds = new Set<string>();
  for (const rows of rowsByAthlete.values()) {
    if (rows.length < 2) continue;
    for (const row of rows) {
      if (!isRescheduledSourceRow(row)) continue;
      const replacement = rows.find((candidate) => {
        if (candidate.id === row.id) return false;
        return (
          hasRescheduleLinkTo(row, candidate) ||
          getAppointmentRowStartValue(candidate) > getAppointmentRowStartValue(row)
        );
      });
      if (replacement) {
        suppressedIds.add(row.id);
      }
    }
  }

  return activeRows.filter((row) => !suppressedIds.has(row.id));
}

export function buildSetMeetingCandidatesFromAppointments(args: {
  appointments: WeeklyAppointmentSetMeetingRow[];
  tasks: ScoutPortalTask[];
  operatorName: string;
}): HeadScoutFollowUpCandidate[] {
  const appointments = selectCurrentSetMeetingAppointmentRows(args.appointments);
  return buildWeeklyOperatorMeetingSetCandidates({
    bookedMeetings: appointments.map((appointment) => ({
      event_id: appointment.sourceEventId || appointment.id,
      athlete_id: appointment.athleteId,
      athlete_main_id: appointment.athleteMainId,
      athlete_name: appointment.athleteName || null,
      title: appointment.meetingTitle || appointment.athleteName || 'Booked Meeting',
      assigned_owner: appointment.headScout || null,
      start: appointment.startsAt,
      end: appointment.endsAt || null,
      date_time_label:
        appointment.dateTimeLabel ||
        formatAppointmentDateTimeLabel(appointment.startsAt, appointment.endsAt),
    })),
    tasks: args.tasks,
    operatorName: args.operatorName,
  }).map((candidate) => buildSetMeetingCandidate(candidate));
}

export function buildSetMeetingCandidatesFromSupabaseFallback(
  candidates: HeadScoutFollowUpCandidate[],
): HeadScoutFollowUpCandidate[] {
  return candidates;
}

export function mergeSetMeetingAppointmentAndBookedMeetingCandidates(args: {
  appointmentCandidates: HeadScoutFollowUpCandidate[];
  bookedMeetingCandidates: HeadScoutFollowUpCandidate[];
}): HeadScoutFollowUpCandidate[] {
  const merged = [...args.appointmentCandidates];
  const existingKeys = new Set(merged.map((candidate) => buildSetMeetingCandidateIdentityKey(candidate)));

  for (const candidate of args.bookedMeetingCandidates) {
    const key = buildSetMeetingCandidateIdentityKey(candidate);
    if (!existingKeys.has(key)) {
      merged.push(candidate);
      existingKeys.add(key);
    }
  }

  return merged;
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
  now?: Date;
}): HeadScoutFollowUpCandidate[] {
  const now = args.now || new Date();
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
    return meetingDate >= args.weekStart && meetingDate < args.weekEnd && isCurrentMeetingWindow(candidate, now);
  });
}
