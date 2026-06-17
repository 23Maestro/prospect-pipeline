import type { ScoutPortalTask, ScoutPrepContext } from '../features/scout-prep/types';
import type { VoicemailFollowUpVariant } from '../lib/scout-follow-up-templates';
import {
  getVoicemailFollowUpRecipients,
  type VoicemailFollowUpRecipient,
} from './scout-contact-selection';
import {
  isIncompleteTaskValue,
  isVoicemailLifecycleTaskMatch,
} from './scout-task-selection';

const BATCH_TASK_TITLE_ORDER = ['Call Attempt 3', 'Call Attempt 2'] as const;

export type ScoutPrepBatchOperation = {
  id:
    | 'call_attempt_2_voicemail'
    | 'call_attempt_3_voicemail'
    | 'not_interested_stage_completion'
    | 'confirmation_cleanup'
    | 'reschedule_pending_voicemail';
  kind:
    | 'voicemail'
    | 'sales_stage_task_completion'
    | 'confirmation_cleanup'
    | 'reschedule_voicemail';
  label: string;
  taskTitle?: string;
  variant?: VoicemailFollowUpVariant;
  stageLabel?: string;
};

export const SCOUT_PREP_BATCH_OPERATIONS = {
  callAttempt2Voicemail: {
    id: 'call_attempt_2_voicemail',
    kind: 'voicemail',
    label: 'Call Attempt 2 Voicemail',
    taskTitle: 'Call Attempt 2',
    variant: 'call_attempt_2',
  },
  callAttempt3Voicemail: {
    id: 'call_attempt_3_voicemail',
    kind: 'voicemail',
    label: 'Call Attempt 3 Voicemail',
    taskTitle: 'Call Attempt 3',
    variant: 'call_attempt_3',
  },
  notInterestedStageCompletion: {
    id: 'not_interested_stage_completion',
    kind: 'sales_stage_task_completion',
    label: 'No Interest + Complete',
    stageLabel: 'Spoke to - Not Interested',
  },
  confirmationCleanup: {
    id: 'confirmation_cleanup',
    kind: 'confirmation_cleanup',
    label: 'Confirmation Clean Up',
    taskTitle: 'Confirmation Call',
  },
  reschedulePendingVoicemail: {
    id: 'reschedule_pending_voicemail',
    kind: 'reschedule_voicemail',
    label: 'Reschedule Pending',
    taskTitle: 'Reschedule Pending',
    variant: 'reschedule_1',
  },
} satisfies Record<string, ScoutPrepBatchOperation>;

export type ScoutPrepBatchRowStatus = 'pending' | 'sending' | 'sent' | 'skipped' | 'failed';

export type ScoutPrepBatchRow = {
  task: ScoutPortalTask;
  operation: ScoutPrepBatchOperation;
  status: ScoutPrepBatchRowStatus;
  recipient?: VoicemailFollowUpRecipient | null;
  message?: string | null;
  review?: {
    previousMeetingLabel?: string | null;
    previousCoachName?: string | null;
    slotLabels?: string[];
    cleanupAction?: 'complete' | 'move';
    cleanupLabel?: string | null;
  } | null;
};

export function normalizeScoutPrepBatchTaskId(value?: string | number | null): string {
  return String(value || '').trim();
}

export type BatchRecipientResolution =
  | {
      status: 'eligible';
      recipient: VoicemailFollowUpRecipient;
      message?: string | null;
    }
  | {
      status: 'skipped';
      recipient?: null;
      message: string;
    };

export function resolveBatchVoicemailRecipient(
  context: ScoutPrepContext,
): BatchRecipientResolution {
  const individualRecipients = getVoicemailFollowUpRecipients(context).filter(
    (recipient) => recipient.id !== 'groupAll' && recipient.phones.length === 1,
  );

  if (individualRecipients.length === 1) {
    return {
      status: 'eligible',
      recipient: individualRecipients[0],
    };
  }

  const parentOne = individualRecipients.find((recipient) => recipient.id === 'parent1');
  if (parentOne) {
    return {
      status: 'eligible',
      recipient: parentOne,
      message: 'Parent 1 default',
    };
  }

  return {
    status: 'skipped',
    message: 'No Parent 1 default or single deterministic recipient',
  };
}

export function isScoutPrepBatchTaskEligible(
  task: Pick<ScoutPortalTask, 'title' | 'description' | 'completion_date'>,
  operation: ScoutPrepBatchOperation,
): boolean {
  if (!isIncompleteTaskValue(task.completion_date)) {
    return false;
  }
  if (operation.kind === 'sales_stage_task_completion') {
    return isNoInterestCompletionTaskVariant(task);
  }
  if (operation.kind === 'confirmation_cleanup') {
    return isConfirmationCleanupTaskVariant(task);
  }
  if (operation.kind === 'reschedule_voicemail') {
    return normalizeBatchTaskText(task).includes('reschedule pending');
  }
  return Boolean(operation.variant && isVoicemailLifecycleTaskMatch(task, operation.variant));
}

function normalizeBatchTaskText(task: Pick<ScoutPortalTask, 'title' | 'description'>): string {
  return [task.title, task.description]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
    .replace(/^\(?sc move this task\)?\s*/i, '')
    .replace(/[._–—-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMeetingSetTaskVariant(task: Pick<ScoutPortalTask, 'title' | 'description'>): boolean {
  const text = normalizeBatchTaskText(task);
  return (
    text.includes('meeting set') ||
    text.includes('confirm the meeting') ||
    text.includes('confirmation call') ||
    text.includes('reschedule pending') ||
    text.includes('rescheduled pending') ||
    text.includes('res pending') ||
    text.includes('rescheduled') ||
    text.includes('meeting result')
  );
}

function isConfirmationCleanupTaskVariant(
  task: Pick<ScoutPortalTask, 'title' | 'description'>,
): boolean {
  const text = normalizeBatchTaskText(task);
  return text.includes('confirmation call') || text.includes('confirm the meeting set');
}

function getNoInterestCompletionTaskTitle(
  task: Pick<ScoutPortalTask, 'title' | 'description'>,
): (typeof BATCH_TASK_TITLE_ORDER)[number] | null {
  const text = normalizeBatchTaskText(task);
  if (isMeetingSetTaskVariant(task)) return null;
  if (text.includes('call attempt 3')) return 'Call Attempt 3';
  if (text.includes('call attempt 2')) return 'Call Attempt 2';
  return null;
}

function isNoInterestCompletionTaskVariant(
  task: Pick<ScoutPortalTask, 'title' | 'description'>,
): boolean {
  return Boolean(getNoInterestCompletionTaskTitle(task));
}

function parseGradYear(task: Pick<ScoutPortalTask, 'grad_year'>): number | null {
  const parsed = Number.parseInt(String(task.grad_year || '').trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function sortScoutPrepBatchTasks<T extends ScoutPortalTask>(tasks: T[]): T[] {
  return [...tasks].sort((left, right) => {
    const leftGradYear = parseGradYear(left);
    const rightGradYear = parseGradYear(right);
    if (leftGradYear !== null && rightGradYear !== null && leftGradYear !== rightGradYear) {
      return rightGradYear - leftGradYear;
    }
    if (leftGradYear !== null && rightGradYear === null) return -1;
    if (leftGradYear === null && rightGradYear !== null) return 1;
    return String(left.athlete_name || '').localeCompare(String(right.athlete_name || ''));
  });
}

export function getScoutPrepBatchGradYearOptions(tasks: ScoutPortalTask[]): string[] {
  return Array.from(
    new Set(
      tasks
        .map((task) => String(task.grad_year || '').trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => Number.parseInt(right, 10) - Number.parseInt(left, 10));
}

export function getScoutPrepBatchTaskTitleOptions(tasks: ScoutPortalTask[]): string[] {
  const available = new Set(
    tasks
      .filter((task) => isIncompleteTaskValue(task.completion_date))
      .map((task) => getNoInterestCompletionTaskTitle(task))
      .filter((title): title is (typeof BATCH_TASK_TITLE_ORDER)[number] => Boolean(title)),
  );
  return BATCH_TASK_TITLE_ORDER.filter((title) => available.has(title));
}

export function collectFailedScoutPrepBatchTaskIdsFromLogText(logText: string): Set<string> {
  const failedTaskIds = new Set<string>();
  const marker = 'SCOUT_PREP_BATCH_ROW_RUN {';
  let index = 0;

  while (index < logText.length) {
    const markerIndex = logText.indexOf(marker, index);
    if (markerIndex < 0) break;
    const jsonStart = logText.indexOf('{', markerIndex);
    if (jsonStart < 0) break;
    const nextEntry = logText.indexOf('\n[', jsonStart);
    const jsonText = logText.slice(jsonStart, nextEntry < 0 ? undefined : nextEntry).trim();
    index = nextEntry < 0 ? logText.length : nextEntry + 1;

    try {
      const parsed = JSON.parse(jsonText) as {
        event?: string;
        status?: string;
        context?: {
          taskId?: string | number | null;
          status?: string | null;
          resultStatus?: string | null;
        };
      };
      if (parsed.event !== 'SCOUT_PREP_BATCH_ROW_RUN') continue;
      const topStatus = String(parsed.status || '').trim().toLowerCase();
      const rowStatus = String(parsed.context?.resultStatus || parsed.context?.status || '')
        .trim()
        .toLowerCase();
      const taskId = normalizeScoutPrepBatchTaskId(parsed.context?.taskId);
      if (!taskId) continue;
      if (topStatus === 'failure' || rowStatus === 'failed') {
        failedTaskIds.add(taskId);
      } else if (rowStatus === 'sent') {
        failedTaskIds.delete(taskId);
      }
    } catch {
      continue;
    }
  }

  return failedTaskIds;
}

export function isScoutPrepConfirmationCleanupDue(args: {
  taskDueAt?: Date | string | null;
  now?: Date;
}): boolean {
  const taskDueAt =
    args.taskDueAt instanceof Date
      ? args.taskDueAt
      : args.taskDueAt
        ? new Date(args.taskDueAt)
        : null;
  if (!taskDueAt || Number.isNaN(taskDueAt.getTime())) {
    return false;
  }
  return taskDueAt.getTime() < (args.now || new Date()).getTime();
}

export function buildScoutPrepBatchPreflightRows(args: {
  operation: ScoutPrepBatchOperation;
  tasks: ScoutPortalTask[];
  limit: number;
  gradYear?: string | null;
  taskTitle?: string | null;
  excludedTaskIds?: Iterable<string | number | null | undefined>;
}): ScoutPrepBatchRow[] {
  const limit = Math.max(1, args.limit);
  const gradYear = String(args.gradYear || '').trim();
  const taskTitle = String(args.taskTitle || '').trim();
  const excludedTaskIds = new Set(
    Array.from(args.excludedTaskIds || [])
      .map((taskId) => normalizeScoutPrepBatchTaskId(taskId))
      .filter(Boolean),
  );
  const filteredTasks = args.tasks.filter((task) => {
    const canonicalTaskId = normalizeScoutPrepBatchTaskId(task.task_id);
    if (canonicalTaskId && excludedTaskIds.has(canonicalTaskId)) return false;
    if (gradYear && String(task.grad_year || '').trim() !== gradYear) return false;
    if (taskTitle && getNoInterestCompletionTaskTitle(task) !== taskTitle) return false;
    return true;
  });
  return sortScoutPrepBatchTasks(filteredTasks).slice(0, limit).map((task) => {
    const eligible = isScoutPrepBatchTaskEligible(task, args.operation);
    return {
      task,
      operation: args.operation,
      status: eligible ? 'pending' : 'skipped',
      message: eligible ? null : `Not an incomplete ${args.operation.taskTitle || 'task'}`,
    };
  });
}

function isNonBlockingVoicemailSendFailure(operation: ScoutPrepBatchOperation): boolean {
  return (
    operation.id === 'call_attempt_2_voicemail' ||
    operation.id === 'call_attempt_3_voicemail'
  );
}

function buildManualSmsNeededMessage(args: {
  recipient: VoicemailFollowUpRecipient;
  message: string;
  error: unknown;
}): string {
  const phone = args.recipient.phones[0] || 'recipient';
  const errorMessage = args.error instanceof Error ? args.error.message : String(args.error);
  return [`Manual SMS needed for ${phone}: ${errorMessage}`, '', args.message].join('\n');
}

export async function runScoutPrepBatchRow(args: {
  row: ScoutPrepBatchRow;
  context: ScoutPrepContext;
  resolveRecipient?: (context: ScoutPrepContext) => BatchRecipientResolution;
  buildMessage: (
    recipient: VoicemailFollowUpRecipient,
    context: ScoutPrepContext,
  ) => string | Promise<string>;
  sendMessage: (recipient: VoicemailFollowUpRecipient, message: string) => Promise<void>;
  persistMessageSent: () => Promise<void>;
}): Promise<ScoutPrepBatchRow> {
  if (args.row.status === 'skipped') {
    return args.row;
  }

  const recipientResolution = (args.resolveRecipient || resolveBatchVoicemailRecipient)(
    args.context,
  );
  if (recipientResolution.status === 'skipped') {
    return {
      ...args.row,
      status: 'skipped',
      recipient: null,
      message: recipientResolution.message,
    };
  }

  try {
    const message = await args.buildMessage(recipientResolution.recipient, args.context);
    let nonBlockingSendFailureMessage: string | null = null;
    try {
      await args.sendMessage(recipientResolution.recipient, message);
    } catch (sendError) {
      if (!isNonBlockingVoicemailSendFailure(args.row.operation)) {
        throw sendError;
      }
      nonBlockingSendFailureMessage = buildManualSmsNeededMessage({
        recipient: recipientResolution.recipient,
        message,
        error: sendError,
      });
    }
    await args.persistMessageSent();
    return {
      ...args.row,
      status: 'sent',
      recipient: recipientResolution.recipient,
      message: nonBlockingSendFailureMessage || recipientResolution.message || 'Sent',
    };
  } catch (error) {
    return {
      ...args.row,
      status: 'failed',
      recipient: recipientResolution.recipient,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
