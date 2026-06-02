#!/usr/bin/env node

import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const EVENT_LIMIT = Number(process.env.MEETING_READBACK_EVENT_LIMIT || 1000);
const credentials = resolveSupabaseCredentials();
const activeAppointmentStatuses = new Set([
  'scheduled',
  'rescheduled',
  'reschedule_pending',
  'confirmation_queued',
  'confirmation_sent',
]);

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeLifecycleText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/[.,:]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function classifyLifecycleStage(row) {
  const text = normalizeLifecycleText(row.crm_stage || row.task_status || row.event_type);
  if (text === 'new opportunity') return 'new_opportunity';
  if (
    [
      'left voice mail 1',
      'left voicemail 1',
      'left voice mail 2',
      'left voicemail 2',
      'never spoke to',
      'called unable to leave vm',
      'unable to leave vm',
      'spoke to athlete not parent',
      'athlete not parent',
    ].includes(text)
  ) {
    return 'call_attempt';
  }
  if (text.includes('closed won') || text.includes('close won')) return 'closed_won';
  if (text.includes('closed lost') || text.includes('close lost')) return 'closed_lost';
  if (
    text.includes('inactive') ||
    text.includes('dead lead') ||
    text.includes('archived') ||
    text.includes('not interested') ||
    text.includes('too young')
  ) {
    return 'inactive';
  }
  if (text.includes('no show') || text.includes('noshow')) return 'no_show';
  if (
    text.includes('reschedule pending') ||
    text.includes('rescheduled pending') ||
    text.includes('meeting result res pending') ||
    text.includes('meeting result canceled') ||
    text.includes('actual meeting canceled')
  ) {
    return 'reschedule_pending';
  }
  if (text.includes('meeting result rescheduled') || text.includes('actual meeting rescheduled') || text === 'rescheduled') {
    return 'rescheduled';
  }
  if (text === 'meeting set') return 'meeting_set';
  if (
    text.includes('actual meeting follow up') ||
    text.includes('spoke to i need to follow up') ||
    text.includes('spoke to follow up') ||
    text.includes('meeting follow up') ||
    text.includes('follow up') ||
    text.includes('follow-up') ||
    text.includes('awaiting close') ||
    text.includes('close pending')
  ) {
    return 'meeting_follow_up';
  }
  const payloadOutcome = normalizeLifecycleText(row.payload_json?.tracker_outcome);
  return payloadOutcome ? payloadOutcome.replace(/\s+/g, '_') : 'unknown';
}

function isLifecycleMeetingRow(row) {
  const normalizedStage = classifyLifecycleStage(row);
  const body = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json) ? row.payload_json : {};
  const values = [
    row.event_type,
    row.crm_stage,
    row.task_status,
    normalizedStage,
    body.tracker_outcome,
    body.appointment_id,
    body.booked_event_id,
    body.source_event_id,
    body.booked_event_title,
    body.meeting_name,
    body.task_title,
  ].map(normalizeKey).join(' ');
  if (values.includes('meeting')) return true;
  if (values.includes('closed_won') || values.includes('closed_lost')) return true;
  if (values.includes('no_show') || values.includes('canceled') || values.includes('cancelled')) return true;
  if (values.includes('reschedule')) return true;
  return Boolean(body.appointment_id || body.booked_event_id);
}

function isCurrentMeetingLifecycle(row) {
  return ['meeting_set', 'rescheduled', 'reschedule_pending'].includes(classifyLifecycleStage(row));
}

function lifecycleAppointmentId(row) {
  const body = row?.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json) ? row.payload_json : {};
  return String(body.appointment_id || body.booked_event_id || '').trim();
}

async function supabaseGet(path) {
  if (!credentials.url || !credentials.serviceRoleKey) {
    throw new Error('Missing Supabase credentials for meeting readback parity audit.');
  }
  const response = await fetch(`${credentials.url}/rest/v1/${path}`, {
    headers: {
      apikey: credentials.serviceRoleKey,
      Authorization: `Bearer ${credentials.serviceRoleKey}`,
      'Accept-Profile': credentials.schema,
    },
  });
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function latestActiveAppointments(rows) {
  const latest = new Map();
  for (const row of rows) {
    if (!activeAppointmentStatuses.has(row.status)) continue;
    const athleteKey = String(row.athlete_key || '').trim();
    if (!athleteKey || latest.has(athleteKey)) continue;
    latest.set(athleteKey, row);
  }
  return [...latest.values()];
}

function currentMeetingsFromLifecycle(appointmentRows, lifecycleRows) {
  const appointmentById = new Map();
  const latestByAthlete = new Map();
  for (const row of appointmentRows) {
    if (!activeAppointmentStatuses.has(row.status)) continue;
    const appointmentId = String(row.id || '').trim();
    if (appointmentId) appointmentById.set(appointmentId, row);
    const athleteKey = String(row.athlete_key || '').trim();
    if (!athleteKey || latestByAthlete.has(athleteKey)) continue;
    latestByAthlete.set(athleteKey, row);
  }

  const latestLifecycleByAthlete = new Map();
  for (const row of lifecycleRows) {
    const athleteKey = String(row.athlete_key || '').trim();
    if (!athleteKey || latestLifecycleByAthlete.has(athleteKey)) continue;
    latestLifecycleByAthlete.set(athleteKey, row);
  }

  return [...latestLifecycleByAthlete.values()]
    .filter(isCurrentMeetingLifecycle)
    .map((row) => {
      const appointmentId = lifecycleAppointmentId(row);
      return appointmentById.get(appointmentId) || latestByAthlete.get(String(row.athlete_key || '').trim()) || {
        id: appointmentId,
        athlete_key: row.athlete_key,
      };
    });
}

function keySet(rows, keyFn) {
  return new Set(rows.map(keyFn).map((value) => String(value || '').trim()).filter(Boolean));
}

function diffSets(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

export function summarizeParity({ oldActiveRows, newActiveRows, oldLifecycleRows, newLifecycleRows }) {
  const oldActiveAppointmentIds = keySet(oldActiveRows, (row) => row.resolved_appointment_id || row.current_appointment_id);
  const newActiveAppointmentIds = keySet(newActiveRows, (row) => row.id);
  const oldLifecycleIds = keySet(oldLifecycleRows, (row) => row.lifecycle_event_id);
  const newLifecycleIds = keySet(newLifecycleRows, (row) => row.id);
  const activeMissingInNew = diffSets(oldActiveAppointmentIds, newActiveAppointmentIds);
  const activeExtraInNew = diffSets(newActiveAppointmentIds, oldActiveAppointmentIds);
  const lifecycleMissingInNew = diffSets(oldLifecycleIds, newLifecycleIds);
  const lifecycleExtraInNew = diffSets(newLifecycleIds, oldLifecycleIds);

  return {
    activeMeetings: {
      oldSource: 'active_athlete_meeting_truth',
      newSource: 'appointments',
      oldRows: oldActiveRows.length,
      newRows: newActiveRows.length,
      missingInNew: activeMissingInNew.length,
      extraInNew: activeExtraInNew.length,
      sampleMissingInNew: activeMissingInNew.slice(0, 10),
      sampleExtraInNew: activeExtraInNew.slice(0, 10),
      parity: activeMissingInNew.length === 0 && activeExtraInNew.length === 0,
    },
    lifecycle: {
      oldSource: 'athlete_lifecycle_timeline',
      newSource: 'lifecycle_events',
      oldRows: oldLifecycleRows.length,
      newRows: newLifecycleRows.length,
      missingInNew: lifecycleMissingInNew.length,
      extraInNew: lifecycleExtraInNew.length,
      sampleMissingInNew: lifecycleMissingInNew.slice(0, 10),
      sampleExtraInNew: lifecycleExtraInNew.slice(0, 10),
      parity: lifecycleMissingInNew.length === 0 && lifecycleExtraInNew.length === 0,
    },
  };
}

export async function runAudit() {
  const [oldActiveRows, appointmentRows, oldLifecycleRows, lifecycleRows] = await Promise.all([
    supabaseGet(`active_athlete_meeting_truth?select=athlete_key,current_appointment_id,resolved_appointment_id,current_starts_at&order=current_starts_at.asc&limit=${EVENT_LIMIT}`),
    supabaseGet(`appointments?select=id,athlete_key,status,starts_at,updated_at&status=in.(${[...activeAppointmentStatuses].join(',')})&order=updated_at.desc&limit=${EVENT_LIMIT}`),
    supabaseGet(`athlete_lifecycle_timeline?select=lifecycle_event_id,athlete_key,event_type,event_at&order=event_at.desc&limit=${EVENT_LIMIT}`),
    supabaseGet('lifecycle_events?select=id,athlete_key,event_type,crm_stage,task_status,payload_json,created_at&order=created_at.desc&limit=1000'),
  ]);
  const safeAppointmentRows = Array.isArray(appointmentRows) ? appointmentRows : [];
  const safeLifecycleRows = Array.isArray(lifecycleRows) ? lifecycleRows : [];
  const newActiveRows = currentMeetingsFromLifecycle(safeAppointmentRows, safeLifecycleRows);
  const newLifecycleRows = safeLifecycleRows.filter(isLifecycleMeetingRow);
  return summarizeParity({
    oldActiveRows: Array.isArray(oldActiveRows) ? oldActiveRows : [],
    newActiveRows,
    oldLifecycleRows: Array.isArray(oldLifecycleRows) ? oldLifecycleRows : [],
    newLifecycleRows,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await runAudit(), null, 2));
}
