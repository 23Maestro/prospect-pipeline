import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCallTrackerOwnership } from './call-tracker-ownership.mjs';

test('Jerami confirmation task resolves tracked ownership', () => {
  const result = resolveCallTrackerOwnership({
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
  });

  assert.equal(result.isTrackedOwner, true);
  assert.equal(result.sourceOwner, 'Jerami Singleton');
  assert.equal(result.ownerProof, 'relevant_task.assigned_owner');
  assert.equal(result.materializationStatus, 'operator_task');
});

test('non-Jerami relevant task resolves excluded ownership', () => {
  const result = resolveCallTrackerOwnership({
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '900',
        title: 'Confirmation Call',
        assigned_owner: 'Logan Lord',
        completion_date: '',
      },
    ],
  });

  assert.equal(result.isTrackedOwner, false);
  assert.equal(result.sourceOwner, 'Logan Lord');
  assert.equal(result.ownerProof, 'relevant_task.assigned_owner');
  assert.equal(result.materializationStatus, 'not_operator_task');
});

test('booked event owner resolves but does not count without active operator task proof', () => {
  const result = resolveCallTrackerOwnership({
    athleteId: '123',
    athleteMainId: '456',
    bookedMeeting: {
      event_id: '777',
      assigned_owner: 'Jerami Singleton',
      athlete_id: '123',
      athlete_main_id: '456',
    },
  });

  assert.equal(result.isTrackedOwner, false);
  assert.equal(result.sourceOwner, 'Jerami Singleton');
  assert.equal(result.ownerProof, 'bookedMeeting.assigned_owner');
  assert.equal(result.materializationStatus, 'not_operator_task');
  assert.equal(result.materializationReason, 'missing_task_assigned_owner');
});

test('mismatched booked event identity returns review instead of guessing', () => {
  const result = resolveCallTrackerOwnership({
    athleteId: '123',
    athleteMainId: '456',
    bookedMeeting: {
      event_id: '777',
      assigned_owner: 'Jerami Singleton',
      athlete_id: '999',
      athlete_main_id: '456',
    },
  });

  assert.equal(result.isTrackedOwner, false);
  assert.equal(result.sourceOwner, null);
  assert.equal(result.materializationStatus, 'not_operator_task');
  assert.equal(result.materializationReason, 'mismatched_athlete_identity');
});

test('missing owner proof returns review fallback instead of throwing', () => {
  const result = resolveCallTrackerOwnership({
    athleteId: '123',
    athleteMainId: '456',
    athleteName: 'Jordan Niles',
  });

  assert.equal(result.isTrackedOwner, false);
  assert.equal(result.sourceOwner, null);
  assert.equal(result.materializationStatus, 'not_operator_task');
  assert.equal(result.materializationReason, 'missing_task_assigned_owner');
});
