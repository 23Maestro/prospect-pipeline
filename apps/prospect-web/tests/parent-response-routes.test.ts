import assert from 'node:assert/strict';
import test from 'node:test';
import { hashParentResponseToken } from '../../../src/domain/parent-response-request';
import { POST as approveParentResponsePOST } from '../app/api/parent-response/[requestId]/approve/route';
import { POST as notifyParentResponsePOST } from '../app/api/parent-response/[requestId]/notify/route';
import { POST as submitParentResponsePOST } from '../app/api/parent-response/[requestId]/submit/route';

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

async function setupEnvAndHash() {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  process.env.PARENT_RESPONSE_TOKEN_SECRET = 'token-pepper';
  process.env.PARENT_RESPONSE_NOTIFY_SECRET = 'notify-secret';
  process.env.PARENT_RESPONSE_APPROVAL_SECRET = 'approval-secret';
  process.env.RESEND_API_KEY = 'resend-key';
  process.env.PARENT_RESPONSE_NOTIFY_FROM = 'Scout Prep <updates@example.com>';
  process.env.PARENT_RESPONSE_NOTIFY_TO = 'operator@example.com';
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'prospect-token';
  return hashParentResponseToken('parent-token', 'token-pepper');
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    appointment_id: 'appt_previous',
    athlete_id: '149',
    athlete_main_id: '953',
    athlete_name: 'Jamiya Turner',
    request_status: 'open',
    approval_status: 'pending',
    token_hash: overrides.token_hash || 'hash',
    expires_at: '2099-01-01T00:00:00Z',
    used_at: null,
    proposed_options: [
      {
        option_id: 'slot-1',
        display_label: 'Monday 6:00 PM ET',
        starts_at: '2026-06-15T18:00',
        ends_at: '2026-06-15T19:00',
        timezone: 'America/New_York',
        open_event_id: 'open_1',
        assigned_to: '1354049',
        head_scout_name: 'Coach Ryan',
      },
    ],
    approval_payload: {
      previous_appointment_id: 'appt_previous',
      previous_meeting_title: 'Coach Ryan - Jamiya Turner',
      previous_meeting_text: 'Previous saved meeting notes',
    },
    ...overrides,
  };
}

test('/api/parent-response submit rejects invalid token', async () => {
  const tokenHash = await setupEnvAndHash();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json([requestRow({ token_hash: tokenHash })]);
  };

  const response = await submitParentResponsePOST(
    new Request('https://example.test/api/parent-response/111/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-token', option_id: 'slot-1' }),
    }),
    { params: { requestId: '111' } },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Invalid response token',
  });
  assert.equal(calls.length, 1);
});

test('/api/parent-response submit rejects expired request', async () => {
  const tokenHash = await setupEnvAndHash();
  globalThis.fetch = async () =>
    Response.json([
      requestRow({
        token_hash: tokenHash,
        expires_at: '2020-01-01T00:00:00Z',
      }),
    ]);

  const response = await submitParentResponsePOST(
    new Request('https://example.test/api/parent-response/111/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'parent-token', option_id: 'slot-1' }),
    }),
    { params: { requestId: '111' } },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Response request is no longer open',
  });
});

test('/api/parent-response submit stores selected slot intent only', async () => {
  const tokenHash = await setupEnvAndHash();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'PATCH') {
      return Response.json([
        requestRow({
          token_hash: tokenHash,
          request_status: 'selected',
          response_kind: 'selected_slot',
          selected_option_id: 'slot-1',
        }),
      ]);
    }
    return Response.json([requestRow({ token_hash: tokenHash })]);
  };

  const response = await submitParentResponsePOST(
    new Request('https://example.test/api/parent-response/111/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'node-test' },
      body: JSON.stringify({
        token: 'parent-token',
        option_id: 'slot-1',
        parent_note: 'That works',
      }),
    }),
    { params: { requestId: '111' } },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    request_id: '111',
    request_status: 'selected',
    response_kind: 'selected_slot',
    selected_option_id: 'slot-1',
    notification: { status: 'sent', error: '' },
  });
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/rest\/v1\/parent_response_requests\?/);
  assert.match(calls[1].url, /\/rest\/v1\/parent_response_requests\?/);
  assert.match(calls[2].url, /\/api\/parent-response\/111\/notify$/);
  assert.equal((calls[2].init?.headers as Record<string, string>)['x-parent-response-secret'], 'notify-secret');
  assert.equal(calls[1].init?.method, 'PATCH');
  const update = JSON.parse(String(calls[1].init?.body));
  assert.equal(update.request_status, 'selected');
  assert.equal(update.response_kind, 'selected_slot');
  assert.equal(update.selected_option_id, 'slot-1');
  assert.equal('crm_stage' in update, false);
  assert.equal('appointment_status' in update, false);
});

test('/api/parent-response submit stores none-work intent only', async () => {
  const tokenHash = await setupEnvAndHash();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'PATCH') {
      return Response.json([
        requestRow({
          token_hash: tokenHash,
          request_status: 'none_work',
          response_kind: 'none_work',
          selected_option_id: null,
        }),
      ]);
    }
    return Response.json([requestRow({ token_hash: tokenHash })]);
  };

  const response = await submitParentResponsePOST(
    new Request('https://example.test/api/parent-response/111/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'parent-token',
        response_kind: 'none_work',
        parent_note: 'Need later this week',
      }),
    }),
    { params: { requestId: '111' } },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    request_id: '111',
    request_status: 'none_work',
    response_kind: 'none_work',
    selected_option_id: null,
    notification: { status: 'sent', error: '' },
  });
  const update = JSON.parse(String(calls[1].init?.body));
  assert.equal(update.request_status, 'none_work');
  assert.equal(update.response_kind, 'none_work');
  assert.equal(update.selected_option_id, null);
  assert.equal('crm_stage' in update, false);
  assert.equal('appointment_status' in update, false);
});

test('/api/parent-response submit stores ready-later human follow-up intent only', async () => {
  const tokenHash = await setupEnvAndHash();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'PATCH') {
      return Response.json([
        requestRow({
          token_hash: tokenHash,
          request_status: 'ready_later',
          response_kind: 'ready_later',
          selected_option_id: null,
        }),
      ]);
    }
    return Response.json([requestRow({ token_hash: tokenHash })]);
  };

  const response = await submitParentResponsePOST(
    new Request('https://example.test/api/parent-response/111/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'parent-token',
        response_kind: 'ready_later',
        parent_note: 'We will follow up when ready',
      }),
    }),
    { params: { requestId: '111' } },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    request_id: '111',
    request_status: 'ready_later',
    response_kind: 'ready_later',
    selected_option_id: null,
    notification: { status: 'sent', error: '' },
  });
  const update = JSON.parse(String(calls[1].init?.body));
  assert.equal(update.request_status, 'ready_later');
  assert.equal(update.response_kind, 'ready_later');
  assert.equal(update.selected_option_id, null);
  assert.equal('crm_stage' in update, false);
  assert.equal('appointment_status' in update, false);
});

test('/api/parent-response notify rejects invalid secret', async () => {
  await setupEnvAndHash();
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json([]);
  };

  const response = await notifyParentResponsePOST(
    new Request('https://example.test/api/parent-response/111/notify', {
      method: 'POST',
      headers: { 'x-parent-response-secret': 'wrong' },
    }),
    { params: { requestId: '111' } },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Invalid parent response notify secret',
  });
  assert.equal(called, false);
});

test('/api/parent-response notify sends selected slot email through Resend', async () => {
  const tokenHash = await setupEnvAndHash();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/rest/v1/parent_response_requests?')) {
      return Response.json([
        requestRow({
          token_hash: tokenHash,
          recipient_name: 'Parent One',
          recipient_phone: '5551112222',
          original_head_scout_name: 'Coach Ryan',
          response_kind: 'selected_slot',
          selected_option_id: 'slot-1',
          response_payload: { parent_note: 'That one works' },
        }),
      ]);
    }
    return Response.json({ id: 'email_123' });
  };

  const response = await notifyParentResponsePOST(
    new Request('https://example.test/api/parent-response/111/notify', {
      method: 'POST',
      headers: { 'x-parent-response-secret': 'notify-secret' },
    }),
    { params: { requestId: '111' } },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.response_kind, 'selected_slot');
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/rest\/v1\/parent_response_requests\?/);
  assert.equal(calls[1].url, 'https://api.resend.com/emails');
  assert.equal(calls[1].init?.method, 'POST');
  assert.equal(calls[2].init?.method, 'PATCH');
  const statusUpdate = JSON.parse(String(calls[2].init?.body));
  assert.equal(statusUpdate.notification_status, 'sent');
  assert.ok(statusUpdate.notification_sent_at);
  assert.equal(statusUpdate.notification_error, null);
  const resendBody = JSON.parse(String(calls[1].init?.body));
  assert.equal(resendBody.from, 'Scout Prep <updates@example.com>');
  assert.equal(resendBody.to, 'operator@example.com');
  assert.match(resendBody.subject, /Jamiya Turner/);
  assert.match(resendBody.text, /Selected slot: Monday 6:00 PM ET/);
  assert.match(resendBody.text, /Parent note: That one works/);
  assert.equal('crm_stage' in resendBody, false);
  assert.equal('appointment_status' in resendBody, false);
});

test('/api/parent-response notify sends ready-later review email without approval payload', async () => {
  const tokenHash = await setupEnvAndHash();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/rest/v1/parent_response_requests?')) {
      return Response.json([
        requestRow({
          token_hash: tokenHash,
          response_kind: 'ready_later',
          selected_option_id: null,
          response_payload: { parent_note: 'We will follow up next week' },
        }),
      ]);
    }
    return Response.json({ id: 'email_456' });
  };

  const response = await notifyParentResponsePOST(
    new Request('https://example.test/api/parent-response/111/notify', {
      method: 'POST',
      headers: { 'x-parent-response-secret': 'notify-secret' },
    }),
    { params: { requestId: '111' } },
  );

  assert.equal(response.status, 200);
  const resendBody = JSON.parse(String(calls[1].init?.body));
  assert.equal(calls[2].init?.method, 'PATCH');
  const statusUpdate = JSON.parse(String(calls[2].init?.body));
  assert.equal(statusUpdate.notification_status, 'sent');
  assert.match(resendBody.subject, /will follow up when ready/);
  assert.match(resendBody.text, /Response: said they will follow up when ready/);
  assert.match(resendBody.text, /Parent note: We will follow up next week/);
  assert.doesNotMatch(resendBody.text, /Selected slot:/);
});

test('/api/parent-response approve rejects invalid secret', async () => {
  await setupEnvAndHash();
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json([]);
  };

  const response = await approveParentResponsePOST(
    new Request('https://example.test/api/parent-response/111/approve', {
      method: 'POST',
      headers: { 'x-parent-response-approval-secret': 'wrong' },
      body: JSON.stringify({ confirm: true }),
    }),
    { params: { requestId: '111' } },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Invalid parent response approval secret',
  });
  assert.equal(called, false);
});

test('/api/parent-response approve requires explicit operator confirmation', async () => {
  await setupEnvAndHash();
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json([]);
  };

  const response = await approveParentResponsePOST(
    new Request('https://example.test/api/parent-response/111/approve', {
      method: 'POST',
      headers: { 'x-parent-response-approval-secret': 'approval-secret' },
      body: JSON.stringify({}),
    }),
    { params: { requestId: '111' } },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Approval requires confirm: true',
  });
  assert.equal(called, false);
});

test('/api/parent-response approve applies selected slot through reschedule path and marks row applied', async () => {
  const tokenHash = await setupEnvAndHash();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    const urlText = String(url);
    calls.push({ url: urlText, init });
    if (urlText.includes('/rest/v1/parent_response_requests?') && init?.method !== 'PATCH') {
      return Response.json([
        requestRow({
          token_hash: tokenHash,
          request_status: 'selected',
          approval_status: 'pending',
          response_kind: 'selected_slot',
          selected_option_id: 'slot-1',
        }),
      ]);
    }
    if (urlText.endsWith('/api/v1/sales/reschedule-meeting')) {
      return Response.json({
        success: true,
        athlete_id: '149',
        athlete_main_id: '953',
        assigned_to: '1354049',
        open_event_id: 'open_1',
        meeting_name: 'Coach Ryan - Jamiya Turner',
        template_id: '210',
        status_code: 200,
        email_sent: true,
        created_task: { task_id: 'task-1', title: 'Confirmation Call' },
      });
    }
    if (urlText.endsWith('/api/v1/sales/stage')) {
      return Response.json({
        success: true,
        stage: 'Meeting Result - Rescheduled',
        athlete_id: '149',
        athlete_main_id: '953',
        status_code: 200,
        tasks_count: 1,
      });
    }
    if (urlText.includes('/rest/v1/parent_response_requests?') && init?.method === 'PATCH') {
      return Response.json([
        requestRow({
          token_hash: tokenHash,
          request_status: 'applied',
          approval_status: 'applied',
        }),
      ]);
    }
    if (
      urlText.includes('/rest/v1/appointments?') &&
      (!init?.method || init.method === 'GET')
    ) {
      return Response.json([]);
    }
    return new Response('', { status: 200 });
  };

  const response = await approveParentResponsePOST(
    new Request('https://example.test/api/parent-response/111/approve', {
      method: 'POST',
      headers: {
        'x-parent-response-approval-secret': 'approval-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirm: true }),
    }),
    { params: { requestId: '111' } },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.approval_status, 'applied');
  assert.equal(payload.stage, 'Meeting Result - Rescheduled');
  assert.equal(payload.open_event_id, 'open_1');

  const rescheduleIndex = calls.findIndex((call) => call.url.endsWith('/api/v1/sales/reschedule-meeting'));
  const stageIndex = calls.findIndex((call) => call.url.endsWith('/api/v1/sales/stage'));
  const appliedIndex = calls.findIndex(
    (call) => call.url.includes('/rest/v1/parent_response_requests?') && call.init?.method === 'PATCH',
  );
  const appointmentWriteIndex = calls.findIndex(
    (call) => call.url.includes('/rest/v1/appointments?') && call.init?.method === 'POST',
  );
  assert.ok(rescheduleIndex > 0);
  assert.ok(stageIndex > rescheduleIndex);
  assert.ok(appliedIndex > stageIndex);
  assert.ok(appointmentWriteIndex > stageIndex);

  const rescheduleBody = JSON.parse(String(calls[rescheduleIndex].init?.body));
  assert.equal(rescheduleBody.previous_event_id, 'appt_previous');
  assert.equal(rescheduleBody.open_event_id, 'open_1');
  assert.equal(rescheduleBody.assigned_to, '1354049');
  const stageBody = JSON.parse(String(calls[stageIndex].init?.body));
  assert.equal(stageBody.stage, 'Meeting Result - Rescheduled');
  const appliedBody = JSON.parse(String(calls[appliedIndex].init?.body));
  assert.equal(appliedBody.request_status, 'applied');
  assert.equal(appliedBody.approval_status, 'applied');
  assert.equal('crm_stage' in appliedBody, false);
  assert.equal('appointment_status' in appliedBody, false);
  const appointmentRows = JSON.parse(String(calls[appointmentWriteIndex].init?.body));
  assert.equal(appointmentRows[0].starts_at, '2026-06-15T22:00:00.000Z');
});
