import test from 'node:test';
import assert from 'node:assert/strict';
import type { ScoutPortalTask } from '../features/scout-prep/types.js';
import {
  buildRepeatProfileDescription,
  isCallAttempt1PortalTask,
  runDuplicateProfileResolutionForTask,
  selectDuplicateCallAttempt1Task,
  selectDuplicateCandidates,
  splitAthleteName,
  toDuplicateSearchRow,
} from './scout-duplicate-profiles.js';

function buildTask(overrides: Partial<ScoutPortalTask> = {}): ScoutPortalTask {
  return {
    contact_id: '1489567',
    athlete_id: '1489567',
    athlete_main_id: '951406',
    athlete_name: 'Wylie Robinson',
    title: 'Call Attempt 1',
    description: 'Call the family',
    ...overrides,
  };
}

test('splitAthleteName preserves first and last name segments', () => {
  assert.deepEqual(splitAthleteName('Wylie Robinson'), {
    firstName: 'Wylie',
    lastName: 'Robinson',
  });
  assert.deepEqual(splitAthleteName('Mary Kate Smith'), {
    firstName: 'Mary',
    lastName: 'Kate Smith',
  });
});

test('toDuplicateSearchRow ignores rows without exact first and last name values', () => {
  assert.equal(
    toDuplicateSearchRow({
      athlete_id: '123',
      name: 'Wylie',
    }),
    null,
  );
});

test('selectDuplicateCandidates keeps the current row clean and selects other exact-name matches', () => {
  const rows = [
    {
      athleteId: '1489567',
      athleteMainId: '951406',
      firstName: 'Wylie',
      lastName: 'Robinson',
      fullName: 'Wylie Robinson',
    },
    {
      athleteId: '1490000',
      athleteMainId: '951499',
      firstName: 'Wylie',
      lastName: 'Robinson',
      fullName: 'Wylie Robinson',
    },
    {
      athleteId: '1490001',
      athleteMainId: '951500',
      firstName: 'Wylie',
      lastName: 'Roberts',
      fullName: 'Wylie Roberts',
    },
  ];

  const candidates = selectDuplicateCandidates({
    rows,
    currentAthleteId: '1489567',
    currentAthleteMainId: '951406',
    targetName: { firstName: 'Wylie', lastName: 'Robinson' },
  });

  assert.deepEqual(
    candidates.map((row) => row.athleteId),
    ['1490000'],
  );
});

test('buildRepeatProfileDescription appends marker once without wiping content', () => {
  assert.equal(buildRepeatProfileDescription('Call the family'), 'Call the family\nRepeat Profile');
  assert.equal(buildRepeatProfileDescription('Call the family\nRepeat Profile'), 'Call the family\nRepeat Profile');
  assert.equal(buildRepeatProfileDescription(''), 'Repeat Profile');
});

test('selectDuplicateCallAttempt1Task chooses newest incomplete call attempt 1 task', () => {
  const task = selectDuplicateCallAttempt1Task([
    {
      task_id: '1001',
      title: 'Call Attempt 1',
      completion_date: '04/24/2026',
    },
    {
      task_id: '1003',
      title: '(SC Move This Task) Call Attempt 1',
      completion_date: null,
      description: 'Call the family',
    },
    {
      task_id: '1002',
      title: 'Call Attempt 1',
      completion_date: null,
    },
  ]);

  assert.equal(task?.task_id, '1003');
});

test('isCallAttempt1PortalTask only allows call attempt 1 rows', () => {
  assert.equal(isCallAttempt1PortalTask(buildTask()), true);
  assert.equal(isCallAttempt1PortalTask(buildTask({ title: 'Call Attempt 2' })), false);
});

test('runDuplicateProfileResolutionForTask does nothing when no duplicate is found', async () => {
  const result = await runDuplicateProfileResolutionForTask(buildTask(), {
    searchRows: async () => [
      {
        athleteId: '1489567',
        athleteMainId: '951406',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
      },
    ],
  });

  assert.equal(result.matchCount, 1);
  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.skipped, []);
});

test('runDuplicateProfileResolutionForTask updates and completes duplicate-side call attempt 1 task', async () => {
  const updates: Array<Record<string, string | null | undefined>> = [];
  const completions: Array<Record<string, string | null | undefined>> = [];

  const result = await runDuplicateProfileResolutionForTask(buildTask(), {
    searchRows: async () => [
      {
        athleteId: '1489567',
        athleteMainId: '951406',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
      },
      {
        athleteId: '1490000',
        athleteMainId: '951499',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
      },
    ],
    resolveAthleteMainId: async () => '951499',
    loadSelectedProfile: async () => undefined,
    fetchTasks: async () => [
      {
        task_id: '2500',
        title: 'Call Attempt 1',
        assigned_owner: 'Jerami Singleton',
        description: 'Call the family',
        completion_date: null,
      },
    ],
    updateTask: async (payload) => {
      updates.push(payload);
      return { success: true, task_id: payload.taskId };
    },
    completeTask: async (payload) => {
      completions.push(payload);
      return { success: true, task_id: payload.taskId };
    },
  });

  assert.equal(result.matchCount, 2);
  assert.equal(result.completed.length, 1);
  assert.deepEqual(result.skipped, []);
  assert.equal(updates[0]?.description, 'Call the family\nRepeat Profile');
  assert.equal(String(completions[0]?.taskId), '2500');
});

test('runDuplicateProfileResolutionForTask reports duplicate profiles with no matching call attempt task', async () => {
  const result = await runDuplicateProfileResolutionForTask(buildTask(), {
    searchRows: async () => [
      {
        athleteId: '1489567',
        athleteMainId: '951406',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
      },
      {
        athleteId: '1490000',
        athleteMainId: '951499',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
      },
    ],
    resolveAthleteMainId: async () => '951499',
    loadSelectedProfile: async () => undefined,
    fetchTasks: async () => [],
  });

  assert.equal(result.completed.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0]?.reason || '', /No incomplete Call Attempt 1 task/);
});
