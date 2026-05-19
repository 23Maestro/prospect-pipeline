import assert from 'node:assert/strict';
import test from 'node:test';
import { GET as callTrackerDataGET } from '../app/api/call-tracker-data/route';
import { DELETE, GET, POST } from '../app/api/call-tracker-sync/route';
import { GET as healthGET } from '../app/api/health/route';
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
        { ...base, source: 'scout_tasks_current_pipeline', raw_task_status: 'confirmation_call', dedupe_key: 'meeting_set:1490749:952575:588133' },
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
  assert.equal(payload.data.summary.dials, 1);
  assert.equal(payload.data.summary.contacts, 1);
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
        { dials: 0, contacts: 0, meetings_set: 0, meeting_outcomes_total: 1, closed_won: 1, money_earned_cents: 10000, voicemail_only: 0, appointments_tracked: 0 },
      ]);
    }
    if (requestUrl.includes('/call_tracker_events_owner_context?')) {
      return Response.json([
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
});
