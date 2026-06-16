import type { ClientMessageThreadEvidenceReceipt } from './client-message-evidence-receipts';
import type {
  ClientReplyThemeRunReceipt,
  ClientReplyThemeRunReceiptMutationResult,
  ClientReplyThemeRunReceiptOperatorAction,
} from './client-message-reply-themes';
import { Buffer } from 'node:buffer';

export type ClientMessageHumanAction =
  | 'send_first_contact_reply'
  | 'offer_reschedule_slots'
  | 'review_reschedule_reply'
  | 'await_client'
  | 'review_opt_out'
  | 'needs_review'
  | 'no_action';

export type ClientMessageActionProposalReason =
  | 'client_replied_to_outreach_attempt'
  | 'post_meeting_recovery_needs_slots'
  | 'client_replied_after_proposed_times'
  | 'operator_already_sent_reschedule_options'
  | 'client_opted_out'
  | 'ambiguous_contact_identity'
  | 'unclassified_reply';

export type ClientMessageActionProposalConfidence = 'high' | 'medium' | 'low';

export type ClientMessageMutationTarget =
  | 'client_message_send'
  | 'apple_reminders'
  | 'apple_calendar_appts'
  | 'scout_prep_reschedule_flow'
  | 'appointments';

export type ClientMessagePreflightCheck =
  | 'check_prospect_id_reminders'
  | 'check_appts_calendar'
  | 'check_existing_active_appointment';

export type ClientMessageActionProposal = {
  version: 1;
  flow: '10x_communications';
  step: 'propose-human-action';
  generatedAt: string;
  mutationResult: ClientReplyThemeRunReceiptMutationResult;
  action: ClientMessageHumanAction;
  humanApprovalRequired: boolean;
  confidence: ClientMessageActionProposalConfidence;
  reason: ClientMessageActionProposalReason;
  sourceSurfaces: string[];
  ids: {
    chatGuid: string;
    contactId: string | null;
    athleteMainId: string | null;
    currentTaskId: string | null;
    messageGuid: string | null;
  };
  suggestedMutationTargets: ClientMessageMutationTarget[];
  requiredPreflightChecks: ClientMessagePreflightCheck[];
};

export type ClientMessageActionProposalMarkdownInput = {
  title?: string | null;
  threadReceipt: ClientMessageThreadEvidenceReceipt;
  classifierReceipt: ClientReplyThemeRunReceipt;
  proposal: ClientMessageActionProposal;
};

export type ClientMessageActionProposalEvidenceBundle = {
  version: 1;
  flow: '10x_communications';
  step: 'review-follow-up-evidence';
  generatedAt: string;
  title: string | null;
  proposal: ClientMessageActionProposal;
  messagesSqlEvidence: ClientMessageThreadEvidenceReceipt;
  replyClassification: ClientReplyThemeRunReceipt;
};

export type ClientMessageOperatorActionTagTone = 'urgent' | 'warning' | 'muted';

export function clientMessageOperatorActionLabel(
  action: ClientReplyThemeRunReceiptOperatorAction,
): string {
  if (action === 'needs_first_contact_reply') return 'Needs Reply';
  if (action === 'needs_reschedule_times') return 'Offer Slots';
  if (action === 'awaiting_client_reschedule_choice') return 'Awaiting Client';
  if (action === 'review_reschedule_reply') return 'Review Reply';
  if (action === 'review_opt_out') return 'Review Opt Out';
  return 'Needs Review';
}

export function clientMessageOperatorActionTagTone(
  action: ClientReplyThemeRunReceiptOperatorAction,
): ClientMessageOperatorActionTagTone {
  if (
    action === 'needs_first_contact_reply' ||
    action === 'needs_reschedule_times' ||
    action === 'review_reschedule_reply'
  ) {
    return 'urgent';
  }
  if (action === 'awaiting_client_reschedule_choice') return 'muted';
  return 'warning';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function jsonBlock(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}

function baseProposal(args: {
  generatedAt?: string;
  threadReceipt: ClientMessageThreadEvidenceReceipt;
  classifierReceipt: ClientReplyThemeRunReceipt;
  action: ClientMessageHumanAction;
  humanApprovalRequired: boolean;
  confidence: ClientMessageActionProposalConfidence;
  reason: ClientMessageActionProposalReason;
  mutationResult?: ClientReplyThemeRunReceiptMutationResult;
  suggestedMutationTargets?: ClientMessageMutationTarget[];
  requiredPreflightChecks?: ClientMessagePreflightCheck[];
}): ClientMessageActionProposal {
  return {
    version: 1,
    flow: '10x_communications',
    step: 'propose-human-action',
    generatedAt: args.generatedAt || new Date().toISOString(),
    mutationResult:
      args.mutationResult ||
      (args.humanApprovalRequired ? 'proposed' : args.classifierReceipt.mutationResult),
    action: args.action,
    humanApprovalRequired: args.humanApprovalRequired,
    confidence: args.confidence,
    reason: args.reason,
    sourceSurfaces: unique([
      ...args.threadReceipt.sourceSurfaces,
      ...args.classifierReceipt.sourceSurfaces,
    ]),
    ids: {
      chatGuid: args.threadReceipt.ids.chatGuid,
      contactId: args.threadReceipt.ids.contactId || args.classifierReceipt.ids.contactId,
      athleteMainId:
        args.threadReceipt.ids.athleteMainId || args.classifierReceipt.ids.athleteMainId,
      currentTaskId: args.threadReceipt.ids.currentTaskId,
      messageGuid: args.classifierReceipt.ids.messageGuid,
    },
    suggestedMutationTargets: args.suggestedMutationTargets || [],
    requiredPreflightChecks: args.requiredPreflightChecks || [],
  };
}

export function buildClientMessageActionProposal(args: {
  generatedAt?: string;
  threadReceipt: ClientMessageThreadEvidenceReceipt;
  classifierReceipt: ClientReplyThemeRunReceipt;
}): ClientMessageActionProposal {
  const thread = args.threadReceipt;
  const classifier = args.classifierReceipt;

  if (thread.admission.ambiguity === 'multiple_athletes') {
    return baseProposal({
      ...args,
      action: 'needs_review',
      humanApprovalRequired: true,
      confidence: 'low',
      reason: 'ambiguous_contact_identity',
    });
  }

  if (classifier.classifier.clientOptedOut || classifier.operatorAction === 'review_opt_out') {
    return baseProposal({
      ...args,
      action: 'review_opt_out',
      humanApprovalRequired: true,
      confidence: 'medium',
      reason: 'client_opted_out',
    });
  }

  if (classifier.operatorAction === 'awaiting_client_reschedule_choice') {
    return baseProposal({
      ...args,
      action: 'await_client',
      humanApprovalRequired: false,
      confidence: 'high',
      reason: 'operator_already_sent_reschedule_options',
      mutationResult: 'none/read_only',
    });
  }

  if (classifier.operatorAction === 'review_reschedule_reply') {
    return baseProposal({
      ...args,
      action: 'review_reschedule_reply',
      humanApprovalRequired: true,
      confidence: 'high',
      reason: 'client_replied_after_proposed_times',
      suggestedMutationTargets: ['scout_prep_reschedule_flow', 'appointments'],
      requiredPreflightChecks: ['check_existing_active_appointment'],
    });
  }

  if (classifier.operatorAction === 'needs_reschedule_times') {
    return baseProposal({
      ...args,
      action: 'offer_reschedule_slots',
      humanApprovalRequired: true,
      confidence: 'high',
      reason: 'post_meeting_recovery_needs_slots',
      suggestedMutationTargets: [
        'client_message_send',
        'scout_prep_reschedule_flow',
        'appointments',
      ],
      requiredPreflightChecks: ['check_existing_active_appointment'],
    });
  }

  if (classifier.operatorAction === 'needs_first_contact_reply') {
    return baseProposal({
      ...args,
      action: 'send_first_contact_reply',
      humanApprovalRequired: true,
      confidence: 'high',
      reason: 'client_replied_to_outreach_attempt',
      suggestedMutationTargets: ['client_message_send', 'apple_reminders', 'apple_calendar_appts'],
      requiredPreflightChecks: ['check_prospect_id_reminders', 'check_appts_calendar'],
    });
  }

  return baseProposal({
    ...args,
    action: 'needs_review',
    humanApprovalRequired: true,
    confidence: 'low',
    reason: 'unclassified_reply',
  });
}

export function buildClientMessageActionProposalMarkdown(
  input: ClientMessageActionProposalMarkdownInput,
): string {
  const title = String(input.title || '').trim();
  return [
    '# 10x Communications Evidence',
    title ? `\n**Client:** ${title}` : '',
    '\n## Proposal',
    jsonBlock(input.proposal),
    '\n## Messages SQL Evidence',
    jsonBlock(input.threadReceipt),
    '\n## Reply Classification',
    jsonBlock(input.classifierReceipt),
  ]
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export function buildClientMessageActionProposalEvidenceBundle(
  input: ClientMessageActionProposalMarkdownInput,
): ClientMessageActionProposalEvidenceBundle {
  const title = String(input.title || '').trim();
  return {
    version: 1,
    flow: '10x_communications',
    step: 'review-follow-up-evidence',
    generatedAt: input.proposal.generatedAt,
    title: title || null,
    proposal: input.proposal,
    messagesSqlEvidence: input.threadReceipt,
    replyClassification: input.classifierReceipt,
  };
}

export function buildClientMessageActionProposalEvidenceJson(
  input: ClientMessageActionProposalMarkdownInput,
): string {
  return JSON.stringify(buildClientMessageActionProposalEvidenceBundle(input), null, 2);
}

function normalizeBaseUrl(value?: string | null): string {
  return String(value || 'https://prospect-web.vercel.app').trim().replace(/\/+$/, '');
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function buildClientMessageActionProposalVisualUrl(
  input: ClientMessageActionProposalMarkdownInput,
  baseUrl =
    process.env.PROSPECT_WEB_PUBLIC_BASE_URL ||
    process.env.PARENT_RESPONSE_PUBLIC_BASE_URL ||
    'https://prospect-web.vercel.app',
): string {
  const bundle = buildClientMessageActionProposalEvidenceBundle(input);
  const encoded = base64UrlEncode(JSON.stringify(bundle));
  return `${normalizeBaseUrl(baseUrl)}/10x-communications-evidence#payload=${encoded}`;
}
