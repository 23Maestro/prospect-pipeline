import fs from 'fs';
import path from 'path';
import { apiFetch } from './fastapi-client';
import { fetchContactInfo, type ContactInfo } from './npid-mcp-adapter';
import { searchLogger } from './logger';
import type { ScoutAthleteTask, ScoutPortalTask } from '../features/scout-prep/types';
import { stripMoveThisTaskPrefix } from '../domain/scout-task-selection';
import type { AthleteTaskSummary } from '../types/athlete-workflows';
import { getActiveOperator } from '../domain/owners';

const FEATURE = 'scout-duplicate-profiles';
const REPEAT_PROFILE_MARKER = 'Repeat Profile';
const REPEAT_TASK_TITLE = 'REPEAT';
const REPEAT_TASK_DESCRIPTION = '';
const DUPLICATE_PROFILE_CHECK_LOG_FILE = path.join(
  process.env.RAYCAST_LOG_DIR || `${process.env.HOME || ''}/raycast_logs`,
  'scout-duplicate-profile-checks.json',
);
const DUPLICATE_PROFILE_CHECK_LOG_LIMIT = 500;

const APOSTROPHE_VARIANT_PATTERN = /(?:\u00e2\u20ac[\u2122\u02dc]|\u201a\u00c4[\u00f4\u00f2]|\u2019|\u2018|\u02bc|\u00b4|`)/g;

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
  cleared: Array<{ athleteId: string; reason: string }>;
  skipped: Array<{ athleteId: string; reason: string }>;
};

export type DuplicateProfileToastSummary = {
  status: 'success' | 'failure';
  title: 'No duplicate' | 'Review duplicate' | 'Repeat marked';
  message: string;
};

type DuplicateProfileIdentityDetails = {
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  name?: string | null;
  grad_year?: string | null;
  sport?: string | null;
  high_school?: string | null;
  city?: string | null;
  state?: string | null;
};

export type DuplicateProfileDecision = {
  isDuplicate: boolean;
  reason: string;
  evidence: string[];
};

type DuplicateProfileEnvelope = {
  athleteId: string;
  athleteMainId: string | null;
  name: { firstName: string; lastName: string; fullName: string };
  profile: {
    gradYear: string | null;
    sport: string | null;
    highSchool: string | null;
    city: string | null;
    state: string | null;
  };
  contacts: {
    student: { name: string | null; phone: string | null; email: string | null };
    parent1: { name: string | null; phone: string | null; email: string | null } | null;
    parent2: { name: string | null; phone: string | null; email: string | null } | null;
  };
};

type DuplicateProfileResolutionDeps = {
  searchRows: (args: {
    searchTerm: string;
    contactId: string;
    athleteMainId: string | null;
  }) => Promise<DuplicateProfileSearchRow[]>;
  resolveAthleteMainId: (candidate: DuplicateProfileSearchRow) => Promise<string | null>;
  fetchAthleteDetails: (athleteId: string) => Promise<DuplicateProfileIdentityDetails | null>;
  loadContactInfo: (contactId: string, athleteMainId: string) => Promise<ContactInfo>;
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
  createRepeatTask: (args: {
    athleteId: string;
    athleteMainId: string;
    contactTask?: string | null;
    taskTitle: string;
    description: string;
    assignedTo: string;
    completedAt: Date;
  }) => Promise<{ success?: boolean; task_id?: string | null; message?: string | null }>;
};

type StorageLike = {
  read: () => Promise<string | undefined>;
  write: (value: string) => Promise<void>;
};

export type DuplicateProfileCheckOutcome = 'no_duplicate' | 'repeat_marked' | 'needs_review' | 'check_failed';

export type DuplicateProfileCheckLogEntry = {
  key: string;
  checkedAt: string;
  outcome: DuplicateProfileCheckOutcome;
  title: DuplicateProfileToastSummary['title'] | 'Check failed';
  taskId: string | null;
  athleteId: string | null;
  athleteMainId: string | null;
  taskTitle: string | null;
  matchCount: number | null;
  completedCount: number;
  clearedCount: number;
  skippedCount: number;
  error?: string;
};

function logInfo(event: string, step: string, context?: Record<string, unknown>) {
  searchLogger.info(event, {
    event,
    step,
    status: step.endsWith('start') ? 'start' : 'success',
    feature: FEATURE,
    context: context || {},
  });
}

function normalizeDuplicateCheckKeyPart(value: string | null | undefined): string {
  return String(value || '').trim();
}

export function buildDuplicateProfileCheckKey(task: ScoutPortalTask): string {
  const taskId = normalizeDuplicateCheckKeyPart(task.task_id);
  if (taskId) return `task:${taskId}`;

  const athleteId = normalizeDuplicateCheckKeyPart(task.athlete_id || task.contact_id);
  const athleteMainId = normalizeDuplicateCheckKeyPart(task.athlete_main_id);
  const taskTitle = normalizeDuplicateCheckKeyPart(task.title).toLowerCase();
  const dueDate = normalizeDuplicateCheckKeyPart(task.due_date);
  return ['profile', athleteId, athleteMainId, taskTitle, dueDate].join(':');
}

function parseDuplicateProfileCheckLog(raw: string | undefined): DuplicateProfileCheckLogEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is DuplicateProfileCheckLogEntry => {
      return Boolean(entry && typeof entry === 'object' && typeof (entry as { key?: unknown }).key === 'string');
    });
  } catch {
    return [];
  }
}

export async function loadDuplicateProfileCheckLog(
  storage?: StorageLike,
): Promise<DuplicateProfileCheckLogEntry[]> {
  const raw = storage
    ? await storage.read()
    : fs.existsSync(DUPLICATE_PROFILE_CHECK_LOG_FILE)
      ? await fs.promises.readFile(DUPLICATE_PROFILE_CHECK_LOG_FILE, 'utf8')
      : undefined;
  return parseDuplicateProfileCheckLog(raw);
}

async function saveDuplicateProfileCheckLog(
  entries: DuplicateProfileCheckLogEntry[],
  storage?: StorageLike,
): Promise<void> {
  const payload = JSON.stringify(entries.slice(0, DUPLICATE_PROFILE_CHECK_LOG_LIMIT), null, 2);
  if (storage) {
    await storage.write(payload);
    return;
  }
  await fs.promises.mkdir(path.dirname(DUPLICATE_PROFILE_CHECK_LOG_FILE), { recursive: true });
  await fs.promises.writeFile(DUPLICATE_PROFILE_CHECK_LOG_FILE, `${payload}\n`, 'utf8');
}

export function isDuplicateProfileTaskAlreadyChecked(
  task: ScoutPortalTask,
  entries: DuplicateProfileCheckLogEntry[],
): boolean {
  const key = buildDuplicateProfileCheckKey(task);
  return entries.some((entry) => entry.key === key && entry.outcome !== 'check_failed');
}

export function filterUncheckedDuplicateProfileTasks(
  tasks: ScoutPortalTask[],
  entries: DuplicateProfileCheckLogEntry[],
): ScoutPortalTask[] {
  return tasks.filter((task) => !isDuplicateProfileTaskAlreadyChecked(task, entries));
}

function resolveDuplicateProfileOutcome(summary: DuplicateProfileToastSummary): DuplicateProfileCheckOutcome {
  switch (summary.title) {
    case 'Repeat marked':
      return 'repeat_marked';
    case 'Review duplicate':
      return 'needs_review';
    case 'No duplicate':
    default:
      return 'no_duplicate';
  }
}

export async function recordDuplicateProfileCheckResult(args: {
  task: ScoutPortalTask;
  result: DuplicateProfileResolutionResult;
  summary: DuplicateProfileToastSummary;
  storage?: StorageLike;
}): Promise<DuplicateProfileCheckLogEntry> {
  const entry: DuplicateProfileCheckLogEntry = {
    key: buildDuplicateProfileCheckKey(args.task),
    checkedAt: new Date().toISOString(),
    outcome: resolveDuplicateProfileOutcome(args.summary),
    title: args.summary.title,
    taskId: normalizeDuplicateCheckKeyPart(args.task.task_id) || null,
    athleteId: normalizeDuplicateCheckKeyPart(args.task.athlete_id || args.task.contact_id) || null,
    athleteMainId: normalizeDuplicateCheckKeyPart(args.task.athlete_main_id) || null,
    taskTitle: normalizeDuplicateCheckKeyPart(args.task.title) || null,
    matchCount: args.result.matchCount,
    completedCount: args.result.completed.length,
    clearedCount: args.result.cleared.length,
    skippedCount: args.result.skipped.length,
  };
  const existing = await loadDuplicateProfileCheckLog(args.storage);
  await saveDuplicateProfileCheckLog(
    [entry, ...existing.filter((candidate) => candidate.key !== entry.key)],
    args.storage,
  );
  logInfo('SCOUT_DUPLICATE_PROFILE_CHECK_LOG', 'record-success', {
    key: entry.key,
    outcome: entry.outcome,
    taskId: entry.taskId,
    athleteId: entry.athleteId,
  });
  return entry;
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
  return normalizeDuplicateAthleteName(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

export function normalizeDuplicateAthleteName(value: string | null | undefined): string {
  return String(value || '')
    .replace(APOSTROPHE_VARIANT_PATTERN, "'")
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDuplicateAthleteNameForLegacySearch(value: string | null | undefined): string {
  return normalizeDuplicateAthleteName(value).replace(/'/g, '’');
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

function emailsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  return valuesMatch(left, right);
}

export function splitAthleteName(fullName: string): { firstName: string; lastName: string } {
  const parts = normalizeDuplicateAthleteName(fullName)
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
  const { firstName, lastName } = splitAthleteName(normalizeDuplicateAthleteName(result.name));
  if (!athleteId || !firstName || !lastName) {
    return null;
  }

  return {
    athleteId,
    athleteMainId: String(result.athlete_main_id || '').trim() || null,
    firstName,
    lastName,
    fullName: normalizeDuplicateAthleteName(`${firstName} ${lastName}`),
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

export function getDuplicateSearchRowClearReason(row: DuplicateProfileSearchRow, task: ScoutPortalTask): string | null {
  const currentGradYear = normalizeDuplicateEvidenceValue(task.grad_year);
  const candidateGradYear = normalizeDuplicateEvidenceValue(row.gradYear);
  if (currentGradYear && candidateGradYear && currentGradYear !== candidateGradYear) {
    return 'different_grad_year_table_clear';
  }

  const currentState = normalizeDuplicateEvidenceValue(task.state);
  const candidateState = normalizeDuplicateEvidenceValue(row.state);
  const sameState = Boolean(currentState && candidateState && currentState === candidateState);

  if (currentState && candidateState && !sameState) {
    return 'different_state_table_clear';
  }

  return null;
}

function buildContactProfileEnvelope(args: {
  athleteId: string;
  athleteMainId: string | null;
  fullName: string;
  row?: DuplicateProfileSearchRow | null;
  task?: ScoutPortalTask | null;
  details?: DuplicateProfileIdentityDetails | null;
  contactInfo: ContactInfo;
}): DuplicateProfileEnvelope {
  const splitName = splitAthleteName(
    args.contactInfo.studentAthlete?.name || args.details?.name || args.fullName,
  );
  return {
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    name: {
      firstName: splitName.firstName,
      lastName: splitName.lastName,
      fullName: [splitName.firstName, splitName.lastName].filter(Boolean).join(' '),
    },
    profile: {
      gradYear: args.task?.grad_year || args.details?.grad_year || args.row?.gradYear || null,
      sport: args.task?.sport || args.details?.sport || args.row?.sport || null,
      highSchool: args.task?.high_school || args.details?.high_school || args.row?.highSchool || null,
      city: args.task?.city || args.details?.city || args.row?.city || null,
      state: args.task?.state || args.details?.state || args.row?.state || null,
    },
    contacts: {
      student: {
        name: args.contactInfo.studentAthlete?.name || null,
        phone: args.contactInfo.studentAthlete?.phone || null,
        email: args.contactInfo.studentAthlete?.email || null,
      },
      parent1: args.contactInfo.parent1
        ? {
            name: args.contactInfo.parent1.name || null,
            phone: args.contactInfo.parent1.phone || null,
            email: args.contactInfo.parent1.email || null,
          }
        : null,
      parent2: args.contactInfo.parent2
        ? {
            name: args.contactInfo.parent2.name || null,
            phone: args.contactInfo.parent2.phone || null,
            email: args.contactInfo.parent2.email || null,
          }
        : null,
    },
  };
}

function collectContactValues(envelope: DuplicateProfileEnvelope) {
  const contacts = [envelope.contacts.student, envelope.contacts.parent1, envelope.contacts.parent2].filter(
    Boolean,
  ) as Array<{ name: string | null; phone: string | null; email: string | null }>;
  return contacts;
}

export function classifyDuplicateProfileEnvelope(args: {
  current: DuplicateProfileEnvelope;
  candidate: DuplicateProfileEnvelope;
}): DuplicateProfileDecision {
  const evidence = new Set<string>();
  const currentContacts = collectContactValues(args.current);
  const candidateContacts = collectContactValues(args.candidate);

  for (const currentContact of currentContacts) {
    for (const candidateContact of candidateContacts) {
      if (phonesMatch(currentContact.phone, candidateContact.phone)) evidence.add('contact_phone');
      if (emailsMatch(currentContact.email, candidateContact.email)) evidence.add('contact_email');
    }
  }

  if (valuesMatch(args.current.profile.gradYear, args.candidate.profile.gradYear)) evidence.add('grad_year');
  if (valuesMatch(args.current.profile.sport, args.candidate.profile.sport)) evidence.add('sport');
  if (valuesMatch(args.current.profile.state, args.candidate.profile.state)) evidence.add('state');
  if (valuesMatch(args.current.profile.city, args.candidate.profile.city)) evidence.add('city');
  if (valuesMatch(args.current.profile.highSchool, args.candidate.profile.highSchool)) evidence.add('high_school');

  const evidenceList = [...evidence];
  const hasContactMatch = evidence.has('contact_phone') || evidence.has('contact_email');
  const sameGradYear = evidence.has('grad_year');
  const sameSport = evidence.has('sport');
  const sameState = evidence.has('state');
  const differentGradYear = Boolean(
    normalizeDuplicateEvidenceValue(args.current.profile.gradYear) &&
      normalizeDuplicateEvidenceValue(args.candidate.profile.gradYear) &&
      !sameGradYear,
  );
  const differentState = Boolean(
    normalizeDuplicateEvidenceValue(args.current.profile.state) &&
      normalizeDuplicateEvidenceValue(args.candidate.profile.state) &&
      !sameState,
  );
  const differentSport = Boolean(
    normalizeDuplicateEvidenceValue(args.current.profile.sport) &&
      normalizeDuplicateEvidenceValue(args.candidate.profile.sport) &&
      !sameSport,
  );

  if (hasContactMatch && sameGradYear && differentSport && sameState) {
    return { isDuplicate: true, reason: 'likely_same_kid_multi_sport', evidence: evidenceList };
  }

  if (differentState) {
    return { isDuplicate: false, reason: 'different_state_table_clear', evidence: evidenceList };
  }

  if (hasContactMatch && differentGradYear) {
    return { isDuplicate: true, reason: 'contact_match_different_grad_year', evidence: evidenceList };
  }

  if (hasContactMatch) {
    return { isDuplicate: true, reason: 'contact_match', evidence: evidenceList };
  }

  if (sameGradYear && sameSport && sameState) {
    return { isDuplicate: true, reason: 'table_profile_match', evidence: evidenceList };
  }

  if (differentSport) {
    return { isDuplicate: false, reason: 'different_sport_contact_mismatch', evidence: evidenceList };
  }

  if (evidenceList.length) {
    return { isDuplicate: false, reason: 'needs_contact_match', evidence: evidenceList };
  }

  return { isDuplicate: false, reason: 'needs_secondary_identity_match', evidence: evidenceList };
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

export function summarizeDuplicateProfileResolutionToast(args: {
  result: DuplicateProfileResolutionResult;
  athleteName: string;
}): DuplicateProfileToastSummary {
  if (!args.result.completed.length && !args.result.skipped.length) {
    return {
      status: 'success',
      title: 'No duplicate',
      message: args.athleteName,
    };
  }

  if (!args.result.completed.length && args.result.skipped.length) {
    return {
      status: 'failure',
      title: 'Review duplicate',
      message: args.result.skipped[0]?.reason || 'No duplicate task updated',
    };
  }

  return {
    status: 'success',
    title: 'Repeat marked',
    message: args.result.skipped.length
      ? `${args.result.completed.length} marked, ${args.result.skipped.length} review`
      : `${args.result.completed.length} marked`,
  };
}

function taskHasRepeatProfileMarker(task: Partial<ScoutAthleteTask> | Partial<AthleteTaskSummary>): boolean {
  const title = String(task.title || '').trim().toLowerCase();
  if (title === REPEAT_TASK_TITLE.toLowerCase()) {
    return true;
  }
  return `${task.title || ''}\n${task.description || ''}`
    .toLowerCase()
    .includes(REPEAT_PROFILE_MARKER.toLowerCase());
}

function isOpenCallAttempt1Task(task: Partial<ScoutAthleteTask> | Partial<AthleteTaskSummary>): boolean {
  const completionDate = String(task.completion_date || '').trim();
  if (completionDate) {
    return false;
  }
  const title = String(stripMoveThisTaskPrefix(task.title) || '')
    .trim()
    .toLowerCase();
  return title === 'call attempt 1';
}

function isTaskAssignedToActiveOperator(task: Partial<ScoutAthleteTask> | Partial<AthleteTaskSummary>): boolean {
  const assignedOwner = String(task.assigned_owner || '').trim().toLowerCase();
  const activeOwner = getActiveOperator().taskAssignedOwnerName.trim().toLowerCase();
  return Boolean(assignedOwner && activeOwner && assignedOwner === activeOwner);
}

export function selectDuplicateCallAttempt1Task(
  tasks: Array<Partial<ScoutAthleteTask> | Partial<AthleteTaskSummary>>,
): ScoutAthleteTask | null {
  const candidates = tasks.filter((task) => {
    const taskId = String(task.task_id || '').trim();
    if (!taskId) {
      return false;
    }
    return isOpenCallAttempt1Task(task);
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

async function loadDuplicateContactInfo(contactId: string, athleteMainId: string): Promise<ContactInfo> {
  return fetchContactInfo(contactId, athleteMainId);
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

async function createDuplicateRepeatTask(args: {
  athleteId: string;
  athleteMainId: string;
  contactTask?: string | null;
  taskTitle: string;
  description: string;
  assignedTo: string;
  completedAt: Date;
}): Promise<{ success?: boolean; task_id?: string | null; message?: string | null }> {
  const completedDate = formatLegacyTaskDate(args.completedAt);

  const response = await apiFetch('/tasks/create', {
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
    fetchAthleteDetails: async (athleteId) => {
      const { fetchScoutPrepAthleteDetails } = await import('./scout-prep');
      return fetchScoutPrepAthleteDetails(athleteId);
    },
    loadContactInfo: loadDuplicateContactInfo,
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
    createRepeatTask: createDuplicateRepeatTask,
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

  const rawAthleteName = String(task.athlete_name || '').trim();
  const athleteName = normalizeDuplicateAthleteName(rawAthleteName);
  const legacySearchName = normalizeDuplicateAthleteNameForLegacySearch(rawAthleteName || athleteName);
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
    hasAthleteName: Boolean(athleteName),
    sourceTaskTitle: String(task.title || '').trim() || null,
    sourceIsCallAttempt1: isCallAttempt1PortalTask(task),
    emailIncluded: false,
  });

  const searchTerms = [...new Set([legacySearchName, athleteName].filter(Boolean))];
  let rows: DuplicateProfileSearchRow[] = [];
  let usedSearchTerm = searchTerms[0] || athleteName;
  for (const searchTerm of searchTerms) {
    rows = await activeDeps.searchRows({
      searchTerm,
      contactId: currentAthleteId,
      athleteMainId: currentAthleteMainId || null,
    });
    usedSearchTerm = searchTerm;
    if (rows.some((row) => isExactDuplicateNameMatch(row, targetName))) {
      break;
    }
  }
  const matchingRows = rows.filter((row) => isExactDuplicateNameMatch(row, targetName));
  const exactNameCandidates = selectDuplicateCandidates({
    rows,
    currentAthleteId,
    currentAthleteMainId,
    targetName,
  });
  const result: DuplicateProfileResolutionResult = {
    searchTerm: usedSearchTerm,
    matchCount: matchingRows.length,
    completed: [],
    cleared: [],
    skipped: [],
  };

  if (!exactNameCandidates.length) {
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
    duplicateCount: exactNameCandidates.length,
  });

  const candidatesNeedingEnvelope: DuplicateProfileSearchRow[] = [];
  for (const candidate of exactNameCandidates) {
    const clearReason = getDuplicateSearchRowClearReason(candidate, task);
    if (clearReason) {
      result.cleared.push({
        athleteId: candidate.athleteId,
        reason: clearReason,
      });
      logInfo('SCOUT_DUPLICATE_PROFILE', 'candidate-cleared', {
        athleteId: currentAthleteId,
        candidateAthleteId: candidate.athleteId,
        reason: clearReason,
      });
      continue;
    }
    candidatesNeedingEnvelope.push(candidate);
  }

  if (!candidatesNeedingEnvelope.length) {
    logInfo('SCOUT_DUPLICATE_PROFILE', 'complete', {
      athleteId: currentAthleteId,
      completedCount: 0,
      clearedCount: result.cleared.length,
      skippedCount: 0,
    });
    return result;
  }

  let currentContactInfo: ContactInfo;
  try {
    currentContactInfo = await activeDeps.loadContactInfo(currentAthleteId, currentAthleteMainId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logFailure('SCOUT_DUPLICATE_PROFILE', 'current-envelope', message, {
      athleteId: currentAthleteId,
      athleteMainId: currentAthleteMainId,
    });
    throw error;
  }

  const currentDetails = await activeDeps.fetchAthleteDetails(currentAthleteId);
  const currentEnvelope = buildContactProfileEnvelope({
    athleteId: currentAthleteId,
    athleteMainId: currentAthleteMainId || null,
    fullName: athleteName,
    task,
    details: currentDetails,
    contactInfo: currentContactInfo,
  });

  for (const candidate of candidatesNeedingEnvelope) {
    const athleteMainId = await activeDeps.resolveAthleteMainId(candidate);
    if (!athleteMainId) {
      result.skipped.push({
        athleteId: candidate.athleteId,
        reason: 'Missing athlete_main_id',
      });
      continue;
    }

    const candidateDetails = await activeDeps.fetchAthleteDetails(candidate.athleteId);
    let candidateContactInfo: ContactInfo;
    try {
      candidateContactInfo = await activeDeps.loadContactInfo(candidate.athleteId, athleteMainId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.skipped.push({
        athleteId: candidate.athleteId,
        reason: `athleteinfo failed: ${message}`,
      });
      continue;
    }

    const candidateEnvelope = buildContactProfileEnvelope({
      athleteId: candidate.athleteId,
      athleteMainId,
      fullName: candidate.fullName,
      row: candidate,
      details: candidateDetails,
      contactInfo: candidateContactInfo,
    });
    const decision = classifyDuplicateProfileEnvelope({
      current: currentEnvelope,
      candidate: candidateEnvelope,
    });

    logInfo('SCOUT_DUPLICATE_PROFILE', 'candidate-classified', {
      athleteId: currentAthleteId,
      candidateAthleteId: candidate.athleteId,
      reason: decision.reason,
      isDuplicate: decision.isDuplicate,
      evidence: decision.evidence,
    });

    if (!decision.isDuplicate) {
      result.skipped.push({
        athleteId: candidate.athleteId,
        reason: decision.reason,
      });
      continue;
    }

    try {
      const duplicateTasks = await activeDeps.fetchTasks(candidate.athleteId, athleteMainId);
      const candidateAlreadyMarkedRepeat = duplicateTasks.some(taskHasRepeatProfileMarker);
      if (candidateAlreadyMarkedRepeat) {
        const currentTaskId = String(task.task_id || '').trim();
        const currentCompletionDate = String(task.completion_date || '').trim();
        const currentIsCallAttempt1 = isCallAttempt1PortalTask(task);
        if (!currentTaskId) {
          result.skipped.push({
            athleteId: candidate.athleteId,
            reason: 'repeat_profile_already_marked_missing_current_task_id',
          });
          continue;
        }
        if (!currentIsCallAttempt1) {
          result.skipped.push({
            athleteId: candidate.athleteId,
            reason: 'repeat_profile_already_marked_current_not_call_attempt_1',
          });
          continue;
        }
        if (currentCompletionDate) {
          result.skipped.push({
            athleteId: candidate.athleteId,
            reason: 'repeat_profile_already_marked_current_complete',
          });
          continue;
        }

        logInfo('SCOUT_DUPLICATE_PROFILE', 'candidate-repeat-marker', {
          athleteId: currentAthleteId,
          candidateAthleteId: candidate.athleteId,
          action: 'complete_current_call_attempt_1',
        });

        await activeDeps.completeTask({
          athleteId: currentAthleteId,
          athleteMainId: currentAthleteMainId,
          contactTask: currentAthleteId,
          taskId: currentTaskId,
          taskTitle: task.title || 'Call Attempt 1',
          assignedOwner: task.assigned_owner,
          description: task.description || null,
        });

        result.completed.push({
          athleteId: currentAthleteId,
          athleteMainId: currentAthleteMainId,
          athleteName,
          taskId: currentTaskId,
          taskTitle: task.title || 'Call Attempt 1',
        });
        continue;
      }

      const duplicateTask = selectDuplicateCallAttempt1Task(duplicateTasks);
      if (!duplicateTask) {
        const hasUnaddressableCallAttempt1 = duplicateTasks.some((duplicateTask) => {
          return isOpenCallAttempt1Task(duplicateTask) && !String(duplicateTask.task_id || '').trim();
        });
        if (hasUnaddressableCallAttempt1) {
          result.skipped.push({
            athleteId: candidate.athleteId,
            reason: 'duplicate_call_attempt_1_missing_task_id',
          });
          continue;
        }

        const createdTask = await activeDeps.createRepeatTask({
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

      if (!isTaskAssignedToActiveOperator(duplicateTask)) {
        logInfo('SCOUT_DUPLICATE_PROFILE', 'candidate-other-owner-call-attempt', {
          athleteId: currentAthleteId,
          candidateAthleteId: candidate.athleteId,
          duplicateTaskId: duplicateTask.task_id,
          assignedOwner: duplicateTask.assigned_owner || null,
          action: 'create_repeat_task',
        });

        const createdTask = await activeDeps.createRepeatTask({
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
      clearedCount: result.cleared.length,
      skippedCount: result.skipped.length,
    });
  } else {
    logInfo('SCOUT_DUPLICATE_PROFILE', 'complete', {
      athleteId: currentAthleteId,
      completedCount: result.completed.length,
      clearedCount: result.cleared.length,
      skippedCount: 0,
    });
  }

  return result;
}
