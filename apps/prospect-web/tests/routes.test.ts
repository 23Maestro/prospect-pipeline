import assert from 'node:assert/strict';
import test from 'node:test';
import { GET as callTrackerDataGET } from '../app/api/call-tracker-data/route';
import { DELETE, GET, POST } from '../app/api/call-tracker-sync/route';
import { GET as healthGET } from '../app/api/health/route';
import { GET as setMeetingsGET } from '../app/api/set-meetings/route';

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
  assert.equal(payload.data.events[0].athlete_name, 'Live Athlete');
  assert.equal(payload.data.supabaseReads.eventView, 'call_tracker_events_owner_context');
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

test('/api/set-meetings is only a Vercel adapter for the FastAPI command contract', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      success: true,
      week_start: '2026-04-27',
      week_end: '2026-05-04',
      count: 1,
      raw_booked_count: 60,
      events: [],
    });
  };

  const response = await setMeetingsGET(new Request('https://example.test/api/set-meetings?week=this'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).raw_booked_count, 60);
  assert.match(calls[0].url, /^https:\/\/tailnet\.example\/api\/v1\/mobile\/set-meetings\?/);
  assert.equal(calls[0].url.includes('/api/v1/mobile/calendar/booked-meetings'), false);
  assert.equal(calls[0].url.includes('task_range=thisWeek'), true);
});
