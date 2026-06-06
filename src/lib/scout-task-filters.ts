import type { ScoutPortalTask } from '../features/scout-prep/types';

export type TaskListFilter = 'todayPastDue' | 'all' | 'tomorrow' | 'future';
export type ScoutTaskRange = 'todayPastDue' | 'all' | 'tomorrow' | 'future';
export type TaskListSortKey = 'gradYear' | 'callAttempt';
export type TaskListSortDirection = 'asc' | 'desc';

export type TaskListSortRule = {
  key: TaskListSortKey;
  direction: TaskListSortDirection;
};

export type TaskListSort = TaskListSortRule | TaskListSortRule[] | null;

export type TaskBucketRow = {
  kind: 'task';
  task: ScoutPortalTask;
};

export const TASK_LIST_PAGE_SIZE = 100;

export function getTaskPageOffset(pageIndex: number, pageSize = TASK_LIST_PAGE_SIZE): number {
  return Math.max(pageIndex, 0) * pageSize;
}

export function buildTaskPageLabel(pageIndex: number, pageSize = TASK_LIST_PAGE_SIZE): string {
  const start = getTaskPageOffset(pageIndex, pageSize) + 1;
  return `${start}-${start + pageSize - 1}`;
}

export function mapTaskListFilterToRange(filter: TaskListFilter): ScoutTaskRange {
  switch (filter) {
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
  const sourceTasks = filterVisibleTaskBucketTasks(args.taskBuckets[range] || [], range);
  const tasks = hasTaskListSort(args.sort)
    ? sortScoutPrepTasks(sourceTasks, args.sort)
    : sourceTasks;
  return tasks.map((task) => ({ kind: 'task', task }) satisfies TaskBucketRow);
}

function filterVisibleTaskBucketTasks(tasks: ScoutPortalTask[], range: ScoutTaskRange): ScoutPortalTask[] {
  if (range !== 'todayPastDue') return tasks;
  return tasks.filter((task) => String(task.title || '').trim().toLowerCase() !== 'repeat');
}

function normalizeTaskListSort(sort?: TaskListSort): TaskListSortRule[] {
  if (!sort) return [];
  return Array.isArray(sort) ? sort : [sort];
}

function hasTaskListSort(sort?: TaskListSort): boolean {
  return normalizeTaskListSort(sort).length > 0;
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
  const sortRules = normalizeTaskListSort(sort);
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      for (const sortRule of sortRules) {
        const leftValue =
          sortRule.key === 'gradYear' ? parseGradYear(left.task) : parseCallAttempt(left.task);
        const rightValue =
          sortRule.key === 'gradYear' ? parseGradYear(right.task) : parseCallAttempt(right.task);
        const comparison = compareOptionalNumber(leftValue, rightValue, sortRule.direction);
        if (comparison !== 0) {
          return comparison;
        }
      }

      return left.index - right.index;
    })
    .map((entry) => entry.task);
}
