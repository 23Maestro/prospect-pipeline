import test from 'node:test';
import assert from 'node:assert/strict';
import type { ScoutPrepContext } from '../features/scout-prep/types';

import {
  SCOUT_PREP_BATCH_OPERATIONS,
  buildScoutPrepBatchPreflightRows,
  resolveBatchVoicemailRecipient,
  runScoutPrepBatchRow,
  sortScoutPrepBatchTasks,
} from './scout-batch-runner';

function buildContext(overrides?: Partial<ScoutPrepContext>): ScoutPrepContext {
  return {
    task: {
      contact_id: '123',
      athlete_main_id: '456',
      athlete_name: 'Bryson Smith',
      grad_year: '2027',
      title: 'Call Attempt 3',
      task_id: '900',
    },
    resolved: {
      athlete_id: '123',
      athlete_main_id: '456',
      sport: 'Football',
      head_scout: 'Ryan Lietz',
    },
    contactInfo: {
      contactId: '123',
      studentAthlete: {
        name: 'Bryson Smith',
        email: null,
        phone: '(651) 555-3000',
      },
      parent1: {
        name: 'Jamie Smith',
        relationship: 'Mother',
        email: null,
        phone: '(651) 555-1212',
      },
      parent2: {
        name: 'Chris Smith',
        relationship: 'Father',
        email: null,
        phone: '1-651-555-9898',
      },
    },
    notes: [],
    tasks: [
      {
        task_id: '900',
        title: 'Call Attempt 3',
        completion_date: '',
        description:
          "Call the family third time. Then If you do not get a hold of them, code as 'Did Not Speak To'",
      },
    ],
    ...overrides,
  } as ScoutPrepContext;
}

test('batch voicemail recipient uses student athlete when duplicate-phone dedupe leaves one recipient', () => {
  const result = resolveBatchVoicemailRecipient(
    buildContext({
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Bryson Smith',
          email: null,
          phone: '(651) 555-1212',
        },
        parent1: {
          name: 'Jamie Smith',
          relationship: 'Mother',
          email: null,
          phone: '(651) 555-1212',
        },
        parent2: null,
      },
    }),
  );

  assert.equal(result.status, 'eligible');
  assert.equal(result.recipient?.id, 'studentAthlete');
  assert.deepEqual(result.recipient?.phones, ['651-555-1212']);
});

test('batch voicemail recipient defaults to parent one when several contacts exist', () => {
  const result = resolveBatchVoicemailRecipient(buildContext());

  assert.equal(result.status, 'eligible');
  assert.equal(result.recipient?.id, 'parent1');
  assert.equal(result.recipient?.name, 'Jamie Smith');
});

test('batch voicemail recipient skips ambiguous rows without parent one', () => {
  const result = resolveBatchVoicemailRecipient(
    buildContext({
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Bryson Smith',
          email: null,
          phone: '(651) 555-3000',
        },
        parent1: null,
        parent2: {
          name: 'Chris Smith',
          relationship: 'Father',
          email: null,
          phone: '1-651-555-9898',
        },
      },
    }),
  );

  assert.equal(result.status, 'skipped');
  assert.match(result.message || '', /Parent 1/);
});

test('batch preflight only marks incomplete Call Attempt 3 rows eligible', () => {
  const rows = buildScoutPrepBatchPreflightRows({
    operation: SCOUT_PREP_BATCH_OPERATIONS.callAttempt3Voicemail,
    tasks: [
      { task_id: '1', title: 'Call Attempt 3', athlete_name: 'Eligible', completion_date: '' },
      { task_id: '2', title: 'Call Attempt 3', athlete_name: 'Completed', completion_date: '05/01/2026' },
      { task_id: '3', title: 'Call Attempt 2', athlete_name: 'Wrong Task', completion_date: '' },
    ],
    limit: 10,
  });

  assert.deepEqual(
    Object.fromEntries(rows.map((row) => [row.task.task_id, row.status])),
    {
      '1': 'pending',
      '2': 'skipped',
      '3': 'skipped',
    },
  );
});

test('batch preflight can target incomplete Call Attempt 2 rows', () => {
  const rows = buildScoutPrepBatchPreflightRows({
    operation: SCOUT_PREP_BATCH_OPERATIONS.callAttempt2Voicemail,
    tasks: [
      { task_id: '1', title: 'Call Attempt 3', athlete_name: 'Wrong Task', completion_date: '' },
      { task_id: '2', title: 'Call Attempt 2', athlete_name: 'Eligible', completion_date: '' },
      { task_id: '3', title: 'Call Attempt 2', athlete_name: 'Completed', completion_date: '05/01/2026' },
    ],
    limit: 10,
  });

  assert.deepEqual(
    Object.fromEntries(rows.map((row) => [row.task.task_id, row.status])),
    {
      '1': 'skipped',
      '2': 'pending',
      '3': 'skipped',
    },
  );
});

test('batch task ordering puts colder younger grad years first', () => {
  const tasks = sortScoutPrepBatchTasks([
    { task_id: '1', title: 'Call Attempt 2', athlete_name: '2028 Athlete', grad_year: '2028', completion_date: '' },
    { task_id: '2', title: 'Call Attempt 2', athlete_name: '2031 Athlete', grad_year: '2031', completion_date: '' },
    { task_id: '3', title: 'Call Attempt 2', athlete_name: '2030 Athlete', grad_year: '2030', completion_date: '' },
  ]);

  assert.deepEqual(
    tasks.map((task) => task.athlete_name),
    ['2031 Athlete', '2030 Athlete', '2028 Athlete'],
  );
});

test('batch row sends message before persistence and never persists after send failure', async () => {
  const calls: string[] = [];
  const context = buildContext();
  const row = buildScoutPrepBatchPreflightRows({
    operation: SCOUT_PREP_BATCH_OPERATIONS.callAttempt3Voicemail,
    tasks: [{ task_id: '1', title: 'Call Attempt 3', athlete_name: 'Eligible', completion_date: '' }],
    limit: 10,
  })[0];

  const sent = await runScoutPrepBatchRow({
    row,
    context,
    resolveRecipient: () => ({
      status: 'eligible',
      recipient: { id: 'parent1', label: 'Parent 1', name: 'Jamie Smith', phones: ['651-555-1212'] },
    }),
    buildMessage: () => 'Message body',
    sendMessage: async () => {
      calls.push('send');
    },
    persistMessageSent: async () => {
      calls.push('persist');
    },
  });

  assert.equal(sent.status, 'sent');
  assert.deepEqual(calls, ['send', 'persist']);

  calls.length = 0;
  const failed = await runScoutPrepBatchRow({
    row,
    context,
    resolveRecipient: () => ({
      status: 'eligible',
      recipient: { id: 'parent1', label: 'Parent 1', name: 'Jamie Smith', phones: ['651-555-1212'] },
    }),
    buildMessage: () => 'Message body',
    sendMessage: async () => {
      calls.push('send');
      throw new Error('iMessage unavailable');
    },
    persistMessageSent: async () => {
      calls.push('persist');
    },
  });

  assert.equal(failed.status, 'failed');
  assert.deepEqual(calls, ['send']);
});
