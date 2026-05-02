import test from 'node:test';
import assert from 'node:assert/strict';
import type { ScoutPrepContext } from '../features/scout-prep/types';

import {
  buildConfirmationActionPayload,
  buildScoutPrepCommandContext,
  buildSetMeetingsCommandContextFromBookedMeetings,
} from './scout-prep-command-pipeline';

function buildContext(): ScoutPrepContext {
  return {
    task: {
      contact_id: '123',
      athlete_main_id: '456',
      athlete_name: 'Avery Jones',
    },
    resolved: {
      athlete_main_id: '456',
      sport: 'Football',
      head_scout: 'Ryan Lietz',
    },
    contactInfo: {
      contactId: '123',
      studentAthlete: { name: 'Avery Jones', email: null, phone: '6515553000' },
      parent1: { name: 'Jamie Jones', relationship: 'Mother', email: null, phone: '6515551212' },
      parent2: { name: 'Chris Jones', relationship: 'Father', email: null, phone: null },
    },
    notes: [],
    tasks: [
      {
        task_id: '9001',
        title: '(SC Move This Task) Confirmation Call',
        completion_date: '',
      },
    ],
  } as ScoutPrepContext;
}

test('Scout Prep command context centralizes athlete, task, contact, and outreach wording facts', () => {
  const context = buildScoutPrepCommandContext({
    context: buildContext(),
    now: new Date('2026-05-01T14:00:00.000Z'),
    meetingStart: new Date('2026-05-01T23:00:00.000Z'),
    meetingTimezone: 'EST',
  });

  assert.equal(context.athleteIdentity.athleteId, '123');
  assert.equal(context.athleteIdentity.athleteMainId, '456');
  assert.equal(context.athleteName, 'Avery Jones');
  assert.equal(context.tasks[0].task_id, '9001');
  assert.deepEqual(context.reminderRecipient?.phones, ['651-555-1212']);
  assert.equal(context.meetingTimePhrase, '7:00pm eastern');
  assert.equal(context.confirmationDayPhrase, 'tonight');
  assert.equal(context.actionEligibility.canSendConfirmation, true);
});

test('confirmation payload reuses command context facts instead of recomputing recipient and task data', () => {
  const commandContext = buildScoutPrepCommandContext({
    context: buildContext(),
    meetingStart: new Date('2026-05-01T23:00:00.000Z'),
    meetingTimezone: 'EST',
  });
  const payload = buildConfirmationActionPayload({
    commandContext,
    reminderVariant: 'confirmation_1',
    message: 'prepared',
  });

  assert.equal(payload.athleteId, '123');
  assert.equal(payload.athleteMainId, '456');
  assert.equal(payload.taskId, '9001');
  assert.equal(payload.currentTask, 'Confirmation Call');
  assert.deepEqual(payload.recipientPhones, ['651-555-1212']);
  assert.equal(payload.headScoutName, 'Ryan Lietz');
});

test('Set Meetings command context excludes non-operator meeting candidates', () => {
  const context = buildSetMeetingsCommandContextFromBookedMeetings({
    bookedMeetings: [
      {
        event_id: 'evt-1',
        title: 'Avery Jones Football',
        assigned_owner: 'Ryan Lietz',
        start: '2026-05-01T23:00:00.000Z',
        end: '2026-05-02T00:00:00.000Z',
        date_time_label: 'Fri 05/01/26 7:00 PM',
      },
      {
        event_id: 'evt-2',
        title: 'Tim Prospect Football',
        assigned_owner: 'Ryan Lietz',
        start: '2026-05-01T23:00:00.000Z',
        end: '2026-05-02T00:00:00.000Z',
        date_time_label: 'Fri 05/01/26 7:00 PM',
      },
    ],
    tasks: [
      {
        contact_id: '123',
        athlete_id: '123',
        athlete_main_id: '456',
        athlete_name: 'Avery Jones',
        task_id: '9001',
        title: 'Confirmation Call',
        assigned_owner: 'Jerami Singleton',
      },
      {
        contact_id: '789',
        athlete_id: '789',
        athlete_main_id: '111',
        athlete_name: 'Tim Prospect',
        task_id: '9002',
        title: 'Confirmation Call',
        assigned_owner: 'Tim Risner',
      },
    ],
    operatorName: 'Jerami Singleton',
  });

  assert.deepEqual(context.candidates.map((candidate) => candidate.athleteName), ['Avery Jones']);
});
