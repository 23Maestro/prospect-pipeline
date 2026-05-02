import type { VoicemailFollowUpVariant } from '../lib/scout-follow-up-templates';

export const SPOKE_TO_FOLLOW_UP_LABEL = 'Spoke to - I Need To Follow Up';

export const SALES_STAGE_LABEL_ALIASES = new Map<string, string>([
  ['Spoke to - Follow Up', SPOKE_TO_FOLLOW_UP_LABEL],
  ['Spoke to - I need to follow up', SPOKE_TO_FOLLOW_UP_LABEL],
]);

export const CURATED_SALES_STAGE_LABELS = [
  'Left Voice Mail 1',
  'Left Voice Mail 2',
  'Never Spoke To',
  'Called - Unable to Leave VM',
  'Spoke to - Not Interested',
  'Spoke to - Athlete, not Parent',
  'Spoke to - Too Young',
  SPOKE_TO_FOLLOW_UP_LABEL,
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

export const POST_CALL_UPDATE_EXCLUDED_STAGE_LABELS = [
  'Actual Meeting - Follow Up',
  'Actual Meeting - Close Lost',
  'Actual Meeting - Close Won',
  'Meeting Result - No Show',
] as const;

export type CuratedSalesStageLabel = (typeof CURATED_SALES_STAGE_LABELS)[number];

export type PostCallActivityStageClassification = {
  kind: 'call_activity';
  normalizedStage: string;
  voicemailVariant: VoicemailFollowUpVariant | null;
  completesPostCallTask: boolean;
};

export type MeetingSetStageClassification = {
  kind: 'meeting_set';
  normalizedStage: 'Meeting Set';
};

export type PostMeetingOutcomeClassification = {
  kind: 'post_meeting_outcome';
  normalizedStage: string;
  outcome: 'follow_up' | 'closed_lost' | 'closed_won' | 'resolution_pending' | 'rescheduled' | 'canceled' | 'no_show';
};

const VOICEMAIL_VARIANT_BY_STAGE = new Map<string, VoicemailFollowUpVariant>([
  ['Left Voice Mail 1', 'call_attempt_1'],
  ['Left Voice Mail 2', 'call_attempt_2'],
  ['Never Spoke To', 'call_attempt_3'],
]);

const POST_CALL_COMPLETION_STAGES = new Set([
  'Left Voice Mail 1',
  'Left Voice Mail 2',
  'Never Spoke To',
  'Meeting Set',
  'Called - Unable to Leave VM',
  'Spoke to - Not Interested',
  'Spoke to - Athlete, not Parent',
  'Spoke to - Too Young',
  SPOKE_TO_FOLLOW_UP_LABEL,
]);

const POST_MEETING_OUTCOME_BY_STAGE = new Map<string, PostMeetingOutcomeClassification['outcome']>([
  ['Actual Meeting - Follow Up', 'follow_up'],
  ['Actual Meeting - Close Lost', 'closed_lost'],
  ['Actual Meeting - Close Won', 'closed_won'],
  ['Meeting Result - Res. Pending', 'resolution_pending'],
  ['Meeting Result - Rescheduled', 'rescheduled'],
  ['Meeting Result - Canceled', 'canceled'],
  ['Meeting Result - No Show', 'no_show'],
]);

export function normalizeSalesStageLabelForLaravel(stage: string): string {
  const trimmed = stage.trim();
  return SALES_STAGE_LABEL_ALIASES.get(trimmed) || trimmed;
}

export const normalizeSalesStageLabelForLegacy = normalizeSalesStageLabelForLaravel;

export function classifyPostCallActivityStage(
  stage: string,
): PostCallActivityStageClassification | null {
  const normalizedStage = normalizeSalesStageLabelForLaravel(stage);
  if (!POST_CALL_COMPLETION_STAGES.has(normalizedStage)) {
    return null;
  }

  return {
    kind: 'call_activity',
    normalizedStage,
    voicemailVariant: VOICEMAIL_VARIANT_BY_STAGE.get(normalizedStage) || null,
    completesPostCallTask: true,
  };
}

export function getSalesStageLabelForVoicemailVariant(
  variant: VoicemailFollowUpVariant,
): string | null {
  for (const [stage, candidate] of VOICEMAIL_VARIANT_BY_STAGE.entries()) {
    if (candidate === variant) return stage;
  }
  return null;
}

export function classifyMeetingSetStage(stage: string): MeetingSetStageClassification | null {
  return normalizeSalesStageLabelForLaravel(stage) === 'Meeting Set'
    ? { kind: 'meeting_set', normalizedStage: 'Meeting Set' }
    : null;
}

export function classifyPostMeetingOutcomeStage(
  stage: string,
): PostMeetingOutcomeClassification | null {
  const normalizedStage = normalizeSalesStageLabelForLaravel(stage);
  const outcome = POST_MEETING_OUTCOME_BY_STAGE.get(normalizedStage);
  return outcome ? { kind: 'post_meeting_outcome', normalizedStage, outcome } : null;
}

export function isCuratedSalesStageLabel(stage: string): boolean {
  return CURATED_SALES_STAGE_LABELS.includes(
    normalizeSalesStageLabelForLaravel(stage) as CuratedSalesStageLabel,
  );
}
