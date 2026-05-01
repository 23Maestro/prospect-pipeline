#!/usr/bin/env node

import fetch from 'node-fetch';
import { resolveCallTrackerOwnership } from './call-tracker-ownership.mjs';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const TRACKED_OWNER_NAME = process.env.CALL_TRACKER_OWNER || 'Jerami Singleton';
const DRY_RUN = process.argv.includes('--dry-run');
const {
  projectRef,
  url: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  schema: SUPABASE_SCHEMA,
} = resolveSupabaseCredentials();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials for call event owner repair.');
  process.exit(1);
}

if (projectRef && !SUPABASE_URL.includes(projectRef)) {
  console.error(`Supabase URL ${SUPABASE_URL} does not match linked project ref ${projectRef}.`);
  process.exit(1);
}

async function apiFetch(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_BASE}${pathname}`, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${pathname} -> HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Accept-Profile': SUPABASE_SCHEMA,
      'Content-Profile': SUPABASE_SCHEMA,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${pathname} failed: ${response.status} ${text.slice(0, 300)}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function fetchAthleteTasks(row) {
  const payload = await apiFetch('/tasks/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: row.athlete_id,
      athlete_main_id: row.athlete_main_id,
    }),
  });
  return Array.isArray(payload.tasks) ? payload.tasks : [];
}

async function fetchAthleteProfile(row) {
  return apiFetch(`/athlete/${encodeURIComponent(row.athlete_id)}/resolve?force_refresh=true`);
}

async function fetchAthleteBookedMeetings(row) {
  const payload = await apiFetch(
    `/calendar/athlete-booked-meetings?athlete_id=${encodeURIComponent(row.athlete_id)}&athlete_main_id=${encodeURIComponent(row.athlete_main_id)}`,
  );
  return Array.isArray(payload.events) ? payload.events : [];
}

function findBookedMeeting(row, meetings) {
  const liveEventId = String(row.live_event_id || '').trim();
  const appointmentId = String(row.appointment_id || '').trim();
  const title = String(row.booked_event_title || '').trim().toLowerCase();
  return (
    meetings.find((event) => liveEventId && String(event?.event_id || '').trim() === liveEventId) ||
    meetings.find((event) => appointmentId && String(event?.event_id || '').trim() === appointmentId) ||
    meetings.find((event) => title && String(event?.title || '').trim().toLowerCase() === title) ||
    null
  );
}

const rows = await supabaseRequest(
  [
    'call_events?select=id,athlete_key,athlete_id,athlete_main_id,athlete_name,appointment_id,live_event_id,booked_event_title,source_owner,owner_proof,is_tracked_owner,payload_json',
    'or=(source_owner.is.null,source_owner.eq.,owner_proof.is.null,owner_proof.eq.)',
    'order=occurred_at.desc',
    'limit=1000',
  ].join('&'),
);

const repairs = [];
const failures = [];

for (const row of Array.isArray(rows) ? rows : []) {
  try {
    const tasks = await fetchAthleteTasks(row);
    let owner;
    try {
      owner = resolveCallTrackerOwnership({
        trackedOwnerName: TRACKED_OWNER_NAME,
        athleteId: row.athlete_id,
        athleteMainId: row.athlete_main_id,
        athleteName: row.athlete_name,
        tasks,
        appointmentId: row.appointment_id,
        liveEventId: row.live_event_id,
      });
    } catch (taskOnlyError) {
      const [resolvedProfile, bookedMeetings] = await Promise.all([
        fetchAthleteProfile(row),
        fetchAthleteBookedMeetings(row),
      ]);
      const bookedMeeting = findBookedMeeting(row, bookedMeetings);
      owner = resolveCallTrackerOwnership({
        trackedOwnerName: TRACKED_OWNER_NAME,
        athleteId: row.athlete_id,
        athleteMainId: row.athlete_main_id,
        athleteName: row.athlete_name,
        tasks,
        bookedMeeting,
        resolvedProfile,
        appointmentId: row.appointment_id,
        liveEventId: row.live_event_id,
      });
    }
    repairs.push({
      id: row.id,
      athlete_name: row.athlete_name,
      source_owner: owner.sourceOwner,
      owner_proof: owner.ownerProof,
      is_tracked_owner: owner.isTrackedOwner,
    });
  } catch (error) {
    failures.push({
      id: row.id,
      athlete_name: row.athlete_name,
      athlete_id: row.athlete_id,
      athlete_main_id: row.athlete_main_id,
      appointment_id: row.appointment_id,
      live_event_id: row.live_event_id,
      booked_event_title: row.booked_event_title,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (failures.length) {
  console.error(JSON.stringify({ failures }, null, 2));
  throw new Error(`Owner repair failed before writes: ${failures.length} unresolved row(s)`);
}

if (!DRY_RUN) {
  for (const repair of repairs) {
    await supabaseRequest(`call_events?id=eq.${encodeURIComponent(repair.id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        source_owner: repair.source_owner,
        owner_proof: repair.owner_proof,
        is_tracked_owner: repair.is_tracked_owner,
      }),
    });
  }
}

console.log(
  JSON.stringify(
    {
      dryRun: DRY_RUN,
      inspected: Array.isArray(rows) ? rows.length : 0,
      repaired: repairs.length,
      repairs,
    },
    null,
    2,
  ),
);
