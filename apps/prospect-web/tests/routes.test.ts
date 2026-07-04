import assert from 'node:assert/strict';
import test from 'node:test';
import { GET as callTrackerDataGET } from '../app/api/call-tracker-data/route';
import { GET as meetingReadbackDataGET } from '../app/api/meeting-readback-data/route';
import { DELETE, GET, POST } from '../app/api/call-tracker-sync/route';
import { GET as healthGET } from '../app/api/health/route';
import { POST as postMeetingOutcomePOST } from '../app/api/post-meeting-outcome/route';
import { POST as prospectMobileSearchPOST } from '../app/api/prospect-mobile/search/route';
import { GET as prospectMobileRescheduleQueueGET } from '../app/api/prospect-mobile/reschedule-queue/route';
import { POST as prospectMobileReschedulePOST } from '../app/api/prospect-mobile/reschedule/route';
import { GET as prospectMobileSetMeetingsGET } from '../app/api/prospect-mobile/set-meetings/route';
import { POST as setMeetingConfirmationPrefixPOST } from '../app/api/set-meeting-confirmation-prefix/route';
import { createCoachRisnerSessionSetCookie } from '../app/api/tim-lite/access';
import { POST as coachRisnerLoginPOST } from '../app/api/tim-lite/auth/login/route';
import { GET as timLiteMeetingsGET } from '../app/api/tim-lite/meetings/route';
import { POST as timLiteSearchPOST } from '../app/api/tim-lite/search/route';

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

test('/api/health returns expected adapter status', async () => {
  const response = healthGET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    status: 'ok',
    adapter: 'vercel-nextjs',
    surfaces: ['prospect-mobile', 'prospect-call-tracker'],
  });
});

test('/api/tim-lite/meetings rejects missing Coach Risner login', async () => {
  process.env.TIM_LITE_ACCESS_TOKEN = 'private-link-token';

  const response = await timLiteMeetingsGET(new Request('https://example.test/api/tim-lite/meetings'));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Coach Risner login is required',
    code: 'coach_risner_login_required',
  });
});

test('/api/tim-lite/auth/login requires Prospect credentials', async () => {
  const response = await coachRisnerLoginPOST(
    new Request('https://example.test/api/tim-lite/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: '', password: '' }),
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Prospect email and password are required',
    code: 'coach_risner_credentials_required',
  });
});

test('/api/prospect-mobile/search uses contact cache first for phone searches', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json([
      {
        athlete_key: '149:953',
        athlete_id: '149',
        athlete_main_id: '953',
        athlete_name: 'Jamiya Turner',
        contact_name: 'Parent One',
        relationship_label: 'Parent 1',
        phone: '(555) 111-2222',
        normalized_phone: '5551112222',
      },
    ]);
  };

  const response = await prospectMobileSearchPOST(
    new Request('https://example.test/api/prospect-mobile/search', {
      method: 'POST',
      body: JSON.stringify({ query: '(555) 111-2222' }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.mode, 'contact_cache');
  assert.equal(payload.count, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://supabase.example/rest/v1/rpc/search_athlete_contact_cache');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { input_query: '(555) 111-2222' });
});

test('/api/prospect-mobile/search sends email searches to athlete and parent raw search', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      success: true,
      count: 1,
      results: [
        {
          athlete_id: '149',
          athlete_main_id: '953',
          name: 'Jamiya Turner',
          parent_name: 'Parent One',
          parent_email: 'parent@example.com',
        },
      ],
    });
  };

  const response = await prospectMobileSearchPOST(
    new Request('https://example.test/api/prospect-mobile/search', {
      method: 'POST',
      body: JSON.stringify({ query: 'parent@example.com' }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.mode, 'raw_email');
  assert.equal(payload.count, 1);
  assert.equal(payload.results[0].name, 'Jamiya Turner');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://tailnet.example/api/v1/athlete/raw-search');
  assert.equal(calls[1].url, 'https://tailnet.example/api/v1/athlete/raw-search');
  assert.equal(JSON.parse(String(calls[0].init?.body)).email, 'parent@example.com');
  assert.equal(JSON.parse(String(calls[1].init?.body)).searching_for, 'Parent');
  assert.equal(calls[0].init?.headers?.['x-mobile-proxy' as keyof HeadersInit], 'vercel');
});

test('/api/tim-lite/meetings reads Tim cache through Tim support appointment status', async () => {
  process.env.TIM_LITE_ACCESS_TOKEN = 'private-link-token';
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/tim_lite_appointments?')) {
      return Response.json([
        { id: 'appt_1', status: 'scheduled' },
        { id: 'appt_rsp', status: 'reschedule_pending' },
        { id: 'appt_no_show', status: 'scheduled', post_meeting_result: 'no_show' },
        { id: 'appt_expired', status: 'scheduled' },
      ]);
    }
    return Response.json([
      {
        appointment_id: 'appt_1',
        athlete_id: '149',
        athlete_main_id: '953',
        athlete_name: 'Jamiya Turner',
        recipient_name: 'Parent One',
        recipient_phone: '5551112222',
        relationship_label: 'Parent 1',
        head_scout_name: 'Scout Name',
        meeting_starts_at: '2099-06-03T18:00:00Z',
        meeting_ends_at: '2099-06-03T19:00:00Z',
        meeting_timezone: 'America/New_York',
        meeting_timezone_label: 'ET',
        message_body: 'Confirmation one',
        admin_url: 'https://admin.example/athletes/953',
        task_url: 'https://admin.example/tasks/1',
        kind: 'confirmation_1',
        generated_at: '2026-06-03T12:00:00Z',
      },
      {
        appointment_id: 'appt_1',
        athlete_name: 'Jamiya Turner',
        message_body: 'Confirmation two',
        kind: 'confirmation_2',
      },
      {
        appointment_id: 'appt_rsp',
        athlete_name: 'Kale Pending',
        message_body: 'Pending one',
        kind: 'confirmation_1',
      },
      {
        appointment_id: 'appt_no_show',
        athlete_name: 'No Show Active Status',
        meeting_starts_at: '2099-06-03T20:00:00Z',
        meeting_ends_at: '2099-06-03T21:00:00Z',
        message_body: 'No show one',
        kind: 'confirmation_1',
      },
      {
        appointment_id: 'appt_expired',
        athlete_name: 'Expired Active',
        meeting_starts_at: '2026-06-03T18:00:00Z',
        meeting_ends_at: '2026-06-03T19:00:00Z',
        message_body: 'Expired one',
        kind: 'confirmation_1',
      },
    ]);
  };

  const response = await timLiteMeetingsGET(
    new Request('https://example.test/api/tim-lite/meetings?week=this', {
      headers: { cookie: createCoachRisnerSessionSetCookie() },
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.count, 1);
  assert.equal(payload.events[0].appointment_id, 'appt_1');
  assert.equal(payload.events.some((event: { athlete_name?: string }) => event.athlete_name === 'No Show Active Status'), false);
  assert.equal(payload.events.some((event: { athlete_name?: string }) => event.athlete_name === 'Expired Active'), false);
  assert.equal(payload.events[0].confirmation_1_message, 'Confirmation one');
  assert.equal(payload.events[0].confirmation_2_message, 'Confirmation two');
  assert.match(calls[0].url, /\/rest\/v1\/tim_lite_confirmation_cache\?/);
  assert.match(calls[0].url, /operator_key=eq\.operator_secondary/);
  assert.match(calls[0].url, /kind=in\.\(confirmation_1,confirmation_2\)/);
  assert.match(calls[1].url, /\/rest\/v1\/tim_lite_appointments\?/);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer service-role');
});

test('/api/prospect-mobile/set-meetings filters confirmation cache through appointment truth', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/appointments?')) {
      return Response.json([
        { id: 'appt_active', status: 'scheduled' },
        { id: 'appt_baker', status: 'reschedule_pending' },
        { id: 'appt_no_show', status: 'scheduled', post_meeting_result: 'no_show' },
        { id: 'appt_expired', status: 'scheduled' },
      ]);
    }
    return Response.json([
      {
        appointment_id: 'appt_active',
        athlete_id: '149',
        athlete_main_id: '953',
        athlete_name: 'Active Meeting',
        recipient_name: 'Parent One',
        recipient_phone: '5551112222',
        head_scout_name: 'Scout Name',
        meeting_starts_at: '2099-06-03T18:00:00Z',
        meeting_ends_at: '2099-06-03T19:00:00Z',
        meeting_timezone: 'America/New_York',
        message_body: 'Confirmation one',
        kind: 'confirmation_1',
      },
      {
        appointment_id: 'appt_baker',
        athlete_id: '150',
        athlete_main_id: '954',
        athlete_name: 'Baker',
        recipient_name: 'Parent Two',
        recipient_phone: '5553334444',
        head_scout_name: 'Scout Name',
        meeting_starts_at: '2026-06-03T19:00:00Z',
        meeting_timezone: 'America/New_York',
        message_body: 'Pending one',
        kind: 'confirmation_1',
      },
      {
        appointment_id: 'appt_no_show',
        athlete_id: '152',
        athlete_main_id: '956',
        athlete_name: 'No Show Active Status',
        recipient_name: 'Parent Four',
        recipient_phone: '5557778888',
        head_scout_name: 'Scout Name',
        meeting_starts_at: '2099-06-03T20:00:00Z',
        meeting_ends_at: '2099-06-03T21:00:00Z',
        meeting_timezone: 'America/New_York',
        message_body: 'No show one',
        kind: 'confirmation_1',
      },
      {
        appointment_id: 'appt_expired',
        athlete_id: '151',
        athlete_main_id: '955',
        athlete_name: 'Expired Active',
        recipient_name: 'Parent Three',
        recipient_phone: '5555556666',
        head_scout_name: 'Scout Name',
        meeting_starts_at: '2026-06-03T18:00:00Z',
        meeting_ends_at: '2026-06-03T19:00:00Z',
        meeting_timezone: 'America/New_York',
        message_body: 'Expired one',
        kind: 'confirmation_1',
      },
    ]);
  };

  const response = await prospectMobileSetMeetingsGET(
    new Request('https://example.test/api/prospect-mobile/set-meetings?week=this'),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.count, 1);
  assert.equal(payload.events[0].appointment_id, 'appt_active');
  assert.equal(payload.events.some((event: { athlete_name?: string }) => event.athlete_name === 'Baker'), false);
  assert.equal(payload.events.some((event: { athlete_name?: string }) => event.athlete_name === 'No Show Active Status'), false);
  assert.equal(payload.events.some((event: { athlete_name?: string }) => event.athlete_name === 'Expired Active'), false);
  assert.match(calls[0].url, /\/rest\/v1\/set_meeting_confirmation_cache\?/);
  assert.match(calls[1].url, /\/rest\/v1\/appointments\?/);
});

test('/api/prospect-mobile/reschedule-queue reads recent RSP appointment outcomes', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/athletes?')) {
      return Response.json([{ athlete_key: '149:953', athlete_name: 'Jamiya Turner' }]);
    }
    return Response.json([
      {
        id: '628106',
        athlete_key: '149:953',
        athlete_id: '149',
        athlete_main_id: '953',
        head_scout: 'Head Scout D',
        starts_at: '2026-06-12T00:00:00Z',
        status: 'scheduled',
        meeting_timezone: 'America/Chicago',
        meeting_timezone_label: 'Central',
        post_meeting_result: 'reschedule_pending',
        source_payload: { meeting_title_base: 'Jamiya Turner Football' },
        updated_at: '2026-06-14T12:00:00Z',
      },
    ]);
  };

  const response = await prospectMobileRescheduleQueueGET(
    new Request('https://example.test/api/prospect-mobile/reschedule-queue?athlete_id=149'),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.count, 1);
  assert.equal(payload.events[0].appointment_id, '628106');
  assert.equal(payload.events[0].head_scout_name, 'Head Scout D');
  assert.equal(payload.events[0].athlete_name, 'Jamiya Turner');
  assert.match(calls[0].url, /post_meeting_result=eq\.reschedule_pending/);
  assert.match(calls[0].url, /updated_at=gte\./);
  assert.match(calls[0].url, /athlete_id=eq\.149/);
  assert.doesNotMatch(calls[1].url, /post_meeting_result=is\.null/);
  assert.match(calls[1].url, /status=in\.\(scheduled,confirmation_queued,confirmation_sent,rescheduled\)/);
});

test('/api/prospect-mobile/reschedule-queue resolves key-shaped names from same-key Supabase context', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const requestUrl = String(url);
    if (requestUrl.includes('/athlete_contact_cache?')) {
      return Response.json([{ athlete_key: '1499520:954251', athlete_name: 'Real Prospect' }]);
    }
    if (requestUrl.includes('/athletes?')) {
      return Response.json([{ athlete_key: '1499520:954251', athlete_name: '1499520:954251' }]);
    }
    if (requestUrl.includes('/set_meeting_confirmation_cache?') || requestUrl.includes('/call_log?')) {
      return Response.json([]);
    }
    if (requestUrl.includes('status=in.(scheduled,confirmation_queued,confirmation_sent,rescheduled)')) {
      return Response.json([]);
    }
    return Response.json([
      {
        id: '630600',
        athlete_key: '1499520:954251',
        athlete_id: '1499520',
        athlete_main_id: '954251',
        head_scout: 'Head Scout G',
        starts_at: '2026-06-14T20:00:00Z',
        status: 'scheduled',
        post_meeting_result: 'reschedule_pending',
        source_payload: {
          workflow_context: {
            athlete_name: '1499520:954251',
            meeting_title_base: '1499520:954251 Football 2029 CA',
          },
        },
        updated_at: '2026-06-15T18:00:00Z',
      },
    ]);
  };

  const response = await prospectMobileRescheduleQueueGET(
    new Request('https://example.test/api/prospect-mobile/reschedule-queue'),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.events[0].athlete_name, 'Real Prospect');
  assert.equal(payload.events[0].previous_meeting_title, 'Real Prospect');
  assert.equal(calls.some((call) => call.url.includes('/athlete_contact_cache?')), true);
});

test('/api/prospect-mobile/reschedule-queue suppresses RSP rows after newer active reschedule exists', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const requestUrl = String(url);
    if (requestUrl.includes('post_meeting_result=is.null')) {
      assert.fail('reschedule queue replacement lookup must not require null post_meeting_result');
    }
    if (requestUrl.includes('status=in.(scheduled,confirmation_queued,confirmation_sent,rescheduled)')) {
      return Response.json([
        {
          id: '630596',
          athlete_key: 'other-athlete',
          starts_at: '2026-06-16T01:00:00Z',
          status: 'scheduled',
          post_meeting_result: 'no_show',
        },
        {
          id: '630597',
          athlete_key: '1499140:953897',
          starts_at: '2026-06-16T01:00:00Z',
          status: 'scheduled',
          post_meeting_result: 'rescheduled',
        },
      ]);
    }
    if (requestUrl.includes('/athletes?')) {
      return Response.json([{ athlete_key: '1499140:953897', athlete_name: 'Joziah Zenobia' }]);
    }
    return Response.json([
      {
        id: '630447',
        athlete_key: '1499140:953897',
        athlete_id: '1499140',
        athlete_main_id: '953897',
        head_scout: 'Head Scout A',
        starts_at: '2026-06-12T01:00:00Z',
        status: 'scheduled',
        post_meeting_result: 'reschedule_pending',
        updated_at: '2026-06-11T22:25:42Z',
      },
    ]);
  };

  const response = await prospectMobileRescheduleQueueGET(
    new Request('https://example.test/api/prospect-mobile/reschedule-queue'),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.count, 0);
  assert.deepEqual(payload.events, []);
  assert.equal(calls.some((call) => call.url.includes('/athletes?')), false);
  assert.equal(calls.some((call) => call.url.includes('post_meeting_result=is.null')), false);
});

test('/api/prospect-mobile/reschedule submits Laravel reschedule and records Supabase truth', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const requestUrl = String(url);
    if (requestUrl.endsWith('/api/v1/sales/reschedule-meeting')) {
      return Response.json({
        success: true,
        created_task: { task_id: 'task_1', title: 'Confirmation Call' },
        email_sent: true,
      });
    }
    if (requestUrl.endsWith('/api/v1/sales/stage')) {
      return Response.json({ success: true, stage: 'Meeting Result - Rescheduled' });
    }
    if (requestUrl.includes('/rest/v1/')) {
      return new Response('', { status: 200 });
    }
    return Response.json({ success: false, error: 'unexpected' }, { status: 500 });
  };

  const response = await prospectMobileReschedulePOST(
    new Request('https://example.test/api/prospect-mobile/reschedule', {
      method: 'POST',
      body: JSON.stringify({
        athlete_id: '149',
        athlete_main_id: '953',
        athlete_name: 'Jamiya Turner',
        previous_appointment_id: '628106',
        previous_meeting_title: 'Jamiya Turner Football',
        previous_meeting_text: 'Previous notes',
        meeting_timezone: 'America/Chicago',
        meeting_timezone_label: 'Central',
        open_event_id: 'open_1',
        assigned_to: '200004',
        start_time: '2026-06-16T19:00',
        head_scout_name: 'Head Scout D',
      }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.stage, 'Meeting Result - Rescheduled');
  assert.equal(payload.open_event_id, 'open_1');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    athlete_id: '149',
    athlete_main_id: '953',
    meeting_name: 'Jamiya Turner Football',
    meeting_timezone: 'America/Chicago',
    assigned_to: '200004',
    open_event_id: 'open_1',
    task_description: 'Previous notes',
    start_time: '2026-06-16T19:00',
    meeting_length: '01:00',
    openmeetings_list_length: '-1',
    template_id: '210',
    keep_as_open_slot: 'yes',
    previous_event_id: '628106',
  });
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
    athlete_id: '149',
    athlete_main_id: '953',
    stage: 'Meeting Result - Rescheduled',
  });
  assert.equal(calls.filter((call) => call.url.includes('/rest/v1/appointments')).length, 2);
  assert.equal(calls.some((call) => call.url.includes('/rest/v1/lifecycle_events')), true);
  assert.equal(String(calls.at(-1)?.init?.body).includes('rescheduled_replaced_by_new_appointment'), true);
});

test('/api/tim-lite/search calls Tim cache RPC through server Supabase', async () => {
  process.env.TIM_LITE_ACCESS_TOKEN = 'private-link-token';
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json([
      {
        appointment_id: 'appt_1',
        athlete_name: 'Jamiya Turner',
        recipient_name: 'Parent One',
        recipient_phone: '5551112222',
        match_kind: 'contact',
      },
    ]);
  };

  const response = await timLiteSearchPOST(
    new Request('https://example.test/api/tim-lite/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: createCoachRisnerSessionSetCookie(),
      },
      body: JSON.stringify({ query: 'Turner' }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.count, 1);
  assert.equal(payload.results[0].athlete_name, 'Jamiya Turner');
  assert.equal(calls[0].url, 'https://supabase.example/rest/v1/rpc/search_tim_lite_confirmation_cache');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { input_query: 'Turner' });
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer service-role');
});

test('/api/call-tracker-sync GET passes through old FastAPI sync status shape', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ success: true, status: 'idle', running: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, status: 'idle', running: false });
  assert.equal(calls[0].url, 'https://tailnet.example/api/v1/call-tracker/sync');
  assert.equal(calls[0].init?.headers?.['x-mobile-proxy' as keyof HeadersInit], 'vercel');
});

test('/api/call-tracker-sync POST starts old FastAPI async sync route', async () => {
  process.env.TAILSCALE_FASTAPI_BASE_URL = 'https://tailnet.example/';
  process.env.INTERNAL_API_SECRET = 'secret';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ success: true, status: 'started', running: true });
  };

  const response = await POST();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, status: 'started', running: true });
  assert.equal(calls[0].url, 'https://tailnet.example/api/v1/call-tracker/sync?wait=false');
  assert.equal(calls[0].init?.method, 'POST');
});

test('/api/call-tracker-sync preserves FastAPI error response shape', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  globalThis.fetch = async () =>
    Response.json({ success: false, status: 'failed', message: 'script failed', log_tail: ['boom'] }, { status: 500 });

  const response = await POST();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    success: false,
    status: 'failed',
    message: 'script failed',
    log_tail: ['boom'],
  });
});

test('/api/call-tracker-sync handles fetch failure with dashboard-compatible JSON', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  globalThis.fetch = async () => {
    throw new Error('network unreachable');
  };

  const response = await POST();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    success: false,
    status: 'failed',
    error: 'network unreachable',
    message: 'network unreachable',
  });
});

test('/api/call-tracker-sync rejects unsupported methods with old shape', async () => {
  const response = DELETE(new Request('https://example.test/api/call-tracker-sync', { method: 'DELETE' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, POST');
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Method DELETE not allowed',
  });
});

test('/api/set-meeting-confirmation-prefix forwards confirmation prefix to FastAPI', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      success: true,
      event_id: '628106',
      prefix: '(ACF*2)',
      original_title: 'Jamiya Turner',
      updated_title: '(ACF*2) Jamiya Turner',
      message: 'Booked meeting title updated',
    });
  };

  const response = await setMeetingConfirmationPrefixPOST(
    new Request('https://example.test/api/set-meeting-confirmation-prefix', {
      method: 'POST',
      body: JSON.stringify({
        event_id: '628106',
        event_date: '2026-05-16',
        prefix: '(ACF*2)',
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    event_id: '628106',
    prefix: '(ACF*2)',
    original_title: 'Jamiya Turner',
    updated_title: '(ACF*2) Jamiya Turner',
    message: 'Booked meeting title updated',
  });
  assert.equal(calls[0].url, 'https://tailnet.example/api/v1/calendar/booked-meeting/title');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    event_id: '628106',
    event_date: '2026-05-16',
    prefix: '(ACF*2)',
  });
});

test('/api/set-meeting-confirmation-prefix rejects unsupported prefixes', async () => {
  const response = await setMeetingConfirmationPrefixPOST(
    new Request('https://example.test/api/set-meeting-confirmation-prefix', {
      method: 'POST',
      body: JSON.stringify({
        event_id: '628106',
        event_date: '2026-05-16',
        prefix: '(FU)',
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'event_id, event_date, and supported prefix are required',
  });
});

test('/api/set-meeting-confirmation-prefix forwards admin modal prefixes to FastAPI', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      success: true,
      event_id: '628106',
      prefix: '(CAN)',
      original_title: 'Jamiya Turner',
      updated_title: '(CAN) Jamiya Turner',
      message: 'Booked meeting title updated',
    });
  };

  const response = await setMeetingConfirmationPrefixPOST(
    new Request('https://example.test/api/set-meeting-confirmation-prefix', {
      method: 'POST',
      body: JSON.stringify({
        event_id: '628106',
        event_date: '2026-05-16',
        prefix: '(CAN)',
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    event_id: '628106',
    prefix: '(CAN)',
    original_title: 'Jamiya Turner',
    updated_title: '(CAN) Jamiya Turner',
    message: 'Booked meeting title updated',
  });
  assert.equal(calls[0].url, 'https://tailnet.example/api/v1/calendar/booked-meeting/title');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    event_id: '628106',
    event_date: '2026-05-16',
    prefix: '(CAN)',
  });
});

test('/api/post-meeting-outcome writes prefix, stage, appointment outcome, scout note, and operator note', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const requestUrl = String(url);
    if (requestUrl.includes('/rest/v1/appointments?select=source_payload')) {
      return Response.json([{ source_payload: { meeting_title_current: 'Jamiya Turner' } }]);
    }
    if (requestUrl.includes('/rest/v1/appointments?')) {
      return Response.json({ success: true });
    }
    if (requestUrl.includes('/calendar/booked-meeting/details?')) {
      return Response.json({
        success: true,
        event_id: '628106',
        title: 'Jamiya Turner',
        description: 'Head Scout notes from booked meeting',
      });
    }
    if (requestUrl.endsWith('/calendar/booked-meeting/title')) {
      return Response.json({
        success: true,
        event_id: '628106',
        prefix: '(RSP)',
        updated_title: '(RSP) Jamiya Turner',
      });
    }
    if (requestUrl.endsWith('/sales/stage')) {
      return Response.json({
        success: true,
        stage: 'Meeting Result - Res. Pending',
        athlete_id: '149',
        athlete_main_id: '953',
      });
    }
    if (requestUrl.endsWith('/notes/add')) {
      return Response.json({ success: true, message: 'Note added' });
    }
    return Response.json({ success: false, error: 'unexpected' }, { status: 500 });
  };

  const response = await postMeetingOutcomePOST(
    new Request('https://example.test/api/post-meeting-outcome', {
      method: 'POST',
      body: JSON.stringify({
        event_id: '628106',
        event_date: '2026-05-16',
        prefix: '(RSP)',
        athlete_id: '149',
        athlete_main_id: '953',
        operator_note_description: 'Mom asked to reschedule after work.',
      }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.stage, 'Meeting Result - Res. Pending');
  assert.deepEqual(
    calls.map((call) => call.url.replace('https://tailnet.example/api/v1', '')),
    [
      '/calendar/booked-meeting/details?event_id=628106&event_date=2026-05-16',
      '/calendar/booked-meeting/title',
      '/sales/stage',
      'https://supabase.example/rest/v1/appointments?select=source_payload&id=eq.628106&limit=1',
      'https://supabase.example/rest/v1/appointments?id=eq.628106',
      '/notes/add',
      '/notes/add',
    ],
  );
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
    athlete_id: '149',
    athlete_main_id: '953',
    stage: 'Meeting Result - Res. Pending',
  });
  assert.equal(calls[4].init?.method, 'PATCH');
  const appointmentPatchBody = JSON.parse(String(calls[4].init?.body));
  assert.equal(appointmentPatchBody.post_meeting_result, 'reschedule_pending');
  assert.equal(appointmentPatchBody.status_reason, 'sales_stage_reschedule_pending');
  assert.match(appointmentPatchBody.updated_at, /^\d{4}-/);
  assert.deepEqual(appointmentPatchBody.source_payload, {
    meeting_title_current: 'Jamiya Turner',
    pending_client_scout_note: 'Head Scout notes from booked meeting',
    pending_client_operator_note_title: 'Reschedule Pending Reason',
    pending_client_operator_note: 'Mom asked to reschedule after work.',
    post_meeting_outcome_source: 'prospect_web_post_meeting_outcome',
  });
  assert.deepEqual(JSON.parse(String(calls[5].init?.body)), {
    athlete_id: '149',
    athlete_main_id: '953',
    title: 'RSP And Scout Notes',
    description: 'Head Scout notes from booked meeting',
  });
  assert.deepEqual(JSON.parse(String(calls[6].init?.body)), {
    athlete_id: '149',
    athlete_main_id: '953',
    title: 'Reschedule Pending Reason',
    description: 'Mom asked to reschedule after work.',
  });
});

test('/api/post-meeting-outcome rejects missing operator note', async () => {
  const response = await postMeetingOutcomePOST(
    new Request('https://example.test/api/post-meeting-outcome', {
      method: 'POST',
      body: JSON.stringify({
        event_id: '628106',
        event_date: '2026-05-16',
        prefix: '(CAN)',
        athlete_id: '149',
        athlete_main_id: '953',
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error:
      'event_id, event_date, prefix, athlete_id, athlete_main_id, and operator_note_description are required',
  });
});

test('/api/call-tracker-data reads live Supabase call_log for the browser contract', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const requestUrl = String(url);
    if (requestUrl.includes('/call_tracker_summary?')) {
      return Response.json([{ dials: 1, contacts: 1, meetings_set: 0, meeting_outcomes_total: 0, closed_won: 0, money_earned_cents: 0, voicemail_only: 0, appointments_tracked: 0 }]);
    }
    if (requestUrl.includes('/call_log?')) {
      return Response.json([
        {
          athlete_name: 'Live Athlete',
          occurred_at: '2026-05-05T17:00:00+00:00',
          event_at: '2026-05-05T17:00:00+00:00',
          tracker_outcome: 'spoke_follow_up',
          raw_crm_stage: 'Spoke to - Follow Up',
          raw_task_status: 'Spoke to - Follow Up',
          raw_event_type: 'call_activity',
          source: 'call_activity',
          appointment_id: null,
          live_event_id: null,
          booked_event_title: 'Spoke to - Follow Up',
          revenue_cents: null,
          dedupe_key: 'activity:live-1',
          active_operator_name: 'Primary Operator',
          task_assigned_owner: 'Primary Operator',
          counts_as_dial: true,
          counts_as_contact: true,
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: false,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Primary Operator',
          resolved_owner_source_field: 'task.assigned_owner',
          can_materialize_for_active_operator: true,
          created_at: '2026-05-05T17:00:00+00:00',
        },
      ]);
    }
    if (requestUrl.includes('/lifecycle_events?')) {
      return Response.json([]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await callTrackerDataGET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  const payload = await response.json();
  assert.equal(payload.data.summary.dials, 1);
  assert.equal(payload.data.events.some((row: { athlete_name?: string }) => row.athlete_name === 'Live Athlete'), true);
  assert.equal(payload.data.supabaseReads.canonicalEventTable, 'call_log');
  assert.equal(payload.data.supabaseReads.sourceMode, 'call_log_only');
  assert.match(payload.data.ui.monthResultLabel, /^[A-Z][a-z]+ Results$/);
  assert.equal(calls.length, 1);
  assert.equal(calls.some((call) => call.url.includes('/lifecycle_events?')), false);
  assert.equal(calls[0].init?.headers?.['Authorization' as keyof HeadersInit], 'Bearer service-role');
});

test('/api/call-tracker-data resolves key-shaped athlete names from same-key Supabase context', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const requestUrl = String(url);
    if (requestUrl.includes('/athlete_contact_cache?')) {
      return Response.json([{ athlete_key: '1499585:954315', athlete_name: 'Deontae Griffin' }]);
    }
    if (requestUrl.includes('/athletes?')) {
      return Response.json([{ athlete_key: '1499585:954315', athlete_name: '1499585:954315' }]);
    }
    if (requestUrl.includes('/set_meeting_confirmation_cache?')) {
      return Response.json([]);
    }
    if (requestUrl.includes('/call_log?select=athlete_key%2Cathlete_name')) {
      return Response.json([]);
    }
    if (requestUrl.includes('/call_log?')) {
      return Response.json([
        {
          athlete_key: '1499585:954315',
          athlete_id: '1499585',
          athlete_main_id: '954315',
          athlete_name: '1499585:954315',
          occurred_at: '2026-06-15T17:00:00+00:00',
          event_at: '2026-06-15T17:00:00+00:00',
          reporting_at: '2026-06-15T17:00:00+00:00',
          tracker_outcome: 'spoke_follow_up',
          raw_crm_stage: 'Actual Meeting Follow Up',
          raw_task_status: 'Meeting Follow Up',
          raw_event_type: 'call_activity',
          source_system: 'call_log',
          appointment_id: null,
          live_event_id: null,
          booked_event_title: null,
          revenue_cents: null,
          dedupe_key: 'activity:key-shaped-name',
          active_operator_name: 'Primary Operator',
          task_assigned_owner: 'Primary Operator',
          counts_as_dial: true,
          counts_as_contact: true,
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: false,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Primary Operator',
          resolved_owner_source_field: 'task.assigned_owner',
          can_materialize_for_active_operator: true,
          payload_json: {},
          created_at: '2026-06-15T17:00:00+00:00',
        },
      ]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await callTrackerDataGET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  const eventNames = payload.data.events.map((row: { athlete_name?: string }) => row.athlete_name);
  assert.equal(eventNames.includes('Deontae Griffin'), true);
  assert.equal(eventNames.some((name: string) => /^\d+:\d+/.test(name)), false);
  assert.equal(calls.some((call) => call.url.includes('/athlete_contact_cache?')), true);
});

test('/api/call-tracker-data shows same-task immediate meeting set as one tracker row', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/call_log?')) {
      const base = {
        athlete_key: '1499731:954461',
        athlete_id: '1499731',
        athlete_main_id: '954461',
        athlete_name: 'Braylon Jenkins',
        occurred_at: '2026-06-11T20:49:00+00:00',
        event_at: '2026-06-11T20:49:00+00:00',
        reporting_at: '2026-06-11T20:49:00+00:00',
        raw_crm_stage: 'Meeting Set',
        raw_task_status: 'Call Attempt 1',
        active_operator_name: 'Primary Operator',
        task_assigned_owner: 'Primary Operator',
        materialization_status: 'operator_task',
        materialization_reason: 'task_assigned_owner_matches_active_operator',
        resolved_owner_name: 'Primary Operator',
        resolved_owner_source_field: 'task.assigned_owner',
        can_materialize_for_active_operator: true,
        payload_json: { task_id: '698726' },
        created_at: '2026-06-11T20:49:00+00:00',
      };
      return Response.json([
        {
          ...base,
          fact_type: 'meeting_set',
          tracker_outcome: 'meeting_set',
          raw_event_type: 'lifecycle_meeting_set',
          source_system: 'lifecycle_meeting_set',
          appointment_id: '630216',
          booked_event_title: 'Braylon Jenkins Football 2028 AR',
          revenue_cents: null,
          dedupe_key: 'meeting_set:1499731:954461:630216',
          counts_as_dial: true,
          counts_as_contact: true,
          counts_as_meeting_set: true,
          counts_as_post_meeting_outcome: false,
        },
        {
          ...base,
          fact_type: 'call_activity',
          tracker_outcome: 'voicemail',
          raw_event_type: 'call_activity',
          source_system: 'call_activity',
          appointment_id: null,
          booked_event_title: null,
          revenue_cents: null,
          dedupe_key: 'call_activity:698726',
          counts_as_dial: true,
          counts_as_contact: false,
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: false,
        },
      ]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await callTrackerDataGET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  const braylonRows = payload.data.events.filter((row: { athlete_name?: string }) => row.athlete_name === 'Braylon Jenkins');
  assert.equal(braylonRows.length, 1);
  assert.equal(braylonRows[0].tracker_outcome, 'meeting_set');
  assert.equal(payload.data.summary.dials, 1);
  assert.equal(payload.data.summary.voicemail_only, 0);
  assert.equal(payload.data.ui.periods['week-3'].dials, 1);
});

test('/api/call-tracker-data dedupes meeting-set rows by appointment', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/call_tracker_summary?')) {
      return Response.json([{ dials: 2, contacts: 2, meetings_set: 2, meeting_outcomes_total: 0, closed_won: 0, money_earned_cents: 0, voicemail_only: 0, appointments_tracked: 1 }]);
    }
    if (requestUrl.includes('/call_log?')) {
      const base = {
        athlete_name: 'Carson visser',
        occurred_at: '2026-05-05T18:22:20+00:00',
        event_at: '2026-05-05T18:22:20+00:00',
        reporting_at: '2026-05-05T18:22:20+00:00',
        reporting_date_et: '2026-05-05',
        tracker_outcome: 'meeting_set',
        raw_crm_stage: 'Meeting Set',
        raw_event_type: 'lifecycle_meeting_set',
        appointment_id: '588133',
        live_event_id: null,
        booked_event_title: "Carson Visser Men's Basketball 2026 UT",
        revenue_cents: null,
        active_operator_name: 'Primary Operator',
        task_assigned_owner: 'Primary Operator',
        counts_as_dial: true,
        counts_as_contact: true,
        counts_as_meeting_set: true,
        counts_as_post_meeting_outcome: false,
        materialization_status: 'operator_task',
        materialization_reason: 'task_assigned_owner_matches_active_operator',
        resolved_owner_name: 'Primary Operator',
        resolved_owner_source_field: 'task.assigned_owner',
        can_materialize_for_active_operator: true,
        created_at: '2026-05-05T18:22:20+00:00',
      };
      return Response.json([
        { ...base, source: 'lifecycle_meeting_set', raw_task_status: 'SCHEDULED FOLLOW-UP', dedupe_key: null },
        {
          ...base,
          occurred_at: '2026-05-11T20:05:53.444+00:00',
          event_at: '2026-05-11T20:05:53.444+00:00',
          reporting_at: '2026-05-11T20:05:53.444+00:00',
          reporting_date_et: '2026-05-11',
          source: 'weekly_booked_meetings_with_operator_confirmation_task',
          raw_task_status: 'confirmation_call',
          dedupe_key: 'meeting_set:1490749:952575:588133',
          created_at: '2026-05-11T20:05:53.444+00:00',
        },
      ]);
    }
    if (requestUrl.includes('/lifecycle_events?')) {
      return Response.json([]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await callTrackerDataGET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  const carsonMeetingSets = payload.data.events.filter(
    (row: { athlete_name?: string; tracker_outcome?: string }) =>
      row.athlete_name?.toLowerCase() === 'carson visser' && row.tracker_outcome === 'meeting_set',
  );
  assert.equal(carsonMeetingSets.length, 1);
  assert.equal(carsonMeetingSets[0].dedupe_key, 'meeting_set:1490749:952575:588133');
  assert.equal(carsonMeetingSets[0].reporting_date_et, '2026-05-11');
});

test('/api/call-tracker-data does not count appointment changes as new meeting sets', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/call_tracker_summary?')) {
      return Response.json([
        { dials: 2, contacts: 2, meetings_set: 1, meeting_outcomes_total: 0, closed_won: 0, money_earned_cents: 0, voicemail_only: 0, appointments_tracked: 1 },
      ]);
    }
    if (requestUrl.includes('/call_log?')) {
      const base = {
        athlete_key: '1491040:952861',
        athlete_id: '1491040',
        athlete_main_id: '952861',
        athlete_name: 'Jamiya Turner',
        event_at: '2026-05-13T20:06:25.123+00:00',
        tracker_outcome: 'meeting_set',
        raw_task_status: 'confirmation_call',
        raw_event_type: 'lifecycle_meeting_set',
        booked_event_title: "Jamiya Turner Women's Volleyball 2027 NC",
        active_operator_name: 'Primary Operator',
        task_assigned_owner: 'Primary Operator',
        counts_as_dial: true,
        counts_as_contact: true,
        counts_as_post_meeting_outcome: false,
        materialization_status: 'operator_task',
        resolved_owner_name: 'Primary Operator',
        resolved_owner_source_field: 'task.assigned_owner',
        can_materialize_for_active_operator: true,
      };
      return Response.json([
        {
          ...base,
          occurred_at: '2026-05-13T22:01:56.559+00:00',
          appointment_id: '624183',
          raw_crm_stage: 'Rescheduled',
          counts_as_meeting_set: false,
          dedupe_key: 'meeting_set:1491040:952861:624183',
          created_at: '2026-05-13T22:01:56.559+00:00',
        },
        {
          ...base,
          occurred_at: '2026-05-13T20:06:25.123+00:00',
          appointment_id: '620950',
          raw_crm_stage: 'Meeting Set',
          counts_as_meeting_set: true,
          dedupe_key: null,
          created_at: '2026-05-13T20:06:25.123+00:00',
        },
      ]);
    }
    if (requestUrl.includes('/lifecycle_events?')) {
      return Response.json([]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await callTrackerDataGET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  const rows = payload.data.events.filter(
    (row: { athlete_name?: string; tracker_outcome?: string }) =>
      row.athlete_name === 'Jamiya Turner' && row.tracker_outcome === 'meeting_set',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].appointment_id, '620950');
  assert.equal(rows[0].counts_as_meeting_set, true);
  for (const row of rows) {
    assert.equal(row.athlete_key, undefined);
    assert.equal(row.athlete_id, undefined);
    assert.equal(row.athlete_main_id, undefined);
  }
  assert.equal(payload.data.summary.meetings_set, 1);
  assert.equal(payload.data.summary.appointments_tracked, 1);
  assert.equal(payload.data.summary.dials, 2);
  assert.equal(payload.data.summary.contacts, 2);
});

test('/api/call-tracker-data excludes scheduled confirmation-task artifacts from meeting counts', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/call_log?')) {
      const artifactBase = {
        athlete_name: null,
        occurred_at: '2026-06-14T13:00:00+00:00',
        event_at: '2026-06-14T13:00:00+00:00',
        reporting_at: '2026-06-14T13:00:00+00:00',
        tracker_outcome: 'meeting_set',
        raw_crm_stage: 'Meeting Set',
        raw_task_status: 'confirmation_call',
        raw_event_type: 'lifecycle_meeting_set',
        source_system: 'scout_tasks_current_pipeline',
        counts_as_dial: true,
        counts_as_contact: true,
        counts_as_meeting_set: true,
        counts_as_post_meeting_outcome: false,
        materialization_status: 'operator_task',
        created_at: '2026-06-14T13:00:00+00:00',
      };
      return Response.json([
        {
          athlete_name: 'Real Meeting',
          occurred_at: '2026-06-14T15:00:00+00:00',
          event_at: '2026-06-14T15:00:00+00:00',
          reporting_at: '2026-06-14T15:00:00+00:00',
          tracker_outcome: 'meeting_set',
          raw_crm_stage: 'Meeting Set',
          raw_task_status: 'Call Attempt 1',
          raw_event_type: 'lifecycle_meeting_set',
          source_system: 'lifecycle_meeting_set',
          appointment_id: 'real-appt',
          booked_event_title: 'Real Meeting Football 2028 TX',
          counts_as_dial: true,
          counts_as_contact: true,
          counts_as_meeting_set: true,
          counts_as_post_meeting_outcome: false,
          materialization_status: 'operator_task',
          created_at: '2026-06-14T15:00:00+00:00',
        },
        { ...artifactBase, appointment_id: 'artifact-1', booked_event_title: '(ACF) Artifact One' },
        { ...artifactBase, appointment_id: 'artifact-2', booked_event_title: 'Artifact Two' },
        { ...artifactBase, appointment_id: 'artifact-3', booked_event_title: 'Artifact Three' },
      ]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await callTrackerDataGET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.summary.meetings_set, 1);
  assert.equal(payload.data.ui.periods['week-total'].meetingsSet, 1);
  assert.equal(
    payload.data.events.some(
      (row: { source?: string; raw_task_status?: string }) =>
        row.source === 'scout_tasks_current_pipeline' && row.raw_task_status === 'confirmation_call',
    ),
    false,
  );
});

test('/api/call-tracker-data keeps same-athlete meeting facts on separate reporting dates', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/call_tracker_summary?')) {
      return Response.json([
        { dials: 2, contacts: 2, meetings_set: 2, meeting_outcomes_total: 0, closed_won: 0, money_earned_cents: 0, voicemail_only: 0, appointments_tracked: 2 },
      ]);
    }
    if (requestUrl.includes('/call_log?')) {
      const base = {
        athlete_key: '1491165:952986',
        athlete_id: '1491165',
        athlete_main_id: '952986',
        athlete_name: 'Michael Gallimore',
        tracker_outcome: 'meeting_set',
        raw_crm_stage: 'Meeting Set',
        raw_task_status: 'confirmation_call',
        raw_event_type: 'lifecycle_meeting_set',
        booked_event_title: 'Michael Gallimore Football 2027 MD',
        active_operator_name: 'Primary Operator',
        task_assigned_owner: 'Primary Operator',
        counts_as_dial: true,
        counts_as_contact: true,
        counts_as_meeting_set: true,
        counts_as_post_meeting_outcome: false,
        materialization_status: 'operator_task',
        resolved_owner_name: 'Primary Operator',
        resolved_owner_source_field: 'task.assigned_owner',
        can_materialize_for_active_operator: true,
      };
      return Response.json([
        {
          ...base,
          occurred_at: '2026-05-13T18:35:24.817+00:00',
          event_at: '2026-05-13T18:35:24.817+00:00',
          reporting_at: '2026-05-13T18:35:24.817+00:00',
          reporting_date_et: '2026-05-13',
          appointment_id: '613331',
          dedupe_key: 'meeting_set:1491165:952986:613331',
          created_at: '2026-05-13T18:35:24.817+00:00',
        },
        {
          ...base,
          occurred_at: '2026-05-18T14:03:52.715+00:00',
          event_at: '2026-05-18T14:03:52.715+00:00',
          reporting_at: '2026-05-18T14:03:52.715+00:00',
          reporting_date_et: '2026-05-18',
          appointment_id: '612642',
          dedupe_key: 'meeting_set:1491165:952986:612642',
          created_at: '2026-05-18T14:03:52.715+00:00',
        },
      ]);
    }
    if (requestUrl.includes('/lifecycle_events?')) {
      return Response.json([]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await callTrackerDataGET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  const rows = payload.data.events.filter(
    (row: { athlete_name?: string; tracker_outcome?: string }) =>
      row.athlete_name === 'Michael Gallimore' && row.tracker_outcome === 'meeting_set',
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row: { reporting_date_et?: string }) => row.reporting_date_et).sort(),
    ['2026-05-13', '2026-05-18'],
  );
});

test('/api/call-tracker-data trusts Supabase reporting_at instead of rewriting meeting-set clocks locally', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/call_tracker_summary?')) {
      return Response.json([
        { dials: 1, contacts: 1, meetings_set: 1, meeting_outcomes_total: 0, closed_won: 0, money_earned_cents: 0, voicemail_only: 0, appointments_tracked: 1 },
      ]);
    }
    if (requestUrl.includes('/call_log?')) {
      return Response.json([
        {
          athlete_key: '1490499:952328',
          athlete_id: '1490499',
          athlete_main_id: '952328',
          athlete_name: 'Elia Imani',
          occurred_at: '2026-05-18T14:03:57.075+00:00',
          event_at: '2026-05-18T14:03:57.075+00:00',
          reporting_at: '2026-05-10T19:04:00.000Z',
          reporting_date_et: '2026-05-10',
          tracker_outcome: 'meeting_set',
          raw_crm_stage: 'Rescheduled',
          raw_task_status: 'confirmation_call',
          raw_event_type: 'lifecycle_meeting_set',
          source: 'weekly_booked_meetings_with_operator_confirmation_task',
          appointment_id: '611039',
          live_event_id: null,
          booked_event_title: 'Elia Imani Football 2029 TX',
          revenue_cents: null,
          dedupe_key: 'meeting_set:1490499:952328:611039',
          active_operator_name: 'Primary Operator',
          task_assigned_owner: 'Primary Operator',
          counts_as_dial: true,
          counts_as_contact: true,
          counts_as_meeting_set: true,
          counts_as_post_meeting_outcome: false,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Head Scout F',
          resolved_owner_source_field: 'appointmentSetterName',
          can_materialize_for_active_operator: true,
          created_at: '2026-05-18T14:03:57.075+00:00',
        },
      ]);
    }
    if (requestUrl.includes('/lifecycle_events?')) {
      return Response.json([
        {
          id: 'lifecycle-1',
          athlete_key: '1490499:952328',
          athlete_id: '1490499',
          athlete_main_id: '952328',
          event_type: 'meeting_set',
          dedupe_key: 'meeting_set:1490499:952328:611039',
          crm_stage: 'Rescheduled',
          task_status: 'confirmation_call',
          created_at: '2026-05-18T14:03:57.075+00:00',
          payload_json: {
            source: 'weekly_booked_meetings_with_operator_confirmation_task',
            appointment_id: '611039',
            booked_event_id: '611039',
            latest_confirmation_task_due_at: '2026-05-10T19:04:00.000Z',
            matched_weekly_task_due_at: 'Sun 05/10/26 03:04 PM',
          },
        },
      ]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await callTrackerDataGET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  const [row] = payload.data.events.filter(
    (event: { athlete_name?: string; tracker_outcome?: string }) =>
      event.athlete_name === 'Elia Imani' && event.tracker_outcome === 'meeting_set',
  );
  assert.equal(row.occurred_at, '2026-05-18T14:03:57.075+00:00');
  assert.equal(row.event_at, '2026-05-18T14:03:57.075+00:00');
  assert.equal(row.reporting_at, '2026-05-10T19:04:00.000Z');
  assert.equal(row.reporting_date_et, '2026-05-10');
});

test('/api/call-tracker-data counts confirmed enrollments while paying commission from Stripe revenue', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-06T16:00:00.000Z') });
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const closedWonAt = '2026-05-20T16:00:00.000Z';
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/call_tracker_summary?')) {
      return Response.json([
        { dials: 0, contacts: 0, meetings_set: 0, meeting_outcomes_total: 2, closed_won: 2, money_earned_cents: 19900, voicemail_only: 0, appointments_tracked: 0 },
      ]);
    }
    if (requestUrl.includes('/call_log?')) {
      return Response.json([
        {
          athlete_name: 'Failed Payment Athlete',
          occurred_at: closedWonAt,
          event_at: closedWonAt,
          tracker_outcome: 'closed_won',
          raw_crm_stage: 'Actual Meeting - Close Won',
          raw_task_status: 'closed_won',
          raw_event_type: 'post_meeting_outcome',
          source: 'legacy_sales_stage_current',
          appointment_id: 'failed-payment',
          live_event_id: 'failed-payment',
          booked_event_title: '(ENR $99) Failed Payment Athlete',
          revenue_cents: 9900,
          dedupe_key: 'legacy_sales_stage_current:failed-payment:closed_won',
          active_operator_name: 'Primary Operator',
          task_assigned_owner: 'Primary Operator',
          counts_as_dial: false,
          counts_as_contact: false,
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Primary Operator',
          resolved_owner_source_field: 'bookedMeeting.assigned_owner',
          can_materialize_for_active_operator: true,
          created_at: closedWonAt,
        },
        {
          athlete_name: 'Commission Athlete',
          occurred_at: closedWonAt,
          event_at: closedWonAt,
          tracker_outcome: 'closed_won',
          raw_crm_stage: 'Actual Meeting - Close Won',
          raw_task_status: 'closed_won',
          raw_event_type: 'post_meeting_outcome',
          source: 'stripe_commissions',
          appointment_id: 'paid-1',
          live_event_id: 'paid-1',
          booked_event_title: '(ENR) Commission Athlete',
          revenue_cents: 10000,
          dedupe_key: 'post_meeting_outcome:paid-1:closed_won',
          active_operator_name: 'Primary Operator',
          task_assigned_owner: 'Primary Operator',
          counts_as_dial: false,
          counts_as_contact: false,
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Primary Operator',
          resolved_owner_source_field: 'bookedMeeting.assigned_owner',
          can_materialize_for_active_operator: true,
          created_at: closedWonAt,
        },
        {
          athlete_name: 'Commission Athlete',
          occurred_at: closedWonAt,
          event_at: closedWonAt,
          tracker_outcome: 'closed_won',
          raw_crm_stage: 'Actual Meeting - Close Won',
          raw_task_status: 'closed_won',
          raw_event_type: 'post_meeting_outcome',
          source: 'legacy_sales_stage_current',
          appointment_id: 'paid-older',
          live_event_id: 'paid-older',
          booked_event_title: '(ENR) Commission Athlete',
          revenue_cents: null,
          dedupe_key: 'post_meeting_outcome:paid-older:closed_won',
          active_operator_name: 'Primary Operator',
          task_assigned_owner: 'Primary Operator',
          counts_as_dial: false,
          counts_as_contact: false,
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Primary Operator',
          resolved_owner_source_field: 'bookedMeeting.assigned_owner',
          can_materialize_for_active_operator: true,
          created_at: closedWonAt,
        },
      ]);
    }
    if (requestUrl.includes('/lifecycle_events?')) {
      return Response.json([]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await callTrackerDataGET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.ui.paycheck.commissionCents, 2000);
  assert.equal(payload.data.ui.summaryCards.moneyEarnedCents, 2000);
  assert.equal(payload.data.ui.summaryCards.closedWon, 2);
  assert.equal(payload.data.ui.closedWonRows.length, 2);
  assert.deepEqual(
    payload.data.ui.closedWonRows.map((row: { athlete_name?: string }) => row.athlete_name).sort(),
    ['Commission Athlete', 'Failed Payment Athlete'],
  );
  assert.equal(
    payload.data.ui.closedWonRows.find((row: { athlete_name?: string }) => row.athlete_name === 'Commission Athlete')?.source,
    'stripe_commissions',
  );
  assert.equal(
    payload.data.events.some((row: { athlete_name?: string }) => row.athlete_name === 'Failed Payment Athlete'),
    true,
  );
});

test('/api/call-tracker-data pays June 14 commission from the May 16-31 earning period', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-06T16:00:00.000Z') });
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/call_tracker_summary?')) {
      return Response.json([
        { dials: 0, contacts: 0, meetings_set: 0, meeting_outcomes_total: 3, closed_won: 3, money_earned_cents: 0, voicemail_only: 0, appointments_tracked: 0 },
      ]);
    }
    if (requestUrl.includes('/call_log?')) {
      const row = (name: string, occurredAt: string, revenueCents: number, dedupeKey?: string, factType = 'enrollment_payment') => ({
        fact_type: factType,
        athlete_name: name,
        occurred_at: occurredAt,
        event_at: occurredAt,
        tracker_outcome: 'closed_won',
        raw_crm_stage: 'Actual Meeting - Close Won',
        raw_task_status: 'closed_won',
        raw_event_type: 'post_meeting_outcome',
        source_system: 'stripe_commissions',
        appointment_id: name,
        live_event_id: name,
        booked_event_title: `(ENR) ${name}`,
        revenue_cents: revenueCents,
        dedupe_key: dedupeKey || `enrollment_payment:${name}`,
        payload_json: {
          commission_duplicate_key: name,
        },
        active_operator_name: 'Primary Operator',
        task_assigned_owner: 'Primary Operator',
        counts_as_dial: false,
        counts_as_contact: false,
        counts_as_meeting_set: false,
        counts_as_post_meeting_outcome: true,
        materialization_status: 'operator_task',
        materialization_reason: 'task_assigned_owner_matches_active_operator',
        resolved_owner_name: 'Primary Operator',
        resolved_owner_source_field: 'bookedMeeting.assigned_owner',
        can_materialize_for_active_operator: true,
        created_at: occurredAt,
      });
      return Response.json([
        row('before-period', '2026-05-15T16:00:00.000Z', 10000),
        row('in-period-one', '2026-05-16T16:00:00.000Z', 10000),
        row('in-period-one', '2026-05-16T16:00:00.000Z', 10000, 'post_meeting_outcome:in-period-one:closed_won', 'enrollment_payment'),
        row('in-period-two', '2026-05-31T16:00:00.000Z', 9000),
        row('after-period', '2026-06-01T16:00:00.000Z', 10000),
      ]);
    }
    if (requestUrl.includes('/lifecycle_events?')) {
      return Response.json([]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await callTrackerDataGET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.ui.paycheck.payDateLabel, 'Next check Jun 14');
  assert.equal(payload.data.ui.paycheck.commissionPeriodLabel, 'May 16-31');
  assert.equal(payload.data.ui.paycheck.commissionCents, 3800);
  assert.equal(payload.data.ui.paycheck.totalCents, 103800);
});

test('/api/meeting-readback-data returns meeting-only live readback rows', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const requestUrl = String(url);
    if (requestUrl.includes('/call_tracker_summary?')) {
      return Response.json([{ meetings_set: 4, closed_won: 1 }]);
    }
    if (requestUrl.includes('/call_log?')) {
      return Response.json([
        {
          athlete_name: 'Meeting Athlete',
          occurred_at: '2026-06-02T15:00:00+00:00',
          event_at: '2026-06-02T15:00:00+00:00',
          reporting_at: '2026-06-02T15:00:00+00:00',
          reporting_date_et: '2026-06-02',
          tracker_outcome: 'meeting_set',
          raw_crm_stage: 'Meeting Set',
          raw_task_status: 'confirmation_call',
          raw_event_type: 'lifecycle_meeting_set',
          source: 'call_tracker_events_owner_context',
          appointment_id: 'appt-1',
          booked_event_title: 'Meeting Athlete Football 2027 TX',
          active_operator_name: 'Primary Operator',
          task_assigned_owner: 'Primary Operator',
          counts_as_meeting_set: true,
          counts_as_post_meeting_outcome: false,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Primary Operator',
          resolved_owner_source_field: 'task.assigned_owner',
          can_materialize_for_active_operator: true,
          created_at: '2026-06-02T14:50:00+00:00',
        },
        {
          athlete_name: 'Call Only Athlete',
          occurred_at: '2026-06-02T16:00:00+00:00',
          event_at: '2026-06-02T16:00:00+00:00',
          tracker_outcome: 'spoke_follow_up',
          raw_crm_stage: 'Spoke to - Follow Up',
          raw_task_status: 'Spoke to - Follow Up',
          raw_event_type: 'call_activity',
          source: 'call_activity',
          materialization_status: 'operator_task',
          created_at: '2026-06-02T16:00:00+00:00',
        },
        {
          athlete_name: 'Won Athlete',
          occurred_at: '2026-06-02T16:30:00+00:00',
          event_at: '2026-06-02T16:30:00+00:00',
          reporting_at: '2026-06-02T16:30:00+00:00',
          tracker_outcome: 'meeting_set',
          raw_crm_stage: 'Meeting Set',
          raw_task_status: 'confirmation_call',
          raw_event_type: 'lifecycle_meeting_set',
          source: 'call_tracker_events_owner_context',
          appointment_id: 'appt-won',
          counts_as_meeting_set: true,
          counts_as_post_meeting_outcome: false,
          materialization_status: 'operator_task',
          created_at: '2026-06-02T16:30:00+00:00',
        },
        {
          athlete_name: 'Won Athlete',
          occurred_at: '2026-06-02T17:00:00+00:00',
          event_at: '2026-06-02T17:00:00+00:00',
          tracker_outcome: 'closed_won',
          raw_crm_stage: 'Closed Won',
          raw_task_status: 'Closed Won',
          raw_event_type: 'meeting_result',
          source: 'call_tracker_events_owner_context',
          appointment_id: 'appt-won',
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          created_at: '2026-06-02T17:00:00+00:00',
        },
        {
          athlete_name: 'Lost Athlete',
          occurred_at: '2026-06-02T18:00:00+00:00',
          event_at: '2026-06-02T18:00:00+00:00',
          tracker_outcome: 'closed_lost',
          raw_crm_stage: 'Closed Lost',
          raw_task_status: 'Closed Lost',
          raw_event_type: 'meeting_result',
          source: 'call_tracker_events_owner_context',
          appointment_id: 'appt-lost',
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          created_at: '2026-06-02T18:00:00+00:00',
        },
        {
          athlete_name: 'Follow Up Athlete',
          occurred_at: '2026-06-02T19:00:00+00:00',
          event_at: '2026-06-02T19:00:00+00:00',
          tracker_outcome: 'actual_meeting_follow_up',
          raw_crm_stage: 'Actual Meeting - Follow Up',
          raw_task_status: 'Actual Meeting - Follow Up',
          raw_event_type: 'meeting_result',
          source: 'call_tracker_events_owner_context',
          appointment_id: 'appt-follow-up',
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          created_at: '2026-06-02T19:00:00+00:00',
        },
        {
          athlete_name: 'No Show Athlete',
          occurred_at: '2026-06-02T20:00:00+00:00',
          event_at: '2026-06-02T20:00:00+00:00',
          tracker_outcome: 'no_show',
          raw_crm_stage: 'No Show',
          raw_task_status: 'No Show',
          raw_event_type: 'meeting_result',
          source: 'call_tracker_events_owner_context',
          appointment_id: 'appt-no-show',
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          created_at: '2026-06-02T20:00:00+00:00',
        },
        {
          athlete_name: 'Kelle Johnson',
          occurred_at: '2026-06-03T21:00:00+00:00',
          event_at: '2026-06-03T21:00:00+00:00',
          reporting_at: '2026-06-03T21:00:00+00:00',
          tracker_outcome: 'meeting_set',
          raw_crm_stage: 'Meeting Set',
          raw_task_status: 'confirmation_call',
          raw_event_type: 'lifecycle_meeting_set',
          appointment_id: 'appt-kelle',
          counts_as_meeting_set: true,
          counts_as_post_meeting_outcome: false,
          created_at: '2026-06-03T21:00:00+00:00',
        },
        {
          athlete_name: 'Kelle Johnson',
          occurred_at: '2026-06-03T22:00:00+00:00',
          event_at: '2026-06-03T22:00:00+00:00',
          reporting_at: '2026-06-03T22:00:00+00:00',
          tracker_outcome: 'no_show',
          raw_crm_stage: 'Meeting Result - No Show',
          raw_task_status: 'No Show',
          raw_event_type: 'meeting_result',
          appointment_id: 'appt-kelle',
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          created_at: '2026-06-03T22:00:00+00:00',
        },
        {
          athlete_name: 'Cale Kethman',
          occurred_at: '2026-06-02T20:00:00+00:00',
          event_at: '2026-06-02T20:00:00+00:00',
          reporting_at: '2026-06-02T20:00:00+00:00',
          tracker_outcome: 'meeting_set',
          raw_crm_stage: 'Meeting Set',
          raw_task_status: 'confirmation_call',
          raw_event_type: 'lifecycle_meeting_set',
          appointment_id: 'appt-cale',
          counts_as_meeting_set: true,
          counts_as_post_meeting_outcome: false,
          created_at: '2026-06-02T20:00:00+00:00',
        },
        {
          athlete_name: 'Alexander Williamson',
          occurred_at: '2026-06-02T21:00:00+00:00',
          event_at: '2026-06-02T21:00:00+00:00',
          reporting_at: '2026-06-02T21:00:00+00:00',
          tracker_outcome: 'meeting_set',
          raw_crm_stage: 'Meeting Set',
          raw_task_status: 'confirmation_call',
          raw_event_type: 'lifecycle_meeting_set',
          appointment_id: 'appt-alexander',
          counts_as_meeting_set: true,
          counts_as_post_meeting_outcome: false,
          created_at: '2026-06-02T21:00:00+00:00',
        },
        {
          athlete_name: 'Baker',
          occurred_at: '2026-06-02T21:00:00+00:00',
          event_at: '2026-06-02T21:00:00+00:00',
          reporting_at: '2026-06-02T21:00:00+00:00',
          tracker_outcome: 'meeting_set',
          raw_crm_stage: 'Meeting Set',
          raw_task_status: 'confirmation_call',
          raw_event_type: 'lifecycle_meeting_set',
          appointment_id: 'appt-baker',
          counts_as_meeting_set: true,
          counts_as_post_meeting_outcome: false,
          created_at: '2026-06-02T21:00:00+00:00',
        },
      ]);
    }
    if (requestUrl.includes('/appointments?')) {
      return Response.json([
        {
          id: 'appt-1',
          athlete_key: 'appt-1',
          athlete_id: '1490010',
          athlete_main_id: '953010',
          head_scout: 'Head Scout D',
          starts_at: '2026-06-03T15:00:00+00:00',
          status: 'scheduled',
          source_event_id: 'event-current-1',
          meeting_timezone: 'America/New_York',
          meeting_timezone_label: 'EST',
          calendar_timezone: 'America/New_York',
          appointment_role: 'initial_set',
          updated_at: '2026-06-02T13:00:00+00:00',
          created_at: '2026-06-02T13:00:00+00:00',
        },
        {
          id: 'appt-cale',
          athlete_key: 'cale',
          athlete_id: '1490100',
          athlete_main_id: '953100',
          head_scout: 'Head Scout F',
          starts_at: '2026-06-02T20:00:00+00:00',
          status: 'pending',
          updated_at: '2026-06-02T20:05:00+00:00',
          created_at: '2026-06-02T20:00:00+00:00',
        },
        {
          id: 'appt-alexander',
          athlete_key: 'alexander',
          athlete_id: '1490101',
          athlete_main_id: '953101',
          head_scout: 'Head Scout C',
          starts_at: '2026-06-02T21:00:00+00:00',
          status: 'pending',
          updated_at: '2026-06-02T21:05:00+00:00',
          created_at: '2026-06-02T21:00:00+00:00',
        },
        {
          id: 'appt-kelle',
          athlete_key: 'kelle',
          athlete_id: '1490102',
          athlete_main_id: '953102',
          head_scout: 'Head Scout E',
          starts_at: '2026-06-03T21:00:00+00:00',
          status: 'no_show',
          updated_at: '2026-06-03T22:05:00+00:00',
          created_at: '2026-06-03T21:00:00+00:00',
        },
        {
          id: 'appt-baker',
          athlete_key: 'baker',
          athlete_id: '1490099',
          athlete_main_id: '953099',
          head_scout: 'Head Scout D',
          starts_at: '2026-06-03T19:00:00+00:00',
          status: 'reschedule_pending',
          updated_at: '2026-06-02T21:05:00+00:00',
          created_at: '2026-06-02T21:00:00+00:00',
        },
      ]);
    }
    if (requestUrl.includes('/athletes?')) {
      return Response.json([
        {
          athlete_key: 'athlete-current',
          athlete_name: 'Current Athlete',
        },
        {
          athlete_key: 'athlete-1',
          athlete_name: 'Current Athlete',
        },
        {
          athlete_key: 'athlete-2',
          athlete_name: 'Lifecycle Call Athlete',
        },
      ]);
    }
    if (requestUrl.includes('/lifecycle_events?')) {
      return Response.json([
        {
          id: 'life-1',
          athlete_key: 'athlete-1',
          athlete_id: '1490001',
          athlete_main_id: '953001',
          event_type: 'meeting_set',
          crm_stage: 'Meeting Set',
          task_status: 'confirmation_call',
          payload_json: {
            booked_event_id: 'appt-life',
            booked_event_title: 'Lifecycle Athlete Soccer 2026 GA',
            materialization_status: 'operator_task',
            active_operator_name: 'Primary Operator',
            task_assigned_owner: 'Primary Operator',
          },
          created_at: '2026-06-02T13:00:00+00:00',
        },
        {
          id: 'life-2',
          athlete_key: 'athlete-2',
          athlete_id: '1490002',
          athlete_main_id: '953002',
          event_type: 'call_activity',
          crm_stage: 'Spoke to - Follow Up',
          task_status: 'Call Attempt 1',
          payload_json: {},
          created_at: '2026-06-02T12:00:00+00:00',
        },
      ]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await meetingReadbackDataGET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  const payload = await response.json();
  assert.equal(payload.contract, 'monthly-enrollment-tracker');
  assert.match(payload.data.title, /Enrollment Tracker/);
  assert.equal(payload.data.summary.meetingsSet, 3);
  assert.equal(payload.data.summary.enrollments, 1);
  assert.equal(payload.data.summary.showRate, 33);
  assert.equal(payload.data.rows.length, 3);
  const meetingAthlete = payload.data.rows.find((row: { athleteName?: string }) => row.athleteName === 'Meeting Athlete');
  assert.equal(meetingAthlete?.status, 'Set');
  assert.equal(meetingAthlete?.headScout, 'Head Scout D');
  assert.equal(payload.data.rows.find((row: { athleteName?: string }) => row.athleteName === 'Won Athlete')?.status, 'Close Won');
  assert.equal(
    payload.data.rows.some((row: { athleteName?: string }) => row.athleteName === 'Baker'),
    false,
  );
  assert.equal(
    payload.data.rows.some((row: { athleteName?: string }) => row.athleteName === 'Cale Kethman'),
    false,
  );
  assert.equal(
    payload.data.rows.some((row: { athleteName?: string }) => row.athleteName === 'Alexander Williamson'),
    false,
  );
  assert.equal(
    payload.data.rows.some((row: { athleteName?: string }) => row.athleteName === 'Kelle Johnson'),
    true,
  );
  assert.equal(payload.data.rows.find((row: { athleteName?: string }) => row.athleteName === 'Kelle Johnson')?.status, 'No Show');
  assert.equal(payload.data.supabaseReads.canonicalEventTable, 'call_log');
  assert.equal(payload.data.supabaseReads.appointmentTable, 'appointments');
  assert.equal(payload.data.supabaseReads.athleteTable, 'athletes');
  assert.equal(
    payload.data.rows.some((row: { athleteName?: string }) => row.athleteName === 'Call Only Athlete'),
    false,
  );
  assert.equal(payload.data.generatedAt.endsWith('Z'), true);
  assert.equal(calls.length, 3);
  assert.equal(calls.some((call) => call.url.includes('/active_athlete_meeting_truth?')), false);
  assert.equal(calls.some((call) => call.url.includes('/athlete_lifecycle_timeline?')), false);
  assert.equal(calls.some((call) => call.url.includes('/lifecycle_events?')), false);
  assert.equal(calls[0].init?.headers?.['Authorization' as keyof HeadersInit], 'Bearer service-role');
  assert.equal(calls.every((call) => call.init?.cache === 'no-store'), true);
});
