import { buildAthleteKey } from './athlete-identity';
import { getActiveOperator } from './owners';

export type BookedMeetingSourceEvent = {
  event_id?: string | number | null;
  title?: string | null;
  assigned_owner?: string | null;
  start?: string | null;
  end?: string | null;
  date_time_label?: string | null;
};

export type BookedMeetingSourceTask = {
  task_id?: string | number | null;
  contact_id?: string | number | null;
  athlete_id?: string | number | null;
  athlete_main_id?: string | number | null;
  athlete_name?: string | null;
  assigned_owner?: string | null;
  title?: string | null;
  description?: string | null;
  due_date?: string | null;
  completion_date?: string | null;
};

export type WeeklyOperatorMeetingSetCandidate = {
  athleteKey: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  taskId: string;
  taskTitle: string | null;
  taskDescription: string | null;
  taskDueDate: string | null;
  taskCompletionDate: string | null;
  taskAssignedOwner: string | null;
  bookedMeeting: {
    eventId: string;
    title: string;
    assignedOwner: string | null;
    start: string;
    end: string | null;
    dateTimeLabel: string | null;
  };
  evidence: {
    source: 'weekly_booked_meetings_with_operator_confirmation_task';
    operatorName: string;
    matchedTaskAthleteName: string;
    cleanedMeetingTitle: string;
  };
};

export type BookedMeetingTitleOutcome =
  | 'active'
  | 'soft_archive_follow_up'
  | 'soft_archive_canceled'
  | 'soft_archive_no_show'
  | 'reschedule_pending'
  | 'terminal_enrollment'
  | 'terminal_close_lost';

const ENROLLMENT_PREFIX_PATTERN = /^\s*\(ENR(?:\s+\$?([0-9]+(?:\.[0-9]{1,2})?)?[^)]*)?\)\s*/i;
const RESCHEDULE_PENDING_PREFIX_PATTERN = /^\s*\(RSP\)(?:\*\d+)?\s*/i;
const CLOSE_LOST_PREFIX_PATTERN = /^\s*\(CL\)(?:\*\d+)?\s*/i;
const FOLLOW_UP_PREFIX_PATTERN = /^\s*\(FU\)(?:\*\d+)?\s*/i;
const CANCELED_PREFIX_PATTERN = /^\s*\(CAN\)(?:\*\d+)?\s*/i;
const NO_SHOW_PREFIX_PATTERN = /^\s*\(NS\)(?:\*\d+)?\s*/i;
export const ACTIVE_BOOKED_MEETING_CONFIRMATION_PREFIXES = ['(ACF)', '(CF)', '(ACF*2)'] as const;
export const NON_ACTIVE_BOOKED_MEETING_PREFIXES = ['(ENR)', '(FU)', '(CL)', '(CAN)', '(NS)', '(RSP)'] as const;

function normalizeText(value?: string | number | null): string {
  return String(value || '').trim();
}

export function normalizeAthleteMatchKey(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function cleanMeetingResolveTitle(title?: string | null): string {
  return String(title || '')
    .trim()
    .replace(/^Follow Up -\s*/i, '')
    .replace(/^\(NS\)\*2\s*/i, '')
    .replace(/^\((?:ACF\*?2?|CF|RSP|CAN|FU|CL|NS|\*)\)\s*/i, '')
    .trim();
}

export function resolveBookedMeetingTitleOutcome(title?: string | null): BookedMeetingTitleOutcome {
  const trimmed = normalizeText(title);
  if (!trimmed) return 'active';
  if (ENROLLMENT_PREFIX_PATTERN.test(trimmed)) return 'terminal_enrollment';
  if (RESCHEDULE_PENDING_PREFIX_PATTERN.test(trimmed)) return 'reschedule_pending';
  if (CLOSE_LOST_PREFIX_PATTERN.test(trimmed)) return 'terminal_close_lost';
  if (FOLLOW_UP_PREFIX_PATTERN.test(trimmed)) return 'soft_archive_follow_up';
  if (CANCELED_PREFIX_PATTERN.test(trimmed)) return 'soft_archive_canceled';
  if (NO_SHOW_PREFIX_PATTERN.test(trimmed)) return 'soft_archive_no_show';
  return 'active';
}

// Prospect ID calendar contract:
// ACF/CF/ACF*2 are active confirmation states and still count as booked meeting-set evidence.
// ENR/FU/CL/CAN/NS/RSP are non-active or terminal outcomes and do not count as active meeting-set facts.
export function isActualSetMeetingTitle(title?: string | null): boolean {
  const trimmed = normalizeText(title);
  if (!trimmed) return false;
  if (resolveBookedMeetingTitleOutcome(trimmed) !== 'active') return false;

  const normalized = trimmed.toLowerCase();
  return !(
    normalized === 'open' ||
    normalized === 'coaching session' ||
    normalized.startsWith('follow up -') ||
    normalized.startsWith('(*)')
  );
}

function isConfirmationTask(task: BookedMeetingSourceTask, operatorName: string): boolean {
  const title = normalizeText(task.title).toLowerCase();
  const description = normalizeText(task.description).toLowerCase();
  const assignedOwner = normalizeText(task.assigned_owner).toLowerCase();
  return (
    assignedOwner === operatorName.trim().toLowerCase() &&
    (title.includes('confirmation call') || description.includes('confirm the meeting set'))
  );
}

function pickOperatorConfirmationTask(tasks: BookedMeetingSourceTask[], operatorName: string) {
  const matches = tasks.filter((task) => isConfirmationTask(task, operatorName));
  if (!matches.length) return null;

  return [...matches].sort((left, right) => {
    const leftCompleted = normalizeText(left.completion_date);
    const rightCompleted = normalizeText(right.completion_date);
    if (!leftCompleted && rightCompleted) return -1;
    if (leftCompleted && !rightCompleted) return 1;

    const leftDate = Date.parse(normalizeText(left.due_date));
    const rightDate = Date.parse(normalizeText(right.due_date));
    if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate) && leftDate !== rightDate) {
      return rightDate - leftDate;
    }

    return normalizeText(right.task_id).localeCompare(normalizeText(left.task_id));
  })[0];
}

function resolveAthleteDisplayName(taskName: string, eventTitle: string): string {
  const cleanedTitle = cleanMeetingResolveTitle(eventTitle);
  const normalizedTitle = cleanedTitle.toLowerCase();
  const normalizedTaskName = taskName.trim().toLowerCase();
  const startIndex = normalizedTitle.indexOf(normalizedTaskName);
  if (startIndex >= 0) {
    return cleanedTitle.slice(startIndex, startIndex + normalizedTaskName.length).trim();
  }
  return taskName.trim();
}

export function buildWeeklyOperatorMeetingSetCandidates(args: {
  bookedMeetings: BookedMeetingSourceEvent[];
  tasks: BookedMeetingSourceTask[];
  operatorName?: string;
}): WeeklyOperatorMeetingSetCandidate[] {
  const operatorName = normalizeText(args.operatorName) || getActiveOperator().taskAssignedOwnerName;
  const tasksByAthlete = new Map<string, BookedMeetingSourceTask[]>();

  for (const task of args.tasks || []) {
    if (!isConfirmationTask(task, operatorName)) continue;
    const key = normalizeAthleteMatchKey(task.athlete_name);
    if (!key) continue;
    const existing = tasksByAthlete.get(key) || [];
    existing.push(task);
    tasksByAthlete.set(key, existing);
  }

  const candidates: WeeklyOperatorMeetingSetCandidate[] = [];
  for (const event of args.bookedMeetings || []) {
    if (!isActualSetMeetingTitle(event.title)) continue;

    const eventId = normalizeText(event.event_id);
    const start = normalizeText(event.start);
    const title = normalizeText(event.title);
    if (!eventId || !start || !title) continue;

    const cleanedTitle = cleanMeetingResolveTitle(title);
    const cleanedTitleKey = normalizeAthleteMatchKey(cleanedTitle);
    const matchingTaskEntry = Array.from(tasksByAthlete.entries()).find(([athleteKey]) =>
      cleanedTitleKey.includes(athleteKey),
    );
    if (!matchingTaskEntry) continue;

    const [athleteKey, matchingTasks] = matchingTaskEntry;
    const task = pickOperatorConfirmationTask(matchingTasks, operatorName);
    if (!task) continue;

    const athleteId = normalizeText(task.athlete_id) || normalizeText(task.contact_id);
    const athleteMainId = normalizeText(task.athlete_main_id);
    const matchedTaskAthleteName = normalizeText(task.athlete_name);
    if (!athleteId || !athleteMainId || !matchedTaskAthleteName) continue;

    candidates.push({
      athleteKey: buildAthleteKey(athleteId, athleteMainId),
      athleteId,
      athleteMainId,
      athleteName: resolveAthleteDisplayName(matchedTaskAthleteName, title),
      taskId: normalizeText(task.task_id),
      taskTitle: normalizeText(task.title) || null,
      taskDescription: normalizeText(task.description) || null,
      taskDueDate: normalizeText(task.due_date) || null,
      taskCompletionDate: normalizeText(task.completion_date) || null,
      taskAssignedOwner: normalizeText(task.assigned_owner) || null,
      bookedMeeting: {
        eventId,
        title,
        assignedOwner: normalizeText(event.assigned_owner) || null,
        start,
        end: normalizeText(event.end) || null,
        dateTimeLabel: normalizeText(event.date_time_label) || null,
      },
      evidence: {
        source: 'weekly_booked_meetings_with_operator_confirmation_task',
        operatorName,
        matchedTaskAthleteName,
        cleanedMeetingTitle: cleanedTitle,
      },
    });

    tasksByAthlete.delete(athleteKey);
  }

  return candidates.sort((left, right) => {
    const dateDiff = Date.parse(left.bookedMeeting.start) - Date.parse(right.bookedMeeting.start);
    if (!Number.isNaN(dateDiff) && dateDiff !== 0) return dateDiff;
    return left.athleteName.localeCompare(right.athleteName);
  });
}
