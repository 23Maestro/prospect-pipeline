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

test('active operator defaults to Jerami workspace context', () => {
  const operator = getActiveOperator();

  assert.equal(PROSPECT_ID_OWNER_CONFIG.activeOperatorKey, 'jerami_singleton');
  assert.equal(PROSPECT_ID_OWNER_CONFIG.headScoutCalendarAccessUserId, 'avdhyXjQ8bFweEf');
  assert.equal(operator.operatorKey, 'jerami_singleton');
  assert.equal(operator.personName, 'Jerami Singleton');
  assert.equal(operator.legacyUserId, '1408164');
  assert.equal(operator.taskAssignedOwnerName, 'Jerami Singleton');
  assert.equal(getLegacyAssignedToFallback(), '1408164');
});

test('Tim Risner is a known owner profile but not the active operator', () => {
  const tim = resolveOwnerByName('Coach Risner');

  assert.equal(tim?.ownerKey, 'tim_risner');
  assert.equal(tim?.dashboardTrackingEligible, false);
  assert.equal(tim?.roles.includes('scouting_coordinator'), true);
  assert.equal(tim?.assignedToLegacyUserId, null);
});

test('head scout order keeps the visible calendar owners available', () => {
  assert.deepEqual(
    HEAD_SCOUT_ORDER.map((scout) => scout.scout_name),
    [
      'David Foley',
      'Jeffrey Stein',
      'Luther Winfield',
      'Nasir Adderley',
      'Ryan Lietz',
      'James Holcomb',
      'Logan Lord',
      'Kenton Manis',
    ],
  );
});

test('new Meeting Set owners resolve from live legacy ids', () => {
  const david = resolveOwnerByName('David Foley');
  const logan = resolveOwnerByName('Logan Lord');
  const kenton = resolveOwnerByName('Kenton Manis');
  const nasir = resolveOwnerByName('Nasir Adderly');

  assert.equal(david?.ownerKey, 'david_foley');
  assert.equal(david?.assignedToLegacyUserId, '1418020');
  assert.equal(david?.meetingForLegacyUserId, '1418020');
  assert.equal(david?.calendarOwnerId, 'GI4oO0m9knrHNq1');
  assert.equal(david?.city, 'Winona');
  assert.equal(david?.state, 'MN');
  assert.equal(david?.roles.includes('head_scout'), true);

  assert.equal(logan?.ownerKey, 'logan_lord');
  assert.equal(logan?.assignedToLegacyUserId, '2254');
  assert.equal(logan?.meetingForLegacyUserId, '2254');
  assert.equal(logan?.calendarOwnerId, 'd9UDl0bRSqQ1owt');
  assert.equal(logan?.city, 'Chandler');
  assert.equal(logan?.state, 'AZ');
  assert.equal(logan?.roles.includes('head_scout'), true);

  assert.equal(kenton?.ownerKey, 'kenton_manis');
  assert.equal(kenton?.personName, 'Kenton Manis');
  assert.equal(kenton?.assignedToLegacyUserId, '1486538');
  assert.equal(kenton?.meetingForLegacyUserId, '1486538');
  assert.equal(kenton?.calendarOwnerId, 'A4H3xiZJdyrEh2X');
  assert.equal(kenton?.city, 'Prosper');
  assert.equal(kenton?.state, 'TX');
  assert.equal(kenton?.roles.includes('head_scout'), true);

  assert.equal(nasir?.ownerKey, 'nasir_adderley');
  assert.equal(nasir?.personName, 'Nasir Adderley');
  assert.equal(nasir?.assignedToLegacyUserId, '1462295');
  assert.equal(nasir?.meetingForLegacyUserId, '1462295');
  assert.equal(nasir?.calendarOwnerId, 'Ax8yvuUTdOzVHr7');
  assert.equal(nasir?.city, 'Dallas');
  assert.equal(nasir?.state, 'TX');
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
        assigned_owner: 'Jerami Singleton',
        completion_date: '',
      },
    ],
    currentTaskId: '900',
    bookedMeeting: {
      event_id: '777',
      assigned_owner: 'Ryan Lietz',
      athlete_id: '123',
      athlete_main_id: '456',
    },
  });

  assert.equal(result.taskAssignedOwner, 'Jerami Singleton');
  assert.equal(result.bookedMeetingAssignedOwner, 'Ryan Lietz');
  assert.equal(result.resolvedOwnerName, 'Ryan Lietz');
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
        assigned_owner: 'Tim Risner',
        completion_date: '',
      },
    ],
    currentTaskId: '901',
    bookedMeeting: {
      event_id: '778',
      assigned_owner: 'Ryan Lietz',
      athlete_id: '123',
      athlete_main_id: '456',
    },
  });

  assert.equal(result.taskOwner?.ownerKey, 'tim_risner');
  assert.equal(result.taskAssignedOwner, 'Tim Risner');
  assert.equal(result.resolvedOwnerName, 'Ryan Lietz');
  assert.equal(result.materializationStatus, 'not_operator_task');
  assert.equal(result.materializationReason, 'task_assigned_owner_is_other_owner');
  assert.equal(result.canMaterializeForActiveOperator, false);
  assert.equal(result.isTrackedOwner, false);
  assert.match(result.reason || '', /Tim Risner/);
});

test('missing task owner is a binary not-operator task with explicit reason', () => {
  const result = resolveOwnerContext({
    purpose: 'meeting_outcome',
    athleteId: '123',
    athleteMainId: '456',
    bookedMeeting: {
      event_id: '779',
      assigned_owner: 'Jerami Singleton',
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
      assigned_to: '1354049',
      meeting_for: '1354049',
      open_event_id: '588339',
      operator_owner: 'Jerami Singleton',
      operator_owner_key: 'jerami_singleton',
      operator_legacy_user_id: '1408164',
    },
  });

  assert.equal(result.taskAssignedOwner, 'Jerami Singleton');
  assert.equal(result.resolvedOwnerName, 'Ryan Lietz');
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
      assigned_to: '1354049',
      meeting_for: '1354049',
      open_event_id: '588339',
    },
  });

  assert.equal(result.taskAssignedOwner, null);
  assert.equal(result.resolvedOwnerName, 'Ryan Lietz');
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
        assigned_owner: 'Tim Risner',
      },
    ],
    selectedTaskId: '906',
    submittedMeetingPayload: {
      assigned_to: '1354049',
      meeting_for: '1354049',
      open_event_id: '588340',
    },
  });

  assert.equal(result.taskAssignedOwner, 'Tim Risner');
  assert.equal(result.resolvedOwnerName, 'Ryan Lietz');
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
        assigned_owner: 'Jerami Singleton',
        completion_date: '',
      },
    ],
    currentTaskId: '903',
    bookedMeeting: {
      event_id: '780',
      assigned_owner: 'Jerami Singleton',
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
      tasks: [{ task_id: '904', title: 'Call Attempt 1', assigned_owner: 'Jerami Singleton' }],
      currentTaskId: '904',
    }),
    resolveOwnerContext({
      purpose: 'call_activity',
      athleteId: '123',
      athleteMainId: '456',
      tasks: [{ task_id: '905', title: 'Call Attempt 1', assigned_owner: 'Tim Risner' }],
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
        assigned_owner: 'Jerami Singleton',
        completion_date: '',
      },
    ],
    resolvedProfile: {
      head_scout: 'Ryan Lietz',
      scouting_coordinator: 'Tim Risner',
    },
  });

  assert.equal(result.profileHeadScout, 'Ryan Lietz');
  assert.equal(result.scoutingCoordinator, 'Tim Risner');
  assert.equal(result.headScout?.ownerKey, 'ryan_lietz');
  assert.equal(result.taskAssignedOwner, 'Jerami Singleton');
});
