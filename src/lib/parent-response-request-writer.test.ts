import assert from 'node:assert/strict';
import test from 'node:test';
import { createSignedParentResponseRequest, getParentResponseRuntimeConfig } from './parent-response-request-writer';

test('getParentResponseRuntimeConfig reads required parent response env without defaults', () => {
  const originalSecret = process.env.PARENT_RESPONSE_TOKEN_SECRET;
  const originalBaseUrl = process.env.PARENT_RESPONSE_PUBLIC_BASE_URL;
  process.env.PARENT_RESPONSE_TOKEN_SECRET = 'token-secret';
  process.env.PARENT_RESPONSE_PUBLIC_BASE_URL = 'https://prospect-web.vercel.app/';
  try {
    assert.deepEqual(getParentResponseRuntimeConfig(), {
      tokenSecret: 'token-secret',
      publicBaseUrl: 'https://prospect-web.vercel.app',
    });
  } finally {
    if (originalSecret === undefined) {
      delete process.env.PARENT_RESPONSE_TOKEN_SECRET;
    } else {
      process.env.PARENT_RESPONSE_TOKEN_SECRET = originalSecret;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.PARENT_RESPONSE_PUBLIC_BASE_URL;
    } else {
      process.env.PARENT_RESPONSE_PUBLIC_BASE_URL = originalBaseUrl;
    }
  }
});

test('createSignedParentResponseRequest inserts intent row and returns signed parent URL', async () => {
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || '{}')),
      headers: init?.headers as Record<string, string>,
    });
    return new Response(JSON.stringify([{ id: 'request-123' }]), { status: 201 });
  };

  const result = await createSignedParentResponseRequest(
    { url: 'https://example.supabase.co', key: 'service-key', schema: 'public' },
    { tokenSecret: 'token-secret', publicBaseUrl: 'https://prospect-web.vercel.app' },
    {
      appointmentId: 'appointment-1',
      athleteId: '123',
      athleteMainId: '456',
      athleteName: 'Jordan Athlete',
      recipientName: 'Taylor Parent',
      recipientPhone: '555-111-2222',
      originalHeadScoutName: 'Ryan Lietz',
      originalMeetingStartsAt: '2026-06-12T15:00:00Z',
      originalMeetingTimezone: 'America/New_York',
      proposedOptions: [
        {
          option_id: 'slot-1',
          display_label: 'Monday at 5PM ET',
          starts_at: '2026-06-15T17:00',
          ends_at: '2026-06-15T18:00',
          open_event_id: 'open-1',
        },
      ],
      approvalPayload: { source: 'test' },
    },
    {
      now: new Date('2026-06-12T12:00:00Z'),
      randomToken: () => 'parent-token',
      fetchImpl: fetchImpl as typeof fetch,
    },
  );

  assert.equal(result.requestId, 'request-123');
  assert.equal(result.token, 'parent-token');
  assert.equal(
    result.url,
    'https://prospect-web.vercel.app/r/request-123?token=parent-token',
  );
  assert.equal(result.expiresAt, '2026-06-14T12:00:00.000Z');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/parent_response_requests\?select=id$/);
  assert.equal(calls[0].headers.Prefer, 'return=representation');
  assert.equal(calls[0].body.request_status, 'open');
  assert.equal(calls[0].body.approval_status, 'pending');
  assert.equal(calls[0].body.notification_status, 'pending');
  assert.equal(calls[0].body.token_hash.includes('parent-token'), false);
  assert.equal(calls[0].body.athlete_id, '123');
  assert.equal(calls[0].body.proposed_options[0].option_id, 'slot-1');
  assert.equal('crm_stage' in calls[0].body, false);
  assert.equal('appointment_status' in calls[0].body, false);
});
