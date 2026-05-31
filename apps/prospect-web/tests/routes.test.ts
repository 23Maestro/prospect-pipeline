import assert from 'node:assert/strict';
import test from 'node:test';
import { GET as callTrackerDataGET } from '../app/api/call-tracker-data/route';
import { GET as meetingReadbackDataGET } from '../app/api/meeting-readback-data/route';
import { DELETE, GET, POST } from '../app/api/call-tracker-sync/route';
import { GET as healthGET } from '../app/api/health/route';
import { POST as postMeetingOutcomePOST } from '../app/api/post-meeting-outcome/route';
import { POST as setMeetingConfirmationPrefixPOST } from '../app/api/set-meeting-confirmation-prefix/route';

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

test('/api/post-meeting-outcome writes prefix, stage, scout note, and operator note', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const requestUrl = String(url);
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
      '/notes/add',
      '/notes/add',
    ],
  );
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
    athlete_id: '149',
    athlete_main_id: '953',
    stage: 'Meeting Result - Res. Pending',
  });
  assert.deepEqual(JSON.parse(String(calls[3].init?.body)), {
    athlete_id: '149',
    athlete_main_id: '953',
    title: 'RSP And Scout Notes',
    description: 'Head Scout notes from booked meeting',
  });
  assert.deepEqual(JSON.parse(String(calls[4].init?.body)), {
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

test('/api/call-tracker-data reads live Supabase reporting views for the browser contract', async () => {
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
    if (requestUrl.includes('/call_tracker_events_owner_context?')) {
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
          active_operator_name: 'Jerami Singleton',
          task_assigned_owner: 'Jerami Singleton',
          counts_as_dial: true,
          counts_as_contact: true,
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: false,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Jerami Singleton',
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
  assert.equal(payload.data.supabaseReads.eventView, 'call_tracker_events_owner_context');
  assert.equal(payload.data.ui.monthResultLabel, 'May Results');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init?.headers?.['Authorization' as keyof HeadersInit], 'Bearer service-role');
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
    if (requestUrl.includes('/call_tracker_events_owner_context?')) {
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
        active_operator_name: 'Jerami Singleton',
        task_assigned_owner: 'Jerami Singleton',
        counts_as_dial: true,
        counts_as_contact: true,
        counts_as_meeting_set: true,
        counts_as_post_meeting_outcome: false,
        materialization_status: 'operator_task',
        materialization_reason: 'task_assigned_owner_matches_active_operator',
        resolved_owner_name: 'Jerami Singleton',
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
    if (requestUrl.includes('/call_tracker_events_owner_context?')) {
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
        active_operator_name: 'Jerami Singleton',
        task_assigned_owner: 'Jerami Singleton',
        counts_as_dial: true,
        counts_as_contact: true,
        counts_as_post_meeting_outcome: false,
        materialization_status: 'operator_task',
        resolved_owner_name: 'Jerami Singleton',
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
    if (requestUrl.includes('/call_tracker_events_owner_context?')) {
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
        active_operator_name: 'Jerami Singleton',
        task_assigned_owner: 'Jerami Singleton',
        counts_as_dial: true,
        counts_as_contact: true,
        counts_as_meeting_set: true,
        counts_as_post_meeting_outcome: false,
        materialization_status: 'operator_task',
        resolved_owner_name: 'Jerami Singleton',
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
    if (requestUrl.includes('/call_tracker_events_owner_context?')) {
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
          active_operator_name: 'Jerami Singleton',
          task_assigned_owner: 'Jerami Singleton',
          counts_as_dial: true,
          counts_as_contact: true,
          counts_as_meeting_set: true,
          counts_as_post_meeting_outcome: false,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Logan Lord',
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

test('/api/call-tracker-data calculates paycheck commission as twenty percent of revenue', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'service-role';
  process.env.SUPABASE_SCHEMA = 'public';
  const closedWonAt = new Date().toISOString();
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/call_tracker_summary?')) {
      return Response.json([
        { dials: 0, contacts: 0, meetings_set: 0, meeting_outcomes_total: 2, closed_won: 2, money_earned_cents: 19900, voicemail_only: 0, appointments_tracked: 0 },
      ]);
    }
    if (requestUrl.includes('/call_tracker_events_owner_context?')) {
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
          active_operator_name: 'Jerami Singleton',
          task_assigned_owner: 'Jerami Singleton',
          counts_as_dial: false,
          counts_as_contact: false,
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Jerami Singleton',
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
          active_operator_name: 'Jerami Singleton',
          task_assigned_owner: 'Jerami Singleton',
          counts_as_dial: false,
          counts_as_contact: false,
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Jerami Singleton',
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
  assert.equal(payload.data.ui.summaryCards.closedWon, 1);
  assert.equal(payload.data.ui.closedWonRows.length, 1);
  assert.equal(payload.data.ui.closedWonRows[0].athlete_name, 'Commission Athlete');
  assert.equal(
    payload.data.events.some((row: { athlete_name?: string }) => row.athlete_name === 'Failed Payment Athlete'),
    false,
  );
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
    if (requestUrl.includes('/call_tracker_events_owner_context?')) {
      return Response.json([
        {
          athlete_name: 'Meeting Athlete',
          occurred_at: '2026-05-29T15:00:00+00:00',
          event_at: '2026-05-29T15:00:00+00:00',
          reporting_at: '2026-05-29T15:00:00+00:00',
          reporting_date_et: '2026-05-29',
          tracker_outcome: 'meeting_set',
          raw_crm_stage: 'Meeting Set',
          raw_task_status: 'confirmation_call',
          raw_event_type: 'lifecycle_meeting_set',
          source: 'call_tracker_events_owner_context',
          appointment_id: 'appt-1',
          booked_event_title: 'Meeting Athlete Football 2027 TX',
          active_operator_name: 'Jerami Singleton',
          task_assigned_owner: 'Jerami Singleton',
          counts_as_meeting_set: true,
          counts_as_post_meeting_outcome: false,
          materialization_status: 'operator_task',
          materialization_reason: 'task_assigned_owner_matches_active_operator',
          resolved_owner_name: 'Jerami Singleton',
          resolved_owner_source_field: 'task.assigned_owner',
          can_materialize_for_active_operator: true,
          created_at: '2026-05-29T14:50:00+00:00',
        },
        {
          athlete_name: 'Call Only Athlete',
          occurred_at: '2026-05-29T16:00:00+00:00',
          event_at: '2026-05-29T16:00:00+00:00',
          tracker_outcome: 'spoke_follow_up',
          raw_crm_stage: 'Spoke to - Follow Up',
          raw_task_status: 'Spoke to - Follow Up',
          raw_event_type: 'call_activity',
          source: 'call_activity',
          materialization_status: 'operator_task',
          created_at: '2026-05-29T16:00:00+00:00',
        },
        {
          athlete_name: 'Won Athlete',
          occurred_at: '2026-05-29T17:00:00+00:00',
          event_at: '2026-05-29T17:00:00+00:00',
          tracker_outcome: 'closed_won',
          raw_crm_stage: 'Closed Won',
          raw_task_status: 'Closed Won',
          raw_event_type: 'meeting_result',
          source: 'call_tracker_events_owner_context',
          appointment_id: 'appt-won',
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          created_at: '2026-05-29T17:00:00+00:00',
        },
        {
          athlete_name: 'Lost Athlete',
          occurred_at: '2026-05-29T18:00:00+00:00',
          event_at: '2026-05-29T18:00:00+00:00',
          tracker_outcome: 'closed_lost',
          raw_crm_stage: 'Closed Lost',
          raw_task_status: 'Closed Lost',
          raw_event_type: 'meeting_result',
          source: 'call_tracker_events_owner_context',
          appointment_id: 'appt-lost',
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          created_at: '2026-05-29T18:00:00+00:00',
        },
        {
          athlete_name: 'Follow Up Athlete',
          occurred_at: '2026-05-29T19:00:00+00:00',
          event_at: '2026-05-29T19:00:00+00:00',
          tracker_outcome: 'actual_meeting_follow_up',
          raw_crm_stage: 'Actual Meeting - Follow Up',
          raw_task_status: 'Actual Meeting - Follow Up',
          raw_event_type: 'meeting_result',
          source: 'call_tracker_events_owner_context',
          appointment_id: 'appt-follow-up',
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          created_at: '2026-05-29T19:00:00+00:00',
        },
        {
          athlete_name: 'No Show Athlete',
          occurred_at: '2026-05-29T20:00:00+00:00',
          event_at: '2026-05-29T20:00:00+00:00',
          tracker_outcome: 'no_show',
          raw_crm_stage: 'No Show',
          raw_task_status: 'No Show',
          raw_event_type: 'meeting_result',
          source: 'call_tracker_events_owner_context',
          appointment_id: 'appt-no-show',
          counts_as_meeting_set: false,
          counts_as_post_meeting_outcome: true,
          materialization_status: 'operator_task',
          created_at: '2026-05-29T20:00:00+00:00',
        },
      ]);
    }
    if (requestUrl.includes('/active_athlete_meeting_truth?')) {
      return Response.json([
        {
          athlete_name: 'Current Athlete',
          crm_stage: 'Meeting Set',
          task_status: 'confirmation_call',
          operator_owner: 'Jerami Singleton',
          current_head_scout: 'Ryan Lietz',
          current_appointment_id: 'current-appt-1',
          resolved_appointment_id: 'current-appt-1',
          current_source_event_id: 'event-current-1',
          current_starts_at: '2026-05-30T15:00:00+00:00',
          current_meeting_timezone: 'America/New_York',
          current_meeting_timezone_label: 'EST',
          current_appointment_status: 'scheduled',
          current_appointment_role: 'initial_set',
          resolution_source: 'current_appointment_pointer',
          pipeline_updated_at: '2026-05-29T13:00:00+00:00',
          appointment_updated_at: '2026-05-29T13:00:00+00:00',
        },
      ]);
    }
    if (requestUrl.includes('/athlete_lifecycle_timeline?')) {
      return Response.json([
        {
          lifecycle_event_id: 'life-1',
          athlete_key: 'athlete-1',
          athlete_id: '1490001',
          athlete_main_id: '953001',
          athlete_name: 'Lifecycle Athlete',
          event_type: 'meeting_set',
          raw_crm_stage: 'Meeting Set',
          raw_task_status: 'confirmation_call',
          normalized_stage: 'meeting_set',
          operator_status: 'active_meeting_queue',
          meeting_lifecycle: 'scheduled',
          pipeline_bucket: 'active_meeting',
          next_action: 'await_meeting_result',
          is_active_or_monitoring: true,
          is_terminal: false,
          indicates_showed: false,
          counts_as_enrollment: false,
          appointment_id: 'appt-life',
          event_title: 'Lifecycle Athlete Soccer 2026 GA',
          operator_owner: 'Jerami Singleton',
          head_scout: 'Ryan Lietz',
          event_source: 'lifecycle_meeting_set',
          revenue_cents: null,
          payload_json: {
            materialization_status: 'operator_task',
            active_operator_name: 'Jerami Singleton',
            task_assigned_owner: 'Jerami Singleton',
          },
          event_at: '2026-05-29T13:00:00+00:00',
        },
        {
          lifecycle_event_id: 'life-2',
          athlete_key: 'athlete-2',
          athlete_id: '1490002',
          athlete_main_id: '953002',
          athlete_name: 'Lifecycle Call Athlete',
          event_type: 'call_activity',
          raw_crm_stage: 'Spoke to - Follow Up',
          raw_task_status: 'Call Attempt 1',
          normalized_stage: 'meeting_follow_up',
          operator_status: 'awaiting_follow_up',
          meeting_lifecycle: 'follow_up_due',
          pipeline_bucket: 'awaiting_update',
          next_action: 'follow_up_for_result',
          is_active_or_monitoring: true,
          is_terminal: false,
          indicates_showed: true,
          counts_as_enrollment: false,
          appointment_id: null,
          event_title: null,
          operator_owner: 'Jerami Singleton',
          head_scout: null,
          event_source: 'lifecycle_events',
          revenue_cents: null,
          payload_json: {},
          event_at: '2026-05-29T12:00:00+00:00',
        },
      ]);
    }
    return Response.json({ error: requestUrl }, { status: 404 });
  };

  const response = await meetingReadbackDataGET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  const payload = await response.json();
  assert.equal(payload.contract, 'prospect-meetings-readback');
  assert.equal(payload.data.summary.trueMeetingsSet, 4);
  assert.equal(payload.data.summary.showedResulted, 3);
  assert.equal(payload.data.summary.showRate, 75);
  assert.equal(payload.data.summary.closedWon, 1);
  assert.equal(payload.data.summary.closedLost, 1);
  assert.equal(payload.data.summary.followUp, 1);
  assert.equal(payload.data.summary.noShowCanceled, 1);
  assert.equal(payload.data.summary.meetingsSet, 4);
  assert.equal(payload.data.summary.needsReview, 0);
  assert.equal(payload.data.meetings.length, 6);
  assert.equal(payload.data.meetings[0].athleteName, 'Current Athlete');
  assert.equal(payload.data.meetings[0].meetingStatus, 'Meeting Set');
  assert.equal(payload.data.meetings[0].proof, 'Verified For Me');
  assert.equal(payload.data.lifecycle.length, 2);
  assert.equal(payload.data.lifecycle[0].lifecycleEvent, 'Meeting Set');
  assert.equal(payload.data.lifecycle[0].athleteName, 'Lifecycle Athlete');
  assert.equal(payload.data.lifecycle[0].pipelineBucket, 'active_meeting');
  assert.equal(payload.data.lifecycle[0].source, 'athlete_lifecycle_timeline');
  assert.equal(payload.data.supabaseReads.activeMeetingView, 'active_athlete_meeting_truth');
  assert.equal(payload.data.supabaseReads.lifecycleView, 'athlete_lifecycle_timeline');
  assert.equal(
    payload.data.meetings.some((row: { athleteName?: string }) => row.athleteName === 'Call Only Athlete'),
    false,
  );
  assert.equal(payload.data.generatedAt.endsWith('Z'), true);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].init?.headers?.['Authorization' as keyof HeadersInit], 'Bearer service-role');
  assert.equal(calls.every((call) => call.init?.cache === 'no-store'), true);
});
