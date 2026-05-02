import type { MeetingSetSubmitResponse, ScoutAthleteTask } from '../features/scout-prep/types';
import type { MeetingSetWriteArgs } from '../lib/supabase-lifecycle';
import { buildMeetingSetFact, type MeetingSetFactRow } from './call-tracker-facts';
import {
  buildMeetingSetLaravelPayload,
  type MeetingSetLaravelPayload,
  type MeetingSetLaravelPayloadInput,
} from './meeting-set-contract';
import { resolveOwnerContext, type MaterializationStatus, type OwnerResolutionResult } from './owner-resolution';
import {
  classifyMeetingSetStage,
  classifyPostCallActivityStage,
  normalizeSalesStageLabelForLaravel,
} from './sales-stage-contract';
import {
  resolvePostCallTaskToComplete,
  stripMoveThisTaskPrefix,
} from './scout-task-selection';

type TaskInput = Partial<ScoutAthleteTask> & Record<string, unknown>;

export type PostCallActionPlanInput = {
  athleteId: string;
  athleteMainId: string;
  athleteName?: string | null;
  stageLabel: string;
  tasks?: TaskInput[] | null;
  selectedTaskId?: string | number | null;
  meetingSet?: MeetingSetLaravelPayloadInput & {
    startsAt?: string | null;
    headScout?: string | null;
    taskDueDate?: string | null;
  };
  meetingSetResult?: Partial<MeetingSetSubmitResponse> | null;
  salesStageCreatedTask?: Partial<ScoutAthleteTask> | null;
};

export type LaravelSalesStageUpdatePlan = {
  athleteId: string;
  athleteMainId: string;
  stage: string;
};

export type LaravelTaskCompletionPlan = {
  athleteId: string;
  athleteMainId: string;
  contactTask: string;
  taskId: string;
  taskTitle: string;
  assignedOwner: string | null;
  description: string;
};

export type SupabaseLifecycleWritePlan = {
  eventType: 'meeting_set';
  args: MeetingSetWriteArgs;
};

export type SupabaseFactWritePlan = {
  eventType: 'meeting_set';
  row: MeetingSetFactRow;
};

export type PostCallActionPlan = {
  laravelSalesStageUpdate: LaravelSalesStageUpdatePlan | null;
  laravelTaskCompletion: LaravelTaskCompletionPlan | null;
  laravelMeetingSetSubmit: MeetingSetLaravelPayload | null;
  supabaseLifecycleWrite: SupabaseLifecycleWritePlan | null;
  supabaseFactWrite: SupabaseFactWritePlan | null;
  ownerContext: OwnerResolutionResult;
  materializationStatus: MaterializationStatus;
};

function asString(value?: string | number | null): string {
  return String(value || '').trim();
}

function taskId(task?: TaskInput | null): string {
  return asString(task?.task_id as string | undefined);
}

function getTaskDisplayTitle(task?: TaskInput | null): string {
  return (
    stripMoveThisTaskPrefix(task?.title as string | undefined) ||
    asString(task?.description as string | undefined) ||
    'Untitled Task'
  );
}

function buildTaskCompletionPlan(input: PostCallActionPlanInput, normalizedStage: string): LaravelTaskCompletionPlan | null {
  const task = resolvePostCallTaskToComplete(input.tasks || [], normalizedStage);
  if (!task?.task_id) return null;
  const taskTitle = getTaskDisplayTitle(task);
  return {
    athleteId: asString(input.athleteId),
    athleteMainId: asString(input.athleteMainId),
    contactTask: asString(input.athleteId),
    taskId: taskId(task),
    taskTitle,
    assignedOwner: asString(task.assigned_owner as string | undefined) || null,
    description: asString(task.description as string | undefined) || taskTitle,
  };
}

function buildMeetingSetWrites(args: {
  input: PostCallActionPlanInput;
  normalizedStage: string;
  ownerContext: OwnerResolutionResult;
  meetingPayload: MeetingSetLaravelPayload;
}): {
  lifecycle: SupabaseLifecycleWritePlan | null;
  fact: SupabaseFactWritePlan | null;
} {
  if (args.ownerContext.materializationStatus !== 'operator_task') {
    return { lifecycle: null, fact: null };
  }

  const createdTask = args.input.meetingSetResult?.created_task || args.input.salesStageCreatedTask || null;
  const currentTaskTitle = stripMoveThisTaskPrefix(createdTask?.title) || 'Confirmation Call';
  const appointmentId = asString(args.input.meetingSetResult?.open_event_id) || args.meetingPayload.open_event_id;
  const startsAt = args.input.meetingSet?.startsAt || args.meetingPayload.start_time || null;
  const meetingName = asString(args.input.meetingSetResult?.meeting_name) || args.meetingPayload.meeting_name;
  const taskDueDate = asString(createdTask?.due_date) || args.input.meetingSet?.taskDueDate || null;
  const headScout =
    asString(args.input.meetingSet?.headScout) ||
    args.ownerContext.profileHeadScout ||
    args.ownerContext.bookedMeetingAssignedOwner ||
    args.ownerContext.appointmentSetterName ||
    null;

  const lifecycleArgs: MeetingSetWriteArgs = {
    athleteId: args.input.athleteId,
    athleteMainId: args.input.athleteMainId,
    athleteName: args.input.athleteName || '',
    crmStage: args.normalizedStage,
    taskStatus: currentTaskTitle,
    headScout,
    currentTaskId: asString(createdTask?.task_id) || null,
    currentTaskTitle,
    appointmentId,
    sourceEventId: appointmentId,
    startsAt,
    meetingTimezone: args.meetingPayload.meeting_timezone,
    legacyAssignedTo: args.meetingPayload.assigned_to,
    meetingName,
    taskDueDate,
    payload: {
      owner_context: {
        active_operator_key: args.ownerContext.activeOperator.operatorKey,
        active_operator_name: args.ownerContext.activeOperator.personName,
        task_assigned_owner: args.ownerContext.taskAssignedOwner,
        appointment_setter_name: args.ownerContext.appointmentSetterName,
        appointment_setter_legacy_user_id: args.ownerContext.appointmentSetterLegacyUserId,
        meeting_for_legacy_user_id: args.ownerContext.meetingForLegacyUserId,
        calendar_owner_id: args.ownerContext.calendarOwnerId,
        booked_meeting_assigned_owner: args.ownerContext.bookedMeetingAssignedOwner,
        resolved_owner_name: args.ownerContext.resolvedOwnerName,
        resolved_owner_role: args.ownerContext.resolvedOwnerRole,
        resolved_owner_legacy_user_id: args.ownerContext.resolvedOwnerLegacyUserId,
        resolved_from_field: args.ownerContext.resolvedFromField,
        resolved_from_value: args.ownerContext.resolvedFromValue,
        owner_proof: args.ownerContext.ownerProof,
        materialization_status: args.ownerContext.materializationStatus,
        materialization_reason: args.ownerContext.materializationReason,
        can_materialize_for_active_operator: args.ownerContext.canMaterializeForActiveOperator,
        owner_status: args.ownerContext.status,
      },
      materialization_status: args.ownerContext.materializationStatus,
      materialization_reason: args.ownerContext.materializationReason,
      owner_proof: args.ownerContext.ownerProof,
      task_assigned_owner: args.ownerContext.taskAssignedOwner,
      materialization_proof: {
        task_assigned_owner: args.ownerContext.taskAssignedOwner,
        materialization_status: args.ownerContext.materializationStatus,
        status: args.ownerContext.materializationStatus,
        reason: args.ownerContext.materializationReason,
      },
    },
  };

  const factRow = buildMeetingSetFact({
    athleteId: args.input.athleteId,
    athleteMainId: args.input.athleteMainId,
    crmStage: args.normalizedStage,
    taskStatus: currentTaskTitle,
    payload: {
      source: 'scout_prep_post_call_action_plan',
      appointment_id: appointmentId,
      meeting_name: meetingName,
      starts_at: startsAt,
      task_assigned_owner: args.ownerContext.taskAssignedOwner,
      booked_meeting_assigned_owner: args.ownerContext.bookedMeetingAssignedOwner,
      materialization_status: args.ownerContext.materializationStatus,
      materialization_reason: args.ownerContext.materializationReason,
    },
  });

  return {
    lifecycle: { eventType: 'meeting_set', args: lifecycleArgs },
    fact: { eventType: 'meeting_set', row: factRow },
  };
}

export function buildPostCallActionPlan(input: PostCallActionPlanInput): PostCallActionPlan {
  const normalizedStage = normalizeSalesStageLabelForLaravel(input.stageLabel);
  const meetingSetClassification = classifyMeetingSetStage(normalizedStage);
  const laravelMeetingSetSubmit = meetingSetClassification && input.meetingSet
    ? buildMeetingSetLaravelPayload(input.meetingSet)
    : null;
  const selectedTask = resolvePostCallTaskToComplete(input.tasks || [], normalizedStage);
  const ownerContext = resolveOwnerContext({
    purpose: meetingSetClassification ? 'meeting_set' : 'call_activity',
    athleteId: input.athleteId,
    athleteMainId: input.athleteMainId,
    tasks: input.tasks as Array<Record<string, unknown>>,
    selectedTaskId: input.selectedTaskId || selectedTask?.task_id || undefined,
    submittedMeetingPayload: laravelMeetingSetSubmit,
    selectedOpenMeeting: input.meetingSet
      ? {
          meeting_for: input.meetingSet.meetingForLegacyUserId,
          calendar_owner_id: input.meetingSet.calendarOwnerId,
          assigned_owner: input.meetingSet.bookedMeetingAssignedOwner,
        }
      : null,
  });
  const writes = laravelMeetingSetSubmit
    ? buildMeetingSetWrites({
        input,
        normalizedStage,
        ownerContext,
        meetingPayload: laravelMeetingSetSubmit,
      })
    : { lifecycle: null, fact: null };

  return {
    laravelSalesStageUpdate: {
      athleteId: asString(input.athleteId),
      athleteMainId: asString(input.athleteMainId),
      stage: normalizedStage,
    },
    laravelTaskCompletion: buildTaskCompletionPlan(input, normalizedStage),
    laravelMeetingSetSubmit,
    supabaseLifecycleWrite: writes.lifecycle,
    supabaseFactWrite: writes.fact,
    ownerContext,
    materializationStatus: ownerContext.materializationStatus,
  };
}
