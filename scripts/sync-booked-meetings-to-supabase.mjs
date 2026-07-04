#!/usr/bin/env node

import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto';
import { buildWeeklyOperatorMeetingSetCandidates } from '../src/domain/booked-meeting-source.ts';
import {
  buildAppointmentSnapshot,
  buildAthleteSnapshot,
  buildMeetingSetFact,
} from '../src/domain/call-tracker-facts.ts';
import { buildOwnerProofPayload } from '../src/domain/owner-proof-payload.ts';
import { resolveOwnerContext } from '../src/domain/owner-resolution.ts';
import {
  insertMeetingSetEventsOnce,
  upsertAppointments,
  upsertAthletes,
} from '../src/domain/supabase-persistence.ts';
import {
  appointmentStatusForTitleOrStage,
  postMeetingResultForTitleOrStage,
  taskStatusForStage,
} from '../src/domain/supabase-lifecycle-translator.ts';
import { classifyMeetingSetStage } from '../src/domain/sales-stage-contract.ts';
import {
  resolveIanaTimeZoneFromLegacyLabel,
  resolveLegacyTimezoneLabelFromIana,
} from '../src/domain/outreach-time-wording.ts';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const {
  projectRef,
  url: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  schema: SUPABASE_SCHEMA,
} = resolveSupabaseCredentials();
const RUN_ID = randomUUID();
const TRACKED_OPERATOR_NAME = process.env.CALL_TRACKER_OWNER || 'Primary Operator';
const SUPABASE_CONFIG = {
  url: SUPABASE_URL,
  key: SUPABASE_SERVICE_ROLE_KEY,
  schema: SUPABASE_SCHEMA,
};
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

function normalizeIsoValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeMeetingTimezone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (['SELECT RECRUIT TIME ZONE', 'SELECT TIME ZONE', 'SELECT TIMEZONE'].includes(trimmed.toUpperCase())) {
    return null;
  }
  return resolveIanaTimeZoneFromLegacyLabel(trimmed);
}

function resolveTimezoneLabel(timezone) {
  const normalized = normalizeMeetingTimezone(timezone);
  return normalized ? resolveLegacyTimezoneLabelFromIana(normalized) : null;
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

async function verifyCandidateBookedMeeting(candidate) {
  const athleteMeetings = await apiFetch(
    `/calendar/athlete-booked-meetings?athlete_id=${encodeURIComponent(candidate.athleteId)}&athlete_main_id=${encodeURIComponent(candidate.athleteMainId)}`,
  ).catch(() => ({ events: [] }));

  return (Array.isArray(athleteMeetings.events) ? athleteMeetings.events : []).find(
    (meetingCandidate) =>
      String(meetingCandidate?.event_id || '').trim() === candidate.bookedMeeting.eventId ||
      (
        String(meetingCandidate?.title || '').trim().toLowerCase() ===
          candidate.bookedMeeting.title.trim().toLowerCase() &&
        String(meetingCandidate?.start || '').trim() === candidate.bookedMeeting.start
      ),
  ) || null;
}

function getBookedMeetingEventDate(meeting) {
  return String(meeting?.start || '').split('T')[0] || null;
}

async function fetchBookedMeetingTimezone(event) {
  const eventId = String(event?.event_id || '').trim();
  const eventDate = getBookedMeetingEventDate(event);
  if (!eventId || !eventDate) return null;
  const params = new URLSearchParams({ event_id: eventId, event_date: eventDate });
  const details = await apiFetch(`/calendar/booked-meeting/details?${params.toString()}`);
  return normalizeMeetingTimezone(details?.form_data?.meetingtimezone) ||
    normalizeMeetingTimezone(details?.form_data?.recruittimezone);
}

const weekWindow = buildWeekWindow();
const [scoutTaskPayload, bookedMeetingsPayload] = await Promise.all([
  apiFetch('/scout/tasks?range=thisWeek').catch(() => ({ tasks: [] })),
  apiFetch(
    `/calendar/booked-meetings?start=${encodeURIComponent(weekWindow.start)}&end=${encodeURIComponent(weekWindow.end)}`,
  ),
]);
const weeklyTasks = Array.isArray(scoutTaskPayload.tasks) ? scoutTaskPayload.tasks : [];
const weeklyBookedMeetings = Array.isArray(bookedMeetingsPayload.events) ? bookedMeetingsPayload.events : [];
const meetingSetCandidates = buildWeeklyOperatorMeetingSetCandidates({
  bookedMeetings: weeklyBookedMeetings,
  tasks: weeklyTasks,
  operatorName: TRACKED_OPERATOR_NAME,
});

const athletesByKey = new Map();
const appointmentsById = new Map();
const meetingSetEvents = [];
const currentLifecycleStateRows = [];
const failures = [];
const nonMeetingSetSkipped = [];

for (const [index, candidate] of meetingSetCandidates.entries()) {
  const event = {
    event_id: candidate.bookedMeeting.eventId,
    title: candidate.bookedMeeting.title,
    assigned_owner: candidate.bookedMeeting.assignedOwner,
    start: candidate.bookedMeeting.start,
    end: candidate.bookedMeeting.end,
    date_time_label: candidate.bookedMeeting.dateTimeLabel,
  };
  console.error(`[${index + 1}/${meetingSetCandidates.length}] ${event.title} :: ${event.start}`);
  try {
    const verifiedMeeting = await verifyCandidateBookedMeeting(candidate);
    if (!verifiedMeeting) {
      throw new Error('Candidate task athlete does not expose this booked meeting');
    }

    const tasksPayload = await apiFetch('/tasks/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete_id: candidate.athleteId,
        athlete_main_id: candidate.athleteMainId,
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
      `/sales/stages/${encodeURIComponent(candidate.athleteId)}`,
    ).catch(() => ({ options: [] }));
    const selectedStage = getSelectedSalesStageLabel(stagePayload);

    const crmStage = String(selectedStage || '').trim() || 'Meeting Set';
    const taskStatus = taskStatusForStage(crmStage, 'confirmation_call') || 'confirmation_call';
    const appointmentId = String(event.event_id || '').trim();
    const startsAt = normalizeIsoValue(event.start);
    const appointmentStatus = appointmentStatusForTitleOrStage(crmStage, event.title) || 'scheduled';
    const postMeetingResult = postMeetingResultForTitleOrStage(crmStage, event.title);
    const meetingTimezone = await fetchBookedMeetingTimezone(event);
    if (!meetingTimezone && ['scheduled', 'rescheduled'].includes(appointmentStatus)) {
      throw new Error('Booked meeting is missing required meeting timezone');
    }
    const meetingTimezoneLabel = resolveTimezoneLabel(meetingTimezone);
    const currentTaskId = String(latestIncompleteConfirmationTask?.task_id || '').trim() || null;
    const currentTaskTitle = buildCurrentTaskTitle(latestIncompleteConfirmationTask);
    const dueAt =
      parseLegacyTaskDate(latestIncompleteConfirmationTask?.due_date) ||
      parseLegacyTaskDate(latestConfirmationTask?.due_date);
    const meetingSetOccurredAt =
      dueAt ||
      parseLegacyTaskDate(candidate.taskDueDate) ||
      normalizeIsoValue(candidate.bookedMeeting.start);
    const updatedAt = new Date().toISOString();

    athletesByKey.set(candidate.athleteKey, buildAthleteSnapshot({
      athleteId: candidate.athleteId,
      athleteMainId: candidate.athleteMainId,
      athleteName: candidate.athleteName,
      updatedAt,
    }));

    const basePayload = {
      sync_run_id: RUN_ID,
      source: candidate.evidence.source,
      operator_name: TRACKED_OPERATOR_NAME,
      athlete_name: candidate.athleteName,
      booked_event_id: appointmentId,
      appointment_id: appointmentId,
      booked_title: event.title || null,
      meeting_name: event.title || null,
      occurred_at: meetingSetOccurredAt,
      occurred_at_source: dueAt
        ? 'confirmation_task.due_date'
        : parseLegacyTaskDate(candidate.taskDueDate)
          ? 'weekly_task.due_date'
          : 'booked_meeting.start',
      booked_start: startsAt,
      starts_at: startsAt,
      booked_end: normalizeIsoValue(event.end),
      booked_owner: candidate.bookedMeeting.assignedOwner,
      head_scout: candidate.bookedMeeting.assignedOwner,
      selected_sales_stage: selectedStage,
      latest_confirmation_task_id: String(latestConfirmationTask?.task_id || '').trim() || null,
      latest_confirmation_task_title:
        String(latestConfirmationTask?.title || '').trim() || null,
      latest_confirmation_task_due_at: dueAt,
      matched_weekly_task_id: candidate.taskId || null,
      matched_weekly_task_title: candidate.taskTitle,
      matched_weekly_task_due_at: candidate.taskDueDate,
      matched_weekly_task_assigned_owner: candidate.taskAssignedOwner,
      matched_task_athlete_name: candidate.evidence.matchedTaskAthleteName,
      verified_athlete_booked_meeting_id: String(verifiedMeeting.event_id || '').trim() || null,
    };
    const ownerContext = resolveOwnerContext({
      purpose: 'meeting_set',
      athleteId: candidate.athleteId,
      athleteMainId: candidate.athleteMainId,
      athleteName: candidate.athleteName,
      tasks: [
        {
          task_id: candidate.taskId,
          title: candidate.taskTitle,
          description: candidate.taskDescription,
          assigned_owner: candidate.taskAssignedOwner,
        },
      ],
      currentTaskId: candidate.taskId,
      appointmentSetterName: candidate.bookedMeeting.assignedOwner,
      bookedMeeting: {
        event_id: appointmentId,
        assigned_owner: candidate.bookedMeeting.assignedOwner,
        athlete_id: candidate.athleteId,
        athlete_main_id: candidate.athleteMainId,
      },
      appointmentId,
    });
    const payload = {
      ...basePayload,
      legacy_compatibility_proof: 'weekly_operator_task_assigned_owner',
      ...buildOwnerProofPayload({
        ownerContext,
        ownerProof: 'payload.matched_weekly_task_assigned_owner',
        bookedMeetingAssignedOwner: candidate.bookedMeeting.assignedOwner,
        basePayload,
      }),
    };

    appointmentsById.set(appointmentId, buildAppointmentSnapshot({
      athleteId: candidate.athleteId,
      athleteMainId: candidate.athleteMainId,
      appointmentId,
      sourceEventId: appointmentId,
      headScout: candidate.bookedMeeting.assignedOwner,
      startsAt,
      status: appointmentStatus,
      meetingTimezone,
      meetingTimezoneLabel,
      originalAppointmentId: appointmentId,
      rescheduleSequence: 0,
      operatorOwner: payload.operator_owner,
      operatorOwnerKey: payload.operator_owner_key,
      appointmentRole: classifyMeetingSetStage(crmStage) ? 'initial_set' : 'unknown',
      statusReason: 'sync_booked_meetings',
      postMeetingResult,
      sourceSystem: 'sync_booked_meetings',
      sourcePayload: {
        sync_run_id: RUN_ID,
        owner_proof: payload.owner_proof,
        booked_event_id: appointmentId,
        meeting_timezone_source: meetingTimezone ? 'booked_meeting_details' : null,
      },
      updatedAt,
    }));

    if (classifyMeetingSetStage(crmStage)) {
      // Clock contract: lifecycle_events.created_at is when this athlete became Meeting Set.
      // Appointment start/end stay in payload_json as meeting evidence; sync reruns insert-once
      // by dedupe_key so daily tracking never moves to the latest sync time.
      meetingSetEvents.push(buildMeetingSetFact({
        athleteId: candidate.athleteId,
        athleteMainId: candidate.athleteMainId,
        crmStage,
        taskStatus,
        payload,
        createdAt: meetingSetOccurredAt || updatedAt,
      }));
    } else {
      nonMeetingSetSkipped.push({
        athlete_key: candidate.athleteKey,
        athlete_name: candidate.athleteName,
        appointment_id: appointmentId,
        crm_stage: crmStage,
        reason: 'booked_meeting_updates_state_only_not_meeting_set_fact',
      });
    }

    currentLifecycleStateRows.push({
      athlete_key: candidate.athleteKey,
      athlete_id: candidate.athleteId,
      athlete_main_id: candidate.athleteMainId,
      crm_stage: crmStage,
      task_status: taskStatus,
      head_scout: candidate.bookedMeeting.assignedOwner,
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

await upsertAthletes(SUPABASE_CONFIG, [...athletesByKey.values()]);
await upsertAppointments(SUPABASE_CONFIG, [...appointmentsById.values()]);
await insertMeetingSetEventsOnce(SUPABASE_CONFIG, meetingSetEvents);

console.log(
  JSON.stringify(
    {
      runId: RUN_ID,
      weekWindow,
      bookedMeetingCount: weeklyBookedMeetings.length,
      meetingSetCandidateCount: meetingSetCandidates.length,
      resolvedAthletes: athletesByKey.size,
      currentLifecycleStateProjected: currentLifecycleStateRows.length,
      appointmentsUpserted: appointmentsById.size,
      meetingSetEventsInsertedOnce: meetingSetEvents.length,
      nonMeetingSetSkipped,
      failures,
    },
    null,
    2,
  ),
);
