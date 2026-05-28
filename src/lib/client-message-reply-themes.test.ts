import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClientReplyThemeReviewSnapshot,
  type ClientReplyThemeReviewChatInput,
  type ClientReplyThemeReviewMessageInput,
} from './client-message-reply-themes';

function chat(overrides: Partial<ClientReplyThemeReviewChatInput> = {}): ClientReplyThemeReviewChatInput {
  return {
    guid: 'chat-1',
    displayName: 'Tiffany Pritchett',
    athleteName: 'Caden Pritchett',
    contactId: 'contact-1',
    athleteMainId: 'athlete-main-1',
    taskTitle: 'Confirmation Call',
    matchedPhones: ['5555555555'],
    ...overrides,
  };
}

function message(
  overrides: Partial<ClientReplyThemeReviewMessageInput> = {},
): ClientReplyThemeReviewMessageInput {
  return {
    guid: overrides.isFromMe ? 'operator' : 'client',
    body: 'Is there any way to reschedule this?',
    date: '2026-05-27T15:00:00.000Z',
    senderName: overrides.isFromMe ? 'Me' : 'Tiffany Pritchett',
    sender: '+15555555555',
    isFromMe: false,
    ...overrides,
  };
}

test('flags reschedule replies with confirmation context', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat()],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Coach Ryan has Caden down for the meeting today at 5:00 PM.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'client',
          body: 'Is there any way to reschedule this?',
          date: '2026-05-27T15:00:00.000Z',
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].theme, 'reschedule_request');
  assert.equal(snapshot.rows[0].templateContext, 'confirmation');
  assert.equal(snapshot.nearMisses.length, 0);
  assert.equal(snapshot.ignoredHandled.length, 0);
});

test('near misses keep actionable replies without enough outbound context', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ taskTitle: null })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'reply',
          body: 'I want to reschedule again like evening',
          date: '2026-05-27T16:00:00.000Z',
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 0);
  assert.equal(snapshot.nearMisses.length, 1);
  assert.equal(snapshot.nearMisses[0].reason, 'no_template_context');
});

test('ignored handled keeps evidence when operator replied after callback', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ taskTitle: 'Call Attempt 1' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'attempt',
          body: 'Avery’s profile came through and I wanted to ask a few quick questions about his college football goals.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'reply',
          body: 'Tomorrow would work',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'handled',
          body: 'Okay, I can follow up then',
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

test('pending reschedule remains visible even when operator replied after client reschedule request', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ taskTitle: 'Reschedule Pending' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Coach Ryan has Caden down for the meeting today at 5:00 PM.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'client',
          body: 'Is there any way to reschedule this?',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'operator',
          body: 'No problem! Would an evening time work this week?',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'client-thanks',
          body: 'Thank you!',
          date: '2026-05-27T16:30:00.000Z',
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].theme, 'reschedule_request');
  assert.equal(snapshot.rows[0].taskTitle, 'Reschedule Pending');
  assert.equal(snapshot.ignoredHandled.length, 0);
});

test('handled rows can carry reminder evidence for later filtering', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ taskTitle: 'Call Attempt 1' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'attempt',
          body: 'Avery’s profile came through and I wanted to ask a few quick questions about his college football goals.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'reply',
          body: 'Tomorrow would work',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'handled',
          body: 'Okay, I can follow up then',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
      ],
    },
    reminderEvidenceByChatGuid: {
      'chat-1': {
        hasReminder: true,
        source: 'apple_calendar',
        label: 'Call Tiffany Rawls',
      },
    },
  });

  assert.equal(snapshot.ignoredHandled.length, 1);
  assert.equal(snapshot.ignoredHandled[0].reminderEvidence?.hasReminder, true);
});
