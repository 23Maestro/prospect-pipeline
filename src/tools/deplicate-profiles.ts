import { Action, Tool } from '@raycast/api';
import { searchLogger } from '../lib/logger';
import { runDuplicateProfileResolutionForTask } from '../lib/scout-duplicate-profiles';
import type { ScoutPortalTask } from '../features/scout-prep/types';

type Input = {
  contactId: string;
  athleteMainId?: string;
  athleteId?: string;
  athleteName: string;
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

function buildTask(input: Input): ScoutPortalTask {
  return {
    task_id: input.taskId || null,
    contact_id: input.contactId,
    athlete_id: input.athleteId || input.contactId,
    athlete_main_id: input.athleteMainId || null,
    athlete_name: input.athleteName,
    title: input.taskTitle || null,
    description: input.taskDescription || null,
    completion_date: input.completionDate || null,
    assigned_owner: input.assignedOwner || null,
    grad_year: input.gradYear || null,
    sport: input.sport || null,
    high_school: input.highSchool || null,
    city: input.city || null,
    state: input.state || null,
    athlete_admin_url: input.athleteAdminUrl || null,
    athlete_profile_url: input.athleteProfileUrl || null,
    athlete_task_url: input.athleteTaskUrl || null,
  };
}

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  if (!input.contactId || !input.athleteName) {
    return {
      style: Action.Style.Destructive,
      message: 'Missing required fields (contactId, athleteName)',
    };
  }

  return {
    message: `Run duplicate profile cleanup for ${input.athleteName}?`,
    info: [
      { name: 'Athlete', value: input.athleteName },
      { name: 'Task', value: input.taskTitle || 'Source task not provided' },
      { name: 'Contact ID', value: input.contactId },
      { name: 'Task ID', value: input.taskId || 'Not provided' },
    ],
  };
};

export default async function tool(input: Input): Promise<string> {
  logInfo('DUPLICATE_TOOL', 'execute', 'start', {
    contactId: input.contactId,
    athleteId: input.athleteId || input.contactId,
    athleteMainId: input.athleteMainId || null,
    taskId: input.taskId || null,
    sourceTaskTitle: input.taskTitle || null,
    hasAthleteName: Boolean(input.athleteName),
  });

  try {
    const task = buildTask(input);
    const result = await runDuplicateProfileResolutionForTask(task);

    logInfo('DUPLICATE_TOOL', 'execute', 'success', {
      matchCount: result.matchCount,
      completed: result.completed.length,
      cleared: result.cleared.length,
      skipped: result.skipped.length,
    });

    return JSON.stringify(
      {
        success: true,
        action: 'duplicate_resolution',
        searchTerm: result.searchTerm,
        matchCount: result.matchCount,
        completed: result.completed,
        cleared: result.cleared,
        skipped: result.skipped,
      },
      null,
      2,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logFailure('DUPLICATE_TOOL', 'execute', message, {
      contactId: input.contactId,
      athleteId: input.athleteId || input.contactId,
      taskId: input.taskId || null,
    });

    return JSON.stringify({
      success: false,
      error: message,
    });
  }
}
