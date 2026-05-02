import test from 'node:test';
import assert from 'node:assert/strict';

import { getActiveOperator, HEAD_SCOUT_ORDER, resolveOwnerByName } from './owners';
import { resolveOwnerContext } from './owner-resolution';

test('active operator defaults to Jerami workspace context', () => {
  const operator = getActiveOperator();

  assert.equal(operator.operatorKey, 'jerami_singleton');
  assert.equal(operator.personName, 'Jerami Singleton');
  assert.equal(operator.legacyUserId, '1408164');
  assert.equal(operator.taskAssignedOwnerName, 'Jerami Singleton');
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
    ['Jeffrey Stein', 'Luther Winfield', 'Ryan Lietz', 'James Holcomb'],
  );
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
