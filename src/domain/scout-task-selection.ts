import type { ScoutAthleteTask, ScoutPortalTask } from '../features/scout-prep/types';
import { isActiveOperatorTaskAssignedOwner } from './owners';
import {
  classifyPostCallActivityStage,
  getSalesStageLabelForVoicemailVariant,
} from './sales-stage-contract';
import type { VoicemailFollowUpVariant } from '../lib/scout-follow-up-templates';

export type ScoutTaskInput = Partial<ScoutAthleteTask> &
  Partial<ScoutPortalTask> &
  Record<string, unknown>;

function taskId(task?: ScoutTaskInput | null): string {
  return String(task?.task_id || '').trim();
}

function asScoutAthleteTask(task: ScoutTaskInput): ScoutAthleteTask {
  return {
    task_id: taskId(task),
    title: task.title,
    assigned_owner: task.assigned_owner,
    due_date: task.due_date,
    completion_date: task.completion_date,
    description: task.description,
    row_text: task.row_text,
  } as ScoutAthleteTask;
}

function sortNewestTaskIdFirst<T extends ScoutTaskInput>(tasks: T[]): T[] {
  return [...tasks].sort((left, right) => {
    const leftId = taskId(left);
    const rightId = taskId(right);
    const leftNum = /^\d+$/.test(leftId) ? Number.parseInt(leftId, 10) : -1;
    const rightNum = /^\d+$/.test(rightId) ? Number.parseInt(rightId, 10) : -1;
    return rightNum - leftNum || rightId.localeCompare(leftId);
  });
}

export function isIncompleteTaskValue(value?: string | null): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return (
    !normalized ||
    normalized === '-' ||
    normalized === '--' ||
    normalized === 'n/a' ||
    normalized === 'not completed' ||
    normalized === 'incomplete'
  );
}

export function stripMoveThisTaskPrefix(taskTitle?: string | null): string | null {
  const trimmed = String(taskTitle || '').trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/^\(SC Move This Task\)\s*/i, '').trim();
  return cleaned || trimmed;
}

export function getIncompleteTasks<T extends ScoutTaskInput>(tasks: T[] = []): T[] {
  return sortNewestTaskIdFirst(
    tasks.filter((task) => isIncompleteTaskValue(task.completion_date) && taskId(task)),
  );
}

export function getTopmostIncompleteTask<T extends ScoutTaskInput>(tasks: T[] = []): T | null {
  return tasks.find((task) => isIncompleteTaskValue(task.completion_date) && taskId(task)) || null;
}

export function findNewestIncompleteTaskByTitle<T extends ScoutTaskInput>(
  tasks: T[] = [],
  taskTitle: string,
): T | null {
  const normalizedTarget = String(taskTitle || '')
    .trim()
    .toLowerCase();
  if (!normalizedTarget) {
    return null;
  }
  return (
    getIncompleteTasks(tasks).find(
      (candidate) =>
        (stripMoveThisTaskPrefix(candidate.title) || '').trim().toLowerCase() === normalizedTarget,
    ) || null
  );
}

export function isConfirmationCallTask(task?: ScoutTaskInput | null): boolean {
  const title = String(task?.title || '')
    .trim()
    .toLowerCase();
  const description = String(task?.description || '')
    .trim()
    .toLowerCase();
  return title.includes('confirmation call') || description.includes('confirm the meeting set');
}

export function findNewestIncompleteConfirmationTask(
  tasks: ScoutTaskInput[] = [],
): ScoutAthleteTask | null {
  const task = getIncompleteTasks(tasks).find((candidate) => isConfirmationCallTask(candidate));
  return task ? asScoutAthleteTask(task) : null;
}

export function isFollowUpScoutTask(task?: ScoutTaskInput | null): boolean {
  const title = String(task?.title || '')
    .trim()
    .toLowerCase();
  const description = String(task?.description || '')
    .trim()
    .toLowerCase();
  const owner = String(task?.assigned_owner || '').trim();
  return (
    isIncompleteTaskValue(task?.completion_date) &&
    isActiveOperatorTaskAssignedOwner(owner) &&
    (title.startsWith('call attempt') || description.includes('call the family'))
  );
}

export function findNewestIncompleteFollowUpTask(
  tasks: ScoutTaskInput[] = [],
): ScoutAthleteTask | null {
  const task = sortNewestTaskIdFirst(
    tasks.filter((candidate) => isFollowUpScoutTask(candidate)),
  )[0];
  return task ? asScoutAthleteTask(task) : null;
}

function normalizeTaskMatchText(
  task: Pick<ScoutTaskInput, 'title' | 'description' | 'row_text'>,
): string {
  return [task.title, task.description, task.row_text]
    .map((value) =>
      String(value || '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
    .join(' ');
}

function isNoShowTaskMatch(
  task: Pick<ScoutTaskInput, 'title' | 'description' | 'row_text'>,
): boolean {
  const text = normalizeTaskMatchText(task).replace(/[-_]+/g, ' ');
  return /\bno\s*show\b/.test(text) || /\bnoshow\b/.test(text);
}

export function isVoicemailLifecycleTaskMatch(
  task: Pick<ScoutTaskInput, 'title' | 'description'>,
  variant: VoicemailFollowUpVariant,
): boolean {
  const title = (stripMoveThisTaskPrefix(task.title) || '')
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
  const description = String(task.description || '')
    .trim()
    .toLowerCase();

  if (variant === 'call_attempt_1') {
    return title === 'call attempt 1' || description.includes('first time');
  }
  if (variant === 'call_attempt_2') {
    return (
      title === 'call attempt 2' ||
      (title === 'scheduled follow up' && description.includes('second time')) ||
      description.includes('second time')
    );
  }
  if (variant === 'call_attempt_3') {
    return title === 'call attempt 3' || description.includes('third time');
  }
  if (variant === 'reschedule_pending') {
    return title === 'reschedule pending';
  }

  return false;
}

export function getVoicemailLifecycleTaskTitle(variant: VoicemailFollowUpVariant): string | null {
  if (variant === 'call_attempt_1') return 'Call Attempt 1';
  if (variant === 'call_attempt_2') return 'Call Attempt 2';
  if (variant === 'call_attempt_3') return 'Call Attempt 3';
  if (variant === 'reschedule_pending') return 'Reschedule Pending';
  if (variant === 'no_show') return 'No Show';
  return null;
}

export function getVoicemailLifecycleStageLabel(variant: VoicemailFollowUpVariant): string | null {
  return getSalesStageLabelForVoicemailVariant(variant);
}

export function resolveVoicemailLifecycleTaskForCompletion(
  tasks: ScoutTaskInput[] = [],
  variant: VoicemailFollowUpVariant,
): ScoutAthleteTask | null {
  if (variant === 'no_show') {
    const task = getIncompleteTasks(tasks).find((candidate) => isNoShowTaskMatch(candidate));
    return task ? asScoutAthleteTask(task) : null;
  }

  const expectedTaskTitle = getVoicemailLifecycleTaskTitle(variant);
  const matchedTask =
    (expectedTaskTitle ? findNewestIncompleteTaskByTitle(tasks, expectedTaskTitle) : null) ||
    getIncompleteTasks(tasks).find((candidate) =>
      isVoicemailLifecycleTaskMatch(candidate, variant),
    ) ||
    null;
  if (matchedTask) {
    return asScoutAthleteTask(matchedTask);
  }

  if (
    variant === 'call_attempt_1' ||
    variant === 'call_attempt_2' ||
    variant === 'call_attempt_3'
  ) {
    const fallback = getTopmostIncompleteTask(tasks);
    return fallback ? asScoutAthleteTask(fallback) : null;
  }

  return null;
}

function normalizePostCallTaskText(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\(?sc move this task\)?\s*/i, '')
    .replace(/[-_–—]+/g, ' ')
    .replace(/[.,:]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function isBroadPostCallTaskMatch(task: ScoutTaskInput, stageLabel: string): boolean {
  const text = normalizePostCallTaskText(
    [task.title, task.description, task.row_text].filter(Boolean).join(' '),
  );
  const stage = normalizePostCallTaskText(stageLabel);
  if (!text || !stage) return false;
  if (text.includes(stage)) return true;
  if (stage.includes('follow up')) {
    return (
      text.includes('scheduled follow up') ||
      text.includes('need to follow up') ||
      text.includes('follow up')
    );
  }
  if (stage.includes('athlete not parent')) return text.includes('athlete not parent');
  if (stage.includes('not interested')) return text.includes('not interested');
  if (stage.includes('too young')) return text.includes('too young');
  if (stage.includes('unable to leave vm')) {
    return text.includes('unable to leave vm') || text.includes('unable to leave voicemail');
  }
  return false;
}

function voicemailTaskTitle(variant?: string | null): string | null {
  if (variant === 'call_attempt_1') return 'Call Attempt 1';
  if (variant === 'call_attempt_2') return 'Call Attempt 2';
  if (variant === 'call_attempt_3') return 'Call Attempt 3';
  return null;
}

export function resolvePostCallTaskToComplete<T extends ScoutTaskInput>(
  tasks: T[] = [],
  stageLabel: string,
): T | null {
  const classification = classifyPostCallActivityStage(stageLabel);
  if (!classification?.completesPostCallTask) return null;
  const incompleteTasks = getIncompleteTasks(tasks);
  const expectedVoicemailTitle = voicemailTaskTitle(classification.voicemailVariant);
  if (expectedVoicemailTitle) {
    const normalizedTitle = expectedVoicemailTitle.toLowerCase();
    return (
      incompleteTasks.find(
        (task) => (stripMoveThisTaskPrefix(task.title) || '').toLowerCase() === normalizedTitle,
      ) ||
      incompleteTasks[0] ||
      null
    );
  }
  return (
    incompleteTasks.find((task) => isBroadPostCallTaskMatch(task, stageLabel)) ||
    incompleteTasks[0] ||
    null
  );
}
