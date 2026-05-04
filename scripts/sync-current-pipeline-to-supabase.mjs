#!/usr/bin/env node

import fetch from 'node-fetch';
import { randomUUID } from 'crypto';
import { buildAthleteKey } from '../src/domain/athlete-identity.ts';
import { buildCallActivityFact, buildMeetingSetFact } from '../src/domain/call-tracker-facts.ts';
import {
  insertMeetingSetEventsOnce,
  readRows,
  upsertAppointments,
  upsertAthletePipelineState,
  upsertAthletes,
  upsertCallActivityEvents,
} from '../src/domain/supabase-persistence.ts';
import {
  classifyScoutTask,
  isDashboardCallActivityStatus,
  stripMoveThisTaskPrefix,
} from '../src/domain/scout-task-classifier.ts';
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
const SUPABASE_CONFIG = {
  url: SUPABASE_URL,
  key: SUPABASE_SERVICE_ROLE_KEY,
  schema: SUPABASE_SCHEMA,
};
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

function getSelectedSalesStage(payload) {
  const options = Array.isArray(payload?.options) ? payload.options : [];
  const selected = options.find((option) => option?.selected);
  return String(selected?.label || selected?.value || '').trim() || null;
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

function compareCurrentPipelineCandidates(left, right) {
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

function normalizeMeetingTitleKey(value) {
  return String(value || '')
    .trim()
    .replace(/^Follow Up -\s*/i, '')
    .replace(/^\([^)]*\)\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasMeetingEnded(meeting) {
  const parsed = parseLegacyTaskDate(meeting?.end || meeting?.start);
  return Boolean(parsed && new Date(parsed).getTime() <= Date.now());
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
const existingMeetingSetRows = await readRows(
  SUPABASE_CONFIG,
  'lifecycle_events',
  'select=athlete_key,payload_json,created_at&event_type=eq.meeting_set',
);
const existingMeetingSetTransitions = new Map();
for (const row of existingMeetingSetRows) {
  const titleKey = normalizeMeetingTitleKey(
    row?.payload_json?.meeting_name || row?.payload_json?.booked_title,
  );
  const athleteKey = String(row?.athlete_key || '').trim();
  const createdAt = String(row?.created_at || '').trim();
  if (!athleteKey || !titleKey || !createdAt) continue;
  const key = `${athleteKey}:${titleKey}`;
  const existing = existingMeetingSetTransitions.get(key);
  if (!existing || new Date(createdAt).getTime() < new Date(existing).getTime()) {
    existingMeetingSetTransitions.set(key, createdAt);
  }
}

const athletesByKey = new Map();
const appointmentsById = new Map();
const callActivityRows = [];
const meetingSetRows = [];
const stateCandidatesByAthlete = new Map();
const failures = [];
const staleSkipped = [];
const ownerSkipped = [];
const clockSkipped = [];

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
    const selectedSalesStage = await apiFetch(
      `/sales/stages/${encodeURIComponent(athleteId)}`,
    )
      .then(getSelectedSalesStage)
      .catch(() => null);
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
    const mapping = classifyScoutTask({
      title: rawTaskTitle,
      description: rawTaskDescription,
    });
    const dueAt = parseLegacyTaskDate(taskFromList?.due_date || pipelineTask.due_date);
    const completionAt = parseLegacyTaskDate(taskFromList?.completion_date || pipelineTask.completion_date);
    const selectedStageIsMeetingSet = String(selectedSalesStage || '').trim().toLowerCase() === 'meeting set';
    const shouldMonitorEndedMeetingSet =
      !currentMeeting &&
      previousMeeting &&
      selectedStageIsMeetingSet &&
      mapping.taskStatus === 'confirmation_call' &&
      hasMeetingEnded(previousMeeting);
    const appointmentMeeting = currentMeeting || (shouldMonitorEndedMeetingSet ? previousMeeting : null);
    const appointmentId = appointmentMeeting?.event_id
      ? String(appointmentMeeting.event_id)
      : null;
    const headScout =
      String(resolvePayload.head_scout || '').trim() ||
      String(appointmentMeeting?.assigned_owner || '').trim() ||
      null;
    const athleteName =
      String(resolvePayload.athlete_name || '').trim() ||
      String(pipelineTask.athlete_name || '').trim() ||
      athleteId;
    const currentAppointmentStatus =
      mapping.taskStatus === 'no_show'
        ? 'no_show'
        : shouldMonitorEndedMeetingSet
          ? 'awaiting_post_meeting_update'
          : mapping.taskStatus === 'confirmation_call'
          ? 'scheduled'
          : appointmentMeeting
            ? 'scheduled'
            : null;
    const ownership = resolveCallTrackerOwnership({
      purpose: 'call_activity',
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
        starts_at: String(appointmentMeeting.start || '').trim() || null,
        status: currentAppointmentStatus,
        source_event_id: appointmentId,
        updated_at: new Date().toISOString(),
      });
    }

    const sourcePayload = {
      sync_run_id: RUN_ID,
      source: 'scout_tasks_current_pipeline',
      task_id: String(pipelineTask.task_id || '').trim() || null,
      raw_task_title: rawTaskTitle || null,
      stripped_task_title: strippedTaskTitle || null,
      raw_task_description: rawTaskDescription || null,
      selected_sales_stage: selectedSalesStage,
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
      awaiting_post_meeting_update: shouldMonitorEndedMeetingSet,
    };

    if (
      appointmentId &&
      currentMeeting &&
      mapping.taskStatus === 'confirmation_call' &&
      String(selectedSalesStage || '').trim().toLowerCase() === 'meeting set'
    ) {
      const titleKey = normalizeMeetingTitleKey(currentMeeting.title || athleteName);
      const existingTransitionAt = existingMeetingSetTransitions.get(`${athleteKey}:${titleKey}`);
      meetingSetRows.push(
        buildMeetingSetFact({
          athleteId,
          athleteMainId,
          crmStage: selectedSalesStage,
          taskStatus: mapping.taskStatus,
          payload: {
            ...sourcePayload,
            source: 'scout_tasks_current_pipeline',
            appointment_id: appointmentId,
            booked_event_id: appointmentId,
            meeting_name: String(currentMeeting.title || '').trim() || athleteName,
            starts_at: String(currentMeeting.start || '').trim() || null,
            booked_start: String(currentMeeting.start || '').trim() || null,
            booked_end: String(currentMeeting.end || '').trim() || null,
            booked_owner: String(currentMeeting.assigned_owner || '').trim() || headScout,
            operator_name: TRACKED_OWNER_NAME,
            task_assigned_owner: ownership.context.taskAssignedOwner,
            owner_proof: ownership.context.ownerProof,
            materialization_status: ownership.context.materializationStatus,
            materialization_reason: ownership.context.materializationReason,
            counts_as_dial: true,
            counts_as_contact: true,
            counts_as_meeting_set: true,
            counts_as_post_meeting_outcome: false,
            materialization_proof: {
              task_assigned_owner: ownership.context.taskAssignedOwner,
              materialization_status: ownership.context.materializationStatus,
              status: ownership.context.materializationStatus,
              reason: ownership.context.materializationReason,
            },
            owner_context: {
              active_operator_key: ownership.context.activeOperator.operatorKey,
              active_operator_name: ownership.context.activeOperator.personName,
              task_assigned_owner: ownership.context.taskAssignedOwner,
              resolved_owner_name: ownership.context.resolvedOwnerName,
              resolved_owner_role: ownership.context.resolvedOwnerRole,
              resolved_from_field: ownership.context.resolvedFromField,
              resolved_from_value: ownership.context.resolvedFromValue,
              owner_proof: ownership.context.ownerProof,
              materialization_status: ownership.context.materializationStatus,
              materialization_reason: ownership.context.materializationReason,
              can_materialize_for_active_operator: ownership.context.canMaterializeForActiveOperator,
              owner_status: ownership.context.status,
            },
          },
          createdAt: existingTransitionAt || new Date().toISOString(),
        }),
      );
    }

    const taskId = String(pipelineTask.task_id || '').trim();
    if (taskId && isDashboardCallActivityStatus(mapping.taskStatus)) {
      const activityOccurredAt = completionAt || dueAt;
      const activityOccurredAtSource = completionAt
        ? 'task.completion_date'
        : dueAt
          ? 'task.due_date'
          : null;
      if (!activityOccurredAt) {
        clockSkipped.push({
          athlete_key: athleteKey,
          athlete_name: athleteName,
          task_id: taskId,
          task_status: mapping.taskStatus,
          reason: 'missing_completion_or_due_date',
        });
      } else {
        callActivityRows.push(
          buildCallActivityFact({
            athleteId,
            athleteMainId,
            athleteName,
            taskId,
            taskTitle: strippedTaskTitle || rawTaskTitle || null,
            taskDescription: rawTaskDescription || null,
            activitySubtype: mapping.taskStatus,
            occurredAt: activityOccurredAt,
            ownerInput: {
              purpose: 'call_activity',
              athleteId,
              athleteMainId,
              athleteName,
              tasks: athleteTasks,
              currentTaskId: taskId,
            },
            ownerContext: ownership.context,
            payload: {
              sync_run_id: RUN_ID,
              source: 'scout_tasks_current_pipeline',
              raw_task_title: rawTaskTitle || null,
              completion_at: completionAt,
              due_at: dueAt,
              occurred_at_source: activityOccurredAtSource,
              head_scout: headScout,
              selected_sales_stage: selectedSalesStage,
            },
            updatedAt: new Date().toISOString(),
          }),
        );
      }
    }

    const candidate = {
      athleteKey,
      athleteId,
      athleteMainId,
      crmStage: shouldMonitorEndedMeetingSet
        ? 'Meeting Set - Awaiting Post Meeting Result'
        : selectedSalesStage,
      taskStatus: shouldMonitorEndedMeetingSet
        ? 'post_meeting_update_pending'
        : mapping.taskStatus,
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
    const [winner] = [...candidates].sort(compareCurrentPipelineCandidates);
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

await upsertAthletes(SUPABASE_CONFIG, [...athletesByKey.values()]);
await upsertAppointments(SUPABASE_CONFIG, [...appointmentsById.values()]);
await upsertAthletePipelineState(SUPABASE_CONFIG, athletePipelineStateRows);
await upsertCallActivityEvents(SUPABASE_CONFIG, callActivityRows);
await insertMeetingSetEventsOnce(SUPABASE_CONFIG, meetingSetRows);

console.log(
  JSON.stringify(
    {
      runId: RUN_ID,
      pipelineTaskCount: pipelineTasks.length,
      uniqueAthletes: athletesByKey.size,
      appointmentsUpserted: appointmentsById.size,
          callActivityEventsUpserted: callActivityRows.length,
          meetingSetEventsInsertedOnce: meetingSetRows.length,
          athletePipelineStateUpserted: athletePipelineStateRows.length,
          staleSkipped,
          ownerSkipped,
          clockSkipped,
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
