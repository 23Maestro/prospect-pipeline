import type { ScoutPortalTask } from '../features/scout-prep/types';

export type TaskListFilter = 'all' | 'today' | 'tomorrow' | 'future';
export type ScoutTaskRange = 'todayPastDue' | 'today' | 'tomorrow' | 'future';

export type TaskBucketRow = {
  kind: 'task';
  task: ScoutPortalTask;
};

export function mapTaskListFilterToRange(filter: TaskListFilter): ScoutTaskRange {
  switch (filter) {
    case 'today':
      return 'today';
    case 'tomorrow':
      return 'tomorrow';
    case 'future':
      return 'future';
    case 'all':
    default:
      return 'todayPastDue';
  }
}

export function getTaskSectionTitle(filter: TaskListFilter): string {
  switch (filter) {
    case 'today':
      return 'Today';
    case 'tomorrow':
      return 'Tomorrow';
    case 'future':
      return 'Future';
    case 'all':
    default:
      return 'Today / Past Due';
  }
}

export function buildTaskBucketRows(args: {
  filter: TaskListFilter;
  taskBuckets: Record<ScoutTaskRange, ScoutPortalTask[]>;
}): TaskBucketRow[] {
  const range = mapTaskListFilterToRange(args.filter);
  return (args.taskBuckets[range] || []).map(
    (task) => ({ kind: 'task', task }) satisfies TaskBucketRow,
  );
}
