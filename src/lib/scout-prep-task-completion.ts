import { getActiveOperator } from '../domain/owners';
import { apiFetch } from './fastapi-client';
import { searchLogger } from './logger';
import { lifecycleSalesStage } from './supabase-lifecycle';

const FEATURE = 'scout-prep';

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

function formatLegacyTaskDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

function formatLegacyTaskTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export type CompleteScoutPrepTaskAfterVoicemailArgs = {
  athleteId: string;
  athleteMainId: string;
  athleteName?: string | null;
  contactTask?: string | null;
  taskId?: string | null;
  crmStage?: string | null;
  taskTitle?: string | null;
  assignedOwner?: string | null;
  description?: string | null;
};

export async function completeScoutPrepTaskAfterVoicemail(
  args: CompleteScoutPrepTaskAfterVoicemailArgs,
): Promise<{ success?: boolean; task_id?: string | null; message?: string | null }> {
  const now = new Date();
  const completedDate = formatLegacyTaskDate(now);
  const completedTime = formatLegacyTaskTime(now);

  logInfo('SCOUT_PREP_TASK_COMPLETE', 'request', 'start', {
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    contactTask: args.contactTask || null,
    taskId: args.taskId || null,
    taskTitle: args.taskTitle || 'Call Attempt 1',
    assignedOwner: args.assignedOwner || getActiveOperator().taskAssignedOwnerName,
    completedDate,
    completedTime,
  });

  const response = await apiFetch('/tasks/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: args.athleteId,
      athlete_main_id: args.athleteMainId,
      contact_task: args.contactTask || args.athleteId,
      task_id: args.taskId || null,
      task_title: args.taskTitle || 'Call Attempt 1',
      assigned_owner: args.assignedOwner || getActiveOperator().taskAssignedOwnerName,
      description: args.description || args.taskTitle || 'Call Attempt 1',
      completed_date: completedDate,
      completed_time: completedTime,
      is_completed: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = '';
    try {
      const parsed = JSON.parse(errorText) as { detail?: string };
      detail = parsed.detail || '';
    } catch {
      detail = '';
    }
    const message = detail || errorText.slice(0, 200) || `HTTP ${response.status}`;
    logFailure('SCOUT_PREP_TASK_COMPLETE', 'request', message, {
      athleteId: args.athleteId,
      athleteMainId: args.athleteMainId,
      contactTask: args.contactTask || null,
      taskId: args.taskId || null,
      statusCode: response.status,
    });
    throw new Error(message);
  }

  const result = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    task_id?: string | null;
    message?: string | null;
  };
  logInfo('SCOUT_PREP_TASK_COMPLETE', 'request', 'success', {
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    contactTask: args.contactTask || null,
    taskId: result.task_id || null,
    message: result.message || null,
  });
  await lifecycleSalesStage({
    sourcePost: '/tasks/complete',
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName || '',
    crmStage: args.crmStage || null,
    taskId: result.task_id || args.taskId || null,
    taskTitle: args.taskTitle || 'Call Attempt 1',
    taskDescription: args.description || args.taskTitle || 'Call Attempt 1',
    taskAssignedOwner: args.assignedOwner || getActiveOperator().taskAssignedOwnerName,
    completedDate,
    completedTime,
    activitySubtype: args.crmStage ? undefined : 'needs_manual_review',
  });
  return result;
}
