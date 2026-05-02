export type ScoutTaskStatus =
  | 'call_attempt_1'
  | 'call_attempt_2'
  | 'call_attempt_3'
  | 'spoke_to_follow_up'
  | 'confirmation_call'
  | 'no_show'
  | 'reschedule_pending'
  | 'closed_won'
  | 'closed_lost'
  | 'meeting_follow_up'
  | 'unable_to_leave_vm'
  | 'inactive'
  | 'needs_manual_review';

export type ActivityKind = 'dial' | 'contact';

export type ScoutTaskClassification = {
  taskStatus: ScoutTaskStatus;
  taskPriority: number;
  activityKind: ActivityKind | null;
  activitySubtype: ScoutTaskStatus | null;
};

function normalizeText(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\(?sc move this task\)?\s*/i, '')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/[.,:]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function stripMoveThisTaskPrefix(taskTitle?: string | null): string {
  const trimmed = String(taskTitle || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/^\(SC Move This Task\)\s*/i, '').trim() || trimmed;
}

export function isIncompleteTaskValue(value?: string | null): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    !normalized ||
    normalized === '-' ||
    normalized === '--' ||
    normalized === 'n/a' ||
    normalized === 'not completed' ||
    normalized === 'incomplete'
  );
}

export function activityKindForTaskStatus(taskStatus?: string | null): ActivityKind | null {
  if (
    taskStatus === 'call_attempt_1' ||
    taskStatus === 'call_attempt_2' ||
    taskStatus === 'call_attempt_3'
  ) {
    return 'dial';
  }
  if (taskStatus === 'spoke_to_follow_up') {
    return 'contact';
  }
  return null;
}

export function isDashboardCallActivityStatus(taskStatus?: string | null): boolean {
  return Boolean(activityKindForTaskStatus(taskStatus));
}

export function classifyScoutTask(args: {
  title?: string | null;
  description?: string | null;
  rowText?: string | null;
}): ScoutTaskClassification {
  const strippedTitle = stripMoveThisTaskPrefix(args.title);
  const title = normalizeText(strippedTitle);
  const description = normalizeText(args.description);
  const rowText = normalizeText(args.rowText);
  const combined = [title, description, rowText].filter(Boolean).join(' ');

  let taskStatus: ScoutTaskStatus = 'needs_manual_review';
  let taskPriority = 0;

  if (title.includes('confirmation call') || description.includes('confirm the meeting set')) {
    taskStatus = 'confirmation_call';
    taskPriority = 500;
  } else if (includesAny(combined, ['closed won', 'close won'])) {
    taskStatus = 'closed_won';
    taskPriority = 480;
  } else if (includesAny(combined, ['closed lost', 'close lost', 'not interested'])) {
    taskStatus = 'closed_lost';
    taskPriority = 470;
  } else if (includesAny(combined, ['reschedule pending', 'res pending', 'res. pending'])) {
    taskStatus = 'reschedule_pending';
    taskPriority = 460;
  } else if (combined.includes('no show') || combined.includes('noshow')) {
    taskStatus = 'no_show';
    taskPriority = 450;
  } else if (title.includes('call attempt 3') || title.includes('never spoke to')) {
    taskStatus = 'call_attempt_3';
    taskPriority = 300;
  } else if (
    title.startsWith('spoke to') ||
    title.includes('follow up') ||
    description.includes('follow up')
  ) {
    taskStatus = title.includes('meeting') || description.includes('meeting')
      ? 'meeting_follow_up'
      : 'spoke_to_follow_up';
    taskPriority = 350;
  } else if (title.includes('call attempt 2') || title.includes('left voice mail 2')) {
    taskStatus = 'call_attempt_2';
    taskPriority = 200;
  } else if (title.includes('call attempt 1') || title.includes('left voice mail 1')) {
    taskStatus = 'call_attempt_1';
    taskPriority = 100;
  }

  const activityKind = activityKindForTaskStatus(taskStatus);
  return {
    taskStatus,
    taskPriority,
    activityKind,
    activitySubtype: activityKind ? taskStatus : null,
  };
}

export function classifyCrmStage(rawCrmStage?: string | null): ScoutTaskStatus {
  const normalized = normalizeText(rawCrmStage);
  if (!normalized) return 'needs_manual_review';
  if (normalized === 'left voice mail 1' || normalized === 'left voicemail 1') return 'call_attempt_1';
  if (normalized === 'left voice mail 2' || normalized === 'left voicemail 2') return 'call_attempt_2';
  if (normalized === 'never spoke to') return 'call_attempt_3';
  if (normalized === 'called unable to leave vm' || normalized === 'unable to leave vm') {
    return 'unable_to_leave_vm';
  }
  if (normalized === 'meeting set' || normalized === 'rescheduled') return 'confirmation_call';
  if (includesAny(normalized, ['reschedule pending', 'rescheduled pending', 'meeting result res pending'])) {
    return 'reschedule_pending';
  }
  if (includesAny(normalized, ['no show', 'noshow'])) return 'no_show';
  if (includesAny(normalized, ['actual meeting follow up', 'spoke to i need to follow up', 'spoke to follow up', 'meeting follow up'])) {
    return 'meeting_follow_up';
  }
  if (includesAny(normalized, ['closed won', 'close won'])) return 'closed_won';
  if (includesAny(normalized, ['closed lost', 'close lost', 'not interested'])) return 'closed_lost';
  if (includesAny(normalized, ['inactive', 'dead lead', 'archived', 'too young'])) return 'inactive';
  return 'needs_manual_review';
}

export function classifyAppointmentTitle(title?: string | null): ScoutTaskStatus | null {
  const normalized = String(title || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('(enr')) return 'closed_won';
  if (normalized.startsWith('(cl)')) return 'closed_lost';
  if (normalized.startsWith('(rsp)')) return 'reschedule_pending';
  if (normalized.startsWith('(can)')) return 'reschedule_pending';
  if (normalized.startsWith('(ns)')) return 'no_show';
  if (normalized.startsWith('(fu)')) return 'meeting_follow_up';
  return null;
}

export function resolvePipelineTaskStatus(args: {
  bookedEventTitle?: string | null;
  rawCrmStage?: string | null;
  existingTaskStatus?: string | null;
}): ScoutTaskStatus {
  return (
    classifyAppointmentTitle(args.bookedEventTitle) ||
    classifyCrmStage(args.rawCrmStage) ||
    (String(args.existingTaskStatus || '').trim() as ScoutTaskStatus) ||
    'needs_manual_review'
  );
}
