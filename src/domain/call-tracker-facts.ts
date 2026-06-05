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
  post_meeting_result?: string | null;
  source_system?: string | null;
  source_payload?: Record<string, unknown>;
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
  event_at?: string | null;
  reporting_at?: string | null;
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

export type CallLogFactRow = {
  fact_type: 'call_activity' | 'meeting_set' | 'post_meeting_outcome' | 'enrollment_payment';
  tracker_outcome: string;
  occurred_at: string;
  event_at: string | null;
  reporting_at: string;
  athlete_key: string | null;
  athlete_id: string | null;
  athlete_main_id: string | null;
  athlete_name: string | null;
  appointment_id: string | null;
  live_event_id: string | null;
  booked_event_title: string | null;
  raw_crm_stage: string | null;
  raw_task_status: string | null;
  raw_event_type: string | null;
  activity_kind: string | null;
  activity_subtype: string | null;
  source_family: 'call_activity_events' | 'lifecycle_events' | 'meeting_events';
  source_table: string;
  source_row_id: string | null;
  source_system: string | null;
  source_owner: string | null;
  owner_proof: string | null;
  active_operator_key: string | null;
  active_operator_name: string | null;
  task_assigned_owner: string | null;
  resolved_owner_name: string | null;
  resolved_owner_role: string | null;
  resolved_owner_source_field: string | null;
  resolved_owner_source_value: string | null;
  materialization_status: string | null;
  materialization_reason: string | null;
  can_materialize_for_active_operator: boolean;
  counts_as_dial: boolean;
  counts_as_contact: boolean;
  counts_as_meeting_set: boolean;
  counts_as_post_meeting_outcome: boolean;
  counts_as_enrollment: boolean;
  revenue_cents: number | null;
  commission_cents: number | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_checkout_session_id: string | null;
  payment_confirmed_at: string | null;
  dedupe_key: string;
  payload_json: Record<string, unknown>;
  updated_at: string;
};

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
  postMeetingResult?: string | null;
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
    post_meeting_result: normalizeValue(args.postMeetingResult),
    source_system: normalizeValue(args.sourceSystem),
    source_payload: args.sourcePayload || {},
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
  eventAt?: string | null;
  reportingAt?: string | null;
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
    event_at: normalizeIsoValue(args.eventAt),
    reporting_at: normalizeIsoValue(args.reportingAt),
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
      event_at: normalizeIsoValue(args.eventAt),
      reporting_at: normalizeIsoValue(args.reportingAt),
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
    occurredAt:
      normalizeValue(args.payload?.occurred_at as string | number | null | undefined) ||
      normalizeValue(args.payload?.completed_at as string | number | null | undefined) ||
      normalizeValue(args.payload?.latest_confirmation_task_due_at as string | number | null | undefined) ||
      normalizeValue(args.payload?.matched_weekly_task_due_at as string | number | null | undefined) ||
      normalizeValue(args.payload?.due_at as string | number | null | undefined) ||
      normalizeValue(args.payload?.task_due_at as string | number | null | undefined) ||
      args.createdAt ||
      null,
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

function boolPayload(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] === true || payload[key] === 'true' || payload[key] === 1 || payload[key] === '1';
}

function textPayload(payload: Record<string, unknown>, key: string): string | null {
  return normalizeValue(payload[key] as string | number | null | undefined);
}

function numberPayload(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstIsoPayload(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = normalizeIsoValue(textPayload(payload, key));
    if (value) return value;
  }
  return null;
}

function callLogClocks(args: {
  occurredAt?: string | null;
  eventAt?: string | null;
  reportingAt?: string | null;
  factType: string;
}): { occurredAt: string; eventAt: string | null; reportingAt: string } {
  const reportingAt = normalizeIsoValue(args.reportingAt) || normalizeIsoValue(args.eventAt) || normalizeIsoValue(args.occurredAt);
  if (!reportingAt) {
    throw new Error(`${args.factType} call_log facts require a reporting clock.`);
  }
  return {
    occurredAt: normalizeIsoValue(args.occurredAt) || reportingAt,
    eventAt: normalizeIsoValue(args.eventAt) || normalizeIsoValue(args.occurredAt),
    reportingAt,
  };
}

function buildCallLogBase(args: {
  factType: CallLogFactRow['fact_type'];
  trackerOutcome?: string | null;
  occurredAt?: string | null;
  eventAt?: string | null;
  reportingAt?: string | null;
  athleteKey?: string | null;
  athleteId?: string | null;
  athleteMainId?: string | null;
  athleteName?: string | null;
  appointmentId?: string | null;
  liveEventId?: string | null;
  bookedEventTitle?: string | null;
  rawCrmStage?: string | null;
  rawTaskStatus?: string | null;
  rawEventType?: string | null;
  activityKind?: string | null;
  activitySubtype?: string | null;
  sourceFamily: CallLogFactRow['source_family'];
  sourceTable: string;
  sourceRowId?: string | null;
  sourceSystem?: string | null;
  sourceOwner?: string | null;
  ownerProof?: string | null;
  payload?: Record<string, unknown>;
  countsAsDial?: boolean;
  countsAsContact?: boolean;
  countsAsMeetingSet?: boolean;
  countsAsPostMeetingOutcome?: boolean;
  countsAsEnrollment?: boolean;
  revenueCents?: number | null;
  commissionCents?: number | null;
  dedupeKey: string;
  updatedAt?: string;
}): CallLogFactRow {
  const payload = args.payload || {};
  const clocks = callLogClocks({
    occurredAt: args.occurredAt,
    eventAt: args.eventAt,
    reportingAt: args.reportingAt,
    factType: args.factType,
  });
  const trackerOutcome = normalizeValue(args.trackerOutcome) || 'needs_review';
  const dedupeKey = normalizeValue(args.dedupeKey);
  if (!dedupeKey) throw new Error(`${args.factType} call_log facts require dedupeKey.`);

  return {
    fact_type: args.factType,
    tracker_outcome: trackerOutcome,
    occurred_at: clocks.occurredAt,
    event_at: clocks.eventAt,
    reporting_at: clocks.reportingAt,
    athlete_key: normalizeValue(args.athleteKey),
    athlete_id: normalizeValue(args.athleteId),
    athlete_main_id: normalizeValue(args.athleteMainId),
    athlete_name: normalizeValue(args.athleteName),
    appointment_id: normalizeValue(args.appointmentId),
    live_event_id: normalizeValue(args.liveEventId),
    booked_event_title: normalizeValue(args.bookedEventTitle),
    raw_crm_stage: normalizeValue(args.rawCrmStage),
    raw_task_status: normalizeValue(args.rawTaskStatus),
    raw_event_type: normalizeValue(args.rawEventType),
    activity_kind: normalizeValue(args.activityKind),
    activity_subtype: normalizeValue(args.activitySubtype),
    source_family: args.sourceFamily,
    source_table: args.sourceTable,
    source_row_id: normalizeValue(args.sourceRowId),
    source_system: normalizeValue(args.sourceSystem),
    source_owner: normalizeValue(args.sourceOwner),
    owner_proof: normalizeValue(args.ownerProof),
    active_operator_key: textPayload(payload, 'active_operator_key'),
    active_operator_name: textPayload(payload, 'active_operator_name'),
    task_assigned_owner: textPayload(payload, 'task_assigned_owner'),
    resolved_owner_name: textPayload(payload, 'resolved_owner_name'),
    resolved_owner_role: textPayload(payload, 'resolved_owner_role'),
    resolved_owner_source_field: textPayload(payload, 'resolved_from_field'),
    resolved_owner_source_value: textPayload(payload, 'resolved_from_value'),
    materialization_status: textPayload(payload, 'materialization_status'),
    materialization_reason: textPayload(payload, 'materialization_reason'),
    can_materialize_for_active_operator:
      boolPayload(payload, 'is_tracked_owner') ||
      boolPayload(payload, 'can_materialize_for_active_operator') ||
      textPayload(payload, 'materialization_status') === 'materialized',
    counts_as_dial: Boolean(args.countsAsDial),
    counts_as_contact: Boolean(args.countsAsContact),
    counts_as_meeting_set: Boolean(args.countsAsMeetingSet),
    counts_as_post_meeting_outcome: Boolean(args.countsAsPostMeetingOutcome),
    counts_as_enrollment: Boolean(args.countsAsEnrollment),
    revenue_cents: args.revenueCents ?? null,
    commission_cents: args.commissionCents ?? numberPayload(payload, 'commission_amount_cents'),
    stripe_payment_intent_id: textPayload(payload, 'stripe_payment_intent_id'),
    stripe_charge_id: textPayload(payload, 'stripe_charge_id'),
    stripe_checkout_session_id: textPayload(payload, 'stripe_checkout_session_id'),
    payment_confirmed_at: normalizeIsoValue(textPayload(payload, 'payment_confirmed_at') || textPayload(payload, 'commission_paid_at')),
    dedupe_key: dedupeKey,
    payload_json: payload,
    updated_at: normalizeIsoValue(args.updatedAt) || new Date().toISOString(),
  };
}

export function buildCallLogFactFromCallActivityFact(row: CallActivityFactRow): CallLogFactRow {
  const payload = row.payload_json || {};
  return buildCallLogBase({
    factType: 'call_activity',
    trackerOutcome: textPayload(payload, 'tracker_outcome') || row.activity_subtype,
    occurredAt: row.occurred_at,
    eventAt: row.occurred_at,
    reportingAt: row.occurred_at,
    athleteKey: row.athlete_key,
    athleteId: row.athlete_id,
    athleteMainId: row.athlete_main_id,
    athleteName: row.athlete_name,
    rawCrmStage: row.raw_crm_stage,
    rawTaskStatus: row.raw_task_status,
    rawEventType: 'call_activity',
    activityKind: row.activity_kind,
    activitySubtype: row.activity_subtype,
    sourceFamily: 'call_activity_events',
    sourceTable: 'call_activity_events',
    sourceRowId: row.task_id,
    sourceSystem: textPayload(payload, 'source') || 'call_activity',
    sourceOwner: row.source_owner,
    ownerProof: row.owner_proof,
    payload,
    countsAsDial: boolPayload(payload, 'counts_as_dial'),
    countsAsContact: boolPayload(payload, 'counts_as_contact'),
    dedupeKey: `call_activity:${row.task_id}`,
    updatedAt: row.updated_at,
  });
}

export function buildCallLogFactFromMeetingSetFact(row: MeetingSetFactRow): CallLogFactRow {
  const payload = row.payload_json || {};
  const appointmentId = textPayload(payload, 'appointment_id') || textPayload(payload, 'booked_event_id');
  const meetingSetOccurredAt =
    firstIsoPayload(
      payload,
      'occurred_at',
      'completed_at',
      'latest_confirmation_task_due_at',
      'matched_weekly_task_due_at',
      'due_at',
      'task_due_at',
    ) || row.created_at;
  return buildCallLogBase({
    factType: 'meeting_set',
    trackerOutcome: textPayload(payload, 'tracker_outcome') || 'meeting_set',
    occurredAt: meetingSetOccurredAt,
    eventAt: meetingSetOccurredAt,
    reportingAt: meetingSetOccurredAt,
    athleteKey: row.athlete_key,
    athleteId: row.athlete_id,
    athleteMainId: row.athlete_main_id,
    athleteName: textPayload(payload, 'athlete_name'),
    appointmentId,
    liveEventId: textPayload(payload, 'live_event_id') || textPayload(payload, 'booked_event_id'),
    bookedEventTitle: textPayload(payload, 'booked_event_title') || textPayload(payload, 'meeting_name'),
    rawCrmStage: row.crm_stage,
    rawTaskStatus: row.task_status,
    rawEventType: textPayload(payload, 'raw_event_type') || 'lifecycle_meeting_set',
    sourceFamily: 'lifecycle_events',
    sourceTable: 'lifecycle_events',
    sourceRowId: row.dedupe_key || row.id,
    sourceSystem: textPayload(payload, 'source') || 'lifecycle_meeting_set',
    sourceOwner: textPayload(payload, 'tracker_source_owner') || textPayload(payload, 'resolved_owner_name'),
    ownerProof: textPayload(payload, 'tracker_owner_proof') || textPayload(payload, 'resolved_from_field'),
    payload,
    countsAsDial: boolPayload(payload, 'counts_as_dial'),
    countsAsContact: boolPayload(payload, 'counts_as_contact'),
    countsAsMeetingSet: true,
    dedupeKey: row.dedupe_key || `meeting_set:${row.athlete_key}:${appointmentId || row.id}`,
    updatedAt: row.created_at,
  });
}

export function buildCallLogFactFromMeetingOutcomeFact(row: MeetingOutcomeFactRow): CallLogFactRow {
  const payload = row.payload_json || {};
  const revenueCents = row.revenue_cents ?? numberPayload(payload, 'commission_amount_cents');
  const isEnrollment = row.raw_event_type === 'post_meeting_outcome' && row.dedupe_key.includes(':closed_won');
  return buildCallLogBase({
    factType: isEnrollment && revenueCents ? 'enrollment_payment' : 'post_meeting_outcome',
    trackerOutcome: textPayload(payload, 'tracker_outcome') || row.raw_task_status || row.raw_crm_stage || 'needs_review',
    occurredAt: row.occurred_at,
    eventAt: row.event_at || textPayload(payload, 'event_at') || row.occurred_at,
    reportingAt: row.reporting_at || textPayload(payload, 'reporting_at') || row.occurred_at,
    athleteKey: row.athlete_key,
    athleteId: row.athlete_id,
    athleteMainId: row.athlete_main_id,
    athleteName: row.athlete_name,
    appointmentId: row.appointment_id,
    liveEventId: row.live_event_id,
    bookedEventTitle: row.booked_event_title,
    rawCrmStage: row.raw_crm_stage,
    rawTaskStatus: row.raw_task_status,
    rawEventType: row.raw_event_type,
    sourceFamily: 'meeting_events',
    sourceTable: 'meeting_events',
    sourceRowId: row.dedupe_key || row.id,
    sourceSystem: row.source,
    sourceOwner: row.source_owner,
    ownerProof: row.owner_proof,
    payload,
    countsAsPostMeetingOutcome: true,
    countsAsEnrollment: Boolean(isEnrollment && revenueCents),
    revenueCents,
    dedupeKey: row.dedupe_key,
  });
}
