#!/usr/bin/env node

import fetch from 'node-fetch';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const SUPABASE_URL =
  String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '') ||
  readLinkedSupabaseUrl();
const SUPABASE_SERVICE_ROLE_KEY =
  String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() ||
  readLinkedServiceRoleKey();
const SUPABASE_SCHEMA = String(process.env.SUPABASE_SCHEMA || 'public').trim() || 'public';
const RUN_ID = randomUUID();
const STATE_ABBREVIATIONS = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing Supabase credentials. Set SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY or keep the linked Supabase CLI project authenticated.',
  );
  process.exit(1);
}

function readLinkedProjectRef() {
  const refPath = path.join(process.cwd(), 'supabase/.temp/project-ref');
  try {
    return fs.readFileSync(refPath, 'utf8').trim();
  } catch {
    return '';
  }
}

function readLinkedSupabaseUrl() {
  const ref = readLinkedProjectRef();
  return ref ? `https://${ref}.supabase.co` : '';
}

function readLinkedServiceRoleKey() {
  const ref = readLinkedProjectRef();
  if (!ref) {
    return '';
  }

  try {
    const output = execFileSync(
      'supabase',
      ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const keys = JSON.parse(output);
    const serviceRole = Array.isArray(keys)
      ? keys.find((entry) => entry?.id === 'service_role' || entry?.name === 'service_role')
      : null;
    return String(serviceRole?.api_key || '').trim();
  } catch {
    return '';
  }
}

function buildAthleteKey(athleteId, athleteMainId) {
  return `${String(athleteId || '').trim()}:${String(athleteMainId || '').trim()}`;
}

function normalizeIsoValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeStateToken(value) {
  const trimmed = String(value || '').trim().toUpperCase();
  if (!trimmed) return '';
  return STATE_ABBREVIATIONS[trimmed] || trimmed;
}

function buildWeekWindow(weekOffset = Number.parseInt(process.env.WEEK_OFFSET || '0', 10) || 0) {
  const now = new Date();
  const currentDay = now.getDay();
  const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + diffToMonday + weekOffset * 7);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function stripMoveThisTaskPrefix(taskTitle) {
  const trimmed = String(taskTitle || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/^\(SC Move This Task\)\s*/i, '').trim() || trimmed;
}

function cleanBookedMeetingTitle(title) {
  return String(title || '')
    .trim()
    .replace(/^\([A-Z*]{2,4}\)\s*/i, '')
    .trim();
}

function isActualSetMeetingTitle(title) {
  const normalized = String(title || '').trim().toLowerCase();
  if (!normalized || normalized === 'open') {
    return false;
  }
  if (normalized === 'coaching session') {
    return false;
  }
  return !(
    normalized.startsWith('follow up -') ||
    normalized.startsWith('(fu)') ||
    normalized.startsWith('(cl)') ||
    normalized.startsWith('(*)')
  );
}

function parseBookedMeetingSearchParts(title) {
  const cleaned = cleanBookedMeetingTitle(title);
  const match = cleaned.match(/^(.*?)\s+([A-Za-z]+)\s+(20\d{2})\s+([A-Z]{2})$/);
  if (!match) {
    return {
      searchTerm: cleaned,
      athleteName: cleaned,
      sport: null,
      gradYear: null,
      state: null,
    };
  }

  return {
    searchTerm: cleaned,
    athleteName: match[1].trim(),
    sport: match[2].trim(),
    gradYear: match[3].trim(),
    state: match[4].trim(),
  };
}

function parseLegacyTaskDate(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }
  return null;
}

function pickNewestTask(tasks, predicate) {
  const matches = (Array.isArray(tasks) ? tasks : []).filter(predicate);
  if (!matches.length) return null;

  return [...matches].sort((left, right) => {
    const rightDate = Date.parse(String(right.due_date || '').trim());
    const leftDate = Date.parse(String(left.due_date || '').trim());
    if (!Number.isNaN(rightDate) && !Number.isNaN(leftDate) && rightDate !== leftDate) {
      return rightDate - leftDate;
    }
    const rightId = Number.parseInt(String(right.task_id || '0'), 10);
    const leftId = Number.parseInt(String(left.task_id || '0'), 10);
    return rightId - leftId;
  })[0];
}

function isConfirmationTask(task) {
  const title = String(task?.title || '').trim().toLowerCase();
  const description = String(task?.description || '').trim().toLowerCase();
  return title.includes('confirmation call') || description.includes('confirm the meeting set');
}

function getSelectedSalesStageLabel(payload) {
  const options = Array.isArray(payload?.options) ? payload.options : [];
  const selected = options.find((option) => option?.selected);
  return String(selected?.label || '').trim() || null;
}

function inferCrmStage({ selectedStage, latestConfirmationTask }) {
  const normalizedSelected = String(selectedStage || '').trim().toLowerCase();
  if (normalizedSelected === 'meeting set') return 'Meeting Set';
  if (normalizedSelected === 'rescheduled') return 'Rescheduled';
  if (normalizedSelected === 'no show') return 'No Show';

  const title = String(latestConfirmationTask?.title || '').trim().toLowerCase();
  if (title.startsWith('(rsp)') || title.includes('rescheduled')) {
    return 'Rescheduled';
  }

  return 'Meeting Set';
}

function inferTaskStatus({ crmStage }) {
  const normalizedStage = String(crmStage || '').trim().toLowerCase();
  if (normalizedStage === 'no show') {
    return 'no_show';
  }
  return 'confirmation_call';
}

function buildCurrentTaskTitle(latestIncompleteConfirmationTask) {
  if (!latestIncompleteConfirmationTask) {
    return 'Confirmation Call';
  }
  const stripped = stripMoveThisTaskPrefix(latestIncompleteConfirmationTask.title);
  return stripped || 'Confirmation Call';
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
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${pathname} -> request timed out after 20s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function supabaseWrite(table, rows, { onConflict } = {}) {
  if (!rows.length) return;
  const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: onConflict ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
      'Accept-Profile': SUPABASE_SCHEMA,
      'Content-Profile': SUPABASE_SCHEMA,
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${table} write failed: ${response.status} ${text.slice(0, 300)}`);
  }
}

async function supabaseQuery(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${query}`, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Accept-Profile': SUPABASE_SCHEMA,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${table} query failed: ${response.status} ${text.slice(0, 300)}`);
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

async function resolveBookedMeetingAthlete(event) {
  const parsed = parseBookedMeetingSearchParts(event.title);
  if (!parsed.searchTerm) {
    return null;
  }

  const searchTerms = [parsed.searchTerm, parsed.athleteName].filter(Boolean);
  const candidates = [];

  for (const term of searchTerms) {
    const searchPayload = await apiFetch('/athlete/raw-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term,
        include_admin_search: true,
        include_recent_search: false,
      }),
    }).catch(() => ({ results: [] }));
    const searchResults = Array.isArray(searchPayload.results) ? searchPayload.results : [];
    for (const result of searchResults) {
      const athleteId = String(result?.athlete_id || '').trim();
      if (!athleteId || candidates.some((candidate) => candidate.athlete_id === athleteId)) {
        continue;
      }
      candidates.push(result);
    }
  }

  if (!candidates.length) {
    return null;
  }

  for (const candidate of candidates) {
    const athleteId = String(candidate?.athlete_id || '').trim();
    if (!athleteId) {
      continue;
    }

    const resolved = await apiFetch(
      `/athlete/${encodeURIComponent(athleteId)}/resolve?force_refresh=true`,
    ).catch(() => null);
    if (!resolved?.athlete_main_id) {
      continue;
    }

    const resolvedName = String(candidate?.name || resolved?.athlete_name || resolved?.name || '').trim();
    const resolvedSport = String(candidate?.sport || resolved?.sport || '').trim();
    const resolvedState = String(candidate?.state || resolved?.state || '').trim();

    if (
      resolvedName &&
      resolvedName.toLowerCase() !== parsed.athleteName.toLowerCase()
    ) {
      continue;
    }
    if (
      parsed.gradYear &&
      String(candidate?.grad_year || resolved?.grad_year || '').trim() !== parsed.gradYear
    ) {
      continue;
    }
    if (
      parsed.sport &&
      resolvedSport &&
      resolvedSport.toLowerCase() !== parsed.sport.toLowerCase()
    ) {
      continue;
    }
    if (
      parsed.state &&
      resolvedState &&
      normalizeStateToken(resolvedState) !== normalizeStateToken(parsed.state)
    ) {
      continue;
    }

    const athleteMeetings = await apiFetch(
      `/calendar/athlete-booked-meetings?athlete_id=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(resolved.athlete_main_id)}`,
    ).catch(() => ({ events: [] }));
    const matchingMeeting = (Array.isArray(athleteMeetings.events) ? athleteMeetings.events : []).find(
      (meetingCandidate) =>
        String(meetingCandidate?.event_id || '').trim() === String(event.event_id || '').trim() ||
        (
          String(meetingCandidate?.title || '').trim().toLowerCase() ===
            String(event.title || '').trim().toLowerCase() &&
          String(meetingCandidate?.start || '').trim() === String(event.start || '').trim()
        ),
    );

    if (!matchingMeeting) {
      continue;
    }

    return {
      athleteId,
      athleteMainId: String(resolved.athlete_main_id).trim(),
      athleteName: resolvedName || cleanBookedMeetingTitle(event.title),
      sport: resolvedSport || null,
      state: resolvedState || null,
      headScout: String(resolved.head_scout || event.assigned_owner || '').trim() || null,
      event: matchingMeeting,
    };
  }

  return null;
}

const weekWindow = buildWeekWindow();
const scoutTaskPayload = await apiFetch('/scout/tasks').catch(() => ({ tasks: [] }));
const activeStateRows = await supabaseQuery(
  'athlete_pipeline_state',
  'select=athlete_key,current_appointment_id&not.current_appointment_id=is.null&limit=500',
).catch(() => []);
const athleteRows = await supabaseQuery(
  'athletes',
  'select=athlete_key,athlete_name&limit=1000',
).catch(() => []);
const activeKeys = new Set(
  activeStateRows.map((row) => String(row.athlete_key || '').trim()).filter(Boolean),
);
const athleteNameByKey = new Map(
  athleteRows.map((row) => [String(row.athlete_key || '').trim(), String(row.athlete_name || '').trim()]),
);
const knownAthleteNames = new Set(
  [
    ...(Array.isArray(scoutTaskPayload.tasks) ? scoutTaskPayload.tasks : []).map((task) =>
      String(task?.athlete_name || '').trim().toLowerCase(),
    ),
    ...Array.from(activeKeys).map((key) => String(athleteNameByKey.get(key) || '').trim().toLowerCase()),
  ].filter(Boolean),
);
const bookedMeetingsPayload = await apiFetch(
  `/calendar/booked-meetings?start=${encodeURIComponent(weekWindow.start)}&end=${encodeURIComponent(weekWindow.end)}`,
);
const bookedMeetings = (Array.isArray(bookedMeetingsPayload.events) ? bookedMeetingsPayload.events : []).filter(
  (event) => {
    if (!isActualSetMeetingTitle(event?.title)) {
      return false;
    }
    const parsed = parseBookedMeetingSearchParts(event?.title);
    return knownAthleteNames.has(String(parsed.athleteName || '').trim().toLowerCase());
  },
);

const athletesByKey = new Map();
const appointmentsById = new Map();
const lifecycleEvents = [];
const athletePipelineStateRows = [];
const failures = [];

for (const [index, event] of bookedMeetings.entries()) {
  console.error(`[${index + 1}/${bookedMeetings.length}] ${event.title} :: ${event.start}`);
  try {
    const resolved = await resolveBookedMeetingAthlete(event);
    if (!resolved) {
      throw new Error('Could not resolve athlete from booked meeting title');
    }

    const athleteKey = buildAthleteKey(resolved.athleteId, resolved.athleteMainId);
    const tasksPayload = await apiFetch('/tasks/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete_id: resolved.athleteId,
        athlete_main_id: resolved.athleteMainId,
      }),
    }).catch(() => ({ tasks: [] }));
    const tasks = Array.isArray(tasksPayload.tasks) ? tasksPayload.tasks : [];
    const latestIncompleteConfirmationTask = pickNewestTask(
      tasks,
      (task) => !String(task?.completion_date || '').trim() && isConfirmationTask(task),
    );
    const latestConfirmationTask =
      latestIncompleteConfirmationTask ||
      pickNewestTask(tasks, (task) => isConfirmationTask(task));
    const stagePayload = await apiFetch(
      `/sales/stages/${encodeURIComponent(resolved.athleteId)}`,
    ).catch(() => ({ options: [] }));
    const selectedStage = getSelectedSalesStageLabel(stagePayload);

    const crmStage = inferCrmStage({
      selectedStage,
      latestConfirmationTask,
    });
    const taskStatus = inferTaskStatus({ crmStage });
    const appointmentId = String(event.event_id || '').trim();
    const startsAt = normalizeIsoValue(event.start);
    const appointmentStatus = crmStage === 'Rescheduled' ? 'rescheduled' : 'scheduled';
    const currentTaskId = String(latestIncompleteConfirmationTask?.task_id || '').trim() || null;
    const currentTaskTitle = buildCurrentTaskTitle(latestIncompleteConfirmationTask);
    const dueAt =
      parseLegacyTaskDate(latestIncompleteConfirmationTask?.due_date) ||
      parseLegacyTaskDate(latestConfirmationTask?.due_date);
    const updatedAt = new Date().toISOString();

    athletesByKey.set(athleteKey, {
      athlete_key: athleteKey,
      athlete_id: resolved.athleteId,
      athlete_main_id: resolved.athleteMainId,
      athlete_name: resolved.athleteName,
      updated_at: updatedAt,
    });

    appointmentsById.set(appointmentId, {
      id: appointmentId,
      athlete_key: athleteKey,
      athlete_id: resolved.athleteId,
      athlete_main_id: resolved.athleteMainId,
      head_scout: resolved.headScout,
      starts_at: startsAt,
      status: appointmentStatus,
      source_event_id: appointmentId,
      updated_at: updatedAt,
    });

    lifecycleEvents.push({
      id: randomUUID(),
      athlete_key: athleteKey,
      athlete_id: resolved.athleteId,
      athlete_main_id: resolved.athleteMainId,
      event_type: 'booked_meeting_gap_reconciled',
      crm_stage: crmStage,
      task_status: taskStatus,
      payload_json: {
        backfill_run_id: RUN_ID,
        source: 'booked_meetings_current_week',
        booked_event_id: appointmentId,
        booked_title: event.title || null,
        booked_start: startsAt,
        booked_end: normalizeIsoValue(event.end),
        booked_owner: resolved.headScout,
        selected_sales_stage: selectedStage,
        latest_confirmation_task_id: String(latestConfirmationTask?.task_id || '').trim() || null,
        latest_confirmation_task_title:
          String(latestConfirmationTask?.title || '').trim() || null,
        latest_confirmation_task_due_at: dueAt,
      },
      created_at: updatedAt,
    });

    athletePipelineStateRows.push({
      athlete_key: athleteKey,
      athlete_id: resolved.athleteId,
      athlete_main_id: resolved.athleteMainId,
      crm_stage: crmStage,
      task_status: taskStatus,
      head_scout: resolved.headScout,
      current_task_id: currentTaskId,
      current_task_title: currentTaskTitle,
      current_appointment_id: appointmentId,
      updated_at: updatedAt,
    });
  } catch (error) {
    failures.push({
      title: String(event?.title || '').trim(),
      start: String(event?.start || '').trim(),
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`  failed: ${failures[failures.length - 1].error}`);
  }
}

await supabaseWrite('athletes', [...athletesByKey.values()], { onConflict: 'athlete_key' });
await supabaseWrite('appointments', [...appointmentsById.values()], { onConflict: 'id' });
await supabaseWrite('lifecycle_events', lifecycleEvents);
await supabaseWrite('athlete_pipeline_state', athletePipelineStateRows, {
  onConflict: 'athlete_key',
});

console.log(
  JSON.stringify(
    {
      runId: RUN_ID,
      weekWindow,
      bookedMeetingCount: bookedMeetings.length,
      resolvedAthletes: athletesByKey.size,
      appointmentsUpserted: appointmentsById.size,
      lifecycleEventsInserted: lifecycleEvents.length,
      athletePipelineStateUpserted: athletePipelineStateRows.length,
      failures,
    },
    null,
    2,
  ),
);
