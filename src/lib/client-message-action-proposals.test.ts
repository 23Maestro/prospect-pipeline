import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClientMessageActionProposal,
  buildClientMessageActionProposalEvidenceBundle,
  buildClientMessageActionProposalEvidenceJson,
  buildClientMessageActionProposalMarkdown,
  buildClientMessageActionProposalVisualUrl,
  clientMessageOperatorActionLabel,
  clientMessageOperatorActionTagTone,
} from './client-message-action-proposals.js';
import type { ClientMessageThreadEvidenceReceipt } from './client-message-evidence-receipts.js';
import type { ClientReplyThemeRunReceipt } from './client-message-reply-themes.js';

function threadReceipt(
  overrides: Partial<ClientMessageThreadEvidenceReceipt> = {},
): ClientMessageThreadEvidenceReceipt {
  return {
    version: 1,
    flow: '10x_communications',
    step: 'read-message-thread-evidence',
    generatedAt: '2026-06-16T18:00:00.000Z',
    sourceSurfaces: ['local_messages_sql', 'athlete_contact_cache'],
    admission: {
      admittedBy: 'contact_cache',
      segment: 'client',
      ambiguity: 'none',
      matchedPhonesCount: 1,
      associatedClientsCount: 1,
    },
    ids: {
      chatGuid: 'chat-1',
      contactId: 'contact-1',
      athleteMainId: 'athlete-main-1',
      currentTaskId: 'task-1',
    },
    thread: {
      serviceName: 'iMessage',
      isGroup: false,
      participantCount: 1,
      totalMessages: 2,
      inboundCount: 1,
      outboundCount: 1,
      decodedAttributedBodyCount: 2,
      plainTextBodyCount: 0,
      emptyBodyCount: 0,
      firstMessageAt: '2026-06-16T17:00:00.000Z',
      lastMessageAt: '2026-06-16T17:05:00.000Z',
    },
    direction: {
      lastInboundGuid: 'in-1',
      lastOutboundGuid: 'out-1',
      operatorSentLatestMessage: false,
      clientSentLatestMessage: true,
    },
    context: {
      crmStage: 'Open',
      taskStatus: 'Call Attempt 1',
      currentTaskTitle: 'Call Attempt 1',
    },
    ...overrides,
  };
}

function classifierReceipt(
  overrides: Partial<ClientReplyThemeRunReceipt> = {},
): ClientReplyThemeRunReceipt {
  return {
    version: 1,
    flow: '10x_communications',
    step: 'classify-client-reply',
    generatedAt: '2026-06-16T18:00:00.000Z',
    mutationResult: 'none/read_only',
    sourceSurfaces: ['local_messages_sql', 'athlete_contact_cache', 'client-message-reply-themes'],
    ids: {
      chatGuid: 'chat-1',
      messageGuid: 'in-1',
      contactId: 'contact-1',
      athleteMainId: 'athlete-main-1',
      matchedPhonesCount: 1,
    },
    direction: {
      lastInboundGuid: 'in-1',
      lastOutboundGuid: 'out-1',
      operatorRepliedAfterInbound: false,
      operatorReplyProposedTimes: false,
    },
    classifier: {
      theme: 'outreach_callback',
      templateContext: 'outreach_attempt',
      themeBucket: 'Call Attempt',
      clientOptedOut: false,
    },
    operatorAction: 'needs_first_contact_reply',
    evidenceMeaning: {
      operatorAction: 'needs_first_contact_reply',
      interpretation:
        'Client replied with callback/timing language after an outreach-attempt template.',
      requiredEvidence: [
        'theme=outreach_callback',
        'templateContext=outreach_attempt',
        'themeBucket=Call Attempt',
      ],
    },
    ...overrides,
  };
}

test('proposes first-contact reply with reminder and calendar preflight checks', () => {
  const proposal = buildClientMessageActionProposal({
    generatedAt: '2026-06-16T18:01:00.000Z',
    threadReceipt: threadReceipt(),
    classifierReceipt: classifierReceipt(),
  });

  assert.deepEqual(proposal, {
    version: 1,
    flow: '10x_communications',
    step: 'propose-human-action',
    generatedAt: '2026-06-16T18:01:00.000Z',
    mutationResult: 'proposed',
    action: 'send_first_contact_reply',
    humanApprovalRequired: true,
    confidence: 'high',
    reason: 'client_replied_to_outreach_attempt',
    sourceSurfaces: ['local_messages_sql', 'athlete_contact_cache', 'client-message-reply-themes'],
    ids: {
      chatGuid: 'chat-1',
      contactId: 'contact-1',
      athleteMainId: 'athlete-main-1',
      currentTaskId: 'task-1',
      messageGuid: 'in-1',
    },
    suggestedMutationTargets: ['client_message_send', 'apple_reminders', 'apple_calendar_appts'],
    requiredPreflightChecks: ['check_prospect_id_reminders', 'check_appts_calendar'],
  });
});

test('proposes reschedule slots when client needs new times', () => {
  const proposal = buildClientMessageActionProposal({
    threadReceipt: threadReceipt({
      context: {
        crmStage: 'Meeting Set',
        taskStatus: 'Meeting Result - No Show',
        currentTaskTitle: 'Meeting Result - No Show',
      },
    }),
    classifierReceipt: classifierReceipt({
      classifier: {
        theme: 'reschedule_request',
        templateContext: 'confirmation',
        themeBucket: 'No Show',
        clientOptedOut: false,
      },
      operatorAction: 'needs_reschedule_times',
    }),
  });

  assert.equal(proposal.action, 'offer_reschedule_slots');
  assert.equal(proposal.reason, 'post_meeting_recovery_needs_slots');
  assert.deepEqual(proposal.suggestedMutationTargets, [
    'client_message_send',
    'scout_prep_reschedule_flow',
    'appointments',
  ]);
  assert.deepEqual(proposal.requiredPreflightChecks, ['check_existing_active_appointment']);
});

test('proposes awaiting client when operator already sent reschedule options', () => {
  const proposal = buildClientMessageActionProposal({
    threadReceipt: threadReceipt({
      direction: {
        lastInboundGuid: 'in-1',
        lastOutboundGuid: 'out-2',
        operatorSentLatestMessage: true,
        clientSentLatestMessage: false,
      },
    }),
    classifierReceipt: classifierReceipt({
      direction: {
        lastInboundGuid: 'in-1',
        lastOutboundGuid: 'out-2',
        operatorRepliedAfterInbound: true,
        operatorReplyProposedTimes: true,
      },
      classifier: {
        theme: 'reschedule_request',
        templateContext: 'confirmation',
        themeBucket: 'RSP',
        clientOptedOut: false,
      },
      operatorAction: 'awaiting_client_reschedule_choice',
    }),
  });

  assert.equal(proposal.action, 'await_client');
  assert.equal(proposal.humanApprovalRequired, false);
  assert.equal(proposal.mutationResult, 'none/read_only');
  assert.deepEqual(proposal.suggestedMutationTargets, []);
});

test('proposes reschedule reply review when client answered after proposed times', () => {
  const proposal = buildClientMessageActionProposal({
    threadReceipt: threadReceipt({
      context: {
        crmStage: 'Meeting Result - Res. Pending',
        taskStatus: 'Reschedule Pending',
        currentTaskTitle: 'Reschedule Pending',
      },
    }),
    classifierReceipt: classifierReceipt({
      direction: {
        lastInboundGuid: 'client-choice',
        lastOutboundGuid: 'times',
        operatorRepliedAfterInbound: true,
        operatorReplyProposedTimes: true,
      },
      classifier: {
        theme: 'reschedule_request',
        templateContext: 'confirmation',
        themeBucket: 'RSP',
        clientOptedOut: false,
      },
      operatorAction: 'review_reschedule_reply',
    }),
  });

  assert.equal(proposal.action, 'review_reschedule_reply');
  assert.equal(proposal.humanApprovalRequired, true);
  assert.equal(proposal.reason, 'client_replied_after_proposed_times');
  assert.deepEqual(proposal.suggestedMutationTargets, [
    'scout_prep_reschedule_flow',
    'appointments',
  ]);
  assert.deepEqual(proposal.requiredPreflightChecks, ['check_existing_active_appointment']);
});

test('keeps ambiguous thread admission in needs review', () => {
  const proposal = buildClientMessageActionProposal({
    threadReceipt: threadReceipt({
      admission: {
        admittedBy: 'merged',
        segment: 'pending',
        ambiguity: 'multiple_athletes',
        matchedPhonesCount: 2,
        associatedClientsCount: 2,
      },
    }),
    classifierReceipt: classifierReceipt(),
  });

  assert.equal(proposal.action, 'needs_review');
  assert.equal(proposal.confidence, 'low');
  assert.equal(proposal.reason, 'ambiguous_contact_identity');
  assert.equal(proposal.humanApprovalRequired, true);
});

test('renders evidence and proposal bundle as json markdown without message bodies', () => {
  const thread = threadReceipt();
  const classifier = classifierReceipt();
  const proposal = buildClientMessageActionProposal({
    generatedAt: '2026-06-16T18:01:00.000Z',
    threadReceipt: thread,
    classifierReceipt: classifier,
  });

  const markdown = buildClientMessageActionProposalMarkdown({
    title: 'Avery Jones',
    threadReceipt: thread,
    classifierReceipt: classifier,
    proposal,
  });

  assert.match(markdown, /^# 10x Communications Evidence\n/);
  assert.match(markdown, /## Proposal\n```json\n/);
  assert.match(markdown, /"action": "send_first_contact_reply"/);
  assert.match(markdown, /## Messages SQL Evidence\n```json\n/);
  assert.match(markdown, /## Reply Classification\n```json\n/);
  assert.equal(markdown.includes('Tomorrow works after school'), false);
});

test('builds copyable evidence bundle for debugging and replay', () => {
  const thread = threadReceipt();
  const classifier = classifierReceipt();
  const proposal = buildClientMessageActionProposal({
    generatedAt: '2026-06-16T18:01:00.000Z',
    threadReceipt: thread,
    classifierReceipt: classifier,
  });

  const bundle = buildClientMessageActionProposalEvidenceBundle({
    title: 'Avery Jones',
    threadReceipt: thread,
    classifierReceipt: classifier,
    proposal,
  });

  assert.deepEqual(bundle, {
    version: 1,
    flow: '10x_communications',
    step: 'review-follow-up-evidence',
    generatedAt: '2026-06-16T18:01:00.000Z',
    title: 'Avery Jones',
    proposal,
    messagesSqlEvidence: thread,
    replyClassification: classifier,
  });
});

test('builds evidence json without message bodies', () => {
  const thread = threadReceipt();
  const classifier = classifierReceipt();
  const proposal = buildClientMessageActionProposal({
    generatedAt: '2026-06-16T18:01:00.000Z',
    threadReceipt: thread,
    classifierReceipt: classifier,
  });

  const json = buildClientMessageActionProposalEvidenceJson({
    title: 'Avery Jones',
    threadReceipt: thread,
    classifierReceipt: classifier,
    proposal,
  });

  assert.match(json, /"step": "review-follow-up-evidence"/);
  assert.match(json, /"messagesSqlEvidence"/);
  assert.match(json, /"replyClassification"/);
  assert.match(json, /"action": "send_first_contact_reply"/);
  assert.equal(json.includes('Tomorrow works after school'), false);
});

test('builds browser visual url with evidence payload in the hash', () => {
  const thread = threadReceipt();
  const classifier = classifierReceipt();
  const proposal = buildClientMessageActionProposal({
    generatedAt: '2026-06-16T18:01:00.000Z',
    threadReceipt: thread,
    classifierReceipt: classifier,
  });

  const url = buildClientMessageActionProposalVisualUrl(
    {
      title: 'Avery Jones',
      threadReceipt: thread,
      classifierReceipt: classifier,
      proposal,
    },
    'https://prospect-web.vercel.app/',
  );

  assert.match(url, /^https:\/\/prospect-web\.vercel\.app\/10x-communications-evidence#payload=/);
  assert.equal(url.includes('?payload='), false);
  assert.equal(url.includes('Tomorrow works after school'), false);
});

test('maps classifier operator action to compact list labels', () => {
  assert.equal(clientMessageOperatorActionLabel('needs_first_contact_reply'), 'Needs Reply');
  assert.equal(clientMessageOperatorActionLabel('needs_reschedule_times'), 'Offer Slots');
  assert.equal(
    clientMessageOperatorActionLabel('awaiting_client_reschedule_choice'),
    'Awaiting Client',
  );
  assert.equal(clientMessageOperatorActionLabel('review_reschedule_reply'), 'Review Reply');
  assert.equal(clientMessageOperatorActionLabel('review_opt_out'), 'Review Opt Out');
  assert.equal(clientMessageOperatorActionLabel('needs_review'), 'Needs Review');
});

test('maps classifier operator action to display tone without implying mutation status', () => {
  assert.equal(clientMessageOperatorActionTagTone('needs_first_contact_reply'), 'urgent');
  assert.equal(clientMessageOperatorActionTagTone('needs_reschedule_times'), 'urgent');
  assert.equal(clientMessageOperatorActionTagTone('awaiting_client_reschedule_choice'), 'muted');
  assert.equal(clientMessageOperatorActionTagTone('review_reschedule_reply'), 'urgent');
  assert.equal(clientMessageOperatorActionTagTone('review_opt_out'), 'warning');
  assert.equal(clientMessageOperatorActionTagTone('needs_review'), 'warning');
});
