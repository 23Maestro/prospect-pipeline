import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findNewestIncompleteConfirmationTask,
  findNewestIncompleteTaskByTitle,
  getIncompleteTasks,
  getTopmostIncompleteTask,
  isIncompleteTaskValue,
  resolvePostCallTaskToComplete,
  resolveVoicemailLifecycleTaskForCompletion,
  stripMoveThisTaskPrefix,
} from './scout-task-selection';

test('incomplete task helpers preserve topmost task and newest task semantics', () => {
  const tasks = [
    { task_id: '100', title: 'Call Attempt 1', completion_date: '' },
    { task_id: '102', title: 'Call Attempt 2', completion_date: '05/01/2026' },
    { task_id: '101', title: '(SC Move This Task) Confirmation Call', completion_date: '-' },
  ];

  assert.equal(isIncompleteTaskValue('not completed'), true);
  assert.equal(stripMoveThisTaskPrefix('(SC Move This Task) Confirmation Call'), 'Confirmation Call');
  assert.equal(getTopmostIncompleteTask(tasks)?.task_id, '100');
  assert.deepEqual(
    getIncompleteTasks(tasks).map((task) => task.task_id),
    ['101', '100'],
  );
  assert.equal(findNewestIncompleteTaskByTitle(tasks, 'Confirmation Call')?.task_id, '101');
});

test('confirmation task selection chooses newest incomplete confirmation task', () => {
  const selected = findNewestIncompleteConfirmationTask([
    { task_id: '300', title: 'Confirmation Call', completion_date: '05/01/2026' },
    { task_id: '302', title: '(SC Move This Task) Confirmation Call', completion_date: '' },
    { task_id: '301', description: 'Confirm the meeting set with the family', completion_date: '' },
  ]);

  assert.equal(selected?.task_id, '302');
});

test('voicemail lifecycle selection prefers matching task and falls back for call attempts', () => {
  assert.equal(
    resolveVoicemailLifecycleTaskForCompletion(
      [
        { task_id: '401', title: 'Call Attempt 1', completion_date: '' },
        { task_id: '402', title: 'Scheduled Follow Up', description: 'Second time text', completion_date: '' },
      ],
      'call_attempt_2',
    )?.task_id,
    '402',
  );

  assert.equal(
    resolveVoicemailLifecycleTaskForCompletion(
      [{ task_id: '403', title: 'Manual Follow Up', completion_date: '' }],
      'call_attempt_3',
    )?.task_id,
    '403',
  );
});

test('post-call task selection keeps stage saves successful with best matching incomplete task', () => {
  assert.equal(
    resolvePostCallTaskToComplete(
      [
        { task_id: '501', title: 'Call Attempt 1', completion_date: '' },
        { task_id: '502', title: 'Scheduled Follow Up', completion_date: '' },
      ],
      'Spoke to - Follow Up',
    )?.task_id,
    '502',
  );

  assert.equal(
    resolvePostCallTaskToComplete(
      [{ task_id: '503', title: 'Current Open Task', completion_date: '' }],
      'Left Voice Mail 2',
    )?.task_id,
    '503',
  );
});
