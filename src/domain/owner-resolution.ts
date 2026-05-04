import { sameAthleteIdentity } from './athlete-identity';
import {
  getActiveOperator,
  isActiveOperatorTaskAssignedOwner,
  ownerHasRole,
  resolveOwnerByAnyId,
  resolveOwnerByCalendarOwnerId,
  resolveOwnerByMeetingForId,
  resolveOwnerByName,
  type ActiveOperatorContext,
  type OwnerDirectoryEntry,
  type OwnerRole,
} from './owners';
import { classifyScoutTask, isIncompleteTaskValue } from './scout-task-classifier';

export type OwnerResolutionPurpose = 'call_activity' | 'meeting_set' | 'meeting_outcome';
export type OwnerResolutionStatus = 'resolved' | 'not_tracked' | 'needs_owner_review';
export type MaterializationStatus = 'operator_task' | 'not_operator_task';
export type MaterializationReason =
  | 'task_assigned_owner_matches_active_operator'
  | 'meeting_set_submitted_by_active_operator'
  | 'task_assigned_owner_is_other_owner'
  | 'missing_task_assigned_owner'
  | 'mismatched_athlete_identity';

export type OwnerResolutionInput = {
  purpose: OwnerResolutionPurpose;
  activeOperator?: ActiveOperatorContext | null;
  athleteId?: string | number | null;
  athleteMainId?: string | number | null;
  athleteName?: string | null;
  tasks?: Array<Record<string, unknown>> | null;
  selectedTaskId?: string | number | null;
  currentTaskId?: string | number | null;
  appointmentSetterName?: string | null;
  appointmentSetterId?: string | number | null;
  selectedOpenMeeting?: Record<string, unknown> | null;
  submittedMeetingPayload?: Record<string, unknown> | null;
  bookedMeeting?: Record<string, unknown> | null;
  matchedAppointment?: Record<string, unknown> | null;
  resolvedProfile?: Record<string, unknown> | null;
  pipelineState?: Record<string, unknown> | null;
  appointmentId?: string | number | null;
  liveEventId?: string | number | null;
};

export type OwnerResolutionResult = {
  activeOperator: ActiveOperatorContext;
  taskOwner: OwnerDirectoryEntry | null;
  appointmentSetter: OwnerDirectoryEntry | null;
  headScout: OwnerDirectoryEntry | null;
  calendarOwner: OwnerDirectoryEntry | null;
  trackedDashboardOwner: OwnerDirectoryEntry | null;
  operatorTaskOwner: OwnerDirectoryEntry | null;
  taskAssignedOwner: string | null;
  appointmentSetterName: string | null;
  appointmentSetterLegacyUserId: string | null;
  meetingForLegacyUserId: string | null;
  calendarOwnerId: string | null;
  bookedMeetingAssignedOwner: string | null;
  profileHeadScout: string | null;
  scoutingCoordinator: string | null;
  resolvedOwnerName: string | null;
  resolvedOwnerRole: OwnerRole | null;
  resolvedOwnerLegacyUserId: string | null;
  resolvedFromField: string | null;
  resolvedFromValue: string | null;
  materializationStatus: MaterializationStatus;
  materializationReason: MaterializationReason;
  canMaterializeForActiveOperator: boolean;
  sourceOwner: string | null;
  sourceOwnerRole: OwnerRole | null;
  sourceOwnerId: string | null;
  ownerProof: string | null;
  status: OwnerResolutionStatus;
  reason: string | null;
  isTrackedOwner: boolean;
};

export class OwnerResolutionContractError extends Error {
  readonly context: OwnerResolutionResult & {
    purpose: OwnerResolutionPurpose;
    athleteId?: string | number | null;
    athleteMainId?: string | number | null;
    athleteName?: string | null;
    currentTaskId?: string | number | null;
    appointmentId?: string | number | null;
    liveEventId?: string | number | null;
  };

  constructor(
    message: string,
    context: OwnerResolutionContractError['context'],
  ) {
    super(message);
    this.name = 'OwnerResolutionContractError';
    this.context = context;
  }
}

function asString(value: unknown): string {
  return String(value || '').trim();
}

function ownerFromTask(task?: Record<string, unknown> | null): string | null {
  return asString(task?.assigned_owner || task?.assignedOwner) || null;
}

function taskId(task?: Record<string, unknown> | null): string {
  return asString(task?.task_id || task?.taskId);
}

function isRelevantTask(task: Record<string, unknown>): boolean {
  const classification = classifyScoutTask({
    title: asString(task.title),
    description: asString(task.description),
    rowText: asString(task.row_text),
  });
  return classification.taskStatus !== 'needs_manual_review';
}

function sortNewestTasks(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftId = Number.parseInt(taskId(left) || '0', 10);
  const rightId = Number.parseInt(taskId(right) || '0', 10);
  if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
    return rightId - leftId;
  }
  return taskId(right).localeCompare(taskId(left));
}

function resolveTaskOwner(input: OwnerResolutionInput): {
  owner: OwnerDirectoryEntry | null;
  taskAssignedOwner: string | null;
  taskId: string | null;
  resolvedFromField: string | null;
} {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const exactTaskId = asString(input.selectedTaskId || input.currentTaskId);
  const exactTask = exactTaskId ? tasks.find((task) => taskId(task) === exactTaskId) || null : null;
  const relevantTasks = tasks.filter(isRelevantTask).sort(sortNewestTasks);
  const incompleteRelevantTasks = relevantTasks.filter((task) =>
    isIncompleteTaskValue(asString(task.completion_date || task.completionDate)),
  );
  const candidates = [exactTask, ...incompleteRelevantTasks, ...relevantTasks].filter(Boolean) as Array<
    Record<string, unknown>
  >;
  const taskWithOwner = candidates.find((task) => ownerFromTask(task));
  const taskAssignedOwner = ownerFromTask(taskWithOwner);
  if (!taskAssignedOwner) {
    return { owner: null, taskAssignedOwner: null, taskId: null, resolvedFromField: null };
  }
  return {
    owner: resolveOwnerByName(taskAssignedOwner),
    taskAssignedOwner,
    taskId: taskId(taskWithOwner) || null,
    resolvedFromField: taskId(taskWithOwner) === exactTaskId ? 'task.assigned_owner' : 'relevant_task.assigned_owner',
  };
}

function resolveAppointmentSetter(input: OwnerResolutionInput): {
  owner: OwnerDirectoryEntry | null;
  appointmentSetterName: string | null;
  appointmentSetterLegacyUserId: string | null;
  meetingForLegacyUserId: string | null;
  resolvedFromField: string | null;
  resolvedFromValue: string | null;
} {
  const appointmentSetterName = asString(input.appointmentSetterName) || null;
  const appointmentSetterLegacyUserId = asString(input.appointmentSetterId) || null;
  const submittedAssignedTo = asString(input.submittedMeetingPayload?.assigned_to || input.submittedMeetingPayload?.assignedto) || null;
  const submittedMeetingFor = asString(input.submittedMeetingPayload?.meeting_for || input.submittedMeetingPayload?.meetingfor) || null;
  const selectedMeetingFor = asString(input.selectedOpenMeeting?.meeting_for || input.selectedOpenMeeting?.meetingfor) || null;
  const selectedAssignedOwner = asString(input.selectedOpenMeeting?.assigned_owner || input.selectedOpenMeeting?.assignedOwner) || null;

  const owner =
    resolveOwnerByName(appointmentSetterName) ||
    resolveOwnerByAnyId(appointmentSetterLegacyUserId) ||
    resolveOwnerByAnyId(submittedAssignedTo) ||
    resolveOwnerByMeetingForId(submittedMeetingFor) ||
    resolveOwnerByMeetingForId(selectedMeetingFor) ||
    resolveOwnerByName(selectedAssignedOwner);

  if (!owner) {
    return {
      owner: null,
      appointmentSetterName,
      appointmentSetterLegacyUserId: appointmentSetterLegacyUserId || submittedAssignedTo,
      meetingForLegacyUserId: submittedMeetingFor || selectedMeetingFor,
      resolvedFromField: null,
      resolvedFromValue: null,
    };
  }

  const resolved =
    appointmentSetterName ? ['appointmentSetterName', appointmentSetterName]
      : appointmentSetterLegacyUserId ? ['appointmentSetterId', appointmentSetterLegacyUserId]
        : submittedAssignedTo ? ['submittedMeetingPayload.assigned_to', submittedAssignedTo]
          : submittedMeetingFor ? ['submittedMeetingPayload.meeting_for', submittedMeetingFor]
            : selectedMeetingFor ? ['selectedOpenMeeting.meeting_for', selectedMeetingFor]
              : ['selectedOpenMeeting.assigned_owner', selectedAssignedOwner || owner.personName];

  return {
    owner,
    appointmentSetterName: appointmentSetterName || owner.personName,
    appointmentSetterLegacyUserId: appointmentSetterLegacyUserId || submittedAssignedTo || owner.legacyUserId || null,
    meetingForLegacyUserId: submittedMeetingFor || selectedMeetingFor || owner.meetingForLegacyUserId || null,
    resolvedFromField: resolved[0],
    resolvedFromValue: resolved[1],
  };
}

function submittedMeetingOperator(input: OwnerResolutionInput): {
  owner: OwnerDirectoryEntry | null;
  ownerName: string | null;
  resolvedFromField: string | null;
  resolvedFromValue: string | null;
} {
  const payload = input.submittedMeetingPayload || {};
  const operatorName =
    asString(payload.operator_owner) ||
    asString(payload.operatorOwner) ||
    asString(payload.operator_name) ||
    asString(payload.operatorName) ||
    asString(payload.raycast_operator_name) ||
    asString(payload.raycastOperatorName) ||
    null;
  const operatorKey =
    asString(payload.operator_owner_key) ||
    asString(payload.operatorOwnerKey) ||
    asString(payload.raycast_operator_key) ||
    asString(payload.raycastOperatorKey) ||
    null;
  const operatorLegacyId =
    asString(payload.operator_legacy_user_id) ||
    asString(payload.operatorLegacyUserId) ||
    asString(payload.raycast_operator_legacy_user_id) ||
    asString(payload.raycastOperatorLegacyUserId) ||
    null;
  const owner =
    resolveOwnerByName(operatorName) ||
    resolveOwnerByAnyId(operatorLegacyId) ||
    null;

  if (!owner) {
    return { owner: null, ownerName: operatorName, resolvedFromField: null, resolvedFromValue: null };
  }

  if (operatorName) {
    return {
      owner,
      ownerName: operatorName,
      resolvedFromField: 'submittedMeetingPayload.operator_owner',
      resolvedFromValue: operatorName,
    };
  }
  if (operatorLegacyId) {
    return {
      owner,
      ownerName: owner.personName,
      resolvedFromField: 'submittedMeetingPayload.operator_legacy_user_id',
      resolvedFromValue: operatorLegacyId,
    };
  }
  if (operatorKey) {
    return {
      owner,
      ownerName: owner.personName,
      resolvedFromField: 'submittedMeetingPayload.operator_owner_key',
      resolvedFromValue: operatorKey,
    };
  }
  return { owner, ownerName: owner.personName, resolvedFromField: null, resolvedFromValue: null };
}

function resolveBookedOwner(input: OwnerResolutionInput): {
  owner: OwnerDirectoryEntry | null;
  bookedMeetingAssignedOwner: string | null;
  eventId: string | null;
  resolvedFromField: string | null;
  identityMatches: boolean;
  identityMismatch: boolean;
} {
  const bookedMeeting = input.bookedMeeting || input.matchedAppointment || null;
  const bookedOwner = asString(bookedMeeting?.assigned_owner || bookedMeeting?.assignedOwner);
  const bookedAthleteId = bookedMeeting?.athlete_id || bookedMeeting?.athleteId;
  const bookedAthleteMainId = bookedMeeting?.athlete_main_id || bookedMeeting?.athleteMainId;
  const identityMatches = sameAthleteIdentity({
      athleteId: input.athleteId,
      athleteMainId: input.athleteMainId,
      candidateAthleteId: bookedAthleteId as string | undefined,
      candidateAthleteMainId: bookedAthleteMainId as string | undefined,
    });
  if (bookedOwner && identityMatches) {
    return {
      owner: resolveOwnerByName(bookedOwner),
      bookedMeetingAssignedOwner: bookedOwner,
      eventId: asString(bookedMeeting?.event_id || bookedMeeting?.eventId) || null,
      resolvedFromField: 'bookedMeeting.assigned_owner',
      identityMatches,
      identityMismatch: false,
    };
  }
  return {
    owner: null,
    bookedMeetingAssignedOwner: bookedOwner || null,
    eventId: null,
    resolvedFromField: null,
    identityMatches,
    identityMismatch: Boolean(bookedOwner && !identityMatches),
  };
}

function resolveProfileHeadScout(input: OwnerResolutionInput): OwnerDirectoryEntry | null {
  return (
    resolveOwnerByName(input.resolvedProfile?.head_scout as string | undefined) ||
    resolveOwnerByName(input.resolvedProfile?.scouting_coordinator as string | undefined) ||
    resolveOwnerByName(input.pipelineState?.head_scout as string | undefined)
  );
}

function profileHeadScout(input: OwnerResolutionInput): string | null {
  return (
    asString(input.resolvedProfile?.head_scout) ||
    asString(input.pipelineState?.head_scout) ||
    null
  );
}

function profileScoutingCoordinator(input: OwnerResolutionInput): string | null {
  return asString(input.resolvedProfile?.scouting_coordinator) || null;
}

function materializationDecision(args: {
  taskAssignedOwner: string | null;
  bookedMeetingIdentityMismatch?: boolean;
}): {
  status: MaterializationStatus;
  reason: MaterializationReason;
} {
  if (args.bookedMeetingIdentityMismatch) {
    return { status: 'not_operator_task', reason: 'mismatched_athlete_identity' };
  }
  if (!args.taskAssignedOwner) {
    return { status: 'not_operator_task', reason: 'missing_task_assigned_owner' };
  }
  if (isActiveOperatorTaskAssignedOwner(args.taskAssignedOwner)) {
    return { status: 'operator_task', reason: 'task_assigned_owner_matches_active_operator' };
  }
  return { status: 'not_operator_task', reason: 'task_assigned_owner_is_other_owner' };
}

function resultFromSource(args: {
  input: OwnerResolutionInput;
  activeOperator: ActiveOperatorContext;
  materializationStatus: MaterializationStatus;
  materializationReason: MaterializationReason;
  taskAssignedOwner?: string | null;
  taskOwner?: OwnerDirectoryEntry | null;
  appointmentSetter?: OwnerDirectoryEntry | null;
  headScout?: OwnerDirectoryEntry | null;
  calendarOwner?: OwnerDirectoryEntry | null;
  appointmentSetterName?: string | null;
  appointmentSetterLegacyUserId?: string | null;
  meetingForLegacyUserId?: string | null;
  bookedMeetingAssignedOwner?: string | null;
  resolvedOwnerName?: string | null;
  resolvedOwnerRole?: OwnerRole | null;
  resolvedOwnerLegacyUserId?: string | null;
  resolvedFromField?: string | null;
  resolvedFromValue?: string | null;
  ownerProof?: string | null;
  reason?: string | null;
}): OwnerResolutionResult {
  const trackedDashboardOwner = args.materializationStatus === 'operator_task'
    ? resolveOwnerByName(args.activeOperator.personName)
    : null;
  const sourceOwnerKnown = args.resolvedOwnerName ? resolveOwnerByName(args.resolvedOwnerName) : null;
  const status: OwnerResolutionStatus = args.materializationStatus === 'operator_task' && args.resolvedOwnerName
    ? 'resolved'
    : args.resolvedOwnerName || sourceOwnerKnown
      ? 'not_tracked'
      : 'needs_owner_review';
  const resolvedFromField = args.resolvedFromField || null;
  const ownerProof = args.ownerProof || resolvedFromField;
  const resolvedFromValue = args.resolvedFromValue || args.resolvedOwnerName || null;

  return {
    activeOperator: args.activeOperator,
    taskOwner: args.taskOwner || null,
    appointmentSetter: args.appointmentSetter || null,
    headScout: args.headScout || null,
    calendarOwner: args.calendarOwner || null,
    trackedDashboardOwner,
    operatorTaskOwner: args.materializationStatus === 'operator_task' ? args.taskOwner || trackedDashboardOwner : null,
    taskAssignedOwner: args.taskAssignedOwner || null,
    appointmentSetterName: args.appointmentSetterName || null,
    appointmentSetterLegacyUserId: args.appointmentSetterLegacyUserId || null,
    meetingForLegacyUserId: args.meetingForLegacyUserId || null,
    calendarOwnerId: args.calendarOwner?.calendarOwnerId || null,
    bookedMeetingAssignedOwner: args.bookedMeetingAssignedOwner || null,
    profileHeadScout: profileHeadScout(args.input),
    scoutingCoordinator: profileScoutingCoordinator(args.input),
    resolvedOwnerName: args.resolvedOwnerName || null,
    resolvedOwnerRole: args.resolvedOwnerRole || null,
    resolvedOwnerLegacyUserId: args.resolvedOwnerLegacyUserId || null,
    resolvedFromField,
    resolvedFromValue,
    materializationStatus: args.materializationStatus,
    materializationReason: args.materializationReason,
    canMaterializeForActiveOperator: args.materializationStatus === 'operator_task',
    sourceOwner: args.resolvedOwnerName || null,
    sourceOwnerRole: args.resolvedOwnerRole || null,
    sourceOwnerId: args.resolvedOwnerLegacyUserId || null,
    ownerProof,
    status,
    reason:
      args.reason ||
      (args.materializationStatus === 'not_operator_task'
        ? args.materializationReason === 'missing_task_assigned_owner'
          ? 'Task assigned owner is missing.'
          : args.materializationReason === 'mismatched_athlete_identity'
            ? 'Booked meeting identity does not match the active athlete.'
            : `Task assigned owner "${args.taskAssignedOwner}" is not active operator "${args.activeOperator.personName}".`
        : status === 'needs_owner_review'
          ? 'No owner source field resolved from source data.'
          : null),
    isTrackedOwner: args.materializationStatus === 'operator_task',
  };
}

export function resolveOwnerContext(input: OwnerResolutionInput): OwnerResolutionResult {
  const activeOperator = input.activeOperator || getActiveOperator();
  const task = resolveTaskOwner(input);
  const appointmentSetter = resolveAppointmentSetter(input);
  const meetingOperator = submittedMeetingOperator(input);
  const booked = resolveBookedOwner(input);
  const headScout = resolveProfileHeadScout(input);
  const calendarOwner =
    resolveOwnerByCalendarOwnerId(input.bookedMeeting?.calendar_owner_id as string | undefined) ||
    resolveOwnerByCalendarOwnerId(input.selectedOpenMeeting?.calendar_owner_id as string | undefined) ||
    null;
  const materialization = materializationDecision({
    taskAssignedOwner: task.taskAssignedOwner,
    bookedMeetingIdentityMismatch: booked.identityMismatch,
  });
  const meetingSetOperatorFallback =
    input.purpose === 'meeting_set' &&
    materialization.reason === 'missing_task_assigned_owner' &&
    meetingOperator.owner?.ownerKey === activeOperator.operatorKey &&
    appointmentSetter.owner
      ? {
          status: 'operator_task' as const,
          reason: 'meeting_set_submitted_by_active_operator' as const,
          taskAssignedOwner: meetingOperator.owner.personName,
          taskOwner: meetingOperator.owner,
          ownerProof: meetingOperator.resolvedFromField || 'submittedMeetingPayload.operator_owner',
        }
      : null;

  if (input.purpose === 'call_activity' && task.taskAssignedOwner) {
    return resultFromSource({
      input,
      activeOperator,
      materializationStatus: materialization.status,
      materializationReason: materialization.reason,
      taskAssignedOwner: task.taskAssignedOwner,
      taskOwner: task.owner,
      appointmentSetter: appointmentSetter.owner,
      headScout,
      calendarOwner,
      appointmentSetterName: appointmentSetter.appointmentSetterName,
      appointmentSetterLegacyUserId: appointmentSetter.appointmentSetterLegacyUserId,
      meetingForLegacyUserId: appointmentSetter.meetingForLegacyUserId,
      bookedMeetingAssignedOwner: booked.bookedMeetingAssignedOwner,
      resolvedOwnerName: task.taskAssignedOwner,
      resolvedOwnerRole: 'task_owner',
      resolvedOwnerLegacyUserId: task.owner?.legacyUserId || null,
      resolvedFromField: task.resolvedFromField,
      resolvedFromValue: task.taskAssignedOwner,
    });
  }

  if (input.purpose === 'meeting_set' && appointmentSetter.owner) {
    return resultFromSource({
      input,
      activeOperator,
      materializationStatus: meetingSetOperatorFallback?.status || materialization.status,
      materializationReason: meetingSetOperatorFallback?.reason || materialization.reason,
      taskAssignedOwner: meetingSetOperatorFallback?.taskAssignedOwner || task.taskAssignedOwner,
      taskOwner: meetingSetOperatorFallback?.taskOwner || task.owner,
      appointmentSetter: appointmentSetter.owner,
      headScout,
      calendarOwner,
      appointmentSetterName: appointmentSetter.appointmentSetterName,
      appointmentSetterLegacyUserId: appointmentSetter.appointmentSetterLegacyUserId,
      meetingForLegacyUserId: appointmentSetter.meetingForLegacyUserId,
      bookedMeetingAssignedOwner: booked.bookedMeetingAssignedOwner,
      resolvedOwnerName: appointmentSetter.owner.personName,
      resolvedOwnerRole: 'appointment_setter',
      resolvedOwnerLegacyUserId: appointmentSetter.owner.legacyUserId || null,
      resolvedFromField: appointmentSetter.resolvedFromField,
      resolvedFromValue: appointmentSetter.resolvedFromValue,
      ownerProof: meetingSetOperatorFallback?.ownerProof || appointmentSetter.resolvedFromField,
    });
  }

  if (input.purpose === 'meeting_outcome' && booked.bookedMeetingAssignedOwner && booked.resolvedFromField) {
    return resultFromSource({
      input,
      activeOperator,
      materializationStatus: materialization.status,
      materializationReason: materialization.reason,
      taskAssignedOwner: task.taskAssignedOwner,
      taskOwner: task.owner,
      appointmentSetter: appointmentSetter.owner,
      headScout,
      calendarOwner,
      appointmentSetterName: appointmentSetter.appointmentSetterName,
      appointmentSetterLegacyUserId: appointmentSetter.appointmentSetterLegacyUserId,
      meetingForLegacyUserId: appointmentSetter.meetingForLegacyUserId,
      bookedMeetingAssignedOwner: booked.bookedMeetingAssignedOwner,
      resolvedOwnerName: booked.bookedMeetingAssignedOwner,
      resolvedOwnerRole: 'appointment_setter',
      resolvedOwnerLegacyUserId: booked.owner?.legacyUserId || null,
      resolvedFromField: booked.resolvedFromField,
      resolvedFromValue: booked.bookedMeetingAssignedOwner,
    });
  }

  if (headScout && ownerHasRole(headScout, 'head_scout')) {
    return resultFromSource({
      input,
      activeOperator,
      materializationStatus: materialization.status,
      materializationReason: materialization.reason,
      taskAssignedOwner: task.taskAssignedOwner,
      taskOwner: task.owner,
      appointmentSetter: appointmentSetter.owner,
      headScout,
      calendarOwner,
      appointmentSetterName: appointmentSetter.appointmentSetterName,
      appointmentSetterLegacyUserId: appointmentSetter.appointmentSetterLegacyUserId,
      meetingForLegacyUserId: appointmentSetter.meetingForLegacyUserId,
      bookedMeetingAssignedOwner: booked.bookedMeetingAssignedOwner,
      resolvedOwnerName: headScout.personName,
      resolvedOwnerRole: 'head_scout',
      resolvedOwnerLegacyUserId: headScout.meetingForLegacyUserId || headScout.calendarOwnerId || null,
      resolvedFromField: 'profile.head_scout',
      resolvedFromValue: headScout.personName,
      reason: 'Primary owner source was unavailable; profile head_scout used as fallback.',
    });
  }

  return {
    activeOperator,
    taskOwner: task.owner,
    appointmentSetter: appointmentSetter.owner,
    headScout,
    calendarOwner,
    trackedDashboardOwner: null,
    operatorTaskOwner: null,
    taskAssignedOwner: task.taskAssignedOwner,
    appointmentSetterName: appointmentSetter.appointmentSetterName,
    appointmentSetterLegacyUserId: appointmentSetter.appointmentSetterLegacyUserId,
    meetingForLegacyUserId: appointmentSetter.meetingForLegacyUserId,
    calendarOwnerId: calendarOwner?.calendarOwnerId || null,
    bookedMeetingAssignedOwner: booked.bookedMeetingAssignedOwner,
    profileHeadScout: profileHeadScout(input),
    scoutingCoordinator: profileScoutingCoordinator(input),
    resolvedOwnerName: null,
    resolvedOwnerRole: null,
    resolvedOwnerLegacyUserId: null,
    resolvedFromField: null,
    resolvedFromValue: null,
    materializationStatus: materialization.status,
    materializationReason: materialization.reason,
    canMaterializeForActiveOperator: false,
    sourceOwner: null,
    sourceOwnerRole: null,
    sourceOwnerId: null,
    ownerProof: null,
    status: 'needs_owner_review',
    reason: `Owner review required for ${input.purpose}; no canonical owner could be resolved from the provided source data.`,
    isTrackedOwner: false,
  };
}

export function assertOwnerResolved(
  input: OwnerResolutionInput,
  context = resolveOwnerContext(input),
): OwnerResolutionResult {
  return context;
}
