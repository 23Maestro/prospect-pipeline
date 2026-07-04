import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_REPLY_EVIDENCE_OBSERVATION_DEFINITIONS,
  CLIENT_REPLY_LATEST_CLIENT_SIGNAL_DEFINITIONS,
  MISSED_CLIENT_REPLY_FLAGS,
  buildClientReplyThreadDiagnostics,
  buildClientReplyThemeRunReceipt,
  buildClientReplyThemeReviewSnapshot,
  buildClientReplyThemeThreadMarkdown,
  classifyClientMessageTheme,
  classifyPendingClientThemeBucket,
  clientReplyThemeReviewBucketLabel,
  clientReplyThemeReviewDisplayName,
  clientReplyThemeReviewReasonLabel,
  clientReplyThemeReviewReasonTagLabel,
  clientReplyThemeReviewToneLabel,
  clientReplyThemeReviewToneTagColor,
  findPendingClientReplyThemeState,
  interpretClientReplyThreadDiagnostics,
  isOperatorRescheduleOffer,
  readCachedClientReplyThemeReviewSnapshot,
  writeCachedClientReplyThemeReviewSnapshot,
} from './client-message-reply-themes.js';

function chat(overrides = {}) {
  return {
    guid: 'chat-1',
    displayName: 'Tiffany Jones',
    lastMessageDate: '2026-05-27T16:00:00.000Z',
    athleteName: 'Avery Jones',
    contactId: '123',
    athleteMainId: '456',
    timezone: 'America/Chicago',
    timezoneLabel: 'CST',
    taskTitle: 'Reschedule Pending',
    matchedPhones: ['6155551212'],
    ...overrides,
  };
}

function message(overrides = {}) {
  return {
    guid: 'message-1',
    body: 'Can we reschedule for tomorrow?',
    date: '2026-05-27T16:00:00.000Z',
    senderName: 'Tiffany Jones',
    sender: '6155551212',
    isFromMe: false,
    ...overrides,
  };
}

test('classifies reply themes from actionable client wording', () => {
  assert.deepEqual(MISSED_CLIENT_REPLY_FLAGS, ['reschedule_request', 'outreach_callback']);
  assert.equal(classifyClientMessageTheme('Can we reschedule?'), 'reschedule_request');
  assert.equal(classifyClientMessageTheme('Need to move the meeting'), 'reschedule_request');
  assert.equal(classifyClientMessageTheme('1'), 'reschedule_request');
  assert.equal(classifyClientMessageTheme('one'), 'reschedule_request');
  assert.equal(
    classifyClientMessageTheme('still interested, need to reschedule'),
    'reschedule_request',
  );
  assert.equal(classifyClientMessageTheme('Tomorrow works better'), 'outreach_callback');
  assert.equal(classifyClientMessageTheme('I am working right now'), 'outreach_callback');
  assert.equal(classifyClientMessageTheme('Can you call me after work?'), 'outreach_callback');
  assert.equal(classifyClientMessageTheme('Thanks'), null);
});

test('no-show option reply 1 is needs reply until operator proposes new times', () => {
  const needsReplySnapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-06-13T17:00:00.000Z',
    chats: [chat({ athleteMainId: '456', taskTitle: 'Meeting Result - No Show' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'no-show-options',
          body: [
            'Hi Jacoreyia, reply with the best fit:',
            '',
            '1 - still interested, need to reschedule',
            '2 - interested, timing is bad',
            '3 - no longer interested',
          ].join('\n'),
          date: '2026-06-13T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'client-one',
          body: '1',
          date: '2026-06-13T14:05:00.000Z',
        }),
      ],
    },
  });

  assert.equal(needsReplySnapshot.rows.length, 1);
  assert.equal(needsReplySnapshot.rows[0].theme, 'reschedule_request');
  assert.equal(needsReplySnapshot.rows[0].operatorRepliedAfter, false);
  assert.equal(needsReplySnapshot.rows[0].replyEvidence?.themeBucket, 'No Show');
  assert.equal(needsReplySnapshot.rows[0].replyEvidence?.lastMeaningfulInbound?.body, '1');
  assert.equal(needsReplySnapshot.rows[0].replyEvidence?.operatorRepliedAfterInbound, false);
  assert.equal(needsReplySnapshot.rows[0].replyEvidence?.operatorReplyProposedTimes, false);
  assert.equal(
    findPendingClientReplyThemeState(
      { athlete_main_id: '456', athlete_name: 'Avery Jones' },
      needsReplySnapshot,
    )?.status,
    'needs_reply',
  );

  const awaitingSnapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-06-13T17:00:00.000Z',
    chats: [chat({ athleteMainId: '456', taskTitle: 'Meeting Result - No Show' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'no-show-options',
          body: [
            'Hi Jacoreyia, reply with the best fit:',
            '',
            '1 - still interested, need to reschedule',
            '2 - interested, timing is bad',
            '3 - no longer interested',
          ].join('\n'),
          date: '2026-06-13T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'client-one',
          body: '1',
          date: '2026-06-13T14:05:00.000Z',
        }),
        message({
          guid: 'operator-times',
          body: 'Here are two new times to reschedule: 1 - Mon 3PM ET, 2 - Tue 4PM ET',
          date: '2026-06-13T14:10:00.000Z',
          isFromMe: true,
        }),
      ],
    },
  });

  assert.equal(awaitingSnapshot.rows[0].operatorRepliedAfter, true);
  assert.equal(awaitingSnapshot.rows[0].operatorRescheduleOfferAfter, true);
  assert.equal(awaitingSnapshot.rows[0].replyEvidence?.themeBucket, 'No Show');
  assert.equal(awaitingSnapshot.rows[0].replyEvidence?.operatorRepliedAfterInbound, true);
  assert.equal(awaitingSnapshot.rows[0].replyEvidence?.operatorReplyProposedTimes, true);
  assert.equal(
    findPendingClientReplyThemeState(
      { athlete_main_id: '456', athlete_name: 'Avery Jones' },
      awaitingSnapshot,
    )?.status,
    'awaiting_reschedule',
  );
});

test('reschedule reply evidence distinguishes generic reply from proposed times', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-06-13T12:00:00.000Z',
    chats: [
      chat({
        guid: 'chat-rsp',
        displayName: 'Parent',
        athleteName: 'Avery Jones',
        athleteMainId: '9001',
        taskTitle: 'Reschedule Pending',
      }),
    ],
    messagesByChatGuid: {
      'chat-rsp': [
        message({
          guid: 'out-1',
          isFromMe: true,
          date: '2026-06-13T10:00:00.000Z',
          body: 'Please reply with the best fit. 1 reschedule, 2 bad timing, 3 no longer interested.',
        }),
        message({
          guid: 'in-1',
          isFromMe: false,
          date: '2026-06-13T10:05:00.000Z',
          body: '1',
        }),
        message({
          guid: 'out-2',
          isFromMe: true,
          date: '2026-06-13T10:10:00.000Z',
          body: 'No problem, I will check with Coach.',
        }),
      ],
    },
  });

  assert.equal(snapshot.rows[0].operatorRepliedAfter, true);
  assert.equal(snapshot.rows[0].operatorRescheduleOfferAfter, false);
  assert.equal(snapshot.rows[0].replyEvidence?.themeBucket, 'RSP');
  assert.equal(snapshot.rows[0].replyEvidence?.lastMeaningfulInbound?.body, '1');
  assert.equal(
    snapshot.rows[0].replyEvidence?.lastMeaningfulOutbound?.body,
    'No problem, I will check with Coach.',
  );
});

test('builds pii-safe thread diagnostics for unmatched pending-client audit cases', () => {
  const diagnostics = buildClientReplyThreadDiagnostics({
    taskTitle: 'Meeting Result - No Show',
    messages: [
      message({
        guid: 'out-options',
        isFromMe: true,
        date: '2026-06-13T10:00:00.000Z',
        body: 'Please reply with the best fit. 1 reschedule, 2 timing is bad, 3 no longer interested.',
      }),
      message({
        guid: 'in-thanks',
        isFromMe: false,
        date: '2026-06-13T10:05:00.000Z',
        body: 'Thanks, I need to reschedule',
      }),
      message({
        guid: 'out-times',
        isFromMe: true,
        date: '2026-06-13T10:10:00.000Z',
        body: 'Here are two new times to reschedule: 1 - Mon 3PM ET, 2 - Tue 4PM ET',
      }),
      message({
        guid: 'empty',
        isFromMe: false,
        date: '2026-06-13T10:15:00.000Z',
        body: '',
      }),
    ],
  });

  assert.deepEqual(diagnostics, {
    version: 1,
    observationIds: [
      'messages_present',
      'empty_body_present',
      'latest_message_from_operator',
      'known_inbound_theme_detected',
      'outbound_template_context_detected',
      'operator_reschedule_offer_detected',
      'post_meeting_recovery_context',
    ],
    totalMessages: 4,
    inboundCount: 1,
    outboundCount: 2,
    emptyBodyCount: 1,
    latestDirection: 'operator',
    lastInboundAt: '2026-06-13T10:05:00.000Z',
    lastOutboundAt: '2026-06-13T10:10:00.000Z',
    clientRepliedAfterLastOutbound: false,
    outboundTemplateContexts: ['confirmation'],
    inboundThemes: ['reschedule_request'],
    outboundRescheduleOfferCount: 1,
    taskSuggestsPostMeetingRecovery: true,
    latestClientReplySignals: [],
    nonSubstantiveMessageCount: 0,
    reactionOnlyCount: 0,
  });
  assert.equal(JSON.stringify(diagnostics).includes('Thanks, I need to reschedule'), false);
  assert.equal(JSON.stringify(diagnostics).includes('Mon 3PM'), false);
  assert.deepEqual(interpretClientReplyThreadDiagnostics(diagnostics), {
    state: 'theme_present_but_operator_latest',
    interpretation:
      'A known client theme exists in the thread, but the operator sent the latest meaningful message afterward.',
    nextHardeningTarget: 'none/read_only',
  });
  assert.deepEqual(
    interpretClientReplyThreadDiagnostics({
      ...diagnostics,
      observationIds: [
        'messages_present',
        'empty_body_present',
        'latest_message_from_client',
        'client_replied_after_last_outbound',
        'no_known_inbound_theme',
        'outbound_template_context_detected',
        'operator_reschedule_offer_detected',
        'post_meeting_recovery_context',
      ],
      latestDirection: 'client',
      inboundThemes: [],
      clientRepliedAfterLastOutbound: true,
    }),
    {
      state: 'client_latest_unparsed_reply',
      interpretation:
        'Client sent the latest meaningful message, but deterministic reply-theme parsing found no known actionable theme.',
      nextHardeningTarget: 'expand_reply_theme_patterns',
    },
  );

  assert.deepEqual(
    interpretClientReplyThreadDiagnostics({
      ...diagnostics,
      observationIds: [
        'messages_present',
        'latest_message_from_client',
        'client_replied_after_last_outbound',
        'no_known_inbound_theme',
        'no_outbound_template_context',
        'post_meeting_recovery_context',
      ],
      latestDirection: 'client',
      inboundThemes: [],
      outboundTemplateContexts: [],
      clientRepliedAfterLastOutbound: true,
      latestClientReplySignals: ['contains_thanks'],
    }),
    {
      state: 'client_latest_unparsed_weak_reply',
      interpretation:
        'Client sent the latest message, but only weak or context-free signals were detected; this is not enough to expand automation patterns.',
      nextHardeningTarget: 'none/read_only',
    },
  );

  assert.deepEqual(
    interpretClientReplyThreadDiagnostics({
      ...diagnostics,
      observationIds: [
        'messages_present',
        'latest_message_from_client',
        'client_replied_after_last_outbound',
        'no_known_inbound_theme',
        'outbound_template_context_detected',
        'post_meeting_recovery_context',
      ],
      latestDirection: 'client',
      inboundThemes: [],
      outboundTemplateContexts: ['confirmation'],
      clientRepliedAfterLastOutbound: true,
      latestClientReplySignals: [
        'contains_call_word',
        'contains_schedule_word',
        'contains_time_word',
      ],
    }),
    {
      state: 'client_latest_unparsed_scheduling_reply',
      interpretation:
        'Client sent the latest message with scheduling-like signals in a post-meeting recovery thread, but no deterministic reply theme matched.',
      nextHardeningTarget: 'manual_source_review',
    },
  );

  const unparsedClientLatest = buildClientReplyThreadDiagnostics({
    taskTitle: 'Meeting Result - No Show',
    messages: [
      message({
        guid: 'operator',
        isFromMe: true,
        date: '2026-06-13T10:00:00.000Z',
        body: 'Prospect ID Zoom meeting tomorrow at 5 PM.',
      }),
      message({
        guid: 'client-latest',
        isFromMe: false,
        date: '2026-06-13T10:05:00.000Z',
        body: 'Okay afternoon works?',
      }),
    ],
  });

  assert.deepEqual(unparsedClientLatest.observationIds, [
    'messages_present',
    'latest_message_from_client',
    'client_replied_after_last_outbound',
    'no_known_inbound_theme',
    'outbound_template_context_detected',
    'post_meeting_recovery_context',
  ]);
  assert.deepEqual(unparsedClientLatest.latestClientReplySignals, [
    'short_reply',
    'contains_question',
    'contains_affirmation',
    'contains_schedule_word',
    'contains_time_word',
  ]);
  assert.equal(JSON.stringify(unparsedClientLatest).includes('Okay afternoon'), false);

  const reactionOnlyLatest = buildClientReplyThreadDiagnostics({
    taskTitle: 'Meeting Result - Res. Pending',
    messages: [
      message({
        guid: 'confirmation',
        isFromMe: true,
        date: '2026-06-10T13:47:47.000Z',
        body: 'Prospect ID Zoom Meeting tonight at 7:00 PM CT. He will call your cell at 7:00 with the Zoom code.',
      }),
      message({
        guid: 'contact-card',
        isFromMe: true,
        date: '2026-06-10T13:48:00.000Z',
        body: '￼',
      }),
      message({
        guid: 'tapback',
        isFromMe: false,
        date: '2026-06-10T13:48:19.000Z',
        body: 'Liked “Prospect ID Zoom Meeting tonight at 7:00 PM CT. He will call your cell at 7:00 with the Zoom code.”',
      }),
    ],
  });

  assert.deepEqual(reactionOnlyLatest.observationIds, [
    'messages_present',
    'non_substantive_message_present',
    'client_reaction_only_present',
    'latest_message_from_operator',
    'no_known_inbound_theme',
    'outbound_template_context_detected',
    'post_meeting_recovery_context',
  ]);
  assert.equal(reactionOnlyLatest.inboundCount, 0);
  assert.equal(reactionOnlyLatest.outboundCount, 1);
  assert.equal(reactionOnlyLatest.nonSubstantiveMessageCount, 2);
  assert.equal(reactionOnlyLatest.reactionOnlyCount, 1);
  assert.equal(reactionOnlyLatest.clientRepliedAfterLastOutbound, false);
  assert.deepEqual(reactionOnlyLatest.latestClientReplySignals, []);
  assert.deepEqual(interpretClientReplyThreadDiagnostics(reactionOnlyLatest), {
    state: 'operator_latest_no_open_client_reply',
    interpretation:
      'Operator sent the latest meaningful message and no unhandled actionable client theme is visible.',
    nextHardeningTarget: 'none/read_only',
  });
});

test('defines evidence observation and latest-client signal semantics', () => {
  assert.deepEqual(
    Object.keys(CLIENT_REPLY_EVIDENCE_OBSERVATION_DEFINITIONS).sort(),
    [
      'client_reaction_only_present',
      'client_replied_after_last_outbound',
      'empty_body_present',
      'known_inbound_theme_detected',
      'latest_message_from_client',
      'latest_message_from_operator',
      'messages_present',
      'no_known_inbound_theme',
      'no_outbound_template_context',
      'non_substantive_message_present',
      'operator_reschedule_offer_detected',
      'outbound_template_context_detected',
      'post_meeting_recovery_context',
    ],
  );
  assert.equal(
    CLIENT_REPLY_EVIDENCE_OBSERVATION_DEFINITIONS.operator_reschedule_offer_detected.proves,
    'A decoded operator message matched reschedule-option language.',
  );
  assert.equal(
    CLIENT_REPLY_EVIDENCE_OBSERVATION_DEFINITIONS.operator_reschedule_offer_detected.doesNotProve,
    'It does not prove a calendar event or reminder was created.',
  );
  assert.equal(
    CLIENT_REPLY_EVIDENCE_OBSERVATION_DEFINITIONS.no_known_inbound_theme.parserImpact,
    'Use latestClientReplySignals to decide whether to expand reply patterns.',
  );
  assert.equal(
    CLIENT_REPLY_EVIDENCE_OBSERVATION_DEFINITIONS.client_reaction_only_present.doesNotProve,
    'It does not prove acceptance, rejection, or reschedule intent.',
  );
  assert.equal(
    CLIENT_REPLY_EVIDENCE_OBSERVATION_DEFINITIONS.non_substantive_message_present.parserImpact,
    'Exclude from latest-direction and theme decisions while keeping it visible for SQL diagnostics.',
  );
  assert.deepEqual(Object.keys(CLIENT_REPLY_LATEST_CLIENT_SIGNAL_DEFINITIONS).sort(), [
    'contains_affirmation',
    'contains_call_word',
    'contains_day_word',
    'contains_negative',
    'contains_numeric_choice',
    'contains_question',
    'contains_schedule_word',
    'contains_thanks',
    'contains_time_word',
    'short_reply',
  ]);
  assert.equal(
    CLIENT_REPLY_LATEST_CLIENT_SIGNAL_DEFINITIONS.contains_thanks.parserImpact,
    'Usually weak evidence unless paired with schedule or call language.',
  );
  assert.equal(
    CLIENT_REPLY_LATEST_CLIENT_SIGNAL_DEFINITIONS.contains_time_word.parserImpact,
    'Candidate for scheduling parser expansion when paired with call or schedule words.',
  );
});

test('builds pii-minimized run receipt from client reply evidence', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-06-13T12:00:00.000Z',
    chats: [
      chat({
        guid: 'chat-rsp',
        displayName: 'Parent',
        athleteName: 'Avery Jones',
        contactId: 'contact-1',
        athleteMainId: '9001',
        taskTitle: 'Reschedule Pending',
        matchedPhones: ['6155551212'],
      }),
    ],
    messagesByChatGuid: {
      'chat-rsp': [
        message({
          guid: 'out-1',
          isFromMe: true,
          date: '2026-06-13T10:00:00.000Z',
          body: 'Please reply with the best fit. 1 reschedule, 2 bad timing, 3 no longer interested.',
        }),
        message({
          guid: 'in-1',
          isFromMe: false,
          date: '2026-06-13T10:05:00.000Z',
          body: '1',
        }),
        message({
          guid: 'out-2',
          isFromMe: true,
          date: '2026-06-13T10:10:00.000Z',
          body: 'No problem, I will check with Coach.',
        }),
      ],
    },
  });

  const receipt = buildClientReplyThemeRunReceipt(snapshot.rows[0], {
    generatedAt: '2026-06-13T12:01:00.000Z',
  });

  assert.deepEqual(receipt, {
    version: 1,
    flow: '10x_communications',
    step: 'classify-client-reply',
    generatedAt: '2026-06-13T12:01:00.000Z',
    mutationResult: 'none/read_only',
    sourceSurfaces: ['local_messages_sql', 'athlete_contact_cache', 'client-message-reply-themes'],
    ids: {
      chatGuid: 'chat-rsp',
      messageGuid: 'in-1',
      contactId: 'contact-1',
      athleteMainId: '9001',
      matchedPhonesCount: 1,
    },
    direction: {
      lastInboundGuid: 'in-1',
      lastOutboundGuid: 'out-2',
      operatorRepliedAfterInbound: true,
      operatorReplyProposedTimes: false,
    },
    classifier: {
      theme: 'reschedule_request',
      templateContext: 'confirmation',
      themeBucket: 'RSP',
      clientOptedOut: false,
    },
    operatorAction: 'needs_reschedule_times',
    evidenceMeaning: {
      operatorAction: 'needs_reschedule_times',
      interpretation:
        'Client reply indicates post-meeting recovery or reschedule intent and no reschedule times have been sent after that reply.',
      requiredEvidence: [
        'theme=reschedule_request',
        'themeBucket=RSP|No Show|Cancel',
        'operatorReplyProposedTimes=false',
      ],
    },
  });
  assert.equal(JSON.stringify(receipt).includes('No problem, I will check with Coach.'), false);
});

test('run receipt can record approved mutation result without changing classifier meaning', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-06-13T12:00:00.000Z',
    chats: [chat({ taskTitle: 'Call Attempt 1' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'outreach',
          body: 'Would later today or tomorrow work for a quick 10-minute call?',
          date: '2026-06-13T10:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'client-reply',
          body: 'Tomorrow works after school',
          date: '2026-06-13T10:05:00.000Z',
        }),
      ],
    },
  });

  const receipt = buildClientReplyThemeRunReceipt(snapshot.rows[0], {
    mutationResult: 'approved',
    sourceSurfaces: ['local_messages_sql', 'athlete_contact_cache', 'apple_reminders'],
  });

  assert.equal(receipt.operatorAction, 'needs_first_contact_reply');
  assert.equal(receipt.mutationResult, 'approved');
  assert.deepEqual(receipt.sourceSurfaces, [
    'local_messages_sql',
    'athlete_contact_cache',
    'apple_reminders',
  ]);
});

test('classifies pending client theme buckets from reply text and task context', () => {
  const fixtures = [
    ['1', 'Meeting Result - No Show', 'No Show'],
    ['2', 'Meeting Result - No Show', 'No Show'],
    ['3', 'Meeting Result - No Show', 'No Show'],
    ['Can we do later today?', 'Call Attempt 1', 'Call Attempt'],
    ['Call me after work', 'Call Attempt 2', 'Call Attempt'],
    ['We need to cancel but maybe another week', 'Meeting Result - Canceled', 'Cancel'],
    ['Not interested anymore', 'Meeting Result - Canceled', 'Opt Out'],
    ['Need to reschedule', 'Reschedule Pending', 'RSP'],
  ] as const;

  for (const [body, taskTitle, expected] of fixtures) {
    assert.equal(classifyPendingClientThemeBucket(body, 'reschedule_request', taskTitle), expected);
  }
});

test('flags only obvious missed reschedule replies after confirmation templates', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat()],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Prospect ID Zoom Meeting tomorrow at 5:00 PM EST with Coach Ryan.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Can we reschedule?',
          date: '2026-05-27T16:00:00.000Z',
        }),
      ],
    },
  });

  assert.equal(snapshot.generatedAt, '2026-05-27T17:00:00.000Z');
  assert.equal(snapshot.totalChatsReviewed, 1);
  assert.equal(snapshot.totalMessagesReviewed, 2);
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].theme, 'reschedule_request');
  assert.equal(snapshot.rows[0].templateContext, 'confirmation');
  assert.equal(snapshot.rows[0].chatGuid, 'chat-1');
  assert.equal(snapshot.rows[0].athleteName, 'Avery Jones');
  assert.equal(snapshot.rows[0].timezone, 'America/Chicago');
  assert.equal(snapshot.rows[0].timezoneLabel, 'CST');
});

test('flags only obvious missed callback replies after outreach attempt templates', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat()],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'attempt',
          body: 'This is Jerami with Prospect ID. Avery’s profile came through and I wanted to ask a few quick questions about his college football goals.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Tomorrow would be better I am working right now',
          date: '2026-05-27T16:00:00.000Z',
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].theme, 'outreach_callback');
  assert.equal(snapshot.rows[0].templateContext, 'outreach_attempt');
});

test('matches pending clients to callback timing evidence', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ taskTitle: 'Call Attempt 1' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'attempt',
          body: 'This is Jerami with Prospect ID. Avery’s profile came through and I wanted to ask a few quick questions about his college football goals.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Can you call me after work?',
          date: '2026-05-27T16:00:00.000Z',
        }),
      ],
    },
  });

  const state = findPendingClientReplyThemeState(
    {
      athlete_main_id: '456',
      athlete_name: 'Avery Jones',
      event_title: 'Call Attempt 1',
    },
    snapshot,
  );

  assert.equal(state?.status, 'needs_reply');
  assert.equal(state?.row.theme, 'outreach_callback');
  assert.equal(state?.row.replyEvidence?.themeBucket, 'Call Attempt');
});

test('flags reschedule after loose confirmation-like outbound context', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat()],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Coach Ryan has Avery down for the meeting today at 5:00 PM.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Is there any way we can reschedule?',
          date: '2026-05-27T16:00:00.000Z',
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].theme, 'reschedule_request');
  assert.equal(snapshot.rows[0].templateContext, 'confirmation');
});

test('flags callback after loose outreach-like outbound context', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat()],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'attempt',
          body: 'I wanted to connect for a quick 10 minute call about Avery and Prospect ID.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Later today will work',
          date: '2026-05-27T16:00:00.000Z',
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].theme, 'outreach_callback');
  assert.equal(snapshot.rows[0].templateContext, 'outreach_attempt');
});

test('does not flag when operator already replied after the actionable client reply', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat()],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'attempt',
          body: 'Would later today or tomorrow work for a quick 10-minute call?',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Tomorrow would be better',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'handled',
          body: 'Tomorrow works. I will follow up then.',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 0);
  assert.equal(snapshot.ignoredHandled.length, 1);
  assert.equal(snapshot.ignoredHandled[0].theme, 'outreach_callback');
});

test('keeps outreach callback visible when later operator message is only a tapback', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-06-18T17:00:00.000Z',
    chats: [chat({ taskTitle: 'Call Attempt 2' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'attempt',
          body: 'Good evening Ms. Burton, this is Scouting Coordinator with Prospect ID. Elijah’s basketball profile came through and I had a few quick questions about college goals. Would tomorrow or later this week be better?',
          date: '2026-06-18T00:03:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Tomorrow works',
          date: '2026-06-18T00:08:00.000Z',
        }),
        message({
          guid: 'tapback',
          body: 'Loved "Tomorrow works"',
          date: '2026-06-18T00:09:00.000Z',
          isFromMe: true,
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.ignoredHandled.length, 0);
  assert.equal(snapshot.rows[0].theme, 'outreach_callback');
  assert.equal(snapshot.rows[0].replyEvidence?.themeBucket, 'Call Attempt');
  assert.equal(snapshot.rows[0].replyEvidence?.operatorRepliedAfterInbound, false);
});

test('keeps reschedule visible when task context is still pending reschedule despite later reply', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ taskTitle: 'Reschedule Pending' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Coach Ryan has Avery down for the meeting today at 5:00 PM.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Can we reschedule?',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'later-outbound',
          body: 'No problem, checking options.',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].theme, 'reschedule_request');
  assert.equal(snapshot.rows[0].operatorRepliedAfter, true);
  assert.equal(snapshot.ignoredHandled.length, 0);
});

test('pending reschedule remains urgent after operator reply', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ taskTitle: 'Meeting Result - Res. Pending' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Coach Ryan has Avery down for the meeting today at 5:00 PM.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Can we reschedule?',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'later-outbound',
          body: 'No problem, checking options.',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].operatorRepliedAfter, true);
  assert.equal(clientReplyThemeReviewBucketLabel('rows'), 'Urgent');
  assert.equal(clientReplyThemeReviewToneLabel('rows'), 'Urgent');
  assert.equal(snapshot.ignoredHandled.length, 0);
});

test('pending client reply theme state distinguishes needs reply from awaiting reschedule', () => {
  const needsReplySnapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ athleteMainId: '456', taskTitle: 'Reschedule Pending' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Coach Ryan has Avery down for the meeting today at 5:00 PM.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Can we reschedule?',
          date: '2026-05-27T15:00:00.000Z',
        }),
      ],
    },
  });
  assert.equal(
    findPendingClientReplyThemeState(
      { event_title: 'Follow Up - Avery Jones Football 2029' },
      needsReplySnapshot,
    )?.status,
    'needs_reply',
  );

  const awaitingSnapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ athleteMainId: '456', taskTitle: 'Meeting Result - Res. Pending' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Coach Ryan has Avery down for the meeting today at 5:00 PM.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Can we reschedule?',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'later-outbound',
          body: 'Coach Ryan has me checking what works best to reschedule Avery:\n1 - Thu 3PM ET\n2 - Fri 4PM ET',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
      ],
    },
  });
  assert.equal(
    findPendingClientReplyThemeState(
      { athlete_main_id: '456', athlete_name: 'Avery Jones' },
      awaitingSnapshot,
    )?.status,
    'awaiting_reschedule',
  );
});

test('pending client reply theme state requires true reschedule offer language', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ athleteMainId: '456', taskTitle: 'Meeting Result - Res. Pending' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Coach Ryan has Avery down for the meeting today at 5:00 PM.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Can we reschedule?',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'generic-outbound',
          body: 'No problem, I will check.',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
      ],
    },
  });

  assert.equal(snapshot.rows[0].operatorRepliedAfter, true);
  assert.equal(snapshot.rows[0].operatorRescheduleOfferAfter, false);
  assert.equal(
    findPendingClientReplyThemeState(
      { athlete_main_id: '456', athlete_name: 'Avery Jones' },
      snapshot,
    )?.status,
    'needs_reply',
  );
  assert.equal(isOperatorRescheduleOffer('No problem, I will check.'), false);
  assert.equal(
    isOperatorRescheduleOffer(
      'Here are two new times to reschedule: 1 - Thu 3PM ET, 2 - Fri 4PM ET',
    ),
    true,
  );
});

test('pending client reply theme state uses outbound-only reschedule offer as awaiting client', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-06-17T19:10:00.000Z',
    chats: [
      chat({
        displayName: 'Joe Henry',
        athleteName: 'Gage Henry',
        athleteMainId: '954321',
        taskTitle: 'Meeting Result - Res. Pending',
      }),
    ],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'gage-times',
          body: 'Coach Head Scout H has me checking what works best to reschedule Gage: 1 - Thursday, June 18 at 7PM ET 2 - Monday, June 22 at 7PM ET Which one works best?',
          date: '2026-06-17T19:05:00.000Z',
          isFromMe: true,
        }),
      ],
    },
  });
  const state = findPendingClientReplyThemeState(
    { athlete_main_id: '954321', athlete_name: 'Gage Henry' },
    snapshot,
  );

  assert.equal(snapshot.rows.length, 1);
  assert.equal(state?.status, 'awaiting_reschedule');
  assert.equal(state?.row.replyEvidence?.operatorReplyProposedTimes, true);
  assert.equal(state?.row.replyEvidence?.clientRepliedAfterOperatorTimes, false);
  assert.equal(state?.row.replyEvidence?.lastMeaningfulOutbound?.guid, 'gage-times');
});

test('pending client reply theme state detects client reply after proposed times', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ athleteMainId: '456', taskTitle: 'Meeting Result - Res. Pending' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Coach Ryan has Avery down for the meeting today at 5:00 PM.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Can we reschedule?',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'times',
          body: 'Here are two new times to reschedule: 1 - Thu 3PM ET, 2 - Fri 4PM ET',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'client-choice',
          body: 'Friday works',
          date: '2026-05-27T16:10:00.000Z',
        }),
      ],
    },
  });

  const state = findPendingClientReplyThemeState(
    { athlete_main_id: '456', athlete_name: 'Avery Jones' },
    snapshot,
  );

  assert.equal(state?.status, 'client_replied_after_times');
  assert.equal(state?.row.replyEvidence?.operatorReplyProposedTimes, true);
  assert.equal(state?.row.replyEvidence?.clientRepliedAfterOperatorTimes, true);
  assert.equal(state?.row.replyEvidence?.lastOperatorRescheduleOffer?.guid, 'times');
  assert.equal(
    buildClientReplyThemeRunReceipt(state!.row).operatorAction,
    'review_reschedule_reply',
  );
});

test('pending client outbound offer comparison handles mixed timezone offsets', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-06-17T19:10:00.000Z',
    chats: [
      chat({
        displayName: 'Joe Henry',
        athleteName: 'Gage Henry',
        athleteMainId: '954321',
        taskTitle: 'Meeting Result - Res. Pending',
      }),
    ],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'gage-times',
          body: 'Coach Head Scout H has me checking what works best to reschedule Gage: 1 - Thursday, June 18 at 7PM ET 2 - Monday, June 22 at 7PM ET Which one works best?',
          date: '2026-06-17T19:05:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'client-after-times',
          body: 'Thanks',
          date: '2026-06-17T15:06:00-04:00',
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 0);
});

test('does not flag actionable wording without the matching outbound template context', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat()],
    messagesByChatGuid: {
      'chat-1': [
        message({ guid: 'outbound', body: 'Checking in', isFromMe: true }),
        message({ guid: 'actionable', body: 'Can we reschedule for tomorrow?' }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 0);
  assert.equal(snapshot.nearMisses.length, 1);
  assert.equal(snapshot.nearMisses[0].theme, 'reschedule_request');
  assert.equal(snapshot.nearMisses[0].reason, 'no_template_context');
});

test('near misses render as misses', () => {
  assert.equal(clientReplyThemeReviewBucketLabel('nearMisses'), 'Misses');
  assert.equal(clientReplyThemeReviewToneLabel('nearMisses'), 'Miss');
  assert.equal(clientReplyThemeReviewReasonLabel('wrong_template_context'), 'Needs Action');
});

test('client review labels handled bucket as triple check', () => {
  assert.equal(clientReplyThemeReviewBucketLabel('ignoredHandled'), 'Triple-Check');
  assert.equal(clientReplyThemeReviewToneLabel('ignoredHandled'), 'Triple-Check');
  assert.equal(clientReplyThemeReviewReasonLabel('replied_after'), 'Triple-Check');
});

test('triple check rows preserve follow up evidence', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => values.get(key),
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat()],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'attempt',
          body: 'Would later today or tomorrow work for a quick 10-minute call?',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'actionable',
          body: 'Tomorrow would be better',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'handled',
          body: 'Tomorrow works. I will follow up then.',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
      ],
    },
  });

  snapshot.ignoredHandled[0].followUpEvidence = ['follow_up_task'];
  await writeCachedClientReplyThemeReviewSnapshot(storage, snapshot);
  const cached = await readCachedClientReplyThemeReviewSnapshot(storage);

  assert.deepEqual(cached?.ignoredHandled[0].followUpEvidence, ['follow_up_task']);
  assert.equal(clientReplyThemeReviewReasonLabel('follow_up_evidence'), 'Triple-Check');
});

test('client review hides diagnostic labels from main UI', () => {
  const visibleLabels = [
    clientReplyThemeReviewBucketLabel('rows'),
    clientReplyThemeReviewBucketLabel('nearMisses'),
    clientReplyThemeReviewBucketLabel('ignoredHandled'),
    clientReplyThemeReviewToneLabel('rows'),
    clientReplyThemeReviewToneLabel('nearMisses'),
    clientReplyThemeReviewToneLabel('ignoredHandled'),
    clientReplyThemeReviewReasonLabel('reschedule_pending'),
    clientReplyThemeReviewReasonLabel('no_operator_reply'),
    clientReplyThemeReviewReasonLabel('wrong_template_context'),
    clientReplyThemeReviewReasonLabel('replied_after'),
    clientReplyThemeReviewReasonLabel('follow_up_evidence'),
  ].join(' ');

  assert.doesNotMatch(visibleLabels, /\bIgnored\b/);
  assert.doesNotMatch(visibleLabels, /\bCovered\b/);
  assert.doesNotMatch(visibleLabels, /\bNo Context\b/);
  assert.doesNotMatch(visibleLabels, /\bReminder Found\b/);
  assert.doesNotMatch(visibleLabels, /\bCalendar Found\b/);
});

test('client review uses definitive tone tag colors', () => {
  assert.equal(clientReplyThemeReviewToneTagColor('rows'), 'red');
  assert.equal(clientReplyThemeReviewToneTagColor('nearMisses'), 'blue');
  assert.equal(clientReplyThemeReviewToneTagColor('ignoredHandled'), 'secondary');
});

test('client review suppresses redundant triple check reason tag', () => {
  assert.equal(clientReplyThemeReviewReasonTagLabel('ignoredHandled', 'replied_after'), null);
  assert.equal(clientReplyThemeReviewReasonTagLabel('rows', 'no_operator_reply'), 'Needs Action');
});

test('client review contact title falls back from phone to athlete name', () => {
  assert.equal(
    clientReplyThemeReviewDisplayName({
      displayName: '+17163277123',
      athleteName: 'Joseph Tombari',
    }),
    'Joseph Tombari',
  );
  assert.equal(
    clientReplyThemeReviewDisplayName({
      displayName: 'Morgan Armstrong',
      athleteName: 'Avery Armstrong',
    }),
    'Morgan Armstrong',
  );
});

test('client thread markdown renders all messages as dialogue', () => {
  const markdown = buildClientReplyThemeThreadMarkdown({
    clientName: 'Morgan Armstrong',
    timeZone: 'America/Chicago',
    timezoneLabel: 'CST',
    messages: [
      message({
        guid: 'client',
        body: 'Can we reschedule?',
        senderName: 'Morgan Armstrong',
        date: '2026-05-27T15:00:00.000Z',
      }),
      message({
        guid: 'operator',
        body: 'Coach Ryan has Avery down for the meeting today at 5:00 PM.',
        senderName: 'Me',
        date: '2026-05-27T14:00:00.000Z',
        isFromMe: true,
      }),
    ],
  });

  assert.match(markdown, /^# Morgan Armstrong/);
  assert.match(markdown, /### Me/);
  assert.match(markdown, /_Wednesday, May 27 at 9AM CT_/);
  assert.match(markdown, /Coach Ryan has Avery down/);
  assert.match(markdown, /### Morgan Armstrong/);
  assert.match(markdown, /_Wednesday, May 27 at 10AM CT_/);
  assert.match(markdown, /Can we reschedule\?/);
  assert.ok(markdown.indexOf('Coach Ryan has Avery down') < markdown.indexOf('Can we reschedule?'));
  assert.doesNotMatch(markdown, /2026-05-27T/);
});

test('client reply theme review snapshot round-trips through cache storage', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => values.get(key),
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat()],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Prospect ID Zoom Meeting tomorrow at 5:00 PM EST with Coach Ryan.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message(),
      ],
    },
  });

  await writeCachedClientReplyThemeReviewSnapshot(storage, snapshot);
  const cached = await readCachedClientReplyThemeReviewSnapshot(storage);

  assert.deepEqual(cached, snapshot);
});
