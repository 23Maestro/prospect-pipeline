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

export type ScoutPrepBatchOperation = {
  id: 'call_attempt_2_voicemail' | 'call_attempt_3_voicemail' | 'not_interested_stage_completion';
  kind: 'voicemail' | 'sales_stage_task_completion';
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
} satisfies Record<string, ScoutPrepBatchOperation>;

export type ScoutPrepBatchRowStatus = 'pending' | 'sending' | 'sent' | 'skipped' | 'failed';

export type ScoutPrepBatchRow = {
  task: ScoutPortalTask;
  operation: ScoutPrepBatchOperation;
  status: ScoutPrepBatchRowStatus;
  recipient?: VoicemailFollowUpRecipient | null;
  message?: string | null;
};

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
    return !isMeetingSetTaskVariant(task);
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

export function buildScoutPrepBatchPreflightRows(args: {
  operation: ScoutPrepBatchOperation;
  tasks: ScoutPortalTask[];
  limit: number;
  gradYear?: string | null;
}): ScoutPrepBatchRow[] {
  const limit = Math.max(1, args.limit);
  const gradYear = String(args.gradYear || '').trim();
  const filteredTasks = gradYear
    ? args.tasks.filter((task) => String(task.grad_year || '').trim() === gradYear)
    : args.tasks;
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
    await args.sendMessage(recipientResolution.recipient, message);
    await args.persistMessageSent();
    return {
      ...args.row,
      status: 'sent',
      recipient: recipientResolution.recipient,
      message: recipientResolution.message || 'Sent',
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
