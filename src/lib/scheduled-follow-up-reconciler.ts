import { LocalStorage } from '@raycast/api';
import type { ScoutAthleteTask } from '../features/scout-prep/types';
import { classifyCrmStage } from '../domain/scout-task-classifier';
import { getTaskSpecificUpdateVariant, isIncompleteTaskValue } from '../domain/scout-task-selection';
import type { AthleteTaskSummary } from '../types/athlete-workflows';
import { apiFetch } from './fastapi-client';
import { updateScoutPrepTask } from './scout-prep-task-update';

const STORAGE_KEY = 'scout-prep:pending-scheduled-follow-up-updates';
const STORAGE_VERSION = 1;
const MAX_ITEMS = 50;
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const SCHEDULED_FOLLOW_UP_TASK_TITLE = 'SCHEDULED FOLLOW-UP';

type StorageLike = Pick<typeof LocalStorage, 'getItem' | 'setItem'>;

export type PendingScheduledFollowUpStatus = 'pending' | 'applied' | 'expired' | 'failed';

export type PendingScheduledFollowUpUpdate = {
  id: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  sourceTaskId?: string | null;
  stageLabel: string;
  note: string;
  dueDate: string;
  dueTime: string;
  status: PendingScheduledFollowUpStatus;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  matchedTaskId?: string | null;
  appliedAt?: string | null;
};

type PersistedQueue = {
  version: number;
  updatedAt: string;
  items: PendingScheduledFollowUpUpdate[];
};

export type ScheduledFollowUpReconcileResult = {
  id: string;
  athleteName: string;
  status: 'waiting' | 'applied' | 'expired' | 'failed';
  taskId?: string | null;
  error?: string | null;
};

export async function fetchAthleteTasksForScheduledFollowUp(
  athleteId: string,
  athleteMainId: string,
): Promise<AthleteTaskSummary[]> {
  const response = await apiFetch('/tasks/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: String(athleteId),
      athlete_main_id: String(athleteMainId),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText.slice(0, 200) || `Tasks HTTP ${response.status}`);
  }

  const payload = (await response.json().catch(() => ({}))) as { tasks?: AthleteTaskSummary[] };
  return Array.isArray(payload.tasks) ? payload.tasks : [];
}

function normalizeText(value?: string | number | null): string {
  return String(value || '').trim();
}

function isPendingScheduledFollowUpUpdate(
  item?: Partial<PendingScheduledFollowUpUpdate> | null,
): item is PendingScheduledFollowUpUpdate {
  return Boolean(
    item &&
      normalizeText(item.id) &&
      normalizeText(item.athleteId) &&
      normalizeText(item.athleteMainId) &&
      normalizeText(item.athleteName) &&
      normalizeText(item.note) &&
      normalizeText(item.dueDate) &&
      normalizeText(item.dueTime) &&
      normalizeText(item.createdAt) &&
      normalizeText(item.expiresAt),
  );
}

async function readQueue(storage: StorageLike = LocalStorage): Promise<PendingScheduledFollowUpUpdate[]> {
  const raw = await storage.getItem<string>(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedQueue>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter(isPendingScheduledFollowUpUpdate);
  } catch {
    return [];
  }
}

async function writeQueue(
  items: PendingScheduledFollowUpUpdate[],
  storage: StorageLike = LocalStorage,
): Promise<void> {
  const queue: PersistedQueue = {
    version: STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    items: items.slice(0, MAX_ITEMS),
  };
  await storage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function isSpokeToNeedFollowUpStage(stageLabel?: string | null): boolean {
  return classifyCrmStage(stageLabel) === 'spoke_to_follow_up';
}

export async function listPendingScheduledFollowUpUpdates(
  storage: StorageLike = LocalStorage,
): Promise<PendingScheduledFollowUpUpdate[]> {
  return readQueue(storage);
}

export async function enqueuePendingScheduledFollowUpUpdate(
  input: {
    athleteId: string;
    athleteMainId: string;
    athleteName: string;
    sourceTaskId?: string | number | null;
    stageLabel: string;
    note: string;
    dueDate: string;
    dueTime: string;
    now?: Date;
    ttlMs?: number;
  },
  storage: StorageLike = LocalStorage,
): Promise<PendingScheduledFollowUpUpdate> {
  const athleteId = normalizeText(input.athleteId);
  const athleteMainId = normalizeText(input.athleteMainId);
  const athleteName = normalizeText(input.athleteName);
  const note = normalizeText(input.note);
  const dueDate = normalizeText(input.dueDate);
  const dueTime = normalizeText(input.dueTime);
  const stageLabel = normalizeText(input.stageLabel);
  if (!athleteId || !athleteMainId || !athleteName || !note || !dueDate || !dueTime) {
    throw new Error('Scheduled follow-up cache requires athlete IDs, note, and due date');
  }
  if (!isSpokeToNeedFollowUpStage(stageLabel)) {
    throw new Error('Scheduled follow-up cache only supports spoke-to follow-up stage');
  }

  const now = input.now || new Date();
  const id = `scheduled-follow-up:${athleteId}:${athleteMainId}`;
  const existing = await readQueue(storage);
  const previous = existing.find((item) => item.id === id);
  const item: PendingScheduledFollowUpUpdate = {
    ...(previous || {}),
    id,
    athleteId,
    athleteMainId,
    athleteName,
    sourceTaskId: normalizeText(input.sourceTaskId) || null,
    stageLabel,
    note,
    dueDate,
    dueTime,
    status: 'pending',
    createdAt: previous?.createdAt || now.toISOString(),
    expiresAt: new Date(now.getTime() + (input.ttlMs || DEFAULT_TTL_MS)).toISOString(),
    attempts: previous?.attempts || 0,
    lastCheckedAt: previous?.lastCheckedAt || null,
    lastError: null,
    matchedTaskId: previous?.matchedTaskId || null,
    appliedAt: null,
  };
  const next = [item, ...existing.filter((candidate) => candidate.id !== id)];
  await writeQueue(next, storage);
  return item;
}

export function findPendingSpokeToFollowUpTask(
  tasks: Array<Partial<ScoutAthleteTask> & Record<string, unknown>>,
): ScoutAthleteTask | null {
  const matches = tasks.filter(
    (task) =>
      isIncompleteTaskValue(task.completion_date as string | null | undefined) &&
      getTaskSpecificUpdateVariant(task) === 'spoke_to_follow_up' &&
      normalizeText(task.task_id as string | number | null),
  );
  if (!matches.length) return null;

  const selected = [...matches].sort((left, right) => {
    const leftId = Number.parseInt(normalizeText(left.task_id as string | number | null), 10) || -1;
    const rightId = Number.parseInt(normalizeText(right.task_id as string | number | null), 10) || -1;
    return rightId - leftId;
  })[0];

  return {
    task_id: normalizeText(selected.task_id as string | number | null),
    title: selected.title as string | null | undefined,
    assigned_owner: selected.assigned_owner as string | null | undefined,
    completion_date: selected.completion_date as string | null | undefined,
    description: selected.description as string | null | undefined,
  } as ScoutAthleteTask;
}

export async function reconcilePendingScheduledFollowUpUpdates(
  options: {
    storage?: StorageLike;
    fetchTasks?: typeof fetchAthleteTasksForScheduledFollowUp;
    updateTask?: typeof updateScoutPrepTask;
    now?: Date;
  } = {},
): Promise<ScheduledFollowUpReconcileResult[]> {
  const storage = options.storage || LocalStorage;
  const fetchTasks = options.fetchTasks || fetchAthleteTasksForScheduledFollowUp;
  const updateTask = options.updateTask || updateScoutPrepTask;
  const now = options.now || new Date();
  const items = await readQueue(storage);
  const results: ScheduledFollowUpReconcileResult[] = [];
  let changed = false;

  for (const item of items) {
    if (item.status !== 'pending') continue;
    item.attempts += 1;
    item.lastCheckedAt = now.toISOString();
    changed = true;

    if (Date.parse(item.expiresAt) < now.getTime()) {
      item.status = 'expired';
      item.lastError = 'Pending scheduled follow-up expired before Laravel task appeared';
      results.push({ id: item.id, athleteName: item.athleteName, status: 'expired' });
      continue;
    }

    try {
      const tasks = await fetchTasks(item.athleteId, item.athleteMainId);
      const targetTask = findPendingSpokeToFollowUpTask(tasks);
      if (!targetTask?.task_id) {
        results.push({ id: item.id, athleteName: item.athleteName, status: 'waiting' });
        continue;
      }

      await updateTask({
        taskId: targetTask.task_id,
        contactTask: item.athleteId,
        athleteMainId: item.athleteMainId,
        athleteName: item.athleteName,
        taskTitle: SCHEDULED_FOLLOW_UP_TASK_TITLE,
        description: item.note,
        dueDate: item.dueDate,
        dueTime: item.dueTime,
        assignedOwner: targetTask.assigned_owner || null,
      });

      item.status = 'applied';
      item.matchedTaskId = targetTask.task_id;
      item.appliedAt = now.toISOString();
      item.lastError = null;
      results.push({
        id: item.id,
        athleteName: item.athleteName,
        status: 'applied',
        taskId: targetTask.task_id,
      });
    } catch (error) {
      item.status = 'failed';
      item.lastError = error instanceof Error ? error.message : String(error);
      results.push({
        id: item.id,
        athleteName: item.athleteName,
        status: 'failed',
        error: item.lastError,
      });
    }
  }

  if (changed) {
    await writeQueue(items, storage);
  }
  return results;
}
