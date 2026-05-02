import { getActiveOperator, isActiveOperatorTaskAssignedOwner } from '../src/domain/owners.ts';
import { resolveOwnerContext } from '../src/domain/owner-resolution.ts';

export function isTrackedOwner(value, trackedOwnerName = getActiveOperator().personName) {
  if (trackedOwnerName && trackedOwnerName !== getActiveOperator().personName) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ') ===
      String(trackedOwnerName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }
  return isActiveOperatorTaskAssignedOwner(value);
}

export function resolveCallTrackerOwnership(args = {}) {
  const purpose = args.purpose || (args.bookedMeeting || args.matchedAppointment ? 'meeting_outcome' : 'call_activity');
  const context = resolveOwnerContext({
    purpose,
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName,
    tasks: args.tasks,
    selectedTaskId: args.selectedTaskId,
    currentTaskId: args.currentTaskId,
    bookedMeeting: args.bookedMeeting,
    matchedAppointment: args.matchedAppointment,
    resolvedProfile: args.resolvedProfile,
    pipelineState: args.pipelineState,
    appointmentId: args.appointmentId,
    liveEventId: args.liveEventId,
    appointmentSetterName: args.appointmentSetterName,
    appointmentSetterId: args.appointmentSetterId,
    selectedOpenMeeting: args.selectedOpenMeeting,
    submittedMeetingPayload: args.submittedMeetingPayload,
  });

  return {
    isTrackedOwner: context.canMaterializeForActiveOperator,
    sourceOwner: context.resolvedOwnerName || context.taskAssignedOwner,
    ownerProof: context.resolvedFromField || context.ownerProof,
    materializationStatus: context.materializationStatus,
    materializationReason: context.materializationReason,
    taskAssignedOwner: context.taskAssignedOwner,
    activeOperator: context.activeOperator,
    context,
  };
}
