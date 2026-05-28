import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskBucketRows,
  buildTaskPageLabel,
  getTaskPageOffset,
  getTaskSectionTitle,
  mapTaskListFilterToRange,
  type ScoutTaskRange,
} from './scout-task-filters.js';
import type { ScoutPortalTask } from '../features/scout-prep/types.js';

function buildTask(
  name: string,
  dueDate: string,
  gradYear = '2028',
  title = 'Call Attempt 1',
): ScoutPortalTask {
  return {
    contact_id: name.toLowerCase().replace(/\s+/g, '-'),
    athlete_id: name.toLowerCase().replace(/\s+/g, '-'),
    athlete_main_id: `${name}-main`,
    athlete_name: name,
    due_date: dueDate,
    title,
    description: null,
    grad_year: gradYear,
  };
}

function buildBuckets(): Record<ScoutTaskRange, ScoutPortalTask[]> {
  return {
    todayPastDue: [buildTask('Today Past Due Athlete', '04/22/2026 09:00 AM')],
    all: [buildTask('All Athlete', '04/20/2026 09:00 AM')],
    tomorrow: [buildTask('Tomorrow Athlete', '04/23/2026 11:00 AM')],
    future: [buildTask('Future Athlete', '04/25/2026 11:00 AM')],
  };
}

test('mapTaskListFilterToRange uses website-aligned range names', () => {
  assert.equal(mapTaskListFilterToRange('todayPastDue'), 'todayPastDue');
  assert.equal(mapTaskListFilterToRange('all'), 'all');
  assert.equal(mapTaskListFilterToRange('tomorrow'), 'tomorrow');
  assert.equal(mapTaskListFilterToRange('future'), 'future');
});

test('getTaskSectionTitle uses site-matched labels', () => {
  assert.equal(getTaskSectionTitle('todayPastDue'), 'Today / Past Due');
  assert.equal(getTaskSectionTitle('all'), 'All');
  assert.equal(getTaskSectionTitle('tomorrow'), 'Tomorrow');
  assert.equal(getTaskSectionTitle('future'), 'Future');
});

test('todayPastDue returns only todayPastDue website rows', () => {
  const rows = buildTaskBucketRows({
    filter: 'todayPastDue',
    taskBuckets: buildBuckets(),
  });

  assert.deepEqual(
    rows.map((row) => row.task.athlete_name),
    ['Today Past Due Athlete'],
  );
});

test('all returns only legacy all rows', () => {
  const rows = buildTaskBucketRows({
    filter: 'all',
    taskBuckets: buildBuckets(),
  });

  assert.deepEqual(
    rows.map((row) => row.task.athlete_name),
    ['All Athlete'],
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

test('all items can sort by grad year without changing the selected bucket', () => {
  const rows = buildTaskBucketRows({
    filter: 'all',
    taskBuckets: {
      ...buildBuckets(),
      all: [
        buildTask('Senior Athlete', '04/22/2026 09:00 AM', '2026'),
        buildTask('Junior Athlete', '04/22/2026 10:00 AM', '2027'),
        buildTask('Missing Grad', '04/22/2026 11:00 AM', ''),
      ],
    },
    sort: { key: 'gradYear', direction: 'desc' },
  });

  assert.deepEqual(
    rows.map((row) => row.task.athlete_name),
    ['Junior Athlete', 'Senior Athlete', 'Missing Grad'],
  );
});

test('all items can sort by call attempt with non-attempt rows last', () => {
  const rows = buildTaskBucketRows({
    filter: 'all',
    taskBuckets: {
      ...buildBuckets(),
      all: [
        buildTask('Meeting Athlete', '04/22/2026 09:00 AM', '2027', 'Confirmation Call'),
        buildTask('Attempt 3 Athlete', '04/22/2026 10:00 AM', '2027', 'Call Attempt 3'),
        buildTask('Attempt 1 Athlete', '04/22/2026 11:00 AM', '2027', 'Call Attempt 1'),
      ],
    },
    sort: { key: 'callAttempt', direction: 'asc' },
  });

  assert.deepEqual(
    rows.map((row) => row.task.athlete_name),
    ['Attempt 1 Athlete', 'Attempt 3 Athlete', 'Meeting Athlete'],
  );
});

test('sort keys compound in the provided order', () => {
  const rows = buildTaskBucketRows({
    filter: 'all',
    taskBuckets: {
      ...buildBuckets(),
      all: [
        buildTask('Attempt 2 Senior', '04/22/2026 09:00 AM', '2026', 'Call Attempt 2'),
        buildTask('Attempt 1 Junior', '04/22/2026 10:00 AM', '2027', 'Call Attempt 1'),
        buildTask('Attempt 1 Senior', '04/22/2026 11:00 AM', '2026', 'Call Attempt 1'),
        buildTask('Attempt 2 Junior', '04/22/2026 12:00 PM', '2027', 'Call Attempt 2'),
      ],
    },
    sort: [
      { key: 'callAttempt', direction: 'asc' },
      { key: 'gradYear', direction: 'asc' },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.task.athlete_name),
    ['Attempt 1 Senior', 'Attempt 1 Junior', 'Attempt 2 Senior', 'Attempt 2 Junior'],
  );
});

test('all page helpers expose stable 100-row windows', () => {
  assert.equal(getTaskPageOffset(0, 100), 0);
  assert.equal(getTaskPageOffset(2, 100), 200);
  assert.equal(buildTaskPageLabel(0, 100), '1-100');
  assert.equal(buildTaskPageLabel(2, 100), '201-300');
});
