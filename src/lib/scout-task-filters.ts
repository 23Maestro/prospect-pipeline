import type { ScoutPortalTask } from '../features/scout-prep/types';

export type TaskListFilter = 'todayPastDue' | 'all' | 'today' | 'tomorrow' | 'future';
export type ScoutTaskRange = 'todayPastDue' | 'all' | 'today' | 'tomorrow' | 'future';
export type TaskListSortKey = 'gradYear' | 'callAttempt';
export type TaskListSortDirection = 'asc' | 'desc';

export type TaskListSort = {
  key: TaskListSortKey;
  direction: TaskListSortDirection;
} | null;

export type TaskBucketRow = {
  kind: 'task';
  task: ScoutPortalTask;
};

export function mapTaskListFilterToRange(filter: TaskListFilter): ScoutTaskRange {
  switch (filter) {
    case 'today':
      return 'today';
    case 'all':
      return 'all';
    case 'tomorrow':
      return 'tomorrow';
    case 'future':
      return 'future';
    case 'todayPastDue':
    default:
      return 'todayPastDue';
  }
}

export function getTaskSectionTitle(filter: TaskListFilter): string {
  switch (filter) {
    case 'today':
      return 'Today';
    case 'all':
      return 'All';
    case 'tomorrow':
      return 'Tomorrow';
    case 'future':
      return 'Future';
    case 'todayPastDue':
    default:
      return 'Today / Past Due';
  }
}

export function buildTaskBucketRows(args: {
  filter: TaskListFilter;
  taskBuckets: Record<ScoutTaskRange, ScoutPortalTask[]>;
  sort?: TaskListSort;
}): TaskBucketRow[] {
  const range = mapTaskListFilterToRange(args.filter);
  const tasks = args.sort
    ? sortScoutPrepTasks(args.taskBuckets[range] || [], args.sort)
    : args.taskBuckets[range] || [];
  return tasks.map((task) => ({ kind: 'task', task }) satisfies TaskBucketRow);
}

function parseGradYear(task: ScoutPortalTask): number | null {
  const parsed = Number.parseInt(String(task.grad_year || '').trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseCallAttempt(task: ScoutPortalTask): number | null {
  const raw = `${task.title || ''} ${task.description || ''}`.toLowerCase();
  const match = raw.match(/call\s+attempt\s+([123])/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function compareOptionalNumber(
  left: number | null,
  right: number | null,
  direction: TaskListSortDirection,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === 'asc' ? left - right : right - left;
}

export function sortScoutPrepTasks(
  tasks: ScoutPortalTask[],
  sort: Exclude<TaskListSort, null>,
): ScoutPortalTask[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const leftValue =
        sort.key === 'gradYear' ? parseGradYear(left.task) : parseCallAttempt(left.task);
      const rightValue =
        sort.key === 'gradYear' ? parseGradYear(right.task) : parseCallAttempt(right.task);
      return (
        compareOptionalNumber(leftValue, rightValue, sort.direction) || left.index - right.index
      );
    })
    .map((entry) => entry.task);
}
