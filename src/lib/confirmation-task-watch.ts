import fs from 'node:fs';
import path from 'node:path';

export type ConfirmationTaskWatchStatus = 'watching' | 'updated' | 'expired' | 'failed';

export type ConfirmationTaskWatchItem = {
  id: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  appointmentId: string;
  meetingStartsAt: string;
  meetingTimezone?: string | null;
  headScout?: string | null;
  status: ConfirmationTaskWatchStatus;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  confirmationTaskId?: string | null;
  updatedDueDate?: string | null;
  updatedDueTime?: string | null;
  source?: string | null;
};

export type ConfirmationTaskWatchQueue = {
  version: 1;
  updatedAt: string;
  items: ConfirmationTaskWatchItem[];
};

export type ConfirmationTaskLike = {
  task_id?: string | number | null;
  title?: string | null;
  description?: string | null;
  due_date?: string | null;
  completion_date?: string | null;
};

const DEFAULT_QUEUE_PATH = '/Users/singleton23/raycast_logs/confirmation-task-watch.json';
const DEFAULT_TTL_MINUTES = 90;

function normalizeText(value?: string | number | null): string {
  return String(value || '').trim();
}

function normalizeKey(value?: string | number | null): string {
  return normalizeText(value).toLowerCase();
}

function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function getConfirmationTaskWatchQueuePath(): string {
  return process.env.CONFIRMATION_TASK_WATCH_QUEUE || DEFAULT_QUEUE_PATH;
}

export function readConfirmationTaskWatchQueue(
  filePath: string = getConfirmationTaskWatchQueuePath(),
): ConfirmationTaskWatchQueue {
  if (!fs.existsSync(filePath)) {
    return { version: 1, updatedAt: new Date().toISOString(), items: [] };
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ConfirmationTaskWatchQueue>;
  return {
    version: 1,
    updatedAt: normalizeText(parsed.updatedAt) || new Date().toISOString(),
    items: Array.isArray(parsed.items) ? parsed.items : [],
  };
}

export function writeConfirmationTaskWatchQueue(
  queue: ConfirmationTaskWatchQueue,
  filePath: string = getConfirmationTaskWatchQueuePath(),
): void {
  ensureParentDirectory(filePath);
  const nextQueue: ConfirmationTaskWatchQueue = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: queue.items,
  };
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(nextQueue, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

export function isConfirmationTaskLike(task?: ConfirmationTaskLike | null): boolean {
  const title = normalizeKey(task?.title);
  const description = normalizeKey(task?.description);
  return title.includes('confirmation call') || description.includes('confirm the meeting set');
}

export function findIncompleteConfirmationTask(
  tasks: ConfirmationTaskLike[],
): ConfirmationTaskLike | null {
  const matches = tasks.filter(
    (task) => isConfirmationTaskLike(task) && !normalizeText(task.completion_date),
  );
  if (!matches.length) return null;

  return [...matches].sort((left, right) => {
    const rightId = Number.parseInt(normalizeText(right.task_id) || '0', 10);
    const leftId = Number.parseInt(normalizeText(left.task_id) || '0', 10);
    return rightId - leftId;
  })[0] || null;
}

export function buildConfirmationTaskMorningDue(meetingStartsAt: string | Date): {
  dueDate: string;
  dueTime: string;
  dueAt: Date;
} {
  const parsed = meetingStartsAt instanceof Date ? meetingStartsAt : new Date(meetingStartsAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid meeting start for confirmation watcher');
  }
  const dueAt = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    9,
    0,
    0,
    0,
  );
  const month = String(dueAt.getMonth() + 1).padStart(2, '0');
  const day = String(dueAt.getDate()).padStart(2, '0');
  return {
    dueDate: `${month}/${day}/${dueAt.getFullYear()}`,
    dueTime: '09:00',
    dueAt,
  };
}

export function upsertConfirmationTaskWatchItem(
  input: {
    athleteId: string;
    athleteMainId: string;
    athleteName: string;
    appointmentId: string;
    meetingStartsAt: string;
    meetingTimezone?: string | null;
    headScout?: string | null;
    source?: string | null;
    now?: Date;
    ttlMinutes?: number;
  },
  filePath: string = getConfirmationTaskWatchQueuePath(),
): ConfirmationTaskWatchItem {
  const now = input.now || new Date();
  const athleteId = normalizeText(input.athleteId);
  const athleteMainId = normalizeText(input.athleteMainId);
  const appointmentId = normalizeText(input.appointmentId);
  const meetingStartsAt = normalizeText(input.meetingStartsAt);
  if (!athleteId || !athleteMainId || !appointmentId || !meetingStartsAt) {
    throw new Error('Confirmation watcher requires athlete IDs, appointment ID, and meeting start');
  }

  const expiresAt = new Date(
    now.getTime() + (input.ttlMinutes || DEFAULT_TTL_MINUTES) * 60 * 1000,
  ).toISOString();
  const id = `confirmation-task:${athleteId}:${athleteMainId}:${appointmentId}`;
  const queue = readConfirmationTaskWatchQueue(filePath);
  const existingIndex = queue.items.findIndex((item) => item.id === id);
  const existing = existingIndex >= 0 ? queue.items[existingIndex] : null;
  const item: ConfirmationTaskWatchItem = {
    ...(existing || {}),
    id,
    athleteId,
    athleteMainId,
    athleteName: normalizeText(input.athleteName),
    appointmentId,
    meetingStartsAt,
    meetingTimezone: input.meetingTimezone || null,
    headScout: input.headScout || null,
    status: 'watching',
    createdAt: existing?.createdAt || now.toISOString(),
    expiresAt,
    attempts: existing?.attempts || 0,
    lastCheckedAt: existing?.lastCheckedAt || null,
    lastError: null,
    confirmationTaskId: existing?.confirmationTaskId || null,
    updatedDueDate: existing?.updatedDueDate || null,
    updatedDueTime: existing?.updatedDueTime || null,
    source: input.source || 'raycast_meeting_set',
  };

  if (existingIndex >= 0) {
    queue.items[existingIndex] = item;
  } else {
    queue.items.push(item);
  }
  writeConfirmationTaskWatchQueue(queue, filePath);
  return item;
}

