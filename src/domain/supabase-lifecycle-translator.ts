import {
  normalizeCrmSalesStage,
  type NormalizedSalesStage,
} from '../lib/sales-lifecycle';
import {
  parseAppointmentTitleOutcome,
  type AppointmentTitleOutcome,
  type AppointmentTitleParseResult,
} from '../lib/head-scout-event-prefix';
import type { ScoutTaskStatus } from './scout-task-classifier';

export { normalizeCrmSalesStage };
export { parseAppointmentTitleOutcome };
export type ParsedAppointmentTitleOutcome = AppointmentTitleParseResult;

export function normalizeLifecycleText(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/[.,:]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function lifecycleTextIncludesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function taskStatusForStage(
  rawCrmStage?: string | null,
  existingTaskStatus?: string | null,
): ScoutTaskStatus | null {
  const normalizedText = normalizeLifecycleText(rawCrmStage);
  const normalizedStage = normalizeCrmSalesStage(rawCrmStage);

  if (normalizedText === 'left voice mail 1' || normalizedText === 'left voicemail 1') {
    return 'call_attempt_1';
  }
  if (normalizedText === 'left voice mail 2' || normalizedText === 'left voicemail 2') {
    return 'call_attempt_2';
  }
  if (normalizedText === 'never spoke to') return 'call_attempt_3';
  if (normalizedText === 'called unable to leave vm' || normalizedText === 'unable to leave vm') {
    return 'unable_to_leave_vm';
  }
  if (normalizedStage === 'meeting_set') return 'confirmation_call';
  if (normalizedStage === 'reschedule_pending') return 'reschedule_pending';
  if (normalizedStage === 'rescheduled') return 'confirmation_call';
  if (normalizedStage === 'no_show') return 'no_show';
  if (normalizedStage === 'canceled') return 'canceled';
  if (normalizedStage === 'meeting_follow_up') return 'meeting_follow_up';
  if (normalizedStage === 'closed_won') return 'closed_won';
  if (normalizedStage === 'closed_lost') return 'closed_lost';
  if (normalizedStage === 'inactive') return 'inactive';

  const existing = String(existingTaskStatus || '').trim();
  return existing ? (existing as ScoutTaskStatus) : null;
}

export function taskStatusForTitleOrStage(
  bookedEventTitle?: string | null,
  rawCrmStage?: string | null,
  existingTaskStatus?: string | null,
): ScoutTaskStatus | null {
  const parsedTitle = parseAppointmentTitleOutcome(bookedEventTitle);
  if (parsedTitle.outcome === 'terminal_enrollment') return 'closed_won';
  if (parsedTitle.outcome === 'terminal_close_lost') return 'closed_lost';
  if (parsedTitle.outcome === 'reschedule_pending') return 'reschedule_pending';
  if (parsedTitle.outcome === 'soft_archive_canceled') return 'canceled';
  if (parsedTitle.outcome === 'soft_archive_no_show') return 'no_show';
  if (parsedTitle.outcome === 'soft_archive_follow_up') return 'meeting_follow_up';
  return taskStatusForStage(rawCrmStage, existingTaskStatus);
}

export function appointmentStatusForTitleOrStage(
  rawCrmStage?: string | null,
  bookedEventTitle?: string | null,
): string | null {
  const parsedTitle = parseAppointmentTitleOutcome(bookedEventTitle);
  if (parsedTitle.outcome !== 'active') return null;

  const normalizedStage = normalizeCrmSalesStage(rawCrmStage);
  if (normalizedStage === 'meeting_set') return 'scheduled';
  if (normalizedStage === 'rescheduled') return 'scheduled';
  return null;
}

export function postMeetingResultForTitleOrStage(
  rawCrmStage?: string | null,
  bookedEventTitle?: string | null,
): string | null {
  const parsedTitle = parseAppointmentTitleOutcome(bookedEventTitle);
  if (parsedTitle.outcome === 'terminal_enrollment') return 'closed_won';
  if (parsedTitle.outcome === 'terminal_close_lost') return 'closed_lost';
  if (parsedTitle.outcome === 'reschedule_pending') return 'reschedule_pending';
  if (parsedTitle.outcome === 'soft_archive_canceled') return 'canceled';
  if (parsedTitle.outcome === 'soft_archive_no_show') return 'no_show';
  if (parsedTitle.outcome === 'soft_archive_follow_up') return 'follow_up';

  const normalizedStage = normalizeCrmSalesStage(rawCrmStage);
  if (normalizedStage === 'closed_won') return 'closed_won';
  if (normalizedStage === 'closed_lost') return 'closed_lost';
  if (normalizedStage === 'reschedule_pending') return 'reschedule_pending';
  if (normalizedStage === 'rescheduled') return 'rescheduled';
  if (normalizedStage === 'no_show') return 'no_show';
  if (normalizedStage === 'canceled') return 'canceled';
  if (normalizedStage === 'meeting_follow_up') return 'follow_up';
  return null;
}

export function crmStageForOutcome(
  titleOutcome: AppointmentTitleOutcome,
  selectedStage?: string | null,
): string | null {
  if (titleOutcome === 'terminal_enrollment') return 'Actual Meeting - Close Won';
  if (titleOutcome === 'terminal_close_lost') return 'Actual Meeting - Close Lost';
  if (titleOutcome === 'reschedule_pending') return 'Meeting Result - Res. Pending';
  if (titleOutcome === 'soft_archive_no_show') return 'Meeting Result - No Show';
  if (titleOutcome === 'soft_archive_canceled') return 'Meeting Result - Canceled';
  if (titleOutcome === 'soft_archive_follow_up') return 'Actual Meeting - Follow Up';
  return String(selectedStage || '').trim() || null;
}

export function shouldArchiveReconciledState(titleOutcome: AppointmentTitleOutcome): boolean {
  return new Set<AppointmentTitleOutcome>([
    'terminal_enrollment',
    'terminal_close_lost',
    'soft_archive_no_show',
    'soft_archive_canceled',
    'soft_archive_follow_up',
  ]).has(titleOutcome);
}

export function isPostMeetingLifecycleStage(stage?: string | null): boolean {
  const postMeetingStages = new Set<NormalizedSalesStage>([
    'closed_won',
    'closed_lost',
    'reschedule_pending',
    'rescheduled',
    'no_show',
    'canceled',
    'meeting_follow_up',
  ]);
  const direct = String(stage || '').trim() as NormalizedSalesStage;
  return postMeetingStages.has(direct) || postMeetingStages.has(normalizeCrmSalesStage(stage));
}
