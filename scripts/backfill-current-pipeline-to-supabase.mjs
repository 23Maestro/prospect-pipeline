#!/usr/bin/env node

import fetch from 'node-fetch';
import { randomUUID } from 'crypto';
import { resolveCallTrackerOwnership } from './call-tracker-ownership.mjs';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const TRACKED_OWNER_NAME = process.env.CALL_TRACKER_OWNER || 'Jerami Singleton';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const {
  projectRef,
  url: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  schema: SUPABASE_SCHEMA,
} = resolveSupabaseCredentials();
const RUN_ID = randomUUID();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    [
      'Missing Supabase credentials.',
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY, or authenticate the Supabase CLI so the linked project can provide them.',
      `Linked project ref: ${projectRef || 'missing'}`,
    ].join(' '),
  );
  process.exit(1);
}

if (projectRef && !SUPABASE_URL.includes(projectRef)) {
  console.error(
    `Supabase URL ${SUPABASE_URL} does not match linked project ref ${projectRef}. Refusing to write to the wrong project.`,
  );
  process.exit(1);
}

function buildAthleteKey(athleteId, athleteMainId) {
  return `${String(athleteId || '').trim()}:${String(athleteMainId || '').trim()}`;
}

function stripMoveThisTaskPrefix(taskTitle) {
  const trimmed = String(taskTitle || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/^\(SC Move This Task\)\s*/i, '').trim() || trimmed;
}

function parseLegacyTaskDate(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  const match = trimmed.match(
    /^(?:[A-Za-z]{3}\s+)?(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i,
  );
  if (!match) return null;

  const month = Number.parseInt(match[1], 10) - 1;
  const day = Number.parseInt(match[2], 10);
  const yearValue = Number.parseInt(match[3], 10);
  const year = match[3].length === 2 ? 2000 + yearValue : yearValue;
  let hour = match[4] ? Number.parseInt(match[4], 10) : 0;
  const minute = match[5] ? Number.parseInt(match[5], 10) : 0;
  const meridiem = String(match[6] || '').toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  const parsed = new Date(year, month, day, hour, minute);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function daysOld(value) {
  const parsed = parseLegacyTaskDate(value);
  if (!parsed) return 0;
  return Math.floor((Date.now() - new Date(parsed).getTime()) / MS_PER_DAY);
}

function selectCurrentAndPreviousMeetings(events) {
  const meetings = [...(Array.isArray(events) ? events : [])]
    .filter((event) => String(event?.start || '').trim())
    .sort((left, right) => String(right.start).localeCompare(String(left.start)));
  if (!meetings.length) {
    return { currentMeeting: null, previousMeeting: null };
  }

  const now = Date.now();
  const currentMeeting =
    meetings.find((meeting) => {
      const parsed = new Date(String(meeting.start));
      return !Number.isNaN(parsed.getTime()) && parsed.getTime() >= now;
    }) || null;

  if (currentMeeting) {
    return {
      currentMeeting,
      previousMeeting:
        meetings.find((meeting) => meeting.event_id !== currentMeeting.event_id) || null,
    };
  }

  return { currentMeeting: null, previousMeeting: meetings[0] || null };
}

function mapPipelineTask(rawTitle, rawDescription) {
  const strippedTitle = stripMoveThisTaskPrefix(rawTitle);
  const normalizedTitle = strippedTitle.toLowerCase();
  const normalizedDescription = String(rawDescription || '').trim().toLowerCase();

  if (
    normalizedTitle.includes('confirmation call') ||
    normalizedDescription.includes('confirm the meeting set')
  ) {
    return {
      crmStage: 'Meeting Set',
      taskStatus: 'confirmation_call',
      taskPriority: 500,
    };
  }

  if (normalizedTitle.includes('no show')) {
    return {
      crmStage: 'No Show',
      taskStatus: 'no_show',
      taskPriority: 450,
    };
  }

  if (normalizedTitle.includes('call attempt 3')) {
    return {
      crmStage: 'Spoke to - Follow Up',
      taskStatus: 'call_attempt_3',
      taskPriority: 300,
    };
  }

  if (
    normalizedTitle.startsWith('spoke to') ||
    normalizedTitle.includes('follow up') ||
    normalizedDescription.includes('follow up')
  ) {
    return {
      crmStage: 'Spoke to - Follow Up',
      taskStatus: 'spoke_to_follow_up',
      taskPriority: 350,
    };
  }

  if (normalizedTitle.includes('call attempt 2')) {
    return {
      crmStage: 'Left Voice Mail 2',
      taskStatus: 'call_attempt_2',
      taskPriority: 200,
    };
  }

  if (normalizedTitle.includes('call attempt 1')) {
    return {
      crmStage: 'Left Voice Mail 1',
      taskStatus: 'call_attempt_1',
      taskPriority: 100,
    };
  }

  return {
    crmStage: null,
    taskStatus: 'needs_manual_review',
    taskPriority: 0,
  };
}

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${path} -> HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${path} -> request timed out after 20s`);
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

function compareBackfillCandidates(left, right) {
  if (right.taskPriority !== left.taskPriority) {
    return right.taskPriority - left.taskPriority;
  }
  if ((right.dueAt || '') !== (left.dueAt || '')) {
    return String(right.dueAt || '').localeCompare(String(left.dueAt || ''));
  }
  const leftTaskId = Number.parseInt(String(left.taskId || '0'), 10);
  const rightTaskId = Number.parseInt(String(right.taskId || '0'), 10);
  return rightTaskId - leftTaskId;
}

function shouldSkipStaleActiveCandidate(candidate, previousMeeting) {
  const meetingAge = daysOld(previousMeeting?.end || previousMeeting?.start);
  const taskAge = daysOld(candidate.dueAt);

  if (candidate.taskStatus === 'call_attempt_3' && taskAge >= 3) {
    return 'stale_never_spoke_to_3_days';
  }

  if (candidate.taskStatus === 'no_show' && Math.max(meetingAge, taskAge) >= 7) {
    return 'stale_no_show_7_days';
  }

  if (
    (candidate.taskStatus === 'spoke_to_follow_up' || candidate.taskStatus === 'meeting_follow_up') &&
    Math.max(meetingAge, taskAge) >= 7
  ) {
    return 'stale_follow_up_7_days';
  }

  return null;
}

const scoutTaskPayload = await apiFetch('/scout/tasks');
const pipelineTasks = Array.isArray(scoutTaskPayload.tasks) ? scoutTaskPayload.tasks : [];

const athletesByKey = new Map();
const appointmentsById = new Map();
const lifecycleEvents = [];
const stateCandidatesByAthlete = new Map();
const failures = [];
const staleSkipped = [];
const ownerSkipped = [];

for (const [index, pipelineTask] of pipelineTasks.entries()) {
  const athleteId = String(
    pipelineTask.contact_id || pipelineTask.athlete_id || '',
  ).trim();
  const athleteMainId = String(pipelineTask.athlete_main_id || '').trim();
  if (!athleteId || !athleteMainId) {
    continue;
  }

  console.error(
    `[${index + 1}/${pipelineTasks.length}] ${pipelineTask.athlete_name} :: ${pipelineTask.title}`,
  );

  try {
    const athleteKey = buildAthleteKey(athleteId, athleteMainId);
    const athleteTasksPayload = await apiFetch('/tasks/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete_id: athleteId,
        athlete_main_id: athleteMainId,
      }),
    }).catch(() => ({ tasks: [] }));
    const athleteTasks = Array.isArray(athleteTasksPayload.tasks) ? athleteTasksPayload.tasks : [];
    const taskFromList =
      athleteTasks.find(
        (task) => String(task.task_id || '').trim() === String(pipelineTask.task_id || '').trim(),
      ) || null;

    const resolvePayload = await apiFetch(
      `/athlete/${encodeURIComponent(athleteId)}/resolve?force_refresh=true`,
    ).catch(() => ({}));
    const bookedMeetingsPayload = await apiFetch(
      `/calendar/athlete-booked-meetings?athlete_id=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(athleteMainId)}`,
    ).catch(() => ({ events: [] }));
    const { currentMeeting, previousMeeting } = selectCurrentAndPreviousMeetings(
      bookedMeetingsPayload.events,
    );

    const rawTaskTitle = String(taskFromList?.title || pipelineTask.title || '').trim();
    const strippedTaskTitle = stripMoveThisTaskPrefix(rawTaskTitle);
    const rawTaskDescription = String(
      taskFromList?.description || pipelineTask.description || '',
    ).trim();
    const mapping = mapPipelineTask(rawTaskTitle, rawTaskDescription);
    const dueAt = parseLegacyTaskDate(taskFromList?.due_date || pipelineTask.due_date);
    const appointmentId = currentMeeting?.event_id
      ? String(currentMeeting.event_id)
      : null;
    const headScout =
      String(resolvePayload.head_scout || '').trim() ||
      String(currentMeeting?.assigned_owner || '').trim() ||
      null;
    const athleteName =
      String(resolvePayload.athlete_name || '').trim() ||
      String(pipelineTask.athlete_name || '').trim() ||
      athleteId;
    const currentAppointmentStatus =
      mapping.taskStatus === 'no_show'
        ? 'no_show'
        : mapping.taskStatus === 'confirmation_call'
          ? 'scheduled'
          : currentMeeting
            ? 'scheduled'
            : null;
    const ownership = resolveCallTrackerOwnership({
      trackedOwnerName: TRACKED_OWNER_NAME,
      athleteId,
      athleteMainId,
      athleteName:
        String(resolvePayload.athlete_name || '').trim() ||
        String(pipelineTask.athlete_name || '').trim() ||
        athleteId,
      tasks: athleteTasks,
      currentTaskId: String(pipelineTask.task_id || '').trim() || null,
      bookedMeeting: currentMeeting || previousMeeting || null,
      resolvedProfile: resolvePayload,
      pipelineState: {
        head_scout:
          String(resolvePayload.head_scout || '').trim() ||
          String(currentMeeting?.assigned_owner || previousMeeting?.assigned_owner || '').trim() ||
          null,
      },
      appointmentId: currentMeeting?.event_id || previousMeeting?.event_id || null,
      liveEventId: currentMeeting?.event_id || previousMeeting?.event_id || null,
    });
    if (!ownership.isTrackedOwner) {
      ownerSkipped.push({
        athlete_key: athleteKey,
        athlete_name:
          String(resolvePayload.athlete_name || '').trim() ||
          String(pipelineTask.athlete_name || '').trim() ||
          athleteId,
        task_id: String(pipelineTask.task_id || '').trim() || null,
        source_owner: ownership.sourceOwner,
        owner_proof: ownership.ownerProof,
      });
      continue;
    }

    athletesByKey.set(athleteKey, {
      athlete_key: athleteKey,
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
      athlete_name: athleteName,
      updated_at: new Date().toISOString(),
    });

    if (appointmentId) {
      appointmentsById.set(appointmentId, {
        id: appointmentId,
        athlete_key: athleteKey,
        athlete_id: athleteId,
        athlete_main_id: athleteMainId,
        head_scout: headScout,
        starts_at: String(currentMeeting.start || '').trim() || null,
        status: currentAppointmentStatus,
        source_event_id: appointmentId,
        updated_at: new Date().toISOString(),
      });
    }

    lifecycleEvents.push({
      athlete_key: athleteKey,
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
      event_type: 'pipeline_task_backfill_current',
      crm_stage: mapping.crmStage,
      task_status: mapping.taskStatus,
      payload_json: {
        backfill_run_id: RUN_ID,
        source: 'scout_tasks_current_pipeline',
        task_id: String(pipelineTask.task_id || '').trim() || null,
        raw_task_title: rawTaskTitle || null,
        stripped_task_title: strippedTaskTitle || null,
        raw_task_description: rawTaskDescription || null,
        assigned_owner:
          String(taskFromList?.assigned_owner || pipelineTask.assigned_owner || '').trim() || null,
        due_at: dueAt,
        task_admin_url: String(pipelineTask.athlete_task_url || '').trim() || null,
        athlete_admin_url: String(pipelineTask.athlete_admin_url || '').trim() || null,
        head_scout: headScout,
        sport: String(resolvePayload.sport || '').trim() || null,
        state: String(resolvePayload.state || '').trim() || null,
        grad_year: String(pipelineTask.grad_year || '').trim() || null,
        current_meeting: currentMeeting || null,
        previous_meeting: previousMeeting || null,
        current_appointment_id: appointmentId,
      },
    });

    const candidate = {
      athleteKey,
      athleteId,
      athleteMainId,
      crmStage: mapping.crmStage,
      taskStatus: mapping.taskStatus,
      headScout,
      currentTaskId: String(pipelineTask.task_id || '').trim() || null,
      currentTaskTitle: strippedTaskTitle || rawTaskTitle || null,
      currentAppointmentId: appointmentId,
      taskPriority: mapping.taskPriority,
      dueAt,
      taskId: String(pipelineTask.task_id || '').trim() || null,
    };
    const staleReason = shouldSkipStaleActiveCandidate(candidate, previousMeeting);
    if (staleReason) {
      staleSkipped.push({
        athlete_key: athleteKey,
        athlete_name: athleteName,
        task_id: candidate.taskId,
        task_status: candidate.taskStatus,
        reason: staleReason,
      });
      continue;
    }

    const existingCandidates = stateCandidatesByAthlete.get(athleteKey) || [];
    existingCandidates.push(candidate);
    stateCandidatesByAthlete.set(athleteKey, existingCandidates);
  } catch (error) {
    failures.push({
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
      athlete_name: pipelineTask.athlete_name,
      task_id: pipelineTask.task_id,
      title: pipelineTask.title,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`  failed: ${failures[failures.length - 1].error}`);
  }
}

const athletePipelineStateRows = Array.from(stateCandidatesByAthlete.entries()).map(
  ([athleteKey, candidates]) => {
    const [winner] = [...candidates].sort(compareBackfillCandidates);
    return {
      athlete_key: athleteKey,
      athlete_id: winner.athleteId,
      athlete_main_id: winner.athleteMainId,
      crm_stage: winner.crmStage,
      task_status: winner.taskStatus,
      head_scout: winner.headScout,
      current_task_id: winner.currentTaskId,
      current_task_title: winner.currentTaskTitle,
      current_appointment_id: winner.currentAppointmentId,
      updated_at: new Date().toISOString(),
    };
  },
);

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
      pipelineTaskCount: pipelineTasks.length,
      uniqueAthletes: athletesByKey.size,
      appointmentsUpserted: appointmentsById.size,
      lifecycleEventsInserted: lifecycleEvents.length,
      athletePipelineStateUpserted: athletePipelineStateRows.length,
      staleSkipped,
      ownerSkipped,
      failures,
      distinctCurrentStatuses: [
        ...new Set(athletePipelineStateRows.map((row) => row.task_status).filter(Boolean)),
      ].sort(),
      distinctCurrentStages: [
        ...new Set(athletePipelineStateRows.map((row) => row.crm_stage).filter(Boolean)),
      ].sort(),
    },
    null,
    2,
  ),
);
