#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const credentials = resolveSupabaseCredentials(repoRoot);
const PAGE_SIZE = Number(process.env.APPOINTMENT_TRUTH_BACKFILL_PAGE_SIZE || 1000);
const API_BASE = String(process.env.API_BASE || 'http://127.0.0.1:8000/api/v1').replace(/\/+$/, '');
const writeMode = process.argv.includes('--write');
const skipLiveTimezoneLookup = process.argv.includes('--skip-live-timezones');
const dryRun = !writeMode;

if (!credentials.url || !credentials.serviceRoleKey) {
  throw new Error('Missing Supabase credentials for appointment truth backfill.');
}

function clean(value) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function normalizeIsoValue(value) {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
}

const IANA_TO_LABEL = {
  'America/New_York': 'EST',
  'America/Detroit': 'EST',
  'America/Indiana/Indianapolis': 'EST',
  'America/Kentucky/Louisville': 'EST',
  'America/Chicago': 'CST',
  'America/Indiana/Knox': 'CST',
  'America/Menominee': 'CST',
  'America/North_Dakota/Beulah': 'CST',
  'America/North_Dakota/Center': 'CST',
  'America/North_Dakota/New_Salem': 'CST',
  'America/Denver': 'MST',
  'America/Boise': 'MST',
  'America/Phoenix': 'MST',
  'America/Los_Angeles': 'PST',
  'America/Anchorage': 'AKST',
  'America/Halifax': 'AST',
  'America/Puerto_Rico': 'AST',
};

const LEGACY_LABEL_TO_IANA = {
  EST: 'America/New_York',
  EDT: 'America/New_York',
  ET: 'America/New_York',
  EASTERN: 'America/New_York',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  CT: 'America/Chicago',
  CENTRAL: 'America/Chicago',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  MT: 'America/Denver',
  MOUNTAIN: 'America/Denver',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  PT: 'America/Los_Angeles',
  PACIFIC: 'America/Los_Angeles',
  AKST: 'America/Anchorage',
  AKDT: 'America/Anchorage',
  AST: 'America/Puerto_Rico',
};

export function normalizeMeetingTimezone(value) {
  const trimmed = clean(value);
  if (!trimmed) return null;
  if (['SELECT RECRUIT TIME ZONE', 'SELECT TIME ZONE', 'SELECT TIMEZONE'].includes(trimmed.toUpperCase())) {
    return null;
  }
  return LEGACY_LABEL_TO_IANA[trimmed.toUpperCase()] || trimmed;
}

export function resolveTimezoneLabel(timezone, fallbackLabel = null) {
  const normalizedTimezone = normalizeMeetingTimezone(timezone);
  const normalizedFallback = clean(fallbackLabel)?.toUpperCase() || null;
  const resolvedFromTimezone = IANA_TO_LABEL[normalizedTimezone] || null;
  if (normalizedFallback && (!resolvedFromTimezone || normalizedFallback === resolvedFromTimezone)) {
    return normalizedFallback;
  }
  return resolvedFromTimezone || normalizedFallback;
}

function loadOwnerDirectory() {
  const raw = readFileSync(resolve(repoRoot, 'config/prospect-id-owners.json'), 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.owners) ? parsed.owners : [];
}

export function normalizeOwnerName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function resolveOwnerByName(owners, value) {
  const normalized = normalizeOwnerName(value);
  if (!normalized) return null;
  return (
    owners.find((owner) =>
      [owner.personName, ...(Array.isArray(owner.aliases) ? owner.aliases : [])].some(
        (alias) => normalizeOwnerName(alias) === normalized,
      ),
    ) || null
  );
}

function headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    apikey: credentials.serviceRoleKey,
    Authorization: `Bearer ${credentials.serviceRoleKey}`,
    'Accept-Profile': credentials.schema,
    'Content-Profile': credentials.schema,
    ...extra,
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${credentials.url.replace(/\/+$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: headers(options.headers || {}),
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getPaged(table, select, extra = '') {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query = [
      `select=${encodeURIComponent(select)}`,
      `limit=${PAGE_SIZE}`,
      `offset=${offset}`,
      extra,
    ].filter(Boolean).join('&');
    const page = await request(`${table}?${query}`, { method: 'GET' });
    rows.push(...(Array.isArray(page) ? page : []));
    if (!Array.isArray(page) || page.length < PAGE_SIZE) return rows;
  }
}

function payloadRecord(row) {
  return row?.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json)
    ? row.payload_json
    : {};
}

function firstPayloadValue(payload, keys) {
  for (const key of keys) {
    const value = clean(payload[key]);
    if (value) return value;
  }
  const ownerContext = payload.owner_context && typeof payload.owner_context === 'object'
    ? payload.owner_context
    : {};
  for (const key of keys) {
    const value = clean(ownerContext[key]);
    if (value) return value;
  }
  return null;
}

function appointmentIdsForLifecycleEvent(row) {
  const payload = payloadRecord(row);
  return [
    payload.appointment_id,
    payload.current_appointment_id,
    payload.booked_event_id,
    payload.live_event_id,
    payload.open_event_id,
  ].map(clean).filter(Boolean);
}

function sortNewestEvents(left, right) {
  return Date.parse(right.created_at || '') - Date.parse(left.created_at || '');
}

function buildLifecycleIndexes(lifecycleRows) {
  const byAppointment = new Map();
  const byAthlete = new Map();
  for (const row of lifecycleRows) {
    for (const id of appointmentIdsForLifecycleEvent(row)) {
      const rows = byAppointment.get(id) || [];
      rows.push(row);
      byAppointment.set(id, rows);
    }
    const athleteKey = clean(row.athlete_key);
    if (athleteKey) {
      const rows = byAthlete.get(athleteKey) || [];
      rows.push(row);
      byAthlete.set(athleteKey, rows);
    }
  }
  for (const rows of byAppointment.values()) rows.sort(sortNewestEvents);
  for (const rows of byAthlete.values()) rows.sort(sortNewestEvents);
  return { byAppointment, byAthlete };
}

function newestRelevantEvent(appointment, lifecycleIndexes) {
  return (
    lifecycleIndexes.byAppointment.get(appointment.id)?.[0] ||
    lifecycleIndexes.byAthlete.get(appointment.athlete_key)?.[0] ||
    null
  );
}

function statusImpliesPostMeeting(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['closed_won', 'closed_lost', 'no_show', 'canceled'].includes(normalized);
}

function isActiveAppointmentStatus(status) {
  return [
    'scheduled',
    'rescheduled',
    'reschedule_pending',
    'confirmation_queued',
    'confirmation_sent',
  ].includes(String(status || '').trim().toLowerCase());
}

export function inferAppointmentRole(appointment, event = null) {
  const eventType = clean(event?.event_type);
  if (eventType === 'meeting_set') return 'initial_set';
  if (eventType === 'rescheduled') return 'reschedule';
  if (eventType === 'confirmation_queued' || eventType === 'confirmation_sent') return 'confirmation';
  if (statusImpliesPostMeeting(appointment.status)) return 'post_meeting_outcome';
  if (clean(appointment.previous_appointment_id)) return 'reschedule';
  if (clean(appointment.status) === 'rescheduled') return 'reschedule';
  if (clean(appointment.status) === 'scheduled') return 'initial_set';
  return 'unknown';
}

function buildAppointmentGroups(appointments) {
  const byAthlete = new Map();
  const byId = new Map();
  for (const appointment of appointments) {
    byId.set(appointment.id, appointment);
    const rows = byAthlete.get(appointment.athlete_key) || [];
    rows.push(appointment);
    byAthlete.set(appointment.athlete_key, rows);
  }
  for (const rows of byAthlete.values()) {
    rows.sort((left, right) => {
      const leftTime = Date.parse(left.starts_at || left.updated_at || '');
      const rightTime = Date.parse(right.starts_at || right.updated_at || '');
      return leftTime - rightTime;
    });
  }
  return { byAthlete, byId };
}

function resolveRelatedAppointmentTimezone(appointment, appointmentGroups) {
  const rows = appointmentGroups.byAthlete.get(appointment.athlete_key) || [];
  const candidates = rows
    .filter((row) => row.id !== appointment.id && normalizeMeetingTimezone(row.meeting_timezone))
    .map((row) => {
      const currentTime = Date.parse(appointment.starts_at || appointment.updated_at || '');
      const rowTime = Date.parse(row.starts_at || row.updated_at || '');
      const distance =
        Number.isFinite(currentTime) && Number.isFinite(rowTime)
          ? Math.abs(currentTime - rowTime)
          : Number.MAX_SAFE_INTEGER;
      return { row, distance };
    })
    .sort((left, right) => left.distance - right.distance);
  return candidates[0]?.row || null;
}

function inferPreviousAppointment(appointment, appointmentGroups) {
  const rows = appointmentGroups.byAthlete.get(appointment.athlete_key) || [];
  const currentTime = Date.parse(appointment.starts_at || appointment.updated_at || '');
  const priorRows = rows.filter((row) => {
    if (row.id === appointment.id) return false;
    const rowTime = Date.parse(row.starts_at || row.updated_at || '');
    return Number.isFinite(currentTime) && Number.isFinite(rowTime) && rowTime < currentTime;
  });
  if (priorRows.length === 1) return priorRows[0];
  if (priorRows.length > 1) return { ambiguous: true, candidateIds: priorRows.map((row) => row.id) };
  return null;
}

function buildSourcePayloadPatch(existingPayload, sources) {
  return {
    ...(existingPayload && typeof existingPayload === 'object' && !Array.isArray(existingPayload)
      ? existingPayload
      : {}),
    appointment_truth_backfill: {
      source_system: 'repair',
      sources: [...new Set(sources)].sort(),
      repaired_at: new Date().toISOString(),
    },
  };
}

export function buildAppointmentTruthPatches({
  appointments,
  confirmationRows,
  bookedMeetingDetailRows = [],
  contactRows,
  lifecycleRows,
  owners,
}) {
  const confirmationByAppointment = new Map();
  for (const row of confirmationRows) {
    const appointmentId = clean(row.appointment_id);
    if (!appointmentId || confirmationByAppointment.has(appointmentId)) continue;
    confirmationByAppointment.set(appointmentId, row);
  }
  const contactByAthlete = new Map();
  for (const row of contactRows) {
    const athleteKey = clean(row.athlete_key);
    if (!athleteKey || contactByAthlete.has(athleteKey)) continue;
    contactByAthlete.set(athleteKey, row);
  }
  const bookedDetailsByAppointment = new Map();
  for (const row of bookedMeetingDetailRows) {
    const appointmentId = clean(row.appointment_id);
    if (!appointmentId || bookedDetailsByAppointment.has(appointmentId)) continue;
    bookedDetailsByAppointment.set(appointmentId, row);
  }

  const lifecycleIndexes = buildLifecycleIndexes(lifecycleRows);
  const appointmentGroups = buildAppointmentGroups(appointments);
  const patches = [];
  const unrepairable = [];

  for (const appointment of appointments) {
    const patch = {};
    const sources = [];
    const confirmation = confirmationByAppointment.get(appointment.id) || {};
    const bookedDetails = bookedDetailsByAppointment.get(appointment.id) || {};
    const contact = contactByAthlete.get(appointment.athlete_key) || {};
    const event = newestRelevantEvent(appointment, lifecycleIndexes);
    const payload = payloadRecord(event);

    const appointmentTimezone = normalizeMeetingTimezone(appointment.meeting_timezone);
    const confirmationTimezone = normalizeMeetingTimezone(confirmation.meeting_timezone);
    const bookedDetailsTimezone = normalizeMeetingTimezone(bookedDetails.meeting_timezone);
    const contactTimezone = normalizeMeetingTimezone(contact.timezone);
    const relatedTimezoneRow =
      appointmentTimezone || confirmationTimezone || bookedDetailsTimezone || contactTimezone
        ? null
        : resolveRelatedAppointmentTimezone(appointment, appointmentGroups);
    const relatedAppointmentTimezone = normalizeMeetingTimezone(relatedTimezoneRow?.meeting_timezone);
    const meetingTimezone =
      appointmentTimezone ||
      confirmationTimezone ||
      bookedDetailsTimezone ||
      contactTimezone ||
      relatedAppointmentTimezone;
    if (!clean(appointment.meeting_timezone) && meetingTimezone) {
      patch.meeting_timezone = meetingTimezone;
      if (confirmationTimezone) sources.push('set_meeting_confirmation_cache');
      else if (bookedDetailsTimezone) sources.push('booked_meeting_details');
      else if (contactTimezone) sources.push('athlete_contact_cache');
      else sources.push('related_appointment');
    }

    const contactLabelFallback =
      appointmentTimezone || confirmationTimezone || bookedDetailsTimezone
        ? null
        : clean(contact.timezone_label);
    const relatedLabelFallback =
      appointmentTimezone || confirmationTimezone || bookedDetailsTimezone || contactLabelFallback
        ? null
        : clean(relatedTimezoneRow?.meeting_timezone_label);
    const labelFallback = contactLabelFallback || relatedLabelFallback;
    const meetingTimezoneLabel =
      clean(appointment.meeting_timezone_label) ||
      resolveTimezoneLabel(meetingTimezone, labelFallback);
    if (!clean(appointment.meeting_timezone_label) && meetingTimezoneLabel) {
      patch.meeting_timezone_label = meetingTimezoneLabel;
      if (contactLabelFallback) sources.push('athlete_contact_cache');
      else if (relatedLabelFallback) sources.push('related_appointment');
      else sources.push('timezone_label_resolver');
    }

    const operatorOwner =
      clean(appointment.operator_owner) ||
      firstPayloadValue(payload, ['operator_owner', 'active_operator_name', 'operator_name']);
    if (!clean(appointment.operator_owner) && operatorOwner) {
      patch.operator_owner = operatorOwner;
      sources.push('lifecycle_events');
    }

    const operatorOwnerKey =
      clean(appointment.operator_owner_key) ||
      firstPayloadValue(payload, ['operator_owner_key', 'active_operator_key']) ||
      resolveOwnerByName(owners, operatorOwner)?.ownerKey ||
      null;
    if (!clean(appointment.operator_owner_key) && operatorOwnerKey) {
      patch.operator_owner_key = operatorOwnerKey;
      sources.push(operatorOwner ? 'owner_directory' : 'lifecycle_events');
    }

    const headScoutKey = clean(appointment.head_scout_key) || resolveOwnerByName(owners, appointment.head_scout)?.ownerKey || null;
    if (!clean(appointment.head_scout_key) && headScoutKey) {
      patch.head_scout_key = headScoutKey;
      sources.push('owner_directory');
    }

    const role = clean(appointment.appointment_role) || inferAppointmentRole(appointment, event);
    if (!clean(appointment.appointment_role) && role) {
      patch.appointment_role = role;
      sources.push(event ? 'lifecycle_events' : 'appointment_status');
    }

    if (
      !clean(appointment.source_system) &&
      Object.keys(patch).length &&
      (!isActiveAppointmentStatus(appointment.status) || meetingTimezone)
    ) {
      patch.source_system = 'repair';
    }

    if (role === 'initial_set' && !clean(appointment.original_appointment_id)) {
      patch.original_appointment_id = appointment.id;
      patch.reschedule_sequence = 0;
      sources.push('appointment_role');
    }

    if (role === 'reschedule') {
      const explicitPrevious = clean(appointment.previous_appointment_id) || firstPayloadValue(payload, ['previous_appointment_id']);
      let previous = explicitPrevious ? appointmentGroups.byId.get(explicitPrevious) || null : null;
      if (!previous && !explicitPrevious) {
        const inferred = inferPreviousAppointment(appointment, appointmentGroups);
        if (inferred?.ambiguous) {
          unrepairable.push({
            appointment_id: appointment.id,
            athlete_key: appointment.athlete_key,
            reason: 'multiple_plausible_previous_appointments',
            candidate_appointment_ids: inferred.candidateIds,
          });
        } else {
          previous = inferred;
        }
      }
      if (!clean(appointment.previous_appointment_id) && previous?.id) {
        patch.previous_appointment_id = previous.id;
        sources.push(explicitPrevious ? 'lifecycle_events' : 'appointment_sequence');
      }
      const originalId =
        clean(appointment.original_appointment_id) ||
        clean(previous?.original_appointment_id) ||
        clean(previous?.id);
      if (!clean(appointment.original_appointment_id) && originalId) {
        patch.original_appointment_id = originalId;
        sources.push('appointment_sequence');
      }
      const previousSequence = Number(previous?.reschedule_sequence);
      const sequence = Number.isFinite(previousSequence) ? previousSequence + 1 : null;
      if (Number(appointment.reschedule_sequence || 0) === 0 && sequence) {
        patch.reschedule_sequence = sequence;
        sources.push('appointment_sequence');
      }
      if (!previous?.id && !explicitPrevious) {
        const alreadyReported = unrepairable.some(
          (entry) =>
            entry.appointment_id === appointment.id &&
            entry.reason === 'multiple_plausible_previous_appointments',
        );
        if (!alreadyReported) {
          unrepairable.push({
            appointment_id: appointment.id,
            athlete_key: appointment.athlete_key,
            reason: 'reschedule_missing_previous_appointment',
          });
        }
      }
    }

    if (Object.keys(patch).length) {
      patch.source_payload = buildSourcePayloadPatch(appointment.source_payload, sources);
      patches.push({
        appointmentId: appointment.id,
        athleteKey: appointment.athlete_key,
        patch,
        sources: [...new Set(sources)].sort(),
      });
    }
  }

  return { patches, unrepairable };
}

async function patchAppointment(appointmentId, patch) {
  await request(`appointments?id=eq.${encodeURIComponent(appointmentId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

async function apiFetch(pathname) {
  const response = await fetch(`${API_BASE}${pathname}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text.slice(0, 200) || `${pathname} -> HTTP ${response.status}`);
  }
  return text ? JSON.parse(text) : null;
}

function eventDateCandidates(startsAt) {
  const parsed = new Date(clean(startsAt) || '');
  if (Number.isNaN(parsed.getTime())) return [];
  const dates = new Set();
  for (const offsetDays of [0, -1, 1]) {
    dates.add(new Date(parsed.getTime() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return [...dates];
}

function formTimezone(formData) {
  if (!formData || typeof formData !== 'object' || Array.isArray(formData)) return null;
  return normalizeMeetingTimezone(formData.meetingtimezone) || normalizeMeetingTimezone(formData.recruittimezone);
}

async function fetchBookedMeetingDetailTimezone(appointment) {
  const eventId = clean(appointment.id);
  if (!eventId) return null;
  const failures = [];
  for (const eventDate of eventDateCandidates(appointment.starts_at)) {
    const params = new URLSearchParams({ event_id: eventId, event_date: eventDate });
    try {
      const payload = await apiFetch(`/calendar/booked-meeting/details?${params.toString()}`);
      const timezone = formTimezone(payload?.form_data);
      if (timezone) {
        return {
          appointment_id: eventId,
          meeting_timezone: timezone,
          source_event_date: eventDate,
          raw_meeting_timezone: clean(payload?.form_data?.meetingtimezone) || clean(payload?.form_data?.recruittimezone),
        };
      }
      failures.push({ eventDate, reason: 'no_valid_timezone' });
    } catch (error) {
      failures.push({ eventDate, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    appointment_id: eventId,
    meeting_timezone: null,
    failures,
  };
}

async function fetchBookedMeetingDetailTimezoneRows(appointments) {
  if (skipLiveTimezoneLookup) return [];
  const rows = [];
  const missingActiveAppointments = appointments.filter(
    (appointment) => !clean(appointment.meeting_timezone) && isActiveAppointmentStatus(appointment.status),
  );
  for (const appointment of missingActiveAppointments) {
    rows.push(await fetchBookedMeetingDetailTimezone(appointment));
  }
  return rows;
}

function countWhere(patches, predicate) {
  return patches.filter((patch) => predicate(patch.patch)).length;
}

export async function runBackfill() {
  const owners = loadOwnerDirectory();
  const [appointments, confirmationRows, contactRows, lifecycleRows] = await Promise.all([
    getPaged(
      'appointments',
      'id,athlete_key,athlete_id,athlete_main_id,head_scout,starts_at,status,source_event_id,meeting_timezone,meeting_timezone_label,calendar_timezone,previous_appointment_id,original_appointment_id,reschedule_sequence,operator_owner,operator_owner_key,head_scout_key,appointment_role,status_reason,source_system,source_payload,updated_at',
      'order=updated_at.desc',
    ),
    getPaged(
      'set_meeting_confirmation_cache',
      'appointment_id,meeting_timezone,meeting_starts_at',
      'order=meeting_starts_at.desc',
    ),
    getPaged('athlete_contact_cache', 'athlete_key,timezone,timezone_label'),
    getPaged(
      'lifecycle_events',
      'athlete_key,event_type,payload_json,crm_stage,task_status,created_at',
      'order=created_at.desc',
    ),
  ]);
  const bookedMeetingDetailRows = await fetchBookedMeetingDetailTimezoneRows(appointments);

  const { patches, unrepairable } = buildAppointmentTruthPatches({
    appointments,
    confirmationRows,
    bookedMeetingDetailRows,
    contactRows,
    lifecycleRows,
    owners,
  });

  if (writeMode) {
    for (const patch of patches) {
      await patchAppointment(patch.appointmentId, patch.patch);
    }
  }

  return {
    mode: dryRun ? 'dry-run' : 'write',
    appointmentsScanned: appointments.length,
    liveTimezoneLookups: skipLiveTimezoneLookup ? 0 : bookedMeetingDetailRows.length,
    liveTimezonePatches: bookedMeetingDetailRows.filter((row) => clean(row.meeting_timezone)).length,
    patches: patches.length,
    timezonePatches: countWhere(patches, (patch) => patch.meeting_timezone || patch.meeting_timezone_label),
    ownerPatches: countWhere(patches, (patch) => patch.operator_owner || patch.operator_owner_key || patch.head_scout_key),
    chainPatches: countWhere(
      patches,
      (patch) => patch.previous_appointment_id || patch.original_appointment_id || patch.reschedule_sequence,
    ),
    rolePatches: countWhere(patches, (patch) => patch.appointment_role),
    unrepairable,
    samplePatches: patches.slice(0, 20),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await runBackfill(), null, 2));
}
