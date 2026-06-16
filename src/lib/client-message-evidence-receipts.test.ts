import test from 'node:test';
import assert from 'node:assert/strict';

import { buildClientMessageThreadEvidenceReceipt } from './client-message-evidence-receipts.js';

test('builds pii-minimized thread evidence receipt from cache-admitted Messages rows', () => {
  const receipt = buildClientMessageThreadEvidenceReceipt({
    generatedAt: '2026-06-16T18:00:00.000Z',
    chat: {
      guid: 'chat-abc',
      serviceName: 'iMessage',
      isGroup: false,
      participantCount: 1,
      matchedPhones: ['6155551212'],
      clientMatch: {
        source: 'contact_cache',
        segment: 'client',
        contactId: 'contact-1',
        athleteMainId: 'athlete-main-1',
        currentTaskId: 'task-1',
        currentTaskTitle: 'Call Attempt 1',
        crmStage: 'Open',
        taskStatus: 'Call Attempt 1',
        ambiguity: 'none',
      },
    },
    messages: [
      {
        guid: 'out-1',
        date: '2026-06-16T17:00:00.000Z',
        isFromMe: true,
        body: 'Would later today or tomorrow work?',
        bodySource: 'attributedBody',
      },
      {
        guid: 'in-1',
        date: '2026-06-16T17:05:00.000Z',
        isFromMe: false,
        body: 'Tomorrow works',
        bodySource: 'attributedBody',
      },
    ],
  });

  assert.deepEqual(receipt, {
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
      associatedClientsCount: 0,
    },
    ids: {
      chatGuid: 'chat-abc',
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
  });
  assert.equal(JSON.stringify(receipt).includes('Tomorrow works'), false);
});

test('thread evidence receipt flags ambiguous cache admission and missing decoded bodies', () => {
  const receipt = buildClientMessageThreadEvidenceReceipt({
    generatedAt: '2026-06-16T18:00:00.000Z',
    chat: {
      guid: 'chat-group',
      serviceName: 'SMS',
      isGroup: true,
      participantCount: 3,
      matchedPhones: ['6155551212', '6155553434'],
      clientMatch: {
        source: 'merged',
        segment: 'pending',
        contactId: null,
        athleteMainId: null,
        currentTaskId: null,
        ambiguity: 'multiple_athletes',
        associatedClientsCount: 2,
      },
    },
    messages: [
      { guid: 'empty', date: null, isFromMe: false, body: '', bodySource: 'empty' },
      {
        guid: 'plain',
        date: '2026-06-16T17:05:00.000Z',
        isFromMe: true,
        body: 'ok',
        bodySource: 'text',
      },
    ],
  });

  assert.equal(receipt.admission.admittedBy, 'merged');
  assert.equal(receipt.admission.ambiguity, 'multiple_athletes');
  assert.equal(receipt.admission.associatedClientsCount, 2);
  assert.equal(receipt.thread.decodedAttributedBodyCount, 0);
  assert.equal(receipt.thread.plainTextBodyCount, 1);
  assert.equal(receipt.thread.emptyBodyCount, 1);
  assert.equal(receipt.direction.lastInboundGuid, 'empty');
  assert.equal(receipt.direction.lastOutboundGuid, 'plain');
});
