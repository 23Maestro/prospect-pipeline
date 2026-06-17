import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeClientMessageBody } from './client-message-body-decoder';

function attributedBodyHex(text: string): string {
  return Buffer.from([0x01, 0x2b, 0x00, ...Buffer.from(text, 'utf8'), 0x86, 0x84]).toString(
    'hex',
  );
}

test('client message body decoder reads attributedBody before message.text', () => {
  assert.deepEqual(
    decodeClientMessageBody({
      body: attributedBodyHex('Here are two times: 1 - Thu 7PM ET 2 - Mon 7PM ET'),
      text: 'stale fallback text',
    }),
    {
      body: 'Here are two times: 1 - Thu 7PM ET 2 - Mon 7PM ET',
      bodySource: 'attributedBody',
      emptyReason: 'none',
      decodedAttributedBody: true,
    },
  );
});

test('client message body decoder falls back to message.text when attributedBody is unavailable', () => {
  assert.deepEqual(
    decodeClientMessageBody({
      body: null,
      text: 'Coach has me checking what works best to reschedule Gage.',
    }),
    {
      body: 'Coach has me checking what works best to reschedule Gage.',
      bodySource: 'text',
      emptyReason: 'none',
      decodedAttributedBody: false,
    },
  );
});

test('client message body decoder preserves empty source when no body is available', () => {
  assert.deepEqual(decodeClientMessageBody({ body: null, text: '   ' }), {
    body: '',
    bodySource: 'empty',
    emptyReason: 'no_body_fields',
    decodedAttributedBody: false,
  });
});

test('client message body decoder marks attachment-only rows as diagnostic empties', () => {
  assert.deepEqual(
    decodeClientMessageBody({ body: null, text: '', cache_has_attachments: 1 }),
    {
      body: '',
      bodySource: 'empty',
      emptyReason: 'attachment',
      decodedAttributedBody: false,
    },
  );
});

test('client message body decoder marks summary and payload rows as diagnostic empties', () => {
  assert.deepEqual(
    decodeClientMessageBody({ body: null, text: '', has_message_summary: 1 }),
    {
      body: '',
      bodySource: 'empty',
      emptyReason: 'summary',
      decodedAttributedBody: false,
    },
  );
  assert.deepEqual(
    decodeClientMessageBody({ body: null, text: '', has_payload_data: 1 }),
    {
      body: '',
      bodySource: 'empty',
      emptyReason: 'payload',
      decodedAttributedBody: false,
    },
  );
  assert.deepEqual(
    decodeClientMessageBody({ body: null, text: '', associated_message_type: 2000 }),
    {
      body: '',
      bodySource: 'empty',
      emptyReason: 'payload',
      decodedAttributedBody: false,
    },
  );
});
