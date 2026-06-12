import assert from 'node:assert/strict';
import test from 'node:test';
import { runParentResponseLiveDryRun } from './verify-parent-response-live-dry-run.mjs';

test('runParentResponseLiveDryRun writes only parent_response_requests support state', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const urlText = String(url);
    if (urlText.includes('/rest/v1/parent_response_requests?select=id')) {
      return Response.json([{ id: 'dry-run-request-1' }]);
    }
    if (urlText.includes('/api/parent-response/dry-run-request-1/submit')) {
      return Response.json({ success: true, request_id: 'dry-run-request-1' });
    }
    if (urlText.includes('/rest/v1/parent_response_requests?') && !init?.method) {
      return Response.json([
        {
          id: 'dry-run-request-1',
          request_status: 'ready_later',
          response_kind: 'ready_later',
          selected_option_id: null,
          notification_status: 'pending',
          approval_status: 'pending',
          response_payload: { parent_note: 'Live dry run. No family action.' },
          source: 'parent_response_live_dry_run',
        },
      ]);
    }
    if (urlText.includes('/rest/v1/parent_response_requests?') && init?.method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    return new Response('unexpected', { status: 500 });
  };

  try {
    const result = await runParentResponseLiveDryRun({
      env: {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        SUPABASE_SCHEMA: 'public',
        PARENT_RESPONSE_TOKEN_SECRET: 'token-secret',
        PARENT_RESPONSE_PUBLIC_BASE_URL: 'https://prospect-web.vercel.app',
      },
      now: new Date('2026-06-12T12:00:00.000Z'),
    });

    assert.equal(result.requestId, 'dry-run-request-1');
    assert.equal(result.requestStatus, 'ready_later');
    assert.equal(result.responseKind, 'ready_later');
    assert.equal(result.cleanedUp, true);
    assert.equal(calls.some((call) => call.url.includes('/rest/v1/lifecycle_events')), false);
    assert.equal(calls.some((call) => call.url.includes('/rest/v1/appointments')), false);
    assert.equal(calls.some((call) => call.url.includes('/sales/stage')), false);

    const cleanupCall = calls.find(
      (call) => call.url.includes('/rest/v1/parent_response_requests?') && call.init?.method === 'PATCH',
    );
    const cleanupBody = JSON.parse(String(cleanupCall?.init?.body || '{}'));
    assert.equal(cleanupBody.request_status, 'canceled');
    assert.equal(cleanupBody.notification_status, 'failed');
    assert.equal(cleanupBody.notification_error, 'dry_run_verified_no_notification_sent');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
