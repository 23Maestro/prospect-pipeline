import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskBucketRows,
  getTaskSectionTitle,
  mapTaskListFilterToRange,
  type ScoutTaskRange,
} from './scout-task-filters.js';
import type { ScoutPortalTask } from '../features/scout-prep/types.js';

function buildTask(name: string, dueDate: string): ScoutPortalTask {
  return {
    contact_id: name.toLowerCase().replace(/\s+/g, '-'),
    athlete_id: name.toLowerCase().replace(/\s+/g, '-'),
    athlete_main_id: `${name}-main`,
    athlete_name: name,
    due_date: dueDate,
    title: 'Call Attempt 1',
    description: null,
    grad_year: '2028',
  };
}

function buildBuckets(): Record<ScoutTaskRange, ScoutPortalTask[]> {
  return {
    todayPastDue: [buildTask('Today Past Due Athlete', '04/22/2026 09:00 AM')],
    today: [buildTask('Today Athlete', '04/22/2026 02:00 PM')],
    tomorrow: [buildTask('Tomorrow Athlete', '04/23/2026 11:00 AM')],
    future: [buildTask('Future Athlete', '04/25/2026 11:00 AM')],
  };
}

test('mapTaskListFilterToRange uses website-aligned range names', () => {
  assert.equal(mapTaskListFilterToRange('all'), 'todayPastDue');
  assert.equal(mapTaskListFilterToRange('today'), 'today');
  assert.equal(mapTaskListFilterToRange('tomorrow'), 'tomorrow');
  assert.equal(mapTaskListFilterToRange('future'), 'future');
});

test('getTaskSectionTitle uses site-matched labels', () => {
  assert.equal(getTaskSectionTitle('all'), 'Today / Past Due');
  assert.equal(getTaskSectionTitle('today'), 'Today');
  assert.equal(getTaskSectionTitle('tomorrow'), 'Tomorrow');
  assert.equal(getTaskSectionTitle('future'), 'Future');
});

test('all items returns only todayPastDue website rows', () => {
  const rows = buildTaskBucketRows({
    filter: 'all',
    taskBuckets: buildBuckets(),
  });

  assert.deepEqual(
    rows.map((row) => row.task.athlete_name),
    ['Today Past Due Athlete'],
  );
});

test('today returns only today rows', () => {
  const rows = buildTaskBucketRows({
    filter: 'today',
    taskBuckets: buildBuckets(),
  });

  assert.deepEqual(
    rows.map((row) => row.task.athlete_name),
    ['Today Athlete'],
  );
});

test('tomorrow returns only tomorrow rows', () => {
  const rows = buildTaskBucketRows({
    filter: 'tomorrow',
    taskBuckets: buildBuckets(),
  });

  assert.deepEqual(
    rows.map((row) => row.task.athlete_name),
    ['Tomorrow Athlete'],
  );
});

test('future returns only future rows', () => {
  const rows = buildTaskBucketRows({
    filter: 'future',
    taskBuckets: buildBuckets(),
  });

  assert.deepEqual(
    rows.map((row) => row.task.athlete_name),
    ['Future Athlete'],
  );
});
