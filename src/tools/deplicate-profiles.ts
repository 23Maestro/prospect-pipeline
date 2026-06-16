import { Tool, Toast, showToast } from '@raycast/api';
import { searchLogger } from '../lib/logger';
import {
  runDuplicateProfileResolutionForTask,
  summarizeDuplicateProfileResolutionToast,
} from '../lib/scout-duplicate-profiles';
import { fetchScoutPortalTaskBuckets } from '../lib/scout-prep';
import {
  SCOUT_PREP_DUPLICATE_CHECK_BATCH_LIMIT,
  buildTodayPastDueDuplicateCheckBatchTasks,
} from '../lib/scout-task-filters';

type Input = {
  limit?: number;
  contactId?: string;
  athleteMainId?: string;
  athleteId?: string;
  athleteName?: string;
  taskId?: string;
  taskTitle?: string;
  taskDescription?: string;
  completionDate?: string;
  assignedOwner?: string;
  gradYear?: string;
  sport?: string;
  highSchool?: string;
  city?: string;
  state?: string;
  athleteAdminUrl?: string;
  athleteProfileUrl?: string;
  athleteTaskUrl?: string;
};

const FEATURE = 'tool.scout-duplicate-profiles';

function logInfo(
  event: string,
  step: string,
  status: 'start' | 'success',
  context?: Record<string, unknown>,
) {
  searchLogger.info(event, {
    event,
    step,
    status,
    feature: FEATURE,
    context: context || {},
  });
}

function logFailure(event: string, step: string, error: string, context?: Record<string, unknown>) {
  searchLogger.error(event, {
    event,
    step,
    status: 'failure',
    feature: FEATURE,
    error,
    context: context || {},
  });
}

function resolveBatchLimit(input: Input): number {
  const parsed = Number.parseInt(String(input.limit || SCOUT_PREP_DUPLICATE_CHECK_BATCH_LIMIT), 10);
  if (Number.isNaN(parsed)) {
    return SCOUT_PREP_DUPLICATE_CHECK_BATCH_LIMIT;
  }
  return Math.max(1, Math.min(parsed, SCOUT_PREP_DUPLICATE_CHECK_BATCH_LIMIT));
}

async function showDuplicateSummaryToast(args: {
  title: 'No duplicate' | 'Review duplicate' | 'Repeat marked';
  message: string;
  status: 'success' | 'failure';
}) {
  await showToast({
    style: args.status === 'success' ? Toast.Style.Success : Toast.Style.Failure,
    title: args.title,
    message: args.message,
  });
}

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  return {
    message: `Run duplicate checks for the top ${resolveBatchLimit(input)} active Scout Prep tasks?`,
    info: [
      { name: 'Source', value: 'Today/PastDue Scout Prep rendered list' },
      { name: 'Limit', value: String(resolveBatchLimit(input)) },
    ],
  };
};

async function runBatchDuplicateChecks(input: Input): Promise<string> {
  const limit = resolveBatchLimit(input);
  logInfo('DUPLICATE_TOOL_BATCH', 'execute', 'start', {
    limit,
    source: 'todayPastDue',
  });

  const taskBuckets = await fetchScoutPortalTaskBuckets(['todayPastDue'] as const);
  const tasks = buildTodayPastDueDuplicateCheckBatchTasks({
    taskBuckets: {
      todayPastDue: [...taskBuckets.todayPastDue].reverse(),
    },
    limit,
  });

  const notifications: Array<{
    title: 'No duplicate' | 'Review duplicate' | 'Repeat marked' | 'Check failed';
    message: string;
    athleteName: string;
    reason?: string;
  }> = [];
  const noDuplicateResults: Array<{ athleteName: string }> = [];
  const markedRepeatResults: Array<{ athleteName: string; message: string }> = [];
  const reviewResults: Array<{ athleteName: string; reason: string }> = [];
  const failedResults: Array<{ athleteName: string; error: string }> = [];
  let checked = 0;
  let marked = 0;
  let noDuplicate = 0;
  let review = 0;
  let failed = 0;

  for (const task of tasks) {
    checked += 1;
    try {
      const result = await runDuplicateProfileResolutionForTask(task);
      const summary = summarizeDuplicateProfileResolutionToast({
        result,
        athleteName: task.athlete_name,
      });
      if (summary.title === 'Repeat marked') {
        marked += 1;
        markedRepeatResults.push({ athleteName: task.athlete_name, message: summary.message });
      }
      if (summary.title === 'No duplicate') {
        noDuplicate += 1;
        noDuplicateResults.push({ athleteName: task.athlete_name });
      }
      if (summary.title === 'Review duplicate') {
        review += 1;
        reviewResults.push({ athleteName: task.athlete_name, reason: summary.message });
      }
      notifications.push({
        title: summary.title,
        message: summary.message,
        athleteName: task.athlete_name,
        ...(summary.title === 'Review duplicate' ? { reason: summary.message } : {}),
      });
      await showDuplicateSummaryToast(summary);
      logInfo('DUPLICATE_TOOL_BATCH_ROW', 'row-complete', 'success', {
        taskId: task.task_id || null,
        athleteId: task.athlete_id || task.contact_id || null,
        title: summary.title,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed += 1;
      failedResults.push({ athleteName: task.athlete_name, error: message });
      notifications.push({
        title: 'Check failed',
        message,
        athleteName: task.athlete_name,
        reason: message,
      });
      await showToast({
        style: Toast.Style.Failure,
        title: 'Check failed',
        message,
      });
      logFailure('DUPLICATE_TOOL_BATCH_ROW', 'row-complete', message, {
        taskId: task.task_id || null,
        athleteId: task.athlete_id || task.contact_id || null,
      });
    }
  }

  logInfo('DUPLICATE_TOOL_BATCH', 'execute', 'success', {
    limit,
    checked,
    marked,
    noDuplicate,
    review,
    failed,
  });

  return JSON.stringify({
    success: failed === 0,
    action: 'duplicate_resolution_batch',
    source: 'todayPastDue',
    limit,
    checked,
    marked,
    noDuplicate,
    review,
    failed,
    results: {
      noDuplicate: noDuplicateResults,
      markedRepeat: markedRepeatResults,
      needsReview: reviewResults,
      failed: failedResults,
    },
    notifications,
  });
}

export default async function tool(input: Input): Promise<string> {
  try {
    return await runBatchDuplicateChecks(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logFailure('DUPLICATE_TOOL_BATCH', 'execute', message, {
      limit: resolveBatchLimit(input),
    });
    await showToast({
      style: Toast.Style.Failure,
      title: 'Check failed',
      message,
    });
    return JSON.stringify({
      success: false,
      error: message,
    });
  }
}
