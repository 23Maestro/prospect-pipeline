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
  assert.equal(result.ownerProof, 'relevant_task_owner');
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
  assert.equal(result.ownerProof, 'relevant_task_owner');
});

test('booked event owner resolves only when athlete identity matches', () => {
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

  assert.equal(result.isTrackedOwner, true);
  assert.equal(result.sourceOwner, 'Jerami Singleton');
  assert.equal(result.ownerProof, 'booked_event_owner');
});

test('mismatched booked event identity throws instead of falling back', () => {
  assert.throws(
    () =>
      resolveCallTrackerOwnership({
        athleteId: '123',
        athleteMainId: '456',
        bookedMeeting: {
          event_id: '777',
          assigned_owner: 'Jerami Singleton',
          athlete_id: '999',
          athlete_main_id: '456',
        },
      }),
    /Unable to resolve call tracker owner proof/,
  );
});

test('missing owner proof throws instead of returning review fallback', () => {
  assert.throws(
    () =>
      resolveCallTrackerOwnership({
        athleteId: '123',
        athleteMainId: '456',
        athleteName: 'Jordan Niles',
      }),
    /Unable to resolve call tracker owner proof/,
  );
});

