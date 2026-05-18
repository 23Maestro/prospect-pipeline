export type ScoutTaskStatus =
  | 'new_opportunity'
  | 'call_attempt_1'
  | 'call_attempt_2'
  | 'call_attempt_3'
  | 'spoke_to_follow_up'
  | 'spoke_to_not_interested'
  | 'spoke_to_athlete_not_parent'
  | 'spoke_to_too_young'
  | 'confirmation_call'
  | 'meeting_set'
  | 'no_show'
  | 'canceled'
  | 'reschedule_pending'
  | 'closed_won'
  | 'closed_lost'
  | 'meeting_follow_up'
  | 'unable_to_leave_vm'
  | 'inactive'
  | 'needs_manual_review';

export type ActivityKind = 'dial' | 'contact';

export type ActivityCountFlags = {
  countsAsDial: boolean;
  countsAsContact: boolean;
  countsAsMeetingSet: boolean;
  countsAsPostMeetingOutcome: boolean;
};

export type TrackerOutcome =
  | 'voicemail'
  | 'spoke_follow_up'
  | 'unable_to_leave_vm'
  | 'not_interested'
  | 'meeting_set'
  | 'closed_won'
  | 'closed_lost'
  | 'reschedule_pending'
  | 'no_show'
  | 'canceled'
  | 'needs_review';

export type ScoutTaskClassification = {
  taskStatus: ScoutTaskStatus;
  taskPriority: number;
  activityKind: ActivityKind | null;
  activitySubtype: ScoutTaskStatus | null;
};

export type CallTrackerReportingClassification = {
  trackerOutcome: TrackerOutcome;
  activityKind: ActivityKind | null;
  countsAsDial: boolean;
  countsAsContact: boolean;
  countsAsMeetingSet: boolean;
  countsAsPostMeetingOutcome: boolean;
};

export { isIncompleteTaskValue } from './scout-task-selection';

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

export function activityKindForTaskStatus(taskStatus?: string | null): ActivityKind | null {
  if (
    taskStatus === 'call_attempt_1' ||
    taskStatus === 'call_attempt_2' ||
    taskStatus === 'call_attempt_3'
  ) {
    return 'dial';
  }
  if (taskStatus === 'unable_to_leave_vm') {
    return 'dial';
  }
  if (
    taskStatus === 'spoke_to_follow_up' ||
    taskStatus === 'spoke_to_not_interested' ||
    taskStatus === 'spoke_to_athlete_not_parent' ||
    taskStatus === 'spoke_to_too_young'
  ) {
    return 'contact';
  }
  return null;
}

export function isDashboardCallActivityStatus(taskStatus?: string | null): boolean {
  return Boolean(activityKindForTaskStatus(taskStatus));
}

export function activityCountFlagsForTaskStatus(taskStatus?: string | null): ActivityCountFlags {
  if (
    taskStatus === 'call_attempt_1' ||
    taskStatus === 'call_attempt_2' ||
    taskStatus === 'call_attempt_3' ||
    taskStatus === 'unable_to_leave_vm'
  ) {
    return {
      countsAsDial: true,
      countsAsContact: false,
      countsAsMeetingSet: false,
      countsAsPostMeetingOutcome: false,
    };
  }
  if (
    taskStatus === 'spoke_to_not_interested' ||
    taskStatus === 'spoke_to_athlete_not_parent' ||
    taskStatus === 'spoke_to_too_young' ||
    taskStatus === 'spoke_to_follow_up'
  ) {
    return {
      countsAsDial: true,
      countsAsContact: true,
      countsAsMeetingSet: false,
      countsAsPostMeetingOutcome: false,
    };
  }
  if (taskStatus === 'meeting_set') {
    return {
      countsAsDial: true,
      countsAsContact: true,
      countsAsMeetingSet: true,
      countsAsPostMeetingOutcome: false,
    };
  }
  if (
    taskStatus === 'closed_won' ||
    taskStatus === 'closed_lost' ||
    taskStatus === 'reschedule_pending' ||
    taskStatus === 'no_show' ||
    taskStatus === 'canceled'
  ) {
    return {
      countsAsDial: false,
      countsAsContact: false,
      countsAsMeetingSet: false,
      countsAsPostMeetingOutcome: true,
    };
  }
  return {
    countsAsDial: false,
    countsAsContact: false,
    countsAsMeetingSet: false,
    countsAsPostMeetingOutcome: false,
  };
}

export function trackerOutcomeForTaskStatus(taskStatus?: string | null): TrackerOutcome {
  if (
    taskStatus === 'call_attempt_1' ||
    taskStatus === 'call_attempt_2' ||
    taskStatus === 'call_attempt_3'
  ) {
    return 'voicemail';
  }
  if (taskStatus === 'unable_to_leave_vm') {
    return 'unable_to_leave_vm';
  }
  if (taskStatus === 'spoke_to_not_interested') {
    return 'not_interested';
  }
  if (
    taskStatus === 'spoke_to_athlete_not_parent' ||
    taskStatus === 'spoke_to_too_young' ||
    taskStatus === 'spoke_to_follow_up' ||
    taskStatus === 'meeting_follow_up'
  ) {
    return 'spoke_follow_up';
  }
  if (taskStatus === 'meeting_set') return 'meeting_set';
  if (taskStatus === 'closed_won') return 'closed_won';
  if (taskStatus === 'closed_lost') return 'closed_lost';
  if (taskStatus === 'reschedule_pending') return 'reschedule_pending';
  if (taskStatus === 'no_show') return 'no_show';
  if (taskStatus === 'canceled') return 'canceled';
  return 'needs_review';
}

export function classifyCallTrackerReporting(taskStatus?: string | null): CallTrackerReportingClassification {
  const flags = activityCountFlagsForTaskStatus(taskStatus);
  return {
    trackerOutcome: trackerOutcomeForTaskStatus(taskStatus),
    activityKind: activityKindForTaskStatus(taskStatus),
    countsAsDial: flags.countsAsDial,
    countsAsContact: flags.countsAsContact,
    countsAsMeetingSet: flags.countsAsMeetingSet,
    countsAsPostMeetingOutcome: flags.countsAsPostMeetingOutcome,
  };
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
  } else if (includesAny(combined, ['called unable to leave vm', 'unable to leave vm'])) {
    taskStatus = 'unable_to_leave_vm';
    taskPriority = 360;
  } else if (title.startsWith('spoke to') && combined.includes('not interested')) {
    taskStatus = 'spoke_to_not_interested';
    taskPriority = 360;
  } else if (title.startsWith('spoke to') && combined.includes('athlete not parent')) {
    taskStatus = 'spoke_to_athlete_not_parent';
    taskPriority = 360;
  } else if (title.startsWith('spoke to') && combined.includes('too young')) {
    taskStatus = 'spoke_to_too_young';
    taskPriority = 360;
  } else if (includesAny(combined, ['closed won', 'close won'])) {
    taskStatus = 'closed_won';
    taskPriority = 480;
  } else if (includesAny(combined, ['closed lost', 'close lost', 'not interested'])) {
    taskStatus = 'closed_lost';
    taskPriority = 470;
  } else if (includesAny(combined, ['reschedule pending', 'res pending', 'res. pending'])) {
    taskStatus = 'reschedule_pending';
    taskPriority = 460;
  } else if (combined.includes('canceled') || combined.includes('cancelled')) {
    taskStatus = 'canceled';
    taskPriority = 455;
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

export function classifyCrmStage(rawCrmStage?: string | null): ScoutTaskStatus | null {
  const normalized = normalizeText(rawCrmStage);
  if (!normalized) return null;
  if (normalized === 'new opportunity') return 'new_opportunity';
  if (normalized === 'left voice mail 1' || normalized === 'left voicemail 1') return 'call_attempt_1';
  if (normalized === 'left voice mail 2' || normalized === 'left voicemail 2') return 'call_attempt_2';
  if (normalized === 'never spoke to') return 'call_attempt_3';
  if (normalized === 'called unable to leave vm' || normalized === 'unable to leave vm') {
    return 'unable_to_leave_vm';
  }
  if (normalized === 'spoke to not interested') return 'spoke_to_not_interested';
  if (normalized === 'spoke to athlete not parent' || normalized === 'athlete not parent') {
    return 'spoke_to_athlete_not_parent';
  }
  if (normalized === 'spoke to too young' || normalized === 'too young') return 'spoke_to_too_young';
  if (normalized === 'meeting set') return 'meeting_set';
  if (normalized === 'rescheduled') return 'confirmation_call';
  if (includesAny(normalized, ['reschedule pending', 'rescheduled pending', 'meeting result res pending'])) {
    return 'reschedule_pending';
  }
  if (includesAny(normalized, ['canceled', 'cancelled'])) return 'canceled';
  if (includesAny(normalized, ['no show', 'noshow'])) return 'no_show';
  if (includesAny(normalized, ['spoke to i need to follow up', 'spoke to follow up'])) {
    return 'spoke_to_follow_up';
  }
  if (includesAny(normalized, ['actual meeting follow up', 'meeting follow up'])) {
    return 'meeting_follow_up';
  }
  if (includesAny(normalized, ['closed won', 'close won'])) return 'closed_won';
  if (includesAny(normalized, ['closed lost', 'close lost', 'not interested'])) return 'closed_lost';
  if (includesAny(normalized, ['inactive', 'dead lead', 'archived', 'too young'])) return 'inactive';
  return null;
}

export function classifyAppointmentTitle(title?: string | null): ScoutTaskStatus | null {
  const normalized = String(title || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('(enr')) return 'closed_won';
  if (normalized.startsWith('(cl)')) return 'closed_lost';
  if (normalized.startsWith('(rsp)')) return 'reschedule_pending';
  if (normalized.startsWith('(can)')) return 'canceled';
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
