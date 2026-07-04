import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getActiveOperator,
  getLegacyAssignedToFallback,
  HEAD_SCOUT_ORDER,
  PROSPECT_ID_OWNER_CONFIG,
  resolveOwnerByName,
} from './owners';
import { resolveOwnerContext } from './owner-resolution';

test('active operator defaults to primary workspace context', () => {
  const operator = getActiveOperator();

  assert.equal(PROSPECT_ID_OWNER_CONFIG.activeOperatorKey, 'operator_primary');
  assert.equal(PROSPECT_ID_OWNER_CONFIG.headScoutCalendarAccessUserId, 'calendar_access_user_demo');
  assert.equal(operator.operatorKey, 'operator_primary');
  assert.equal(operator.personName, 'Primary Operator');
  assert.equal(operator.legacyUserId, '100001');
  assert.equal(operator.taskAssignedOwnerName, 'Primary Operator');
  assert.equal(getLegacyAssignedToFallback(), '100001');
});

test('Secondary Operator is a known owner profile but not the active operator', () => {
  const tim = resolveOwnerByName('Secondary Operator');

  assert.equal(tim?.ownerKey, 'operator_secondary');
  assert.equal(tim?.dashboardTrackingEligible, false);
  assert.equal(tim?.roles.includes('scouting_coordinator'), true);
  assert.equal(tim?.assignedToLegacyUserId, null);
});

test('head scout order keeps the visible calendar owners available', () => {
  assert.deepEqual(
    HEAD_SCOUT_ORDER.map((scout) => scout.scout_name),
    [
      'Head Scout A',
      'Head Scout B',
      'Head Scout C',
      'Head Scout D',
      'Head Scout E',
      'Head Scout F',
      'Head Scout G',
      'Head Scout H',
    ],
  );
});

test('new Meeting Set owners resolve from live legacy ids', () => {
  const david = resolveOwnerByName('Head Scout A');
  const logan = resolveOwnerByName('Head Scout F');
  const kenton = resolveOwnerByName('Head Scout G');
  const nasir = resolveOwnerByName('Head Scout H');

  assert.equal(david?.ownerKey, 'head_scout_a');
  assert.equal(david?.assignedToLegacyUserId, '200001');
  assert.equal(david?.meetingForLegacyUserId, '200001');
  assert.equal(david?.calendarOwnerId, 'calendar_owner_a');
  assert.equal(david?.city, 'Example City');
  assert.equal(david?.state, 'FL');
  assert.equal(david?.roles.includes('head_scout'), true);

  assert.equal(logan?.ownerKey, 'head_scout_f');
  assert.equal(logan?.assignedToLegacyUserId, '200006');
  assert.equal(logan?.meetingForLegacyUserId, '200006');
  assert.equal(logan?.calendarOwnerId, 'calendar_owner_f');
  assert.equal(logan?.city, 'Example City');
  assert.equal(logan?.state, 'SC');
  assert.equal(logan?.roles.includes('head_scout'), true);

  assert.equal(kenton?.ownerKey, 'head_scout_g');
  assert.equal(kenton?.personName, 'Head Scout G');
  assert.equal(kenton?.assignedToLegacyUserId, '200007');
  assert.equal(kenton?.meetingForLegacyUserId, '200007');
  assert.equal(kenton?.calendarOwnerId, 'calendar_owner_g');
  assert.equal(kenton?.city, 'Example City');
  assert.equal(kenton?.state, 'VA');
  assert.equal(kenton?.roles.includes('head_scout'), true);

  assert.equal(nasir?.ownerKey, 'head_scout_h');
  assert.equal(nasir?.personName, 'Head Scout H');
  assert.equal(nasir?.assignedToLegacyUserId, '200008');
  assert.equal(nasir?.meetingForLegacyUserId, '200008');
  assert.equal(nasir?.calendarOwnerId, 'calendar_owner_h');
  assert.equal(nasir?.city, 'Example City');
  assert.equal(nasir?.state, 'TN');
  assert.equal(nasir?.roles.includes('head_scout'), true);
});

test('Jerami task assignment allows active-operator materialization even when booked owner is Ryan', () => {
  const result = resolveOwnerContext({
    purpose: 'meeting_outcome',
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '900',
        title: 'Confirmation Call',
        assigned_owner: 'Primary Operator',
        completion_date: '',
      },
    ],
    currentTaskId: '900',
    bookedMeeting: {
      event_id: '777',
      assigned_owner: 'Head Scout D',
      athlete_id: '123',
      athlete_main_id: '456',
    },
  });

  assert.equal(result.taskAssignedOwner, 'Primary Operator');
  assert.equal(result.bookedMeetingAssignedOwner, 'Head Scout D');
  assert.equal(result.resolvedOwnerName, 'Head Scout D');
  assert.equal(result.resolvedFromField, 'bookedMeeting.assigned_owner');
  assert.equal(result.materializationStatus, 'operator_task');
  assert.equal(result.materializationReason, 'task_assigned_owner_matches_active_operator');
  assert.equal(result.canMaterializeForActiveOperator, true);
  assert.equal(result.isTrackedOwner, true);
});

test('Tim task assignment is recognized but blocked from active-operator materialization', () => {
  const result = resolveOwnerContext({
    purpose: 'meeting_outcome',
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '901',
        title: 'Confirmation Call',
        assigned_owner: 'Secondary Operator',
        completion_date: '',
      },
    ],
    currentTaskId: '901',
    bookedMeeting: {
      event_id: '778',
      assigned_owner: 'Head Scout D',
      athlete_id: '123',
      athlete_main_id: '456',
    },
  });

  assert.equal(result.taskOwner?.ownerKey, 'operator_secondary');
  assert.equal(result.taskAssignedOwner, 'Secondary Operator');
  assert.equal(result.resolvedOwnerName, 'Head Scout D');
  assert.equal(result.materializationStatus, 'not_operator_task');
  assert.equal(result.materializationReason, 'task_assigned_owner_is_other_owner');
  assert.equal(result.canMaterializeForActiveOperator, false);
  assert.equal(result.isTrackedOwner, false);
  assert.match(result.reason || '', /Secondary Operator/);
});

test('missing task owner is a binary not-operator task with explicit reason', () => {
  const result = resolveOwnerContext({
    purpose: 'meeting_outcome',
    athleteId: '123',
    athleteMainId: '456',
    bookedMeeting: {
      event_id: '779',
      assigned_owner: 'Primary Operator',
      athlete_id: '123',
      athlete_main_id: '456',
    },
  });

  assert.equal(result.materializationStatus, 'not_operator_task');
  assert.equal(result.materializationReason, 'missing_task_assigned_owner');
  assert.equal(result.canMaterializeForActiveOperator, false);
  assert.equal(result.isTrackedOwner, false);
});

test('Meeting Set submit keeps Jerami operator ownership from internal Raycast operator context', () => {
  const result = resolveOwnerContext({
    purpose: 'meeting_set',
    athleteId: '123',
    athleteMainId: '456',
    submittedMeetingPayload: {
      assigned_to: '200004',
      meeting_for: '200004',
      open_event_id: '588339',
      operator_owner: 'Primary Operator',
      operator_owner_key: 'operator_primary',
      operator_legacy_user_id: '100001',
    },
  });

  assert.equal(result.taskAssignedOwner, 'Primary Operator');
  assert.equal(result.resolvedOwnerName, 'Head Scout D');
  assert.equal(result.resolvedFromField, 'submittedMeetingPayload.assigned_to');
  assert.equal(result.ownerProof, 'submittedMeetingPayload.operator_owner');
  assert.equal(result.materializationStatus, 'operator_task');
  assert.equal(result.materializationReason, 'meeting_set_submitted_by_active_operator');
  assert.equal(result.canMaterializeForActiveOperator, true);
});

test('Meeting Set submit without internal operator context does not infer Jerami from head scout payload', () => {
  const result = resolveOwnerContext({
    purpose: 'meeting_set',
    athleteId: '123',
    athleteMainId: '456',
    submittedMeetingPayload: {
      assigned_to: '200004',
      meeting_for: '200004',
      open_event_id: '588339',
    },
  });

  assert.equal(result.taskAssignedOwner, null);
  assert.equal(result.resolvedOwnerName, 'Head Scout D');
  assert.equal(result.materializationStatus, 'not_operator_task');
  assert.equal(result.materializationReason, 'missing_task_assigned_owner');
  assert.equal(result.canMaterializeForActiveOperator, false);
});

test('Meeting Set submit does not override an explicit non-Jerami task owner', () => {
  const result = resolveOwnerContext({
    purpose: 'meeting_set',
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '906',
        title: 'Call Attempt 1',
        assigned_owner: 'Secondary Operator',
      },
    ],
    selectedTaskId: '906',
    submittedMeetingPayload: {
      assigned_to: '200004',
      meeting_for: '200004',
      open_event_id: '588340',
    },
  });

  assert.equal(result.taskAssignedOwner, 'Secondary Operator');
  assert.equal(result.resolvedOwnerName, 'Head Scout D');
  assert.equal(result.materializationStatus, 'not_operator_task');
  assert.equal(result.materializationReason, 'task_assigned_owner_is_other_owner');
  assert.equal(result.canMaterializeForActiveOperator, false);
});

test('mismatched booked meeting identity blocks materialization with explicit reason', () => {
  const result = resolveOwnerContext({
    purpose: 'meeting_outcome',
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '903',
        title: 'Confirmation Call',
        assigned_owner: 'Primary Operator',
        completion_date: '',
      },
    ],
    currentTaskId: '903',
    bookedMeeting: {
      event_id: '780',
      assigned_owner: 'Primary Operator',
      athlete_id: '999',
      athlete_main_id: '456',
    },
  });

  assert.equal(result.materializationStatus, 'not_operator_task');
  assert.equal(result.materializationReason, 'mismatched_athlete_identity');
  assert.equal(result.canMaterializeForActiveOperator, false);
  assert.equal(result.resolvedOwnerName, null);
});

test('materialization status vocabulary stays binary', () => {
  const cases = [
    resolveOwnerContext({
      purpose: 'call_activity',
      athleteId: '123',
      athleteMainId: '456',
      tasks: [{ task_id: '904', title: 'Call Attempt 1', assigned_owner: 'Primary Operator' }],
      currentTaskId: '904',
    }),
    resolveOwnerContext({
      purpose: 'call_activity',
      athleteId: '123',
      athleteMainId: '456',
      tasks: [{ task_id: '905', title: 'Call Attempt 1', assigned_owner: 'Secondary Operator' }],
      currentTaskId: '905',
    }),
    resolveOwnerContext({
      purpose: 'call_activity',
      athleteId: '123',
      athleteMainId: '456',
    }),
  ];

  assert.deepEqual(
    [...new Set(cases.map((result) => result.materializationStatus))].sort(),
    ['not_operator_task', 'operator_task'],
  );
});

test('scoutingCoordinator keeps Laravel meaning distinct from head scout', () => {
  const result = resolveOwnerContext({
    purpose: 'call_activity',
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '902',
        title: 'Call Attempt 1',
        assigned_owner: 'Primary Operator',
        completion_date: '',
      },
    ],
    resolvedProfile: {
      head_scout: 'Head Scout D',
      scouting_coordinator: 'Secondary Operator',
    },
  });

  assert.equal(result.profileHeadScout, 'Head Scout D');
  assert.equal(result.scoutingCoordinator, 'Secondary Operator');
  assert.equal(result.headScout?.ownerKey, 'head_scout_d');
  assert.equal(result.taskAssignedOwner, 'Primary Operator');
});
