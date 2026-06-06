import { buildPostCallActionPlan } from '../domain/post-call-action';
import {
  POST_CALL_UPDATE_EXCLUDED_STAGE_LABELS,
  classifyPostMeetingOutcomeStage,
  classifyPostCallActivityStage,
  classifyMeetingSetStage,
  needsPostCallMeetingSchedulingFields,
  normalizeSalesStageLabelForLaravel,
} from '../domain/sales-stage-contract';
import type { MeetingSetSubmitResponse, ScoutPortalTask, ScoutPrepContext } from '../features/scout-prep/types';
import { HEAD_SCOUT_ORDER, fetchOpenMeetings, type OpenMeetingSlot } from './head-scout-schedules';
import { searchLogger } from './logger';
import { fetchCuratedSalesStageOptions, fetchMeetingSetTemplate, submitMeetingSet, updateSalesStage } from './sales-stage';
import { completeScoutPrepTaskAfterVoicemail } from './scout-prep-task-completion';
import { hydrateMeetingSetTemplateForForm } from './scout-prep-contact';
import { recordMeetingSet } from './supabase-lifecycle';
import { syncMeetingSetConfirmationCacheFromScoutPrep } from './set-meeting-confirmation-cache-sync';

const FEATURE = 'scout-prep-post-call-update';

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

function firstString(...values: Array<string | number | null | undefined>): string {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

export type SubmitScoutPrepPostCallUpdateArgs = {
  task: ScoutPortalTask;
  context: ScoutPrepContext;
  stageLabel: string;
  appointmentId?: string | null;
  meetingSet?: {
    meetingName?: string | null;
    meetingTimezone?: string | null;
    assignedToLegacyUserId?: string | null;
    openEventId?: string | null;
    taskDescription?: string | null;
    startTime?: string | null;
    startsAt?: string | null;
    meetingLength?: string | null;
  } | null;
};

export type SubmitScoutPrepPostCallUpdateResult = {
  success: true;
  stage: string;
  createdTaskId: string | null;
  completedTaskId: string | null;
  message: string;
};

export async function fetchScoutPrepPostCallUpdateStageOptions(
  athleteId: string,
) {
  const normalizedAthleteId = firstString(athleteId);
  if (!normalizedAthleteId) {
    throw new Error('Missing athlete_id for post-call stages.');
  }

  const options = await fetchCuratedSalesStageOptions(normalizedAthleteId, {
    excludeLabels: [...POST_CALL_UPDATE_EXCLUDED_STAGE_LABELS],
  });

  return options.filter((option) => {
    const label = option.label || option.value || '';
    return Boolean(classifyPostCallActivityStage(label)) && !classifyMeetingSetStage(label);
  });
}

export async function fetchScoutPrepPostCallUpdateFullStageOptions(
  athleteId: string,
) {
  const normalizedAthleteId = firstString(athleteId);
  if (!normalizedAthleteId) {
    throw new Error('Missing athlete_id for post-call stages.');
  }

  return await fetchCuratedSalesStageOptions(normalizedAthleteId, {
    excludeLabels: [...POST_CALL_UPDATE_EXCLUDED_STAGE_LABELS],
  });
}

export type ScoutPrepPostCallMeetingSetFormModel = {
  kind: 'meeting_set';
  template: {
    meetingName: string;
    selectedRecruitTimezone: string;
    recruitTimezoneOptions: Array<{ value: string; label: string; selected?: boolean }>;
    detailsTemplate: string;
  };
  headScouts: Array<{
    meetingFor: string;
    scoutName: string;
    city: string;
    state: string;
    calendarOwnerId: string | null;
  }>;
  selectedMeetingFor: string;
  openMeetingSlots: OpenMeetingSlot[];
  selectedOpenMeetingId: string;
  meetingLength: string;
};

export async function fetchScoutPrepPostCallMeetingSetFormModel(args: {
  task: ScoutPortalTask;
  context: ScoutPrepContext;
  meetingFor?: string | null;
}): Promise<ScoutPrepPostCallMeetingSetFormModel> {
  const template = await fetchMeetingSetTemplate(args.task);
  const hydrated = hydrateMeetingSetTemplateForForm(template, args.context, {
    athleteName: args.context.contactInfo.studentAthlete.name || args.task.athlete_name,
    gradYear: args.task.grad_year,
  });
  const selectedMeetingFor = firstString(args.meetingFor, HEAD_SCOUT_ORDER[0]?.meeting_for);
  const openMeetings = selectedMeetingFor
    ? await fetchOpenMeetings(selectedMeetingFor)
    : { slots: [] as OpenMeetingSlot[] };
  const selectedTimezone =
    firstString(
      hydrated.selected_recruit_timezone,
      hydrated.recruit_timezone_options.find((option) => option.selected)?.value,
      'EST',
    ) || 'EST';

  return {
    kind: 'meeting_set',
    template: {
      meetingName: firstString(hydrated.meeting_name),
      selectedRecruitTimezone: selectedTimezone,
      recruitTimezoneOptions: hydrated.recruit_timezone_options || [],
      detailsTemplate: firstString(hydrated.details_template),
    },
    headScouts: HEAD_SCOUT_ORDER.map((scout) => ({
      meetingFor: scout.meeting_for,
      scoutName: scout.scout_name,
      city: scout.city,
      state: scout.state,
      calendarOwnerId: scout.calendar_owner_id || null,
    })),
    selectedMeetingFor,
    openMeetingSlots: openMeetings.slots || [],
    selectedOpenMeetingId: openMeetings.slots?.[0]?.open_event_id || '',
    meetingLength: '01:00',
  };
}

function buildMeetingSetStartsAt(selectedOpenMeeting?: Pick<OpenMeetingSlot, 'date_time_label' | 'start_time'> | null): string | null {
  const rawStartTime = String(selectedOpenMeeting?.start_time || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(rawStartTime)) {
    return rawStartTime;
  }

  const dateLabel = String(selectedOpenMeeting?.date_time_label || '').trim();
  const isoDate = dateLabel.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (isoDate && rawStartTime) {
    return `${isoDate}T${rawStartTime.length === 5 ? `${rawStartTime}:00` : rawStartTime}`;
  }

  return rawStartTime || null;
}

export async function submitScoutPrepPostCallUpdate(
  args: SubmitScoutPrepPostCallUpdateArgs,
): Promise<SubmitScoutPrepPostCallUpdateResult> {
  const stageLabel = normalizeSalesStageLabelForLaravel(args.stageLabel);
  if (!stageLabel) {
    throw new Error('Official Sales Stage is required.');
  }
  if (needsPostCallMeetingSchedulingFields(stageLabel)) {
    if (!classifyMeetingSetStage(stageLabel)) {
      throw new Error(`${stageLabel} requires the Raycast meeting scheduling fields.`);
    }
    if (!args.meetingSet) {
      throw new Error(`${stageLabel} requires meeting scheduling fields.`);
    }
  }
  if (classifyPostMeetingOutcomeStage(stageLabel)) {
    throw new Error(`${stageLabel} requires the Raycast post-meeting fields.`);
  }

  const task = args.task;
  const context = args.context;
  const athleteId = firstString(
    task.athlete_id,
    task.contact_id,
    context.task.athlete_id,
    context.task.contact_id,
  );
  const athleteMainId = firstString(
    task.athlete_main_id,
    context.resolved.athlete_main_id,
    context.task.athlete_main_id,
  );
  const athleteName = firstString(
    context.contactInfo.studentAthlete.name,
    task.athlete_name,
    context.task.athlete_name,
  );

  if (!athleteId || !athleteMainId) {
    throw new Error('Missing athlete_main_id or athlete_id for sales stage update');
  }

  let meetingSetResult: MeetingSetSubmitResponse | null = null;
  const selectedOpenMeeting = args.meetingSet?.openEventId
    ? (await fetchOpenMeetings(firstString(args.meetingSet.assignedToLegacyUserId))).slots.find(
        (slot) => slot.open_event_id === args.meetingSet?.openEventId,
      ) || null
    : null;
  const selectedScout = args.meetingSet?.assignedToLegacyUserId
    ? HEAD_SCOUT_ORDER.find((scout) => scout.meeting_for === args.meetingSet?.assignedToLegacyUserId) || null
    : null;
  const meetingSetInput = args.meetingSet && classifyMeetingSetStage(stageLabel)
    ? {
        athleteId,
        athleteMainId,
        meetingName: firstString(args.meetingSet.meetingName),
        meetingTimezone: firstString(args.meetingSet.meetingTimezone),
        assignedToLegacyUserId: firstString(args.meetingSet.assignedToLegacyUserId),
        meetingForLegacyUserId: selectedScout?.meeting_for || firstString(args.meetingSet.assignedToLegacyUserId),
        openEventId: firstString(args.meetingSet.openEventId),
        calendarOwnerId: selectedScout?.calendar_owner_id || null,
        bookedMeetingAssignedOwner: selectedOpenMeeting?.assigned_owner || null,
        taskDescription: firstString(args.meetingSet.taskDescription),
        startTime: firstString(args.meetingSet.startTime, selectedOpenMeeting?.start_time),
        startsAt: firstString(args.meetingSet.startsAt, buildMeetingSetStartsAt(selectedOpenMeeting), selectedOpenMeeting?.start_time),
        meetingLength: firstString(args.meetingSet.meetingLength, '01:00'),
        headScout: firstString(context.resolved.head_scout) || null,
      }
    : undefined;

  if (meetingSetInput) {
    if (
      !meetingSetInput.meetingName ||
      !meetingSetInput.meetingTimezone ||
      !meetingSetInput.assignedToLegacyUserId ||
      !meetingSetInput.openEventId ||
      !meetingSetInput.taskDescription ||
      !meetingSetInput.startTime
    ) {
      throw new Error('Meeting update requires meeting name, timezone, scout, open meeting, and details.');
    }
    const initialPlan = buildPostCallActionPlan({
      athleteId,
      athleteMainId,
      athleteName,
      stageLabel,
      tasks: context.tasks,
      selectedTaskId: task.task_id,
      meetingSet: meetingSetInput,
    });
    if (!initialPlan.laravelMeetingSetSubmit) {
      throw new Error('Meeting Set submit plan was not built.');
    }
    meetingSetResult = await submitMeetingSet(initialPlan.laravelMeetingSetSubmit);
  }

  const basePlan = buildPostCallActionPlan({
    athleteId,
    athleteMainId,
    athleteName,
    stageLabel,
    tasks: context.tasks,
    selectedTaskId: task.task_id,
    meetingSet: meetingSetInput,
  });

  const salesStageResult = await updateSalesStage({
    athleteMainId,
    athleteId,
    athleteName,
    stage: basePlan.laravelSalesStageUpdate?.stage || stageLabel,
    appointmentId: args.appointmentId || null,
  });

  const actionPlan = buildPostCallActionPlan({
    athleteId,
    athleteMainId,
    athleteName,
    stageLabel,
    tasks: context.tasks,
    selectedTaskId: task.task_id,
    meetingSet: meetingSetInput,
    meetingSetResult,
    salesStageCreatedTask: salesStageResult.created_task || null,
  });

  if (actionPlan.supabaseLifecycleWrite) {
    try {
      await recordMeetingSet(actionPlan.supabaseLifecycleWrite.args);
    } catch (error) {
      logFailure(
        'SCOUT_PREP_MEETING_SET_SYNC',
        'supabase-write',
        error instanceof Error ? error.message : String(error),
        {
          contactId: athleteId,
          athleteMainId,
          stageLabel,
          materializationStatus: actionPlan.ownerContext.materializationStatus,
        },
      );
    }
  }
  if (meetingSetInput && meetingSetResult) {
    try {
      await syncMeetingSetConfirmationCacheFromScoutPrep({
        athleteId,
        athleteMainId,
        athleteName,
        context,
        meetingSet: {
          openEventId: meetingSetInput.openEventId,
          startsAt: meetingSetInput.startsAt,
          startTime: meetingSetInput.startTime,
          meetingTimezone: meetingSetInput.meetingTimezone,
          meetingLength: meetingSetInput.meetingLength,
          bookedMeetingAssignedOwner: meetingSetInput.bookedMeetingAssignedOwner,
          headScout: meetingSetInput.headScout,
        },
        meetingSetResult,
      });
    } catch (error) {
      logFailure(
        'SCOUT_PREP_SET_MEETING_REMINDER_CACHE_SYNC',
        'supabase-write',
        error instanceof Error ? error.message : String(error),
        {
          contactId: athleteId,
          athleteMainId,
          stageLabel,
          appointmentId: meetingSetInput.openEventId,
        },
      );
    }
  }

  const taskCompletion = actionPlan.laravelTaskCompletion;
  let completedTaskId: string | null = null;
  if (taskCompletion) {
    try {
      const result = await completeScoutPrepTaskAfterVoicemail({
        athleteId: taskCompletion.athleteId,
        athleteMainId: taskCompletion.athleteMainId,
        athleteName,
        contactTask: taskCompletion.contactTask,
        taskId: taskCompletion.taskId,
        crmStage: taskCompletion.crmStage,
        taskTitle: taskCompletion.taskTitle,
        assignedOwner: taskCompletion.assignedOwner,
        description: taskCompletion.description,
      });
      completedTaskId = result.task_id ? String(result.task_id) : null;
    } catch (error) {
      logFailure(
        'SCOUT_PREP_POST_CALL_TASK_COMPLETE',
        'best-effort',
        error instanceof Error ? error.message : String(error),
        {
          contactId: athleteId,
          athleteMainId,
          stageLabel,
          taskId: taskCompletion.taskId,
        },
      );
    }
  }

  return {
    success: true,
    stage: salesStageResult.stage || stageLabel,
    createdTaskId: salesStageResult.created_task?.task_id || null,
    completedTaskId,
    message: completedTaskId ? 'Saved' : meetingSetResult?.email_sent ? 'Email sent' : salesStageResult.stage || stageLabel,
  };
}
