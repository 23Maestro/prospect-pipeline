export type RawCrmSalesStage = string;

export type NormalizedSalesStage =
  | 'new_opportunity'
  | 'call_attempt'
  | 'meeting_set'
  | 'meeting_follow_up'
  | 'reschedule_pending'
  | 'rescheduled'
  | 'no_show'
  | 'closed_won'
  | 'closed_lost'
  | 'inactive'
  | 'unknown';

export type OperatorWorkflowStatus =
  | 'active_call_queue'
  | 'active_meeting_queue'
  | 'awaiting_reschedule'
  | 'awaiting_follow_up'
  | 'awaiting_close'
  | 'won'
  | 'lost'
  | 'no_show'
  | 'inactive'
  | 'needs_manual_review';

export type MeetingLifecycleState =
  | 'not_set'
  | 'scheduled'
  | 'reschedule_pending'
  | 'rescheduled'
  | 'no_show'
  | 'follow_up_due'
  | 'resolved'
  | 'closed_won'
  | 'closed_lost'
  | 'inactive'
  | 'needs_manual_review';

export type SalesRecordLifecycle = {
  rawCrmStage: RawCrmSalesStage | null;
  normalizedStage: NormalizedSalesStage;
  operatorStatus: OperatorWorkflowStatus;
  meetingLifecycle: MeetingLifecycleState;
  isActiveQueueItem: boolean;
  isTerminal: boolean;
  shouldArchiveFromWorkingViews: boolean;
  reason: string;
};

export const KNOWN_BACKEND_CRM_STAGE_LABELS = [
  'Left Voice Mail 1',
  'Left Voice Mail 2',
  'Never Spoke To',
  'Called - Unable to Leave VM',
  'Spoke to - Not Interested',
  'Meeting Set',
  'Rescheduled',
  'Actual Meeting - Follow Up',
  'Actual Meeting - Close Lost',
  'Actual Meeting - Close Won',
  'Meeting Result - Res. Pending',
  'Meeting Result - Rescheduled',
  'Meeting Result - Canceled',
  'Meeting Result - No Show',
] as const;

export const KNOWN_TS_ONLY_STAGE_LABELS = ['New Opportunity', 'Spoke to - Follow Up'] as const;

function normalizeStageText(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/[.:]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function normalizeCrmSalesStage(rawCrmStage?: string | null): NormalizedSalesStage {
  const normalized = normalizeStageText(rawCrmStage);
  if (!normalized) return 'unknown';

  if (normalized === 'new opportunity') return 'new_opportunity';

  if (
    normalized === 'left voice mail 1' ||
    normalized === 'left voicemail 1' ||
    normalized === 'left voice mail 2' ||
    normalized === 'left voicemail 2' ||
    normalized === 'never spoke to' ||
    normalized === 'called - unable to leave vm' ||
    normalized === 'called unable to leave vm' ||
    normalized === 'unable to leave vm'
  ) {
    return 'call_attempt';
  }

  if (includesAny(normalized, ['closed won', 'close won'])) return 'closed_won';
  if (
    includesAny(normalized, ['closed lost', 'close lost']) ||
    normalized === 'spoke to - not interested' ||
    normalized === 'not interested'
  ) {
    return 'closed_lost';
  }

  if (includesAny(normalized, ['inactive', 'dead lead', 'archived'])) return 'inactive';
  if (includesAny(normalized, ['no show', 'noshow'])) return 'no_show';
  if (
    includesAny(normalized, [
      'reschedule pending',
      'rescheduled pending',
      'meeting result res pending',
      'meeting result canceled',
      'actual meeting canceled',
    ])
  ) {
    return 'reschedule_pending';
  }
  if (includesAny(normalized, ['meeting result rescheduled', 'actual meeting rescheduled'])) {
    return 'rescheduled';
  }
  if (normalized === 'rescheduled') return 'rescheduled';
  if (normalized === 'meeting set') return 'meeting_set';

  if (
    includesAny(normalized, [
      'actual meeting follow up',
      'spoke to - follow up',
      'meeting follow up',
      'follow-up',
      'follow up',
      'awaiting close',
      'close pending',
      'close follow up',
    ])
  ) {
    return 'meeting_follow_up';
  }

  return 'unknown';
}

function resolveOperatorStatus(args: {
  normalizedStage: NormalizedSalesStage;
  normalizedRawStage: string;
}): OperatorWorkflowStatus {
  const { normalizedStage, normalizedRawStage } = args;

  if (normalizedStage === 'new_opportunity' || normalizedStage === 'call_attempt') {
    return 'active_call_queue';
  }
  if (normalizedStage === 'meeting_set' || normalizedStage === 'rescheduled') {
    return 'active_meeting_queue';
  }
  if (normalizedStage === 'reschedule_pending') return 'awaiting_reschedule';
  if (normalizedStage === 'no_show') return 'no_show';
  if (normalizedStage === 'closed_won') return 'won';
  if (normalizedStage === 'closed_lost') return 'lost';
  if (normalizedStage === 'inactive') return 'inactive';
  if (normalizedStage === 'meeting_follow_up') {
    if (includesAny(normalizedRawStage, ['awaiting close', 'close pending'])) {
      return 'awaiting_close';
    }
    return 'awaiting_follow_up';
  }
  return 'needs_manual_review';
}

function resolveMeetingLifecycle(args: {
  normalizedStage: NormalizedSalesStage;
  normalizedRawStage: string;
}): MeetingLifecycleState {
  const { normalizedStage, normalizedRawStage } = args;

  if (normalizedStage === 'new_opportunity' || normalizedStage === 'call_attempt') return 'not_set';
  if (normalizedStage === 'meeting_set') return 'scheduled';
  if (normalizedStage === 'reschedule_pending') return 'reschedule_pending';
  if (normalizedStage === 'rescheduled') return 'rescheduled';
  if (normalizedStage === 'no_show') return 'no_show';
  if (normalizedStage === 'closed_won') return 'closed_won';
  if (normalizedStage === 'closed_lost') return 'closed_lost';
  if (normalizedStage === 'inactive') return 'inactive';
  if (normalizedStage === 'meeting_follow_up') {
    if (includesAny(normalizedRawStage, ['resolved'])) return 'resolved';
    return 'follow_up_due';
  }
  return 'needs_manual_review';
}

export function isTerminalSalesState(
  lifecycle: Pick<SalesRecordLifecycle, 'normalizedStage'>,
): boolean {
  return (
    lifecycle.normalizedStage === 'closed_won' ||
    lifecycle.normalizedStage === 'closed_lost' ||
    lifecycle.normalizedStage === 'inactive'
  );
}

export function isActiveCallQueueItem(
  lifecycle: Pick<SalesRecordLifecycle, 'normalizedStage'>,
): boolean {
  return (
    lifecycle.normalizedStage === 'new_opportunity' || lifecycle.normalizedStage === 'call_attempt'
  );
}

export function isActiveMeetingQueueItem(
  lifecycle: Pick<SalesRecordLifecycle, 'normalizedStage'>,
): boolean {
  return (
    lifecycle.normalizedStage === 'meeting_set' ||
    lifecycle.normalizedStage === 'reschedule_pending' ||
    lifecycle.normalizedStage === 'rescheduled' ||
    lifecycle.normalizedStage === 'meeting_follow_up'
  );
}

export function shouldDropFromWorkingQueue(
  lifecycle: Pick<SalesRecordLifecycle, 'normalizedStage' | 'operatorStatus'>,
): boolean {
  return isTerminalSalesState(lifecycle) && lifecycle.operatorStatus !== 'needs_manual_review';
}

export function isKnownCrmSalesStage(rawCrmStage?: string | null): boolean {
  const normalized = normalizeStageText(rawCrmStage);
  return (
    KNOWN_BACKEND_CRM_STAGE_LABELS.some((stage) => normalizeStageText(stage) === normalized) ||
    KNOWN_TS_ONLY_STAGE_LABELS.some((stage) => normalizeStageText(stage) === normalized)
  );
}

export function resolveSalesLifecycle(rawCrmStage?: string | null): SalesRecordLifecycle {
  const normalizedRawStage = normalizeStageText(rawCrmStage);
  const normalizedStage = normalizeCrmSalesStage(rawCrmStage);
  const operatorStatus = resolveOperatorStatus({ normalizedStage, normalizedRawStage });
  const meetingLifecycle = resolveMeetingLifecycle({ normalizedStage, normalizedRawStage });
  const isTerminal = isTerminalSalesState({ normalizedStage });
  const unknown = normalizedStage === 'unknown';
  const isActiveQueueItem = !isTerminal;
  const shouldArchiveFromWorkingViews = shouldDropFromWorkingQueue({
    normalizedStage,
    operatorStatus,
  });

  let reason = 'Lifecycle resolved from CRM sales stage.';
  if (!normalizedRawStage) {
    reason = 'CRM sales stage is blank or unavailable; manual review required.';
  } else if (unknown) {
    reason = `Unknown CRM sales stage "${rawCrmStage}" requires manual review.`;
  } else if (normalizedStage === 'new_opportunity') {
    reason = 'CRM stage is New Opportunity, so the record stays in the active call queue.';
  } else if (normalizedStage === 'call_attempt') {
    reason = `CRM stage "${rawCrmStage}" is treated as an active call-attempt state.`;
  } else if (normalizedStage === 'meeting_set') {
    reason = 'CRM stage is Meeting Set, so the record stays in the active meeting queue.';
  } else if (normalizedStage === 'reschedule_pending') {
    reason = 'CRM stage is a reschedule-pending state and remains actionable.';
  } else if (normalizedStage === 'rescheduled') {
    reason = 'CRM stage is Rescheduled, so the record stays in the active meeting queue.';
  } else if (normalizedStage === 'no_show') {
    reason = 'CRM stage is a no-show state, so keep the athlete monitored but out of active meeting views.';
  } else if (normalizedStage === 'meeting_follow_up') {
    reason = `CRM stage "${rawCrmStage}" is treated as an active post-meeting follow-up state.`;
  } else if (normalizedStage === 'closed_won') {
    reason = `CRM stage "${rawCrmStage}" is terminal and should drop from active working views.`;
  } else if (normalizedStage === 'closed_lost') {
    reason = `CRM stage "${rawCrmStage}" is terminal and should drop from active working views.`;
  } else if (normalizedStage === 'inactive') {
    reason = `CRM stage "${rawCrmStage}" is inactive and should archive from active working views.`;
  }

  return {
    rawCrmStage: String(rawCrmStage || '').trim() || null,
    normalizedStage,
    operatorStatus,
    meetingLifecycle,
    isActiveQueueItem,
    isTerminal,
    shouldArchiveFromWorkingViews,
    reason,
  };
}
