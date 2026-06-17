import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClientMessageAuditPendingActions,
  buildClientMessageAuditVerificationSummary,
  type ClientMessageAuditCounts,
  type ClientMessageAuditPendingAction,
  type ClientMessageAuditPendingMatch,
} from './client-message-audit-verification.js';
import type { ClientMessageActionProposal } from './client-message-action-proposals.js';

const counts: ClientMessageAuditCounts = {
  pendingAppointments: 20,
  messagesChatsScanned: 230,
  contactCacheResolutions: 102,
  matchedChats: 95,
  sampledMatchedChats: 95,
  replyThemeRows: 8,
  replyThemeNearMisses: 0,
  pendingClientReplyMatches: 3,
  pendingClientReviewReplies: 0,
};

function proposal(overrides: Partial<ClientMessageActionProposal> = {}): ClientMessageActionProposal {
  return {
    version: 1,
    flow: '10x_communications',
    step: 'propose-human-action',
    generatedAt: '2026-06-16T18:00:00.000Z',
    mutationResult: 'proposed',
    action: 'offer_reschedule_slots',
    humanApprovalRequired: true,
    confidence: 'high',
    reason: 'post_meeting_recovery_needs_slots',
    sourceSurfaces: ['local_messages_sql', 'athlete_contact_cache', 'client-message-reply-themes'],
    ids: {
      chatGuid: 'chat-1',
      contactId: 'contact-1',
      athleteMainId: 'athlete-main-1',
      currentTaskId: 'task-1',
      messageGuid: 'message-1',
    },
    suggestedMutationTargets: ['client_message_send', 'scout_prep_reschedule_flow', 'appointments'],
    requiredPreflightChecks: ['check_existing_active_appointment'],
    ...overrides,
  };
}

function verificationArgs(overrides: {
  pendingActions?: ClientMessageAuditPendingAction[];
  manualReviewTargets?: Parameters<typeof buildClientMessageAuditVerificationSummary>[0]['manualReviewTargets'];
  diagnosticMeaningCounts?: Parameters<typeof buildClientMessageAuditVerificationSummary>[0]['diagnosticMeaningCounts'];
  unmatchedObservationCounts?: Parameters<typeof buildClientMessageAuditVerificationSummary>[0]['unmatchedObservationCounts'];
  clientLatestUnparsedSignalCounts?: Parameters<typeof buildClientMessageAuditVerificationSummary>[0]['clientLatestUnparsedSignalCounts'];
  decoderCoverage?: Parameters<typeof buildClientMessageAuditVerificationSummary>[0]['decoderCoverage'];
  counts?: ClientMessageAuditCounts;
} = {}): Parameters<typeof buildClientMessageAuditVerificationSummary>[0] {
  return {
    counts: overrides.counts || counts,
    pendingActions:
      overrides.pendingActions ||
      buildClientMessageAuditPendingActions([
        {
          appointmentIdHash: 'appointment-1',
          athleteKeyHash: 'athlete-key-1',
          outcome: 'reschedule_pending',
          replyState: 'needs_reply',
          matchedReplyEvidence: true,
          proposal: proposal(),
        },
        {
          appointmentIdHash: 'appointment-2',
          athleteKeyHash: 'athlete-key-2',
          outcome: 'no_show',
          replyState: 'awaiting_reschedule',
          matchedReplyEvidence: true,
          proposal: proposal({
            action: 'await_client',
            reason: 'operator_already_sent_reschedule_options',
            humanApprovalRequired: false,
            mutationResult: 'none/read_only',
            suggestedMutationTargets: [],
            requiredPreflightChecks: [],
          }),
        },
      ]),
    manualReviewTargets: overrides.manualReviewTargets || [],
    diagnosticMeaningCounts:
      overrides.diagnosticMeaningCounts ||
      {
        client_latest_unparsed_weak_reply: {
          count: 1,
          nextHardeningTarget: 'none/read_only',
        },
      },
    unmatchedObservationCounts:
      overrides.unmatchedObservationCounts ||
      {
        non_substantive_message_present: 11,
        client_reaction_only_present: 3,
      },
    clientLatestUnparsedSignalCounts:
      overrides.clientLatestUnparsedSignalCounts || { contains_thanks: 1 },
    decoderCoverage: overrides.decoderCoverage || {
      totalMessages: 100,
      attributedBodiesPresent: 96,
      attributedBodiesDecoded: 96,
      textFallbackCount: 2,
      emptyCount: 2,
      emptyReasonCounts: { attachment: 1, summary: 1 },
      undecodedAttributedBodyWithoutText: 0,
    },
  };
}

test('builds redacted pending actions from matched evidence only', () => {
  const matches: ClientMessageAuditPendingMatch[] = [
    {
      appointmentIdHash: 'appointment-1',
      athleteKeyHash: 'athlete-key-1',
      outcome: 'reschedule_pending',
      replyState: 'needs_reply',
      matchedReplyEvidence: true,
      proposal: proposal(),
    },
    {
      appointmentIdHash: 'appointment-2',
      athleteKeyHash: 'athlete-key-2',
      outcome: 'no_show',
      matchedReplyEvidence: false,
    },
  ];

  assert.deepEqual(buildClientMessageAuditPendingActions(matches), [
    {
      appointmentIdHash: 'appointment-1',
      athleteKeyHash: 'athlete-key-1',
      outcome: 'reschedule_pending',
      replyState: 'needs_reply',
      action: 'offer_reschedule_slots',
      reason: 'post_meeting_recovery_needs_slots',
      confidence: 'high',
      humanApprovalRequired: true,
      mutationResult: 'proposed',
      suggestedMutationTargets: [
        'client_message_send',
        'scout_prep_reschedule_flow',
        'appointments',
      ],
      requiredPreflightChecks: ['check_existing_active_appointment'],
    },
  ]);
});

test('passes verification when live evidence and human-in-loop action gates are safe', () => {
  const summary = buildClientMessageAuditVerificationSummary(verificationArgs());

  assert.equal(summary.status, 'pass');
  assert.equal(summary.gates.length, 8);
  assert.deepEqual(
    summary.gates.map((gate) => [gate.id, gate.status]),
    [
      ['messages_sql_readable', 'pass'],
      ['contact_cache_admission', 'pass'],
      ['pending_clients_scope', 'pass'],
      ['action_proposals_human_in_loop', 'pass'],
      ['manual_review_targets', 'pass'],
      ['non_substantive_messages_accounted', 'pass'],
      ['message_body_decoder_coverage', 'pass'],
      ['weak_unparsed_replies_do_not_trigger_actions', 'pass'],
    ],
  );
});

test('fails verification when a mutating action bypasses human approval', () => {
  const pendingActions = buildClientMessageAuditPendingActions([
    {
      appointmentIdHash: 'appointment-1',
      athleteKeyHash: 'athlete-key-1',
      outcome: 'no_show',
      replyState: 'needs_reply',
      matchedReplyEvidence: true,
      proposal: proposal({ humanApprovalRequired: false }),
    },
  ]);
  const summary = buildClientMessageAuditVerificationSummary(verificationArgs({ pendingActions }));
  const actionGate = summary.gates.find((gate) => gate.id === 'action_proposals_human_in_loop');

  assert.equal(summary.status, 'fail');
  assert.equal(actionGate?.status, 'fail');
  assert.deepEqual(actionGate?.observed, {
    pendingActions: 1,
    mutatingActions: 1,
    unsafeMutatingActions: 1,
    unsafeReadOnlyActions: 0,
  });
});

test('review status is used when manual review targets remain', () => {
  const summary = buildClientMessageAuditVerificationSummary(
    verificationArgs({
      manualReviewTargets: [
        {
          appointmentIdHash: 'appointment-1',
          athleteKeyHash: 'athlete-key-1',
          outcome: 'reschedule_pending',
          chatGuidHash: 'chat-hash',
          lastMessageDate: '2026-06-16T18:00:00.000Z',
          reason: 'client_latest_unparsed_scheduling_reply',
          interpretation: 'Needs source review.',
          observations: ['latest_message_from_client'],
          latestClientReplySignals: ['contains_schedule_word'],
        },
      ],
    }),
  );

  assert.equal(summary.status, 'review');
  assert.equal(summary.gates.find((gate) => gate.id === 'manual_review_targets')?.status, 'review');
});

test('fails when reaction-only evidence is not counted as non-substantive evidence', () => {
  const summary = buildClientMessageAuditVerificationSummary(
    verificationArgs({
      unmatchedObservationCounts: {
        client_reaction_only_present: 3,
        non_substantive_message_present: 2,
      },
    }),
  );

  assert.equal(summary.status, 'fail');
  assert.equal(
    summary.gates.find((gate) => gate.id === 'non_substantive_messages_accounted')?.status,
    'fail',
  );
});

test('review status is used when weak unparsed replies carry stronger scheduling signals', () => {
  const summary = buildClientMessageAuditVerificationSummary(
    verificationArgs({
      clientLatestUnparsedSignalCounts: {
        contains_thanks: 1,
        contains_schedule_word: 1,
      },
    }),
  );

  assert.equal(summary.status, 'review');
  assert.equal(
    summary.gates.find((gate) => gate.id === 'weak_unparsed_replies_do_not_trigger_actions')
      ?.status,
    'review',
  );
});

test('fails when sampled attributed body evidence cannot be decoded or text-fallbacked', () => {
  const summary = buildClientMessageAuditVerificationSummary(
    verificationArgs({
      decoderCoverage: {
        totalMessages: 12,
        attributedBodiesPresent: 10,
        attributedBodiesDecoded: 9,
        textFallbackCount: 0,
        emptyCount: 3,
        emptyReasonCounts: { no_body_fields: 2, attachment: 1 },
        undecodedAttributedBodyWithoutText: 1,
      },
    }),
  );

  assert.equal(summary.status, 'fail');
  assert.equal(
    summary.gates.find((gate) => gate.id === 'message_body_decoder_coverage')?.status,
    'fail',
  );
});
