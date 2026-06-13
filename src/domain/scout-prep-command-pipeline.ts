import type { ScoutAthleteTask, ScoutPortalTask, ScoutPrepContext } from '../features/scout-prep/types';
import { getActiveOperator } from './owners';
import {
  getMeetingReminderRecipient,
  getVoicemailFollowUpRecipients,
  selectScoutPrepContactNumbers,
} from './scout-contact-selection';
import {
  findNewestIncompleteConfirmationTask,
  getIncompleteTasks,
  stripMoveThisTaskPrefix,
} from './scout-task-selection';
import {
  getGreetingForLocalTime,
  getRelativeMeetingDayPhrase,
  getReminderTimeLabel,
} from './outreach-time-wording';
import {
  buildSetMeetingCandidateIdentityKey,
  buildSetMeetingCandidatesFromBookedMeetings,
  sortSetMeetingCandidates,
} from './set-meetings-candidate';
import type { BookedMeetingEvent } from '../lib/head-scout-schedules';
import type { HeadScoutFollowUpCandidate } from '../lib/head-scout-follow-ups';

export type ScoutPrepCommandContext = {
  activeOperator: ReturnType<typeof getActiveOperator>;
  athleteIdentity: {
    athleteId: string;
    athleteMainId: string;
  };
  athleteName: string;
  task: ScoutPortalTask | ScoutPrepContext['task'];
  tasks: ScoutAthleteTask[];
  contactSelection: ReturnType<typeof selectScoutPrepContactNumbers>;
  reminderRecipient: ReturnType<typeof getMeetingReminderRecipient>;
  voicemailRecipients: ReturnType<typeof getVoicemailFollowUpRecipients>;
  ownerContext: null;
  currentMeeting: BookedMeetingEvent | null;
  previousMeeting: BookedMeetingEvent | null;
  headScout: string | null;
  meetingTimezone: string | null;
  meetingStart: Date | null;
  meetingTimePhrase: string | null;
  confirmationDayPhrase: string | null;
  greeting: string;
  actionEligibility: {
    canSendConfirmation: boolean;
    canSendVoicemail: boolean;
  };
};

export type SetMeetingsCommandContext = {
  activeOperator: ReturnType<typeof getActiveOperator>;
  candidates: HeadScoutFollowUpCandidate[];
  weekWindow: { start: string; end: string } | null;
  weekLabel: string | null;
  selectedScout: string | null;
  actionEligibility: {
    canSendConfirmation: boolean;
  };
};

export type ConfirmationActionPayload = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  taskId: string;
  currentTask: string;
  recipientPhones: string[];
  recipientNames: string[];
  headScoutName: string | null;
  meetingStart: Date | null;
  meetingTimezone: string | null;
  reminderVariant: string;
  message: string | null;
};

export type VoicemailActionPayload = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  recipients: ReturnType<typeof getVoicemailFollowUpRecipients>;
  currentTask: string | null;
};

function candidateCompletenessScore(candidate: HeadScoutFollowUpCandidate): number {
  return [
    candidate.athleteId,
    candidate.athleteMainId,
    candidate.taskId,
    candidate.currentTask,
    candidate.adminUrl,
    candidate.taskUrl,
    candidate.parent1Name,
    candidate.parent2Name,
    candidate.bookedMeeting?.event_id,
    candidate.bookedMeeting?.start,
    candidate.bookedMeeting?.end,
    candidate.headScoutName,
  ].filter((value) => String(value || '').trim()).length;
}

function dedupeSetMeetingCandidatesByIdentity(
  candidates: HeadScoutFollowUpCandidate[],
): HeadScoutFollowUpCandidate[] {
  const byIdentity = new Map<string, HeadScoutFollowUpCandidate>();

  for (const candidate of candidates) {
    const key = buildSetMeetingCandidateIdentityKey(candidate);
    const existing = byIdentity.get(key);
    if (!existing || candidateCompletenessScore(candidate) > candidateCompletenessScore(existing)) {
      byIdentity.set(key, candidate);
    }
  }

  return Array.from(byIdentity.values());
}

export type MeetingSetActionPayload = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  taskId: string | null;
};

function parseMeetingStart(value?: string | Date | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeScoutAthleteTask(task: Partial<ScoutAthleteTask>): ScoutAthleteTask {
  return {
    task_id: String(task.task_id || '').trim(),
    title: task.title,
    assigned_owner: task.assigned_owner,
    due_date: task.due_date,
    completion_date: task.completion_date,
    description: task.description,
    row_text: task.row_text,
  };
}

export function buildScoutPrepCommandContext(args: {
  context: ScoutPrepContext;
  currentMeeting?: BookedMeetingEvent | null;
  previousMeeting?: BookedMeetingEvent | null;
  meetingStart?: string | Date | null;
  meetingTimezone?: string | null;
  now?: Date;
}): ScoutPrepCommandContext {
  const athleteId = String(args.context.task.contact_id || '').trim();
  const athleteMainId = String(
    args.context.resolved.athlete_main_id || args.context.task.athlete_main_id || '',
  ).trim();
  const meetingStart = parseMeetingStart(args.meetingStart || args.currentMeeting?.start || null);
  const meetingTimezone = args.meetingTimezone || null;
  const confirmationTask = findNewestIncompleteConfirmationTask(args.context.tasks);
  const voicemailRecipients = getVoicemailFollowUpRecipients(args.context);

  return {
    activeOperator: getActiveOperator(),
    athleteIdentity: { athleteId, athleteMainId },
    athleteName: args.context.contactInfo.studentAthlete.name || args.context.task.athlete_name || '',
    task: args.context.task,
    tasks: getIncompleteTasks(args.context.tasks).map(normalizeScoutAthleteTask),
    contactSelection: selectScoutPrepContactNumbers(args.context),
    reminderRecipient: getMeetingReminderRecipient(args.context),
    voicemailRecipients,
    ownerContext: null,
    currentMeeting: args.currentMeeting || null,
    previousMeeting: args.previousMeeting || null,
    headScout: args.context.resolved.head_scout || null,
    meetingTimezone,
    meetingStart,
    meetingTimePhrase: meetingStart
      ? getReminderTimeLabel({ meetingStart, meetingTimezone })
      : null,
    confirmationDayPhrase: meetingStart
      ? getRelativeMeetingDayPhrase({ meetingStart, meetingTimezone, now: args.now })
      : null,
    greeting: getGreetingForLocalTime({ now: args.now, meetingTimezone }),
    actionEligibility: {
      canSendConfirmation: Boolean(confirmationTask?.task_id),
      canSendVoicemail: voicemailRecipients.some((recipient) => recipient.phones.length > 0),
    },
  };
}

export function buildSetMeetingsCommandContext(args: {
  candidates: HeadScoutFollowUpCandidate[];
  weekWindow?: { start: string; end: string } | null;
  weekLabel?: string | null;
  selectedScout?: string | null;
}): SetMeetingsCommandContext {
  const candidates = sortSetMeetingCandidates(dedupeSetMeetingCandidatesByIdentity(args.candidates));
  return {
    activeOperator: getActiveOperator(),
    candidates,
    weekWindow: args.weekWindow || null,
    weekLabel: args.weekLabel || null,
    selectedScout: args.selectedScout || null,
    actionEligibility: {
      canSendConfirmation: candidates.some((candidate) => Boolean(candidate.athleteId && candidate.athleteMainId)),
    },
  };
}

export function buildHeadScoutScheduleCommandContext(args: {
  candidates: HeadScoutFollowUpCandidate[];
  weekWindow?: { start: string; end: string } | null;
  weekLabel?: string | null;
  selectedScout?: string | null;
}): SetMeetingsCommandContext {
  return buildSetMeetingsCommandContext(args);
}

export function buildConfirmationActionPayload(args: {
  commandContext: ScoutPrepCommandContext;
  confirmationTask?: ScoutAthleteTask | null;
  reminderVariant: string;
  message?: string | null;
}): ConfirmationActionPayload {
  const confirmationTask =
    args.confirmationTask || findNewestIncompleteConfirmationTask(args.commandContext.tasks);
  return {
    athleteId: args.commandContext.athleteIdentity.athleteId,
    athleteMainId: args.commandContext.athleteIdentity.athleteMainId,
    athleteName: args.commandContext.athleteName,
    taskId: String(confirmationTask?.task_id || '').trim(),
    currentTask: stripMoveThisTaskPrefix(confirmationTask?.title) || 'Confirmation Call',
    recipientPhones: args.commandContext.reminderRecipient?.phones || [],
    recipientNames: args.commandContext.reminderRecipient?.recipientNames || [],
    headScoutName: args.commandContext.headScout,
    meetingStart: args.commandContext.meetingStart,
    meetingTimezone: args.commandContext.meetingTimezone,
    reminderVariant: args.reminderVariant,
    message: args.message || null,
  };
}

export function buildVoicemailActionPayload(args: {
  commandContext: ScoutPrepCommandContext;
  currentTask?: string | null;
}): VoicemailActionPayload {
  return {
    athleteId: args.commandContext.athleteIdentity.athleteId,
    athleteMainId: args.commandContext.athleteIdentity.athleteMainId,
    athleteName: args.commandContext.athleteName,
    recipients: args.commandContext.voicemailRecipients,
    currentTask: args.currentTask || null,
  };
}

export function buildMeetingSetActionPayload(args: {
  commandContext: ScoutPrepCommandContext;
  taskId?: string | null;
}): MeetingSetActionPayload {
  return {
    athleteId: args.commandContext.athleteIdentity.athleteId,
    athleteMainId: args.commandContext.athleteIdentity.athleteMainId,
    athleteName: args.commandContext.athleteName,
    taskId: args.taskId || null,
  };
}

export function buildClientMessageActionPayload(args: {
  commandContext: ScoutPrepCommandContext;
}): MeetingSetActionPayload {
  return buildMeetingSetActionPayload(args);
}

export function buildSetMeetingsCommandContextFromBookedMeetings(args: {
  bookedMeetings: BookedMeetingEvent[];
  tasks: ScoutPortalTask[];
  operatorName?: string;
  weekWindow?: { start: string; end: string } | null;
  weekLabel?: string | null;
  selectedScout?: string | null;
}): SetMeetingsCommandContext {
  return buildSetMeetingsCommandContext({
    candidates: buildSetMeetingCandidatesFromBookedMeetings({
      bookedMeetings: args.bookedMeetings,
      tasks: args.tasks,
      operatorName: args.operatorName || getActiveOperator().personName,
    }),
    weekWindow: args.weekWindow,
    weekLabel: args.weekLabel,
    selectedScout: args.selectedScout,
  });
}
