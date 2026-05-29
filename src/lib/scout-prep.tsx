import { Color, Detail } from '@raycast/api';
import { apiFetch, apiRootFetch } from './fastapi-client';
import { fetchAthleteNotes, fetchContactInfo, type ContactInfo } from './npid-mcp-adapter';
import { buildScoutPrepCard } from '../features/scout-prep/content';
import { buildScoutPrepFallbackOutput } from './scout-prep-ai';
import type {
  ScoutPrepAIOutput,
  ScoutAthleteTask,
  ScoutPrepFormValues,
  ScoutPrepGrade,
  ScoutRecentProfile,
  ScoutPortalTask,
  ScoutPrepContext,
} from '../features/scout-prep/types';
import type { AthleteTaskSummary } from '../types/athlete-workflows';
import { searchLogger } from './logger';
import type { VoicemailFollowUpVariant } from './scout-follow-up-templates';
import { getActiveOperator } from '../domain/owners';
import { recordLifecycleMutation } from './supabase-lifecycle';
import {
  findNewestIncompleteConfirmationTask,
  findNewestIncompleteFollowUpTask,
  isConfirmationCallTask,
  isFollowUpScoutTask,
  stripMoveThisTaskPrefix,
} from '../domain/scout-task-selection';
import {
  getCachedScoutPrepContactInfo,
  getCachedScoutPrepMeasurables,
  setCachedScoutPrepContactInfo,
  setCachedScoutPrepMeasurables,
  type ScoutPrepMeasurables,
} from './scout-prep-cache';

const FEATURE = 'scout-prep';
export type ScoutTaskRange =
  | 'todayPastDue'
  | 'all'
  | 'today'
  | 'tomorrow'
  | 'future'
  | 'thisWeek'
  | 'nextWeek';

export type ScoutPortalTaskFetchOptions = {
  start?: number;
  length?: number;
  searchText?: string;
};

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

export async function fetchScoutPortalTasks(
  range: ScoutTaskRange = 'todayPastDue',
  options: ScoutPortalTaskFetchOptions = {},
): Promise<ScoutPortalTask[]> {
  logInfo('SCOUT_PREP_TASKS_FETCH', 'request', 'start');
  const params = new URLSearchParams({ range });
  if (typeof options.start === 'number') params.set('start', String(options.start));
  if (typeof options.length === 'number') params.set('length', String(options.length));
  if (options.searchText?.trim()) params.set('searchText', options.searchText.trim());
  const response = await apiFetch(`/scout/tasks?${params.toString()}`);
  if (!response.ok) {
    let message = `Failed to fetch scout tasks: ${response.status}`;
    if (response.status === 404) {
      try {
        const openapiResponse = await apiRootFetch('/openapi.json');
        const spec = (await openapiResponse.json()) as { paths?: Record<string, unknown> };
        const hasScoutRoute = Object.prototype.hasOwnProperty.call(
          spec.paths || {},
          '/api/v1/scout/tasks',
        );
        if (!hasScoutRoute) {
          message =
            'Scout route missing from FastAPI server. The server is stale and needs restart.';
        }
      } catch {
        message =
          'Scout route returned 404. The FastAPI server may be stale or not exposing /api/v1/scout/tasks.';
      }
    }
    logFailure('SCOUT_PREP_TASKS_FETCH', 'request', message, {
      statusCode: response.status,
    });
    throw new Error(message);
  }
  const data = (await response.json()) as { tasks?: ScoutPortalTask[] };
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  logInfo('SCOUT_PREP_TASKS_FETCH', 'parse', 'success', {
    count: tasks.length,
    range,
    start: options.start ?? null,
    length: options.length ?? null,
    searchText: options.searchText?.trim() || null,
  });
  return tasks;
}

export async function fetchScoutPortalTaskBuckets<T extends ScoutTaskRange>(
  ranges: readonly T[],
  optionsByRange: Partial<Record<T, ScoutPortalTaskFetchOptions>> = {},
): Promise<Record<T, ScoutPortalTask[]>> {
  const entries = await Promise.all(
    ranges.map(async (range) => [
      range,
      await fetchScoutPortalTasks(range, optionsByRange[range] || {}),
    ] as const),
  );
  return Object.fromEntries(entries) as Record<T, ScoutPortalTask[]>;
}

export async function fetchScoutRecentProfiles(): Promise<ScoutRecentProfile[]> {
  logInfo('SCOUT_PREP_RECENT_PROFILES_FETCH', 'request', 'start');
  const response = await apiFetch('/scout/recent-profiles');
  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Recent profiles HTTP ${response.status}`;
    logFailure('SCOUT_PREP_RECENT_PROFILES_FETCH', 'request', message, {
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }
  const data = (await response.json()) as { profiles?: ScoutRecentProfile[] };
  const profiles = Array.isArray(data.profiles) ? data.profiles : [];
  logInfo('SCOUT_PREP_RECENT_PROFILES_FETCH', 'parse', 'success', {
    count: profiles.length,
  });
  return profiles;
}

export async function fetchAthleteTasks(
  athleteId: string,
  athleteMainId: string,
): Promise<AthleteTaskSummary[]> {
  logInfo('SCOUT_PREP_ATHLETE_TASKS_FETCH', 'request', 'start', {
    athleteId,
    athleteMainId,
  });
  const response = await apiFetch('/tasks/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: String(athleteId),
      athlete_main_id: String(athleteMainId),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Tasks HTTP ${response.status}`;
    logFailure('SCOUT_PREP_ATHLETE_TASKS_FETCH', 'request', message, {
      athleteId,
      athleteMainId,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json().catch(() => ({}))) as { tasks?: AthleteTaskSummary[] };
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  logInfo('SCOUT_PREP_ATHLETE_TASKS_FETCH', 'parse', 'success', {
    athleteId,
    athleteMainId,
    count: tasks.length,
  });
  return tasks;
}

type AthleteResolveResponse = {
  athlete_id?: string;
  athlete_main_id?: string | null;
  grad_year?: string | null;
  high_school?: string | null;
  city?: string | null;
  state?: string | null;
  positions?: string | null;
  sport?: string | null;
  gpa?: string | null;
  head_scout?: string | null;
  scouting_coordinator?: string | null;
};

export async function fetchScoutPrepAthleteDetails(
  athleteId: string,
): Promise<AthleteResolveResponse | null> {
  logInfo('SCOUT_PREP_ATHLETE_DETAILS', 'request', 'start', {
    athleteId,
  });
  const response = await apiFetch(`/athlete/${encodeURIComponent(athleteId)}/scout-prep-resolve`);
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    logFailure(
      'SCOUT_PREP_ATHLETE_DETAILS',
      'request',
      errorText.slice(0, 200) || `Athlete resolve HTTP ${response.status}`,
      {
        athleteId,
        statusCode: response.status,
      },
    );
    return null;
  }

  const payload = (await response.json().catch(() => ({}))) as AthleteResolveResponse;
  logInfo('SCOUT_PREP_ATHLETE_DETAILS', 'parse', 'success', {
    athleteId,
    athleteMainId: payload.athlete_main_id || null,
    hasCity: Boolean(String(payload.city || '').trim()),
    hasState: Boolean(String(payload.state || '').trim()),
    hasSport: Boolean(String(payload.sport || '').trim()),
  });
  return payload;
}

export {
  findNewestIncompleteConfirmationTask,
  findNewestIncompleteFollowUpTask,
  isConfirmationCallTask,
  isFollowUpScoutTask,
  stripMoveThisTaskPrefix,
} from '../domain/scout-task-selection';

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

export async function completeScoutPrepTaskAfterVoicemail(args: {
  athleteId: string;
  athleteMainId: string;
  athleteName?: string | null;
  contactTask?: string | null;
  taskId?: string | null;
  crmStage?: string | null;
  taskTitle?: string | null;
  assignedOwner?: string | null;
  description?: string | null;
}): Promise<{ success?: boolean; task_id?: string | null; message?: string | null }> {
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
  await recordLifecycleMutation({
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

export async function fetchScoutTaskPopup(taskId: string): Promise<{
  success: boolean;
  form_data: Record<string, string>;
  checkbox_fields: string[];
}> {
  const response = await apiFetch('/tasks/popup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_id: taskId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText.slice(0, 200) || `Task popup HTTP ${response.status}`);
  }

  return (await response.json()) as {
    success: boolean;
    form_data: Record<string, string>;
    checkbox_fields: string[];
  };
}

export async function updateScoutPrepTask(args: {
  taskId: string;
  contactTask: string;
  athleteMainId: string;
  athleteName?: string | null;
  taskTitle?: string | null;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  assignedOwner?: string | null;
}): Promise<{ success?: boolean; task_id?: string | null; message?: string | null }> {
  const response = await apiFetch('/tasks/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_id: args.taskId,
      contact_task: args.contactTask,
      athlete_main_id: args.athleteMainId,
      task_title: args.taskTitle ?? null,
      description: args.description ?? null,
      due_date: args.dueDate ?? null,
      due_time: args.dueTime ?? null,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText.slice(0, 200) || `Task update HTTP ${response.status}`);
  }

  const result = (await response.json()) as {
    success?: boolean;
    task_id?: string | null;
    message?: string | null;
  };
  await recordLifecycleMutation({
    sourcePost: '/tasks/update',
    athleteId: args.contactTask,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName || '',
    taskId: result.task_id || args.taskId,
    taskTitle: args.taskTitle || null,
    taskDescription: args.description || null,
    taskAssignedOwner: args.assignedOwner || null,
    dueDate: args.dueDate,
    dueTime: args.dueTime,
    activitySubtype: 'needs_manual_review',
  });
  return result;
}

export async function recordCallAttempt3MessageSent(args: {
  athleteId: string;
  athleteMainId: string;
  athleteName?: string | null;
  taskId: string;
}): Promise<{
  success?: boolean;
  task_id?: string | null;
  stage?: string | null;
  message?: string | null;
}> {
  const now = new Date();
  const completedDate = formatLegacyTaskDate(now);
  const completedTime = formatLegacyTaskTime(now);

  const response = await apiFetch('/tasks/call-attempt-3-sent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: args.athleteId,
      athlete_main_id: args.athleteMainId,
      task_id: args.taskId,
      completed_date: completedDate,
      completed_time: completedTime,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText.slice(0, 200) || `Call Attempt 3 HTTP ${response.status}`);
  }

  const result = (await response.json()) as {
    success?: boolean;
    task_id?: string | null;
    stage?: string | null;
    message?: string | null;
  };
  await recordLifecycleMutation({
    sourcePost: '/tasks/call-attempt-3-sent',
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName || '',
    crmStage: result.stage || 'Never Spoke To',
    taskId: result.task_id || args.taskId,
    taskTitle: 'Call Attempt 3',
    taskDescription: FOLLOW_UP_DESCRIPTION_BY_VARIANT.call_attempt_3,
    activitySubtype: 'call_attempt_3',
    taskAssignedOwner: getActiveOperator().taskAssignedOwnerName,
    completedDate,
    completedTime,
  });
  return result;
}

const FOLLOW_UP_STAGE_BY_VARIANT: Partial<Record<VoicemailFollowUpVariant, string>> = {
  call_attempt_1: 'Left Voice Mail 1',
  call_attempt_2: 'Left Voice Mail 2',
  call_attempt_3: 'Never Spoke To',
};

const FOLLOW_UP_DESCRIPTION_BY_VARIANT: Partial<Record<VoicemailFollowUpVariant, string>> = {
  call_attempt_1: 'Call the family and leave first voicemail follow-up.',
  call_attempt_2: 'Call the family second time and leave follow-up voicemail.',
  call_attempt_3:
    "Call the family third time. Then If you do not get a hold of them, code as 'Did Not Speak To'",
};

const FOLLOW_UP_TASK_TITLE_BY_VARIANT: Partial<Record<VoicemailFollowUpVariant, string>> = {
  call_attempt_1: 'Call Attempt 1',
  call_attempt_2: 'Call Attempt 2',
  call_attempt_3: 'Call Attempt 3',
};

export async function recordVoicemailFollowUpMessageSent(args: {
  athleteId: string;
  athleteMainId: string;
  athleteName?: string | null;
  taskId: string;
  variant: VoicemailFollowUpVariant;
  taskTitle?: string | null;
  description?: string | null;
  assignedTo?: string | null;
}): Promise<{
  success?: boolean;
  task_id?: string | null;
  stage?: string | null;
  message?: string | null;
}> {
  const stage = FOLLOW_UP_STAGE_BY_VARIANT[args.variant];
  const taskTitle = String(
    args.taskTitle || FOLLOW_UP_TASK_TITLE_BY_VARIANT[args.variant] || '',
  ).trim();
  const description = String(
    args.description || FOLLOW_UP_DESCRIPTION_BY_VARIANT[args.variant] || taskTitle,
  ).trim();

  if (!stage) {
    throw new Error(`No lifecycle update configured for ${args.variant}`);
  }
  const activitySubtype =
    args.variant === 'call_attempt_1' ||
    args.variant === 'call_attempt_2' ||
    args.variant === 'call_attempt_3'
      ? args.variant
      : undefined;
  if (!taskTitle) {
    throw new Error(`Missing task title for ${args.variant}`);
  }

  const now = new Date();
  const completedDate = formatLegacyTaskDate(now);
  const completedTime = formatLegacyTaskTime(now);

  const response = await apiFetch('/tasks/follow-up-message-sent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: args.athleteId,
      athlete_main_id: args.athleteMainId,
      task_id: args.taskId,
      completed_date: completedDate,
      completed_time: completedTime,
      stage,
      task_title: taskTitle,
      description,
      assigned_to: args.assignedTo || getActiveOperator().legacyUserId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText.slice(0, 200) || `Follow-up update HTTP ${response.status}`);
  }

  const result = (await response.json()) as {
    success?: boolean;
    task_id?: string | null;
    stage?: string | null;
    message?: string | null;
  };
  await recordLifecycleMutation({
    sourcePost: '/tasks/follow-up-message-sent',
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName || '',
    crmStage: result.stage || stage,
    taskId: result.task_id || args.taskId,
    taskTitle,
    taskDescription: description,
    activitySubtype,
    taskAssignedOwner: getActiveOperator().taskAssignedOwnerName,
    completedDate,
    completedTime,
  });
  return result;
}

export function resolveGradeLabel(gradYear?: string | null): ScoutPrepGrade {
  const parsed = parseInt(String(gradYear || '').trim(), 10);
  if (Number.isNaN(parsed)) {
    return 'Junior';
  }

  const now = new Date();
  const graduatingClass = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
  const offset = parsed - graduatingClass;

  if (offset <= 0) return 'Senior';
  if (offset === 1) return 'Junior';
  if (offset === 2) return 'Sophomore';
  return 'Freshman';
}

export function buildScoutPrepValues(args: {
  athleteName: string;
  parent1Name?: string | null;
  parent2Name?: string | null;
  gradYear?: string | null;
  sport?: string | null;
}): ScoutPrepFormValues {
  return {
    athleteName: args.athleteName,
    parent1Name: args.parent1Name?.trim() || 'Parent 1',
    parent2Name: args.parent2Name?.trim() || undefined,
    gradYear: resolveGradeLabel(args.gradYear),
    sport: args.sport?.trim() || 'Sport',
  };
}

export function resolveScoutPrepContactLookupIds(args: {
  taskContactId?: string | null;
  resolvedAthleteId?: string | null;
  taskAthleteMainId?: string | null;
  resolvedAthleteMainId?: string | null;
}): { contactId: string; athleteMainId: string } {
  const contactId = String(args.resolvedAthleteId || args.taskContactId || '').trim();
  const athleteMainId = String(args.resolvedAthleteMainId || args.taskAthleteMainId || '').trim();
  return { contactId, athleteMainId };
}

export function isScoutPrepContactCacheUsable(contactInfo?: ContactInfo | null): boolean {
  return Boolean(contactInfo?.parent1);
}

export function isScoutPrepContextCacheUsableForDisplay(
  context?: ScoutPrepContext | null,
): boolean {
  return Boolean(context?.contactInfo?.studentAthlete && context?.resolved);
}

export async function loadScoutPrepContext(task: ScoutPortalTask): Promise<ScoutPrepContext> {
  const athleteId = String(task.athlete_id || task.contact_id || '').trim();
  const athleteMainIdHint = String(task.athlete_main_id || '').trim();

  logInfo('SCOUT_PREP_CONTEXT_LOAD', 'resolve-athlete', 'start', {
    contactId: task.contact_id,
    athleteId,
    athleteMainIdHint: athleteMainIdHint || null,
  });

  if (!athleteId) {
    const message = 'Missing athlete_id for scout prep task';
    logFailure('SCOUT_PREP_CONTEXT_LOAD', 'resolve-athlete', message, {
      contactId: task.contact_id,
      athleteId,
      athleteMainIdHint: athleteMainIdHint || null,
    });
    throw new Error(message);
  }

  const athleteDetails = await fetchScoutPrepAthleteDetails(athleteId);
  const athleteMainId = String(athleteMainIdHint || athleteDetails?.athlete_main_id || '').trim();

  if (!athleteMainId) {
    const message = 'Missing athlete_main_id for scout prep task';
    logFailure('SCOUT_PREP_CONTEXT_LOAD', 'resolve-athlete', message, {
      contactId: task.contact_id,
      athleteId,
      athleteMainIdHint: athleteMainIdHint || null,
    });
    throw new Error(message);
  }

  logInfo('SCOUT_PREP_CONTEXT_LOAD', 'resolve-athlete', 'success', {
    contactId: task.contact_id,
    athleteId,
    athleteMainId,
  });

  logInfo('SCOUT_PREP_CONTEXT_LOAD', 'hydrate-context', 'start', {
    contactId: task.contact_id,
    athleteId,
    athleteMainId,
  });
  logInfo('SCOUT_PREP_CONTACT_CACHE', 'request', 'start', {
    contactId: task.contact_id,
    athleteId,
    athleteMainId,
  });
  logInfo('SCOUT_PREP_MEASURABLES', 'request', 'start', {
    contactId: task.contact_id,
    athleteId,
  });
  const contactLookup = resolveScoutPrepContactLookupIds({
    taskContactId: task.contact_id,
    resolvedAthleteId: athleteDetails?.athlete_id || athleteId,
    taskAthleteMainId: task.athlete_main_id,
    resolvedAthleteMainId: athleteDetails?.athlete_main_id || athleteMainId,
  });

  const [contactInfo, notes, tasks, measurables] = await Promise.all([
    loadScoutPrepContactInfo(contactLookup.contactId, contactLookup.athleteMainId, athleteId),
    fetchAthleteNotes(athleteId, athleteMainId),
    fetchAthleteTasks(athleteId, athleteMainId),
    loadScoutPrepMeasurables(athleteId, String(task.contact_id)),
  ]);

  logInfo('SCOUT_PREP_CONTEXT_LOAD', 'hydrate-context', 'success', {
    contactId: task.contact_id,
    athleteId,
    athleteMainId,
    notesCount: notes.length,
    tasksCount: tasks.length,
    hasParent1: Boolean(contactInfo.parent1),
    hasParent2: Boolean(contactInfo.parent2),
  });

  if (!contactInfo.parent1) {
    logFailure(
      'SCOUT_PREP_CONTEXT_LOAD',
      'hydrate-context',
      'Primary parent contact missing for scout prep reminders',
      {
        contactId: task.contact_id,
        athleteId,
        athleteMainId,
      },
    );
  }

  return {
    task,
    resolved: {
      athlete_id: athleteDetails?.athlete_id || athleteId,
      athlete_main_id: athleteDetails?.athlete_main_id || athleteMainId,
      sport: task.sport || athleteDetails?.sport || null,
      high_school: task.high_school || athleteDetails?.high_school || null,
      city: task.city || athleteDetails?.city || null,
      state: task.state || athleteDetails?.state || null,
      positions: athleteDetails?.positions || null,
      gpa: athleteDetails?.gpa || null,
      head_scout: athleteDetails?.head_scout || null,
      scouting_coordinator: athleteDetails?.scouting_coordinator || null,
      height: measurables.height || null,
      weight: measurables.weight || null,
    },
    contactInfo,
    notes,
    tasks,
  };
}

async function loadScoutPrepContactInfo(
  contactId: string,
  athleteMainId: string,
  athleteId: string,
): Promise<ContactInfo> {
  const cached = await getCachedScoutPrepContactInfo(contactId, athleteMainId);
  if (cached?.isFresh && isScoutPrepContactCacheUsable(cached.data)) {
    logInfo('SCOUT_PREP_CONTACT_CACHE', 'parse', 'success', {
      contactId,
      athleteId,
      athleteMainId,
      source: 'cache',
      cacheAgeMs: cached.cacheAgeMs,
      hasParent1: Boolean(cached.data.parent1),
      hasParent2: Boolean(cached.data.parent2),
    });
    return cached.data;
  }
  if (cached?.isFresh) {
    logInfo('SCOUT_PREP_CONTACT_CACHE', 'request', 'start', {
      contactId,
      athleteId,
      athleteMainId,
      source: 'cache-missing-parent-refresh',
      cacheAgeMs: cached.cacheAgeMs,
    });
  }

  try {
    const contactInfo = await fetchContactInfo(contactId, athleteMainId);
    await setCachedScoutPrepContactInfo(contactId, athleteMainId, contactInfo);
    logInfo('SCOUT_PREP_CONTACT_CACHE', 'parse', 'success', {
      contactId,
      athleteId,
      athleteMainId,
      source: 'api',
      hasParent1: Boolean(contactInfo.parent1),
      hasParent2: Boolean(contactInfo.parent2),
    });
    return contactInfo;
  } catch (error) {
    if (cached) {
      logInfo('SCOUT_PREP_CONTACT_CACHE', 'parse', 'success', {
        contactId,
        athleteId,
        athleteMainId,
        source: 'stale-cache',
        cacheAgeMs: cached.cacheAgeMs,
        hasParent1: Boolean(cached.data.parent1),
        hasParent2: Boolean(cached.data.parent2),
      });
      return cached.data;
    }
    throw error;
  }
}

async function loadScoutPrepMeasurables(
  athleteId: string,
  contactId: string,
): Promise<ScoutPrepMeasurables> {
  const cached = await getCachedScoutPrepMeasurables(athleteId);
  if (cached?.isFresh) {
    logInfo('SCOUT_PREP_MEASURABLES', 'parse', 'success', {
      contactId,
      athleteId,
      source: 'cache',
      cacheAgeMs: cached.cacheAgeMs,
      hasHeight: Boolean(String(cached.data.height || '').trim()),
      hasWeight: Boolean(String(cached.data.weight || '').trim()),
    });
    return cached.data;
  }

  const measurablesResponse = await apiFetch(
    `/athlete/${encodeURIComponent(athleteId)}/measurables`,
  );
  if (measurablesResponse.ok) {
    const measurables = (await measurablesResponse
      .json()
      .catch(() => ({}))) as ScoutPrepMeasurables;
    await setCachedScoutPrepMeasurables(athleteId, measurables);
    logInfo('SCOUT_PREP_MEASURABLES', 'parse', 'success', {
      contactId,
      athleteId,
      source: 'api',
      hasHeight: Boolean(String(measurables.height || '').trim()),
      hasWeight: Boolean(String(measurables.weight || '').trim()),
    });
    return measurables;
  }

  const errorText = await measurablesResponse.text().catch(() => '');
  if (cached) {
    logInfo('SCOUT_PREP_MEASURABLES', 'parse', 'success', {
      contactId,
      athleteId,
      source: 'stale-cache',
      cacheAgeMs: cached.cacheAgeMs,
      hasHeight: Boolean(String(cached.data.height || '').trim()),
      hasWeight: Boolean(String(cached.data.weight || '').trim()),
    });
    return cached.data;
  }

  logFailure(
    'SCOUT_PREP_MEASURABLES',
    'request',
    errorText.slice(0, 200) || `Measurables HTTP ${measurablesResponse.status}`,
    {
      contactId,
      athleteId,
      statusCode: measurablesResponse.status,
      responsePreview: errorText.slice(0, 120),
    },
  );
  throw new Error(errorText.slice(0, 200) || `Measurables HTTP ${measurablesResponse.status}`);
}

export function buildScoutPrepDetailMarkdown(
  values: ScoutPrepFormValues,
  context: ScoutPrepContext,
  output?: ScoutPrepAIOutput | null,
): string {
  try {
    const card = buildScoutPrepCard(
      values,
      context,
      output || buildScoutPrepFallbackOutput(values, context),
    );
    logInfo('SCOUT_PREP_CARD_BUILD', 'assemble-card', 'success', {
      anchorCount: card.diagnostics.anchorCount,
      snapshotFieldCount: card.diagnostics.snapshotFieldCount,
      chosenDeficitGrade: card.diagnostics.deficitGrade,
      rapportSource: card.diagnostics.rapportSource,
      hasLocalTime: card.diagnostics.hasLocalTime,
      rapportInputs: {
        hasState: card.diagnostics.hasState,
        hasCity: card.diagnostics.hasCity,
        hasSchool: card.diagnostics.hasSchool,
        hasSport: card.diagnostics.hasSport,
        hasParent1: card.diagnostics.hasParent1,
      },
    });
    return card.markdown;
  } catch (error) {
    logFailure(
      'SCOUT_PREP_CARD_BUILD',
      'assemble-card',
      error instanceof Error ? error.message : String(error),
      {
        athleteName: values.athleteName,
        contactId: context.task.contact_id,
      },
    );
    throw error;
  }
}

export function buildScoutPrepMetadata(values: ScoutPrepFormValues, context: ScoutPrepContext) {
  const { resolved } = context;

  return (
    <Detail.Metadata>
      <Detail.Metadata.TagList title="Student Athlete">
        <Detail.Metadata.TagList.Item text={values.athleteName} color={Color.Blue} />
      </Detail.Metadata.TagList>
      <Detail.Metadata.TagList title="Parent 1">
        <Detail.Metadata.TagList.Item text={values.parent1Name} color={Color.Green} />
      </Detail.Metadata.TagList>
      {values.parent2Name ? (
        <Detail.Metadata.TagList title="Parent 2">
          <Detail.Metadata.TagList.Item text={values.parent2Name} color={Color.Magenta} />
        </Detail.Metadata.TagList>
      ) : null}
      <Detail.Metadata.TagList title="Sport">
        <Detail.Metadata.TagList.Item text={values.sport} color={Color.Orange} />
      </Detail.Metadata.TagList>
      <Detail.Metadata.TagList title="Grade">
        <Detail.Metadata.TagList.Item text={values.gradYear} color={Color.Purple} />
      </Detail.Metadata.TagList>
      {resolved.high_school ? (
        <Detail.Metadata.TagList title="School">
          <Detail.Metadata.TagList.Item text={resolved.high_school} color={Color.Red} />
        </Detail.Metadata.TagList>
      ) : null}
    </Detail.Metadata>
  );
}
