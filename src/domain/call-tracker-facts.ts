import { randomUUID } from 'crypto';
import { buildAthleteKey, validateAthleteIdentity } from './athlete-identity';
import {
  assertOwnerResolved,
  type OwnerResolutionInput,
  type OwnerResolutionResult,
} from './owner-resolution';
import {
  activityKindForTaskStatus,
  classifyCallTrackerReporting,
  type ActivityKind,
} from './scout-task-classifier';
import { classifyMeetingSetStage } from './sales-stage-contract';
import { resolveOwnerByName } from './owners';

function normalizeValue(value?: string | number | null): string | null {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function normalizeIsoValue(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
}

export type CallTrackerEventEnvelope = {
  raw_crm_stage: string | null;
  raw_task_status: string | null;
  raw_event_type: string;
  tracker_outcome: string | null;
  occurred_at: string | null;
  source: string;
  appointment_id: string | null;
  live_event_id: string | null;
  booked_event_title: string | null;
  revenue_cents: number | null;
};

export function buildCallTrackerEventEnvelope(args: {
  rawCrmStage: string | null;
  rawTaskStatus: string | null;
  rawEventType: string;
  trackerOutcome?: string | null;
  occurredAt?: string | null;
  source: string;
  appointmentId?: string | null;
  liveEventId?: string | null;
  bookedEventTitle?: string | null;
  revenueCents?: number | null;
}): CallTrackerEventEnvelope {
  return {
    raw_crm_stage: normalizeValue(args.rawCrmStage),
    raw_task_status: normalizeValue(args.rawTaskStatus),
    raw_event_type: normalizeValue(args.rawEventType) || 'unknown',
    tracker_outcome: normalizeValue(args.trackerOutcome),
    occurred_at: normalizeIsoValue(args.occurredAt),
    source: normalizeValue(args.source) || 'unknown',
    appointment_id: normalizeValue(args.appointmentId),
    live_event_id: normalizeValue(args.liveEventId),
    booked_event_title: normalizeValue(args.bookedEventTitle),
    revenue_cents: args.revenueCents ?? null,
  };
}

export type AthleteSnapshotRow = {
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  athlete_name: string;
  updated_at: string;
};

export type AppointmentSnapshotRow = {
  id: string;
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  head_scout: string | null;
  starts_at: string | null;
  status: string | null;
  source_event_id: string | null;
  meeting_timezone?: string | null;
  meeting_timezone_label?: string | null;
  calendar_timezone?: string | null;
  previous_appointment_id?: string | null;
  original_appointment_id?: string | null;
  reschedule_sequence?: number;
  operator_owner?: string | null;
  operator_owner_key?: string | null;
  head_scout_key?: string | null;
  appointment_role?: string | null;
  status_reason?: string | null;
  source_system?: string | null;
  source_payload?: Record<string, unknown>;
  updated_at: string;
};

export type PipelineStateSnapshotRow = {
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  crm_stage: string | null;
  task_status: string | null;
  head_scout: string | null;
  current_task_id: string | null;
  current_task_title: string | null;
  current_appointment_id: string | null;
  updated_at: string;
};

export type LifecycleAuditEventRow = {
  id: string;
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  event_type: string;
  dedupe_key?: string | null;
  previous_crm_stage?: string | null;
  previous_task_status?: string | null;
  crm_stage: string | null;
  task_status: string | null;
  payload_json: Record<string, unknown>;
  created_at: string;
};

export type CallActivityFactRow = {
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  athlete_name: string | null;
  task_id: string;
  task_title: string | null;
  task_description: string | null;
  raw_crm_stage: string | null;
  raw_task_status: string | null;
  activity_type: string;
  activity_kind: ActivityKind;
  activity_subtype: string;
  occurred_at: string;
  source_owner: string;
  owner_proof: string;
  payload_json: Record<string, unknown>;
  updated_at: string;
};

export type MeetingOutcomeFactRow = {
  id: string;
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  athlete_name: string | null;
  occurred_at: string;
  source: string;
  raw_crm_stage: string | null;
  raw_task_status: string | null;
  raw_event_type: string;
  appointment_id: string | null;
  live_event_id?: string | null;
  booked_event_title: string | null;
  revenue_cents: number | null;
  source_owner: string;
  is_tracked_owner: boolean;
  owner_proof: string;
  dedupe_key: string;
  payload_json: Record<string, unknown>;
};

export type MeetingSetFactRow = LifecycleAuditEventRow;

export type MeetingSetFactInput = Omit<
  Parameters<typeof buildLifecycleAuditEvent>[0],
  'eventType' | 'dedupeKey'
>;

export function buildAppointmentId(args: {
  athleteId: string | number;
  athleteMainId: string | number;
  appointmentId?: string | null;
  sourceEventId?: string | null;
  startsAt?: string | null;
}): string {
  const explicit = normalizeValue(args.appointmentId) || normalizeValue(args.sourceEventId);
  if (explicit) return explicit;
  const startsAt = normalizeIsoValue(args.startsAt);
  if (startsAt) return `appointment:${buildAthleteKey(args.athleteId, args.athleteMainId)}:${startsAt}`;
  return `appointment:${buildAthleteKey(args.athleteId, args.athleteMainId)}`;
}

export function buildReminderDedupeKey(args: {
  appointmentId: string;
  kind: string;
  suffix: string;
  sendAt?: string | null;
}): string {
  return [
    args.appointmentId.trim(),
    args.kind.trim(),
    args.suffix.trim(),
    normalizeIsoValue(args.sendAt) || 'none',
  ].join(':');
}

export function buildAthleteSnapshot(args: {
  athleteId: string | number;
  athleteMainId: string | number;
  athleteName: string;
  updatedAt?: string;
}): AthleteSnapshotRow {
  const identity = validateAthleteIdentity(args);
  return {
    athlete_key: identity.athleteKey,
    athlete_id: identity.athleteId,
    athlete_main_id: identity.athleteMainId,
    athlete_name: args.athleteName.trim(),
    updated_at: args.updatedAt || new Date().toISOString(),
  };
}

export function buildAppointmentSnapshot(args: {
  athleteId: string | number;
  athleteMainId: string | number;
  appointmentId?: string | null;
  sourceEventId?: string | null;
  headScout?: string | null;
  startsAt?: string | null;
  status?: string | null;
  meetingTimezone?: string | null;
  meetingTimezoneLabel?: string | null;
  calendarTimezone?: string | null;
  previousAppointmentId?: string | null;
  originalAppointmentId?: string | null;
  rescheduleSequence?: number | null;
  operatorOwner?: string | null;
  operatorOwnerKey?: string | null;
  appointmentRole?: string | null;
  statusReason?: string | null;
  sourceSystem?: string | null;
  sourcePayload?: Record<string, unknown> | null;
  updatedAt?: string;
}): AppointmentSnapshotRow {
  const identity = validateAthleteIdentity(args);
  const headScout = normalizeValue(args.headScout);
  const headScoutOwner = resolveOwnerByName(headScout);
  return {
    id: buildAppointmentId(args),
    athlete_key: identity.athleteKey,
    athlete_id: identity.athleteId,
    athlete_main_id: identity.athleteMainId,
    head_scout: headScout,
    starts_at: normalizeIsoValue(args.startsAt),
    status: normalizeValue(args.status),
    source_event_id: normalizeValue(args.sourceEventId),
    meeting_timezone: normalizeValue(args.meetingTimezone),
    meeting_timezone_label: normalizeValue(args.meetingTimezoneLabel),
    calendar_timezone: normalizeValue(args.calendarTimezone),
    previous_appointment_id: normalizeValue(args.previousAppointmentId),
    original_appointment_id: normalizeValue(args.originalAppointmentId),
    reschedule_sequence: Math.max(0, Math.trunc(Number(args.rescheduleSequence || 0))),
    operator_owner: normalizeValue(args.operatorOwner),
    operator_owner_key: normalizeValue(args.operatorOwnerKey),
    head_scout_key: headScoutOwner?.ownerKey || null,
    appointment_role: normalizeValue(args.appointmentRole),
    status_reason: normalizeValue(args.statusReason),
    source_system: normalizeValue(args.sourceSystem),
    source_payload: args.sourcePayload || {},
    updated_at: args.updatedAt || new Date().toISOString(),
  };
}

export function buildPipelineStateSnapshot(args: {
  athleteId: string | number;
  athleteMainId: string | number;
  crmStage?: string | null;
  taskStatus?: string | null;
  headScout?: string | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  currentAppointmentId?: string | null;
  updatedAt?: string;
}): PipelineStateSnapshotRow {
  const identity = validateAthleteIdentity(args);
  return {
    athlete_key: identity.athleteKey,
    athlete_id: identity.athleteId,
    athlete_main_id: identity.athleteMainId,
    crm_stage: normalizeValue(args.crmStage),
    task_status: normalizeValue(args.taskStatus),
    head_scout: normalizeValue(args.headScout),
    current_task_id: normalizeValue(args.currentTaskId),
    current_task_title: normalizeValue(args.currentTaskTitle),
    current_appointment_id: normalizeValue(args.currentAppointmentId),
    updated_at: args.updatedAt || new Date().toISOString(),
  };
}

export function buildLifecycleAuditEvent(args: {
  athleteId: string | number;
  athleteMainId: string | number;
  eventType: string;
  dedupeKey?: string | null;
  crmStage?: string | null;
  taskStatus?: string | null;
  previousCrmStage?: string | null;
  previousTaskStatus?: string | null;
  payload?: Record<string, unknown>;
  createdAt?: string;
}): LifecycleAuditEventRow {
  const identity = validateAthleteIdentity(args);
  const row: LifecycleAuditEventRow = {
    id: randomUUID(),
    athlete_key: identity.athleteKey,
    athlete_id: identity.athleteId,
    athlete_main_id: identity.athleteMainId,
    event_type: args.eventType.trim(),
    dedupe_key: normalizeValue(args.dedupeKey),
    crm_stage: normalizeValue(args.crmStage),
    task_status: normalizeValue(args.taskStatus),
    payload_json: args.payload || {},
    created_at: args.createdAt || new Date().toISOString(),
  };

  if (args.previousCrmStage !== undefined) row.previous_crm_stage = normalizeValue(args.previousCrmStage);
  if (args.previousTaskStatus !== undefined) row.previous_task_status = normalizeValue(args.previousTaskStatus);
  return row;
}

function requireResolvedOwner(input: OwnerResolutionInput, context?: OwnerResolutionResult): OwnerResolutionResult {
  return assertOwnerResolved(input, context);
}

function requireFactOccurredAt(factType: string, value?: string | null): string {
  const occurredAt = normalizeIsoValue(value);
  if (!occurredAt) {
    throw new Error(`${factType} facts require an explicit occurredAt reporting clock.`);
  }
  return occurredAt;
}

function requireFactAthleteName(factType: string, value?: string | null): string {
  const athleteName = normalizeValue(value);
  if (!athleteName) {
    throw new Error(`${factType} facts require athleteName.`);
  }
  return athleteName;
}

export function buildCallActivityFact(args: {
  athleteId: string | number;
  athleteMainId: string | number;
  athleteName?: string | null;
  taskId: string | number;
  taskTitle?: string | null;
  taskDescription?: string | null;
  rawCrmStage: string | null;
  rawTaskStatus?: string | null;
  activitySubtype: string;
  occurredAt?: string | null;
  ownerInput: OwnerResolutionInput;
  ownerContext?: OwnerResolutionResult;
  payload?: Record<string, unknown>;
  updatedAt?: string;
}): CallActivityFactRow {
  const identity = validateAthleteIdentity(args);
  const activityKind = activityKindForTaskStatus(args.activitySubtype);
  const reporting = classifyCallTrackerReporting(args.activitySubtype);
  if (!activityKind) {
    throw new Error(`Task status ${args.activitySubtype} is not a dashboard call activity fact.`);
  }
  const owner = requireResolvedOwner(args.ownerInput, args.ownerContext);
  const occurredAt = requireFactOccurredAt('call_activity', args.occurredAt);
  const athleteName = requireFactAthleteName('call_activity', args.athleteName);
  const envelope = buildCallTrackerEventEnvelope({
    rawCrmStage: args.rawCrmStage,
    rawTaskStatus: normalizeValue(args.rawTaskStatus) || args.activitySubtype,
    rawEventType: 'call_activity',
    trackerOutcome: reporting.trackerOutcome,
    occurredAt,
    source: 'call_activity',
    bookedEventTitle: args.taskTitle,
  });
  return {
    athlete_key: identity.athleteKey,
    athlete_id: identity.athleteId,
    athlete_main_id: identity.athleteMainId,
    athlete_name: athleteName,
    task_id: String(args.taskId).trim(),
    task_title: normalizeValue(args.taskTitle),
    task_description: normalizeValue(args.taskDescription),
    raw_crm_stage: envelope.raw_crm_stage,
    raw_task_status: envelope.raw_task_status,
    activity_type: args.activitySubtype,
    activity_kind: activityKind,
    activity_subtype: args.activitySubtype,
    occurred_at: occurredAt,
    source_owner: owner.resolvedOwnerName || '',
    owner_proof: owner.resolvedFromField || '',
    payload_json: {
      ...(args.payload || {}),
      ...envelope,
      call_tracker_event: envelope,
      activity_kind: activityKind,
      activity_subtype: args.activitySubtype,
      counts_as_dial: reporting.countsAsDial,
      counts_as_contact: reporting.countsAsContact,
      counts_as_meeting_set: reporting.countsAsMeetingSet,
      counts_as_post_meeting_outcome: reporting.countsAsPostMeetingOutcome,
      tracker_outcome: reporting.trackerOutcome,
      occurred_at_source: args.payload?.occurred_at_source || 'input.occurredAt',
      active_operator_key: owner.activeOperator.operatorKey,
      active_operator_name: owner.activeOperator.personName,
      task_assigned_owner: owner.taskAssignedOwner,
      resolved_owner_name: owner.resolvedOwnerName,
      resolved_owner_role: owner.resolvedOwnerRole,
      resolved_from_field: owner.resolvedFromField,
      resolved_from_value: owner.resolvedFromValue,
      materialization_status: owner.materializationStatus,
      materialization_reason: owner.materializationReason,
      owner_status: owner.status,
    },
    updated_at: args.updatedAt || new Date().toISOString(),
  };
}

export function buildMeetingOutcomeDedupeKey(args: {
  source: string;
  athleteKey: string;
  liveEventId?: string | null;
  appointmentId?: string | null;
  rawEventType: string;
  outcome?: string | null;
}): string {
  const rawEventType = String(args.rawEventType || '').trim();
  const eventIdentity = args.liveEventId || args.appointmentId || 'missing-event';
  const outcome = args.outcome || 'unknown';
  if (rawEventType === 'post_meeting_outcome') {
    return ['post_meeting_outcome', args.athleteKey, eventIdentity, outcome]
      .map((value) => String(value || '').trim())
      .join(':');
  }

  return [
    args.source,
    args.athleteKey,
    eventIdentity,
    rawEventType,
    outcome,
  ]
    .map((value) => String(value || '').trim())
    .join(':');
}

export function buildMeetingOutcomeFact(args: {
  athleteId: string | number;
  athleteMainId: string | number;
  athleteName?: string | null;
  occurredAt?: string | null;
  source: string;
  rawCrmStage?: string | null;
  rawTaskStatus?: string | null;
  rawEventType: string;
  dedupeOutcome?: string | null;
  appointmentId?: string | null;
  liveEventId?: string | null;
  bookedEventTitle?: string | null;
  revenueCents?: number | null;
  ownerInput: OwnerResolutionInput;
  ownerContext?: OwnerResolutionResult;
  payload?: Record<string, unknown>;
}): MeetingOutcomeFactRow {
  const identity = validateAthleteIdentity(args);
  const owner = requireResolvedOwner(args.ownerInput, args.ownerContext);
  const occurredAt = requireFactOccurredAt('meeting_outcome', args.occurredAt);
  const envelope = buildCallTrackerEventEnvelope({
    rawCrmStage: args.rawCrmStage || null,
    rawTaskStatus: args.rawTaskStatus || null,
    rawEventType: args.rawEventType,
    trackerOutcome: args.dedupeOutcome || args.rawTaskStatus || args.rawCrmStage,
    occurredAt,
    source: args.source,
    appointmentId: args.appointmentId,
    liveEventId: args.liveEventId,
    bookedEventTitle: args.bookedEventTitle,
    revenueCents: args.revenueCents,
  });
  const dedupeKey = buildMeetingOutcomeDedupeKey({
    source: args.source,
    athleteKey: identity.athleteKey,
    liveEventId: args.liveEventId,
    appointmentId: args.appointmentId,
    rawEventType: args.rawEventType,
    outcome: args.dedupeOutcome || args.rawTaskStatus || args.rawCrmStage,
  });
  return {
    id: randomUUID(),
    athlete_key: identity.athleteKey,
    athlete_id: identity.athleteId,
    athlete_main_id: identity.athleteMainId,
    athlete_name: normalizeValue(args.athleteName),
    occurred_at: occurredAt,
    source: envelope.source,
    raw_crm_stage: envelope.raw_crm_stage,
    raw_task_status: envelope.raw_task_status,
    raw_event_type: envelope.raw_event_type,
    appointment_id: envelope.appointment_id,
    live_event_id: envelope.live_event_id,
    booked_event_title: envelope.booked_event_title,
    revenue_cents: envelope.revenue_cents,
    source_owner: owner.resolvedOwnerName || '',
    is_tracked_owner: owner.canMaterializeForActiveOperator,
    owner_proof: owner.resolvedFromField || '',
    dedupe_key: dedupeKey,
    payload_json: {
      ...(args.payload || {}),
      ...envelope,
      call_tracker_event: envelope,
      active_operator_key: owner.activeOperator.operatorKey,
      active_operator_name: owner.activeOperator.personName,
      task_assigned_owner: owner.taskAssignedOwner,
      booked_meeting_assigned_owner: owner.bookedMeetingAssignedOwner,
      appointment_setter_name: owner.appointmentSetterName,
      scouting_coordinator: owner.scoutingCoordinator,
      profile_head_scout: owner.profileHeadScout,
      resolved_owner_name: owner.resolvedOwnerName,
      resolved_owner_role: owner.resolvedOwnerRole,
      resolved_from_field: owner.resolvedFromField,
      resolved_from_value: owner.resolvedFromValue,
      materialization_status: owner.materializationStatus,
      materialization_reason: owner.materializationReason,
      owner_status: owner.status,
      tracker_source_owner: owner.resolvedOwnerName,
      tracker_owner_proof: owner.resolvedFromField,
      is_tracked_owner: owner.canMaterializeForActiveOperator,
      occurred_at_source: args.payload?.occurred_at_source || 'input.occurredAt',
    },
  };
}

export function buildMeetingSetFact(args: MeetingSetFactInput): MeetingSetFactRow {
  const identity = validateAthleteIdentity(args);
  if (!classifyMeetingSetStage(args.crmStage || '')) {
    throw new Error(`Meeting set facts require CRM stage Meeting Set. Received ${args.crmStage || 'missing'}.`);
  }
  const appointmentId = normalizeValue(
    (args.payload?.appointment_id as string | number | null | undefined) ||
      (args.payload?.booked_event_id as string | number | null | undefined),
  );
  if (!appointmentId) {
    throw new Error('Meeting set facts require a booked meeting appointment_id/event_id.');
  }
  const envelope = buildCallTrackerEventEnvelope({
    rawCrmStage: args.crmStage || 'Meeting Set',
    rawTaskStatus: args.taskStatus || null,
    rawEventType: 'lifecycle_meeting_set',
    trackerOutcome: 'meeting_set',
    occurredAt: args.createdAt || null,
    source: String(args.payload?.source || 'lifecycle_meeting_set'),
    appointmentId,
    bookedEventTitle: normalizeValue(args.payload?.meeting_name as string | number | null | undefined),
  });

  return buildLifecycleAuditEvent({
    ...args,
    payload: {
      ...(args.payload || {}),
      ...envelope,
      call_tracker_event: envelope,
    },
    eventType: 'meeting_set',
    dedupeKey: `meeting_set:${identity.athleteKey}:${appointmentId}`,
  });
}
