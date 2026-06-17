import type { ClientMessageActionProposal } from './client-message-action-proposals';

export type ClientMessageAuditPendingMatch = {
  appointmentIdHash: string | null;
  athleteKeyHash: string | null;
  outcome: string;
  replyState?: string;
  matchedReplyEvidence: boolean;
  proposal?: ClientMessageActionProposal;
};

export type ClientMessageAuditPendingAction = {
  appointmentIdHash: string | null;
  athleteKeyHash: string | null;
  outcome: string;
  replyState: string | undefined;
  action: ClientMessageActionProposal['action'] | undefined;
  reason: ClientMessageActionProposal['reason'] | undefined;
  confidence: ClientMessageActionProposal['confidence'] | undefined;
  humanApprovalRequired: boolean | undefined;
  mutationResult: ClientMessageActionProposal['mutationResult'] | undefined;
  suggestedMutationTargets: ClientMessageActionProposal['suggestedMutationTargets'];
  requiredPreflightChecks: ClientMessageActionProposal['requiredPreflightChecks'];
};

export type ClientMessageAuditCounts = {
  pendingAppointments: number;
  messagesChatsScanned: number;
  contactCacheResolutions: number;
  matchedChats: number;
  sampledMatchedChats: number;
  replyThemeRows: number;
  replyThemeNearMisses: number;
  pendingClientReplyMatches: number;
  pendingClientReviewReplies: number;
};

export type ClientMessageAuditDiagnosticMeaningCounts = Record<
  string,
  {
    count: number;
    nextHardeningTarget?: string;
    interpretation?: string;
  }
>;

export type ClientMessageAuditObservationCounts = Record<string, number>;
export type ClientMessageAuditSignalCounts = Record<string, number>;

export type ClientMessageAuditDecoderCoverage = {
  totalMessages: number;
  attributedBodiesPresent: number;
  attributedBodiesDecoded: number;
  textFallbackCount: number;
  emptyCount: number;
  emptyReasonCounts: Record<string, number>;
  undecodedAttributedBodyWithoutText: number;
};

export type ClientMessageAuditManualReviewTarget = {
  appointmentIdHash: string | null;
  athleteKeyHash: string | null;
  outcome: string;
  chatGuidHash: string | null;
  lastMessageDate: string | null;
  reason: string;
  interpretation: string;
  observations: string[];
  latestClientReplySignals: string[];
};

export type ClientMessageAuditGateStatus = 'pass' | 'review' | 'fail';

export type ClientMessageAuditVerificationGate = {
  id:
    | 'messages_sql_readable'
    | 'contact_cache_admission'
    | 'pending_clients_scope'
    | 'action_proposals_human_in_loop'
    | 'manual_review_targets'
    | 'non_substantive_messages_accounted'
    | 'message_body_decoder_coverage'
    | 'weak_unparsed_replies_do_not_trigger_actions';
  status: ClientMessageAuditGateStatus;
  observed: unknown;
  required: string;
  meaning: string;
};

export type ClientMessageAuditVerificationSummary = {
  version: 1;
  status: ClientMessageAuditGateStatus;
  gates: ClientMessageAuditVerificationGate[];
};

export function buildClientMessageAuditPendingActions(
  pendingMatches: ClientMessageAuditPendingMatch[],
): ClientMessageAuditPendingAction[] {
  return pendingMatches
    .filter((match) => match.matchedReplyEvidence)
    .map((match) => ({
      appointmentIdHash: match.appointmentIdHash,
      athleteKeyHash: match.athleteKeyHash,
      outcome: match.outcome,
      replyState: match.replyState,
      action: match.proposal?.action,
      reason: match.proposal?.reason,
      confidence: match.proposal?.confidence,
      humanApprovalRequired: match.proposal?.humanApprovalRequired,
      mutationResult: match.proposal?.mutationResult,
      suggestedMutationTargets: match.proposal?.suggestedMutationTargets || [],
      requiredPreflightChecks: match.proposal?.requiredPreflightChecks || [],
    }));
}

export function buildClientMessageAuditVerificationSummary(args: {
  counts: ClientMessageAuditCounts;
  pendingActions: ClientMessageAuditPendingAction[];
  manualReviewTargets: ClientMessageAuditManualReviewTarget[];
  diagnosticMeaningCounts: ClientMessageAuditDiagnosticMeaningCounts;
  unmatchedObservationCounts: ClientMessageAuditObservationCounts;
  clientLatestUnparsedSignalCounts: ClientMessageAuditSignalCounts;
  decoderCoverage?: ClientMessageAuditDecoderCoverage;
}): ClientMessageAuditVerificationSummary {
  const mutatingActions = args.pendingActions.filter(
    (action) => (action.suggestedMutationTargets || []).length > 0,
  );
  const unsafeMutatingActions = mutatingActions.filter(
    (action) => action.humanApprovalRequired !== true || action.mutationResult !== 'proposed',
  );
  const readOnlyActions = args.pendingActions.filter(
    (action) => !(action.suggestedMutationTargets || []).length,
  );
  const unsafeReadOnlyActions = readOnlyActions.filter(
    (action) => action.humanApprovalRequired || action.mutationResult !== 'none/read_only',
  );
  const gates: ClientMessageAuditVerificationGate[] = [
    {
      id: 'messages_sql_readable',
      status: args.counts.messagesChatsScanned > 0 ? 'pass' : 'fail',
      observed: args.counts.messagesChatsScanned,
      required: '>0',
      meaning: 'Local Messages SQL produced recent chat evidence.',
    },
    {
      id: 'contact_cache_admission',
      status:
        args.counts.contactCacheResolutions > 0 && args.counts.matchedChats > 0
          ? 'pass'
          : 'fail',
      observed: {
        contactCacheResolutions: args.counts.contactCacheResolutions,
        matchedChats: args.counts.matchedChats,
      },
      required: 'contact-cache resolutions and matched chats both >0',
      meaning:
        'Client message threads were admitted through athlete_contact_cache, not raw phone guessing.',
    },
    {
      id: 'pending_clients_scope',
      status: args.counts.pendingAppointments > 0 ? 'pass' : 'review',
      observed: args.counts.pendingAppointments,
      required: '>0 for a live Pending Clients audit',
      meaning: 'Pending Clients scope came from appointment outcome evidence.',
    },
    {
      id: 'action_proposals_human_in_loop',
      status: unsafeMutatingActions.length || unsafeReadOnlyActions.length ? 'fail' : 'pass',
      observed: {
        pendingActions: args.pendingActions.length,
        mutatingActions: mutatingActions.length,
        unsafeMutatingActions: unsafeMutatingActions.length,
        unsafeReadOnlyActions: unsafeReadOnlyActions.length,
      },
      required:
        'all mutating actions require human approval and proposal status; read-only actions stay none/read_only',
      meaning: 'The action lane separates proposed mutations from read-only wait states.',
    },
    {
      id: 'manual_review_targets',
      status: args.manualReviewTargets.length ? 'review' : 'pass',
      observed: args.manualReviewTargets.length,
      required: '0 before parser expansion or automation claims',
      meaning:
        'Threads needing source review are surfaced explicitly instead of becoming hidden parser work.',
    },
    {
      id: 'non_substantive_messages_accounted',
      status:
        (args.unmatchedObservationCounts.client_reaction_only_present || 0) <=
        (args.unmatchedObservationCounts.non_substantive_message_present || 0)
          ? 'pass'
          : 'fail',
      observed: {
        nonSubstantiveMessageRows:
          args.unmatchedObservationCounts.non_substantive_message_present || 0,
        clientReactionOnlyRows: args.unmatchedObservationCounts.client_reaction_only_present || 0,
      },
      required: 'reaction-only rows are counted inside non-substantive message evidence',
      meaning:
        'Tapbacks and attachment placeholders are diagnostic SQL evidence, not client-reply action evidence.',
    },
    {
      id: 'message_body_decoder_coverage',
      status: args.decoderCoverage?.undecodedAttributedBodyWithoutText ? 'fail' : 'pass',
      observed: args.decoderCoverage || null,
      required:
        '0 sampled rows with attributedBody present, no decoded attributed body, and no text fallback',
      meaning:
        'Every sampled message row is either decoded to text or explicitly classified as known non-text diagnostic evidence.',
    },
    {
      id: 'weak_unparsed_replies_do_not_trigger_actions',
      status:
        args.diagnosticMeaningCounts.client_latest_unparsed_weak_reply?.count &&
        Object.keys(args.clientLatestUnparsedSignalCounts).some(
          (signal) => signal !== 'contains_thanks',
        )
          ? 'review'
          : 'pass',
      observed: {
        weakUnparsedReplies:
          args.diagnosticMeaningCounts.client_latest_unparsed_weak_reply?.count || 0,
        signals: args.clientLatestUnparsedSignalCounts,
      },
      required: 'weak unparsed replies remain read-only unless stronger schedule/call signals appear',
      meaning: 'Thanks-only or context-free client text does not create a follow-up automation lane.',
    },
  ];

  return {
    version: 1,
    status: gates.some((gate) => gate.status === 'fail')
      ? 'fail'
      : gates.some((gate) => gate.status === 'review')
        ? 'review'
        : 'pass',
    gates,
  };
}
