import { normalizeCrmSalesStage, resolveSalesLifecycle } from '../lib/sales-lifecycle';
import {
  appointmentStatusForTitleOrStage,
  parseAppointmentTitleOutcome,
  postMeetingResultForTitleOrStage,
  taskStatusForStage,
  taskStatusForTitleOrStage,
} from './supabase-lifecycle-translator';

export type WorkflowContextInput = {
  athleteId?: string | null;
  athleteMainId?: string | null;
  athleteName?: string | null;
  sport?: string | null;
  gradYear?: string | null;
  state?: string | null;
  salesStage?: string | null;
  taskStatus?: string | null;
  appointmentId?: string | null;
  appointmentStatus?: string | null;
  postMeetingResult?: string | null;
  meetingTitle?: string | null;
};

export type WorkflowContext = {
  workflow_id: string | null;
  athlete_key: string | null;
  athlete_id: string | null;
  athlete_main_id: string | null;
  athlete_name: string | null;
  sport: string | null;
  grad_year: string | null;
  state: string | null;
  sales_stage: string | null;
  task_status: string | null;
  appointment_id: string | null;
  appointment_status: string | null;
  post_meeting_result: string | null;
  meeting_title_base: string | null;
  meeting_title_prefix: string | null;
  meeting_title_current: string | null;
};

const STATE_ABBREVIATIONS: Record<string, string> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
};

function clean(value?: string | null): string | null {
  const text = String(value || '').trim();
  return text || null;
}

function cleanState(value?: string | null): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return STATE_ABBREVIATIONS[upper] || (upper.length === 2 ? upper : raw);
}

function buildAthleteKey(athleteId?: string | null, athleteMainId?: string | null): string | null {
  const id = clean(athleteId);
  const mainId = clean(athleteMainId);
  return id && mainId ? `${id}:${mainId}` : null;
}

export function buildWorkflowId(args: {
  athleteId?: string | null;
  athleteMainId?: string | null;
  appointmentId?: string | null;
}): string | null {
  const athleteKey = buildAthleteKey(args.athleteId, args.athleteMainId);
  if (!athleteKey) return null;
  const appointmentId = clean(args.appointmentId);
  return appointmentId ? `meeting:${athleteKey}:${appointmentId}` : `athlete:${athleteKey}`;
}

export function isFabricatedMeetingTitle(value?: string | null): boolean {
  const title = clean(value);
  if (!title) return false;
  return /^post meeting\b/i.test(title);
}

function resolveMeetingTitleBase(args: WorkflowContextInput): string | null {
  const athleteName = clean(args.athleteName);
  const sport = clean(args.sport);
  const gradYear = clean(args.gradYear);
  const state = cleanState(args.state);
  if (!athleteName || !sport || !gradYear || !state) return null;
  return [athleteName, sport, gradYear, state].join(' ');
}

function extractMeetingTitlePrefix(title?: string | null): string | null {
  const currentTitle = clean(title);
  if (!currentTitle) return null;
  const match = currentTitle.match(/^\s*(\([A-Z][A-Z0-9\s$.-]*(?:\*\d+)?\)(?:\*\d+)?)/i);
  return match?.[1]?.trim() || null;
}

function cleanAppointmentStatus(value?: string | null): string | null {
  const normalized = clean(value);
  if (
    normalized === 'scheduled' ||
    normalized === 'confirmation_queued' ||
    normalized === 'confirmation_sent'
  ) {
    return normalized;
  }
  return null;
}

export function resolveWorkflowContext(input: WorkflowContextInput): WorkflowContext {
  const athleteId = clean(input.athleteId);
  const athleteMainId = clean(input.athleteMainId);
  const appointmentId = clean(input.appointmentId);
  const salesStage = clean(input.salesStage);
  const currentTitle = isFabricatedMeetingTitle(input.meetingTitle) ? null : clean(input.meetingTitle);
  const parsedTitle = parseAppointmentTitleOutcome(currentTitle);
  const salesStageLifecycle = resolveSalesLifecycle(salesStage);
  const projectedTaskStatus = salesStageLifecycle.shouldArchiveFromWorkingViews
    ? taskStatusForStage(salesStage, input.taskStatus)
    : taskStatusForTitleOrStage(currentTitle, salesStage, input.taskStatus);
  const projectedAppointmentStatus = salesStageLifecycle.shouldArchiveFromWorkingViews
    ? null
    : cleanAppointmentStatus(input.appointmentStatus) ||
      appointmentStatusForTitleOrStage(salesStage, currentTitle);
  const salesStagePostMeetingResult = postMeetingResultForTitleOrStage(salesStage, null);
  const projectedPostMeetingResult = salesStageLifecycle.shouldArchiveFromWorkingViews
    ? salesStagePostMeetingResult
    : postMeetingResultForTitleOrStage(salesStage, currentTitle) || clean(input.postMeetingResult);

  return {
    workflow_id: buildWorkflowId({ athleteId, athleteMainId, appointmentId }),
    athlete_key: buildAthleteKey(athleteId, athleteMainId),
    athlete_id: athleteId,
    athlete_main_id: athleteMainId,
    athlete_name: clean(input.athleteName),
    sport: clean(input.sport),
    grad_year: clean(input.gradYear),
    state: cleanState(input.state),
    sales_stage: normalizeCrmSalesStage(salesStage),
    task_status: projectedTaskStatus,
    appointment_id: appointmentId,
    appointment_status: projectedAppointmentStatus,
    post_meeting_result: projectedPostMeetingResult,
    meeting_title_base: resolveMeetingTitleBase(input),
    meeting_title_prefix: parsedTitle.prefix || extractMeetingTitlePrefix(currentTitle),
    meeting_title_current: currentTitle,
  };
}
