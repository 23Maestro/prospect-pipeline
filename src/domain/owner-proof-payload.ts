import type { OwnerResolutionResult } from './owner-resolution';

function normalizeValue(value: unknown): string | null {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function buildOwnerProofPayload(args: {
  ownerContext: OwnerResolutionResult;
  ownerProof?: string | null;
  taskAssignedOwner?: string | null;
  bookedMeetingAssignedOwner?: string | null;
  basePayload?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const basePayload = args.basePayload || {};
  const existingOwnerContext = recordValue(basePayload.owner_context);
  const existingMaterializationProof = recordValue(basePayload.materialization_proof);
  const ownerProof =
    normalizeValue(args.ownerProof) ||
    normalizeValue(args.ownerContext.ownerProof) ||
    normalizeValue(args.ownerContext.resolvedFromField) ||
    normalizeValue(basePayload.owner_proof) ||
    normalizeValue(existingOwnerContext.owner_proof) ||
    normalizeValue(existingMaterializationProof.owner_proof);
  const taskAssignedOwner =
    normalizeValue(args.ownerContext.taskAssignedOwner) ||
    normalizeValue(args.taskAssignedOwner) ||
    normalizeValue(basePayload.task_assigned_owner) ||
    normalizeValue(existingOwnerContext.task_assigned_owner) ||
    normalizeValue(existingMaterializationProof.task_assigned_owner);
  const bookedMeetingAssignedOwner =
    normalizeValue(args.bookedMeetingAssignedOwner) ||
    normalizeValue(args.ownerContext.bookedMeetingAssignedOwner) ||
    normalizeValue(basePayload.booked_meeting_assigned_owner) ||
    normalizeValue(existingOwnerContext.booked_meeting_assigned_owner);
  const appointmentSetterName =
    normalizeValue(args.ownerContext.appointmentSetterName) ||
    normalizeValue(existingOwnerContext.appointment_setter_name);
  const appointmentSetterLegacyUserId =
    normalizeValue(args.ownerContext.appointmentSetterLegacyUserId) ||
    normalizeValue(existingOwnerContext.appointment_setter_legacy_user_id);
  const meetingForLegacyUserId =
    normalizeValue(args.ownerContext.meetingForLegacyUserId) ||
    normalizeValue(existingOwnerContext.meeting_for_legacy_user_id);
  const calendarOwnerId =
    normalizeValue(args.ownerContext.calendarOwnerId) ||
    normalizeValue(existingOwnerContext.calendar_owner_id);
  const resolvedOwnerName =
    normalizeValue(args.ownerContext.resolvedOwnerName) ||
    normalizeValue(existingOwnerContext.resolved_owner_name);
  const resolvedOwnerRole =
    normalizeValue(args.ownerContext.resolvedOwnerRole) ||
    normalizeValue(existingOwnerContext.resolved_owner_role);
  const resolvedOwnerLegacyUserId =
    normalizeValue(args.ownerContext.resolvedOwnerLegacyUserId) ||
    normalizeValue(existingOwnerContext.resolved_owner_legacy_user_id);
  const resolvedFromField =
    normalizeValue(args.ownerContext.resolvedFromField) ||
    normalizeValue(existingOwnerContext.resolved_from_field);
  const resolvedFromValue =
    normalizeValue(args.ownerContext.resolvedFromValue) ||
    normalizeValue(existingOwnerContext.resolved_from_value);

  return {
    operator_owner: args.ownerContext.activeOperator.personName,
    operator_owner_key: args.ownerContext.activeOperator.operatorKey,
    operator_legacy_user_id: args.ownerContext.activeOperator.legacyUserId,
    task_assigned_owner: taskAssignedOwner,
    booked_meeting_assigned_owner: bookedMeetingAssignedOwner,
    owner_proof: ownerProof,
    materialization_status: args.ownerContext.materializationStatus,
    materialization_reason: args.ownerContext.materializationReason,
    owner_context: {
      ...existingOwnerContext,
      active_operator_key: args.ownerContext.activeOperator.operatorKey,
      active_operator_name: args.ownerContext.activeOperator.personName,
      task_assigned_owner: taskAssignedOwner,
      appointment_setter_name: appointmentSetterName,
      appointment_setter_legacy_user_id: appointmentSetterLegacyUserId,
      meeting_for_legacy_user_id: meetingForLegacyUserId,
      calendar_owner_id: calendarOwnerId,
      booked_meeting_assigned_owner: bookedMeetingAssignedOwner,
      resolved_owner_name: resolvedOwnerName,
      resolved_owner_role: resolvedOwnerRole,
      resolved_owner_legacy_user_id: resolvedOwnerLegacyUserId,
      resolved_from_field: resolvedFromField,
      resolved_from_value: resolvedFromValue,
      owner_proof: ownerProof,
      materialization_status: args.ownerContext.materializationStatus,
      materialization_reason: args.ownerContext.materializationReason,
      can_materialize_for_active_operator: args.ownerContext.canMaterializeForActiveOperator,
      owner_status: args.ownerContext.status,
    },
    materialization_proof: {
      ...existingMaterializationProof,
      task_assigned_owner: taskAssignedOwner,
      owner_proof: ownerProof,
      materialization_status: args.ownerContext.materializationStatus,
      status: args.ownerContext.materializationStatus,
      reason: args.ownerContext.materializationReason,
    },
  };
}
