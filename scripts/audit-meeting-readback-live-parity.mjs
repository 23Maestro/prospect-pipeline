#!/usr/bin/env node

import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const EVENT_LIMIT = Number(process.env.MEETING_READBACK_EVENT_LIMIT || 1000);
const credentials = resolveSupabaseCredentials();
const activeAppointmentStatuses = new Set([
  'scheduled',
  'rescheduled',
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

function activeCanonicalAppointments(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => activeAppointmentStatuses.has(row.status));
}

function keySet(rows, keyFn) {
  return new Set(rows.map(keyFn).map((value) => String(value || '').trim()).filter(Boolean));
}

export function summarizeCanonicalCoverage({ activeRows, lifecycleRows }) {
  const activeAppointmentIds = keySet(activeRows, (row) => row.id);
  const lifecycleIds = keySet(lifecycleRows, (row) => row.id);
  return {
    activeMeetings: {
      source: 'appointments',
      rows: activeRows.length,
      appointmentIds: activeAppointmentIds.size,
      canonical: true,
    },
    lifecycle: {
      source: 'lifecycle_events',
      rows: lifecycleRows.length,
      lifecycleEventIds: lifecycleIds.size,
      canonical: true,
    },
  };
}

export async function runAudit() {
  const [appointmentRows, lifecycleRows] = await Promise.all([
    supabaseGet(`appointments?select=id,athlete_key,status,starts_at,updated_at&status=in.(${[...activeAppointmentStatuses].join(',')})&order=updated_at.desc&limit=${EVENT_LIMIT}`),
    supabaseGet('lifecycle_events?select=id,athlete_key,event_type,crm_stage,task_status,payload_json,created_at&order=created_at.desc&limit=1000'),
  ]);
  const safeAppointmentRows = Array.isArray(appointmentRows) ? appointmentRows : [];
  const safeLifecycleRows = Array.isArray(lifecycleRows) ? lifecycleRows : [];
  const activeRows = activeCanonicalAppointments(safeAppointmentRows);
  const newLifecycleRows = safeLifecycleRows.filter(isLifecycleMeetingRow);
  return summarizeCanonicalCoverage({
    activeRows,
    lifecycleRows: newLifecycleRows,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await runAudit(), null, 2));
}
