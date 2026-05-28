import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSED_CLIENT_REPLY_FLAGS,
  buildClientReplyThemeReviewSnapshot,
  buildClientReplyThemeThreadMarkdown,
  classifyClientMessageTheme,
  clientReplyThemeReviewBucketLabel,
  clientReplyThemeReviewDisplayName,
  clientReplyThemeReviewReasonLabel,
  clientReplyThemeReviewReasonTagLabel,
  clientReplyThemeReviewToneLabel,
  clientReplyThemeReviewToneTagColor,
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
  assert.equal(classifyClientMessageTheme('Tomorrow works better'), 'outreach_callback');
  assert.equal(classifyClientMessageTheme('I am working right now'), 'outreach_callback');
  assert.equal(classifyClientMessageTheme('Can you call me after work?'), 'outreach_callback');
  assert.equal(classifyClientMessageTheme('Thanks'), null);
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
  assert.equal(clientReplyThemeReviewBucketLabel('rows'), 'Urgent');
  assert.equal(clientReplyThemeReviewToneLabel('rows'), 'Urgent');
  assert.equal(snapshot.ignoredHandled.length, 0);
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
    messages: [
      message({
        guid: 'operator',
        body: 'Coach Ryan has Avery down for the meeting today at 5:00 PM.',
        senderName: 'Me',
        date: '2026-05-27T14:00:00.000Z',
        isFromMe: true,
      }),
      message({
        guid: 'client',
        body: 'Can we reschedule?',
        senderName: 'Morgan Armstrong',
        date: '2026-05-27T15:00:00.000Z',
      }),
    ],
  });

  assert.match(markdown, /^# Morgan Armstrong/);
  assert.match(markdown, /> \*\*Me\*\*/);
  assert.match(markdown, /> Coach Ryan has Avery down/);
  assert.match(markdown, /> \*\*Morgan Armstrong\*\*/);
  assert.match(markdown, /> Can we reschedule\?/);
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
