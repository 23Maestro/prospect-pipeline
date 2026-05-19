import { apiFetch } from './fastapi-client';
import { fetchContactInfo } from './npid-mcp-adapter';
import { searchLogger } from './logger';
import type { ScoutAthleteTask, ScoutPortalTask } from '../features/scout-prep/types';
import { stripMoveThisTaskPrefix } from '../domain/scout-task-selection';
import type { AthleteTaskSummary } from '../types/athlete-workflows';
import { getActiveOperator } from '../domain/owners';

const FEATURE = 'scout-duplicate-profiles';
const REPEAT_PROFILE_MARKER = 'Repeat Profile';
const REPEAT_TASK_TITLE = 'REPEAT';
const REPEAT_TASK_DESCRIPTION = 'REPEAT';

type RawAthleteSearchResult = {
  athlete_id: string;
  athlete_main_id?: string | null;
  name?: string | null;
  grad_year?: string | null;
  sport?: string | null;
  state?: string | null;
  city?: string | null;
  high_school?: string | null;
  email?: string | null;
  phone?: string | null;
  parent_name?: string | null;
  parent_email?: string | null;
  parent_phone?: string | null;
};

type RawAthleteSearchResponse = {
  success?: boolean;
  count?: number;
  results?: RawAthleteSearchResult[];
};

export type DuplicateProfileSearchRow = {
  athleteId: string;
  athleteMainId?: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  gradYear?: string | null;
  sport?: string | null;
  state?: string | null;
  city?: string | null;
  highSchool?: string | null;
  email?: string | null;
  phone?: string | null;
  parentName?: string | null;
  parentEmail?: string | null;
  parentPhone?: string | null;
};

export type DuplicateProfileResolutionItem = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  taskId: string;
  taskTitle: string;
};

export type DuplicateProfileResolutionResult = {
  searchTerm: string;
  matchCount: number;
  completed: DuplicateProfileResolutionItem[];
  skipped: Array<{ athleteId: string; reason: string }>;
};

type DuplicateProfileResolutionDeps = {
  searchRows: (args: {
    searchTerm: string;
    contactId: string;
    athleteMainId: string | null;
  }) => Promise<DuplicateProfileSearchRow[]>;
  resolveAthleteMainId: (candidate: DuplicateProfileSearchRow) => Promise<string | null>;
  loadSelectedProfile: (contactId: string, athleteMainId: string) => Promise<void>;
  fetchTasks: (athleteId: string, athleteMainId: string) => Promise<Array<Partial<ScoutAthleteTask>>>;
  updateTask: (args: {
    taskId: string;
    contactTask: string;
    athleteMainId: string;
    athleteName?: string | null;
    taskTitle?: string | null;
    description?: string | null;
    dueDate?: string | null;
    dueTime?: string | null;
    assignedOwner?: string | null;
  }) => Promise<{ success?: boolean; task_id?: string | null; message?: string | null }>;
  completeTask: (args: {
    athleteId: string;
    athleteMainId: string;
    athleteName?: string | null;
    contactTask?: string | null;
    taskId?: string | null;
    crmStage?: string | null;
    taskTitle?: string | null;
    assignedOwner?: string | null;
    description?: string | null;
  }) => Promise<{ success?: boolean; task_id?: string | null; message?: string | null }>;
  createCompletedTask: (args: {
    athleteId: string;
    athleteMainId: string;
    contactTask?: string | null;
    taskTitle: string;
    description: string;
    assignedTo: string;
    completedAt: Date;
  }) => Promise<{ success?: boolean; task_id?: string | null; message?: string | null }>;
};

function logInfo(event: string, step: string, context?: Record<string, unknown>) {
  searchLogger.info(event, {
    event,
    step,
    status: 'success',
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

export function normalizeDuplicateNamePart(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

function normalizeDuplicateEvidenceValue(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDuplicatePhone(value: string | null | undefined): string {
  return String(value || '').replace(/\D+/g, '');
}

function valuesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeDuplicateEvidenceValue(left);
  const normalizedRight = normalizeDuplicateEvidenceValue(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function phonesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeDuplicatePhone(left);
  const normalizedRight = normalizeDuplicatePhone(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function splitAthleteName(fullName: string): { firstName: string; lastName: string } {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= 1) {
    return {
      firstName: parts[0] || '',
      lastName: '',
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export function toDuplicateSearchRow(result: RawAthleteSearchResult): DuplicateProfileSearchRow | null {
  const athleteId = String(result.athlete_id || '').trim();
  const { firstName, lastName } = splitAthleteName(String(result.name || '').trim());
  if (!athleteId || !firstName || !lastName) {
    return null;
  }

  return {
    athleteId,
    athleteMainId: String(result.athlete_main_id || '').trim() || null,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    gradYear: result.grad_year || null,
    sport: result.sport || null,
    state: result.state || null,
    city: result.city || null,
    highSchool: result.high_school || null,
    email: result.email || null,
    phone: result.phone || null,
    parentName: result.parent_name || null,
    parentEmail: result.parent_email || null,
    parentPhone: result.parent_phone || null,
  };
}

export function isExactDuplicateNameMatch(
  row: DuplicateProfileSearchRow,
  target: { firstName: string; lastName: string },
): boolean {
  return (
    normalizeDuplicateNamePart(row.firstName) === normalizeDuplicateNamePart(target.firstName) &&
    normalizeDuplicateNamePart(row.lastName) === normalizeDuplicateNamePart(target.lastName)
  );
}

export function selectDuplicateCandidates(args: {
  rows: DuplicateProfileSearchRow[];
  currentAthleteId: string;
  currentAthleteMainId?: string | null;
  targetName: { firstName: string; lastName: string };
}): DuplicateProfileSearchRow[] {
  const currentAthleteId = String(args.currentAthleteId || '').trim();
  const currentAthleteMainId = String(args.currentAthleteMainId || '').trim();

  return args.rows.filter((row) => {
    if (!isExactDuplicateNameMatch(row, args.targetName)) {
      return false;
    }

    if (row.athleteId === currentAthleteId) {
      return false;
    }

    const rowMainId = String(row.athleteMainId || '').trim();
    if (currentAthleteMainId && rowMainId && rowMainId === currentAthleteMainId) {
      return false;
    }

    return true;
  });
}

export function getDuplicateIdentityEvidence(row: DuplicateProfileSearchRow, task: ScoutPortalTask): string[] {
  const evidence: string[] = [];
  if (valuesMatch(row.gradYear, task.grad_year)) evidence.push('grad_year');
  if (valuesMatch(row.sport, task.sport)) evidence.push('sport');
  if (valuesMatch(row.highSchool, task.high_school)) evidence.push('high_school');
  if (valuesMatch(row.state, task.state)) evidence.push('state');
  if (valuesMatch(row.city, task.city)) evidence.push('city');

  const taskWithContact = task as ScoutPortalTask & {
    email?: string | null;
    phone?: string | null;
    parent_name?: string | null;
    parent_email?: string | null;
    parent_phone?: string | null;
  };
  if (valuesMatch(row.email, taskWithContact.email)) evidence.push('email');
  if (phonesMatch(row.phone, taskWithContact.phone)) evidence.push('phone');
  if (valuesMatch(row.parentName, taskWithContact.parent_name)) evidence.push('parent_name');
  if (valuesMatch(row.parentEmail, taskWithContact.parent_email)) evidence.push('parent_email');
  if (phonesMatch(row.parentPhone, taskWithContact.parent_phone)) evidence.push('parent_phone');

  return evidence;
}

export function buildRepeatProfileDescription(description?: string | null): string {
  const existing = String(description || '').trim();
  if (!existing) {
    return REPEAT_PROFILE_MARKER;
  }
  if (existing.toLowerCase().includes(REPEAT_PROFILE_MARKER.toLowerCase())) {
    return existing;
  }
  return `${existing}\n${REPEAT_PROFILE_MARKER}`;
}

export function selectDuplicateCallAttempt1Task(
  tasks: Array<Partial<ScoutAthleteTask> | Partial<AthleteTaskSummary>>,
): ScoutAthleteTask | null {
  const candidates = tasks.filter((task) => {
    const completionDate = String(task.completion_date || '').trim();
    if (completionDate) {
      return false;
    }
    const title = String(stripMoveThisTaskPrefix(task.title) || '')
      .trim()
      .toLowerCase();
    return title === 'call attempt 1';
  });

  if (!candidates.length) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftId = String(left.task_id || '').trim();
    const rightId = String(right.task_id || '').trim();
    const leftNum = /^\d+$/.test(leftId) ? Number.parseInt(leftId, 10) : -1;
    const rightNum = /^\d+$/.test(rightId) ? Number.parseInt(rightId, 10) : -1;
    return rightNum - leftNum || rightId.localeCompare(leftId);
  });

  return sorted[0] as ScoutAthleteTask;
}

async function searchDuplicateRows(args: {
  searchTerm: string;
  contactId: string;
  athleteMainId: string | null;
}): Promise<DuplicateProfileSearchRow[]> {
  const athleteMainId = String(args.athleteMainId || '').trim();
  if (!athleteMainId) {
    throw new Error('Missing athlete_main_id for duplicate search');
  }

  const response = await apiFetch('/athlete/admin-duplicate-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      search_term: args.searchTerm,
      contact_id: args.contactId,
      athlete_main_id: athleteMainId,
      email: '',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText.slice(0, 200) || `Raw search HTTP ${response.status}`);
  }

  const payload = (await response.json().catch(() => ({}))) as RawAthleteSearchResponse;
  return Array.isArray(payload.results)
    ? payload.results.map(toDuplicateSearchRow).filter((row): row is DuplicateProfileSearchRow => Boolean(row))
    : [];
}

async function resolveDuplicateAthleteMainId(candidate: DuplicateProfileSearchRow): Promise<string | null> {
  const directMainId = String(candidate.athleteMainId || '').trim();
  if (directMainId) {
    return directMainId;
  }

  const { fetchScoutPrepAthleteDetails } = await import('./scout-prep');
  const details = await fetchScoutPrepAthleteDetails(candidate.athleteId);
  const athleteMainId = String(details?.athlete_main_id || '').trim();
  return athleteMainId || null;
}

async function replaySelectedProfile(contactId: string, athleteMainId: string): Promise<void> {
  await fetchContactInfo(contactId, athleteMainId);
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

async function createCompletedDuplicateRepeatTask(args: {
  athleteId: string;
  athleteMainId: string;
  contactTask?: string | null;
  taskTitle: string;
  description: string;
  assignedTo: string;
  completedAt: Date;
}): Promise<{ success?: boolean; task_id?: string | null; message?: string | null }> {
  const completedDate = formatLegacyTaskDate(args.completedAt);
  const completedTime = formatLegacyTaskTime(args.completedAt);

  const response = await apiFetch('/tasks/create-completed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: args.athleteId,
      athlete_main_id: args.athleteMainId,
      contact_task: args.contactTask || args.athleteId,
      task_title: args.taskTitle,
      description: args.description,
      due_date: completedDate,
      due_time: '00:00',
      completed_date: completedDate,
      completed_time: completedTime,
      assigned_to: args.assignedTo,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText.slice(0, 200) || `Task create HTTP ${response.status}`);
  }

  return (await response.json().catch(() => ({}))) as {
    success?: boolean;
    task_id?: string | null;
    message?: string | null;
  };
}

function createDefaultDeps(): DuplicateProfileResolutionDeps {
  return {
    searchRows: searchDuplicateRows,
    resolveAthleteMainId: resolveDuplicateAthleteMainId,
    loadSelectedProfile: replaySelectedProfile,
    fetchTasks: async (athleteId, athleteMainId) => {
      const { fetchAthleteTasks } = await import('./scout-prep');
      return fetchAthleteTasks(athleteId, athleteMainId);
    },
    updateTask: async (args) => {
      const { updateScoutPrepTask } = await import('./scout-prep');
      return updateScoutPrepTask(args);
    },
    completeTask: async (args) => {
      const { completeScoutPrepTaskAfterVoicemail } = await import('./scout-prep');
      return completeScoutPrepTaskAfterVoicemail(args);
    },
    createCompletedTask: createCompletedDuplicateRepeatTask,
  };
}

export function isCallAttempt1PortalTask(task: ScoutPortalTask): boolean {
  const title = String(stripMoveThisTaskPrefix(task.title) || '')
    .trim()
    .toLowerCase();
  return title === 'call attempt 1';
}

export async function runDuplicateProfileResolutionForTask(
  task: ScoutPortalTask,
  deps: Partial<DuplicateProfileResolutionDeps> = {},
): Promise<DuplicateProfileResolutionResult> {
  const activeDeps = { ...createDefaultDeps(), ...deps };
  if (!isCallAttempt1PortalTask(task)) {
    throw new Error('Duplicate profile check only runs for Call Attempt 1 tasks');
  }

  const athleteName = String(task.athlete_name || '').trim();
  const targetName = splitAthleteName(athleteName);
  if (!targetName.firstName || !targetName.lastName) {
    throw new Error('Need first and last name for duplicate search');
  }

  const currentAthleteId = String(task.athlete_id || task.contact_id || '').trim();
  const currentAthleteMainId = String(task.athlete_main_id || '').trim();
  if (!currentAthleteId) {
    throw new Error('Missing athlete id for duplicate search');
  }

  logInfo('SCOUT_DUPLICATE_PROFILE', 'search-start', {
    athleteId: currentAthleteId,
    athleteMainId: currentAthleteMainId || null,
    athleteName,
    emailIncluded: false,
  });

  const rows = await activeDeps.searchRows({
    searchTerm: athleteName,
    contactId: currentAthleteId,
    athleteMainId: currentAthleteMainId || null,
  });
  const matchingRows = rows.filter((row) => isExactDuplicateNameMatch(row, targetName));
  const exactNameCandidates = selectDuplicateCandidates({
    rows,
    currentAthleteId,
    currentAthleteMainId,
    targetName,
  });
  const candidates = exactNameCandidates.filter((row) => getDuplicateIdentityEvidence(row, task).length > 0);

  const result: DuplicateProfileResolutionResult = {
    searchTerm: athleteName,
    matchCount: matchingRows.length,
    completed: [],
    skipped: [],
  };

  for (const candidate of exactNameCandidates) {
    if (candidates.includes(candidate)) {
      continue;
    }
    result.skipped.push({
      athleteId: candidate.athleteId,
      reason: 'Needs secondary identity match',
    });
  }

  if (!candidates.length) {
    logInfo('SCOUT_DUPLICATE_PROFILE', 'search-complete', {
      athleteId: currentAthleteId,
      matchCount: matchingRows.length,
      duplicateCount: 0,
    });
    return result;
  }

  logInfo('SCOUT_DUPLICATE_PROFILE', 'duplicate-found', {
    athleteId: currentAthleteId,
    matchCount: matchingRows.length,
    duplicateCount: candidates.length,
  });

  for (const candidate of candidates) {
    const athleteMainId = await activeDeps.resolveAthleteMainId(candidate);
    if (!athleteMainId) {
      result.skipped.push({
        athleteId: candidate.athleteId,
        reason: 'Missing athlete_main_id',
      });
      continue;
    }

    try {
      await activeDeps.loadSelectedProfile(candidate.athleteId, athleteMainId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.skipped.push({
        athleteId: candidate.athleteId,
        reason: `athleteinfo failed: ${message}`,
      });
      continue;
    }

    try {
      const duplicateTasks = await activeDeps.fetchTasks(candidate.athleteId, athleteMainId);
      const duplicateTask = selectDuplicateCallAttempt1Task(duplicateTasks);
      if (!duplicateTask) {
        const createdTask = await activeDeps.createCompletedTask({
          athleteId: candidate.athleteId,
          athleteMainId,
          contactTask: candidate.athleteId,
          taskTitle: REPEAT_TASK_TITLE,
          description: REPEAT_TASK_DESCRIPTION,
          assignedTo: getActiveOperator().legacyUserId,
          completedAt: new Date(),
        });
        result.completed.push({
          athleteId: candidate.athleteId,
          athleteMainId,
          athleteName: candidate.fullName,
          taskId: createdTask.task_id || '',
          taskTitle: REPEAT_TASK_TITLE,
        });
        continue;
      }

      const nextDescription = buildRepeatProfileDescription(
        duplicateTask.description || duplicateTask.title || 'Call Attempt 1',
      );

      await activeDeps.updateTask({
        taskId: duplicateTask.task_id,
        contactTask: candidate.athleteId,
        athleteMainId,
        taskTitle: duplicateTask.title || 'Call Attempt 1',
        description: nextDescription,
      });

      await activeDeps.completeTask({
        athleteId: candidate.athleteId,
        athleteMainId,
        contactTask: candidate.athleteId,
        taskId: duplicateTask.task_id,
        taskTitle: duplicateTask.title || 'Call Attempt 1',
        assignedOwner: duplicateTask.assigned_owner,
        description: nextDescription,
      });

      result.completed.push({
        athleteId: candidate.athleteId,
        athleteMainId,
        athleteName: candidate.fullName,
        taskId: duplicateTask.task_id,
        taskTitle: duplicateTask.title || 'Call Attempt 1',
      });
    } catch (error) {
      result.skipped.push({
        athleteId: candidate.athleteId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (result.skipped.length) {
    logFailure('SCOUT_DUPLICATE_PROFILE', 'partial-complete', result.skipped[0].reason, {
      athleteId: currentAthleteId,
      completedCount: result.completed.length,
      skippedCount: result.skipped.length,
    });
  } else {
    logInfo('SCOUT_DUPLICATE_PROFILE', 'complete', {
      athleteId: currentAthleteId,
      completedCount: result.completed.length,
      skippedCount: 0,
    });
  }

  return result;
}
