import { Action, Tool } from '@raycast/api';
import { searchLogger } from '../lib/logger';
import { runDuplicateProfileResolutionForTask } from '../lib/scout-duplicate-profiles';
import type { ScoutPortalTask } from '../features/scout-prep/types';

type Input = {
  contactId: string;
  athleteMainId?: string;
  athleteName: string;
  taskTitle: string;
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
    contact_id: input.contactId,
    athlete_id: input.contactId,
    athlete_main_id: input.athleteMainId || '',
    athlete_name: input.athleteName,
    title: input.taskTitle,
    description: null,
  };
}

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  if (!input.contactId || !input.athleteName || !input.taskTitle) {
    return {
      style: Action.Style.Destructive,
      message: 'Missing required fields (contactId, athleteName, taskTitle)',
    };
  }

  return {
    message: `Run duplicate profile cleanup for ${input.athleteName}?`,
    info: [
      { name: 'Athlete', value: input.athleteName },
      { name: 'Task', value: input.taskTitle },
      { name: 'Contact ID', value: input.contactId },
    ],
  };
};

export default async function tool(input: Input): Promise<string> {
  logInfo('DUPLICATE_TOOL', 'execute', 'start', {
    contactId: input.contactId,
    athleteName: input.athleteName,
  });

  try {
    const task = buildTask(input);
    const result = await runDuplicateProfileResolutionForTask(task);

    logInfo('DUPLICATE_TOOL', 'execute', 'success', {
      completed: result.completed.length,
      skipped: result.skipped.length,
    });

    return JSON.stringify(
      {
        success: true,
        action: 'duplicate_resolution',
        searchTerm: result.searchTerm,
        matchCount: result.matchCount,
        completed: result.completed,
        skipped: result.skipped,
      },
      null,
      2,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logFailure('DUPLICATE_TOOL', 'execute', message, {
      contactId: input.contactId,
    });

    return JSON.stringify({
      success: false,
      error: message,
    });
  }
}
