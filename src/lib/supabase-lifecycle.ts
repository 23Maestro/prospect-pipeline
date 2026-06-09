import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveAppointmentTitleOutcome } from './head-scout-event-prefix';
import { searchLogger } from './logger';
import { resolveSalesLifecycle } from './sales-lifecycle';
import {
  classifyCallTrackerReporting,
  classifyScoutTask,
  type ScoutTaskStatus,
} from '../domain/scout-task-classifier';
import { taskStatusForStage } from '../domain/supabase-lifecycle-translator';
import { resolveOwnerContext, type MaterializationStatus } from '../domain/owner-resolution';
import { buildOwnerProofPayload } from '../domain/owner-proof-payload';
import {
  buildCallActivityFact,
  buildCallLogFactFromCallActivityFact,
  buildCallLogFactFromMeetingSetFact,
  buildMeetingSetFact,
} from '../domain/call-tracker-facts';
import { resolveOwnerByName } from '../domain/owners';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  assertAppointmentTruthWrite,
  mergeAppointmentTruthRow,
} from '../domain/appointment-truth';

const FEATURE = 'supabase-lifecycle';
const DEFAULT_SCHEMA = 'public';
const REPO_ROOT_FALLBACK = '/Users/singleton23/Raycast/prospect-pipeline';
const API_BASE = 'http://127.0.0.1:8000/api/v1';

type Preferences = {
  supabaseUrl?: string;
  supabaseSecretKey?: string;
  supabaseServiceRoleKey?: string;
  supabaseSchema?: string;
};

type SupabaseConfig = {
  url: string;
  key: string;
  schema: string;
};

function readRaycastPreferenceValues(): Preferences {
  try {
    if (typeof require !== 'function') {
      return {};
    }
    const api = require('@raycast/api') as {
      getPreferenceValues?: <T extends Record<string, unknown>>() => T;
    };
    return api.getPreferenceValues?.<Preferences>() || {};
  } catch {
    return {};
  }
}

type PipelineActor = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
};

type AppointmentSnapshot = {
  appointmentId?: string | null;
  headScout?: string | null;
  startsAt?: string | null;
  status?: string | null;
  sourceEventId?: string | null;
  meetingTimezone?: string | null;
  meetingTimezoneLabel?: string | null;
  calendarTimezone?: string | null;
  previousAppointmentId?: string | null;
  originalAppointmentId?: string | null;
  rescheduleSequence?: number | null;
  operatorOwner?: string | null;
  operatorOwnerKey?: string | null;
  appointmentRole?: string | null;
  statusReason?: string | null;
  postMeetingResult?: string | null;
  sourceSystem?: string | null;
  sourcePayload?: Record<string, unknown> | null;
};

type PipelineStateSnapshot = {
  crmStage?: string | null;
  taskStatus?: string | null;
  headScout?: string | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  currentAppointmentId?: string | null;
};

type LifecycleWriteArgs = {
  athlete: PipelineActor;
  eventType: string;
  dedupeKey?: string | null;
  payload?: Record<string, unknown>;
  appointment?: AppointmentSnapshot | null;
  previousState?: Pick<PipelineStateSnapshot, 'crmStage' | 'taskStatus'> | null;
  state: PipelineStateSnapshot;
};

export type LifecycleMutationSourcePost =
  | '/sales/stage'
  | '/tasks/complete'
  | '/sales/meeting-set'
  | '/tasks/update'
  | '/tasks/call-attempt-3-sent'
  | '/tasks/follow-up-message-sent';

export type LifecycleMutationEventArgs = PipelineActor & {
  sourcePost: LifecycleMutationSourcePost;
  crmStage?: string | null;
  taskStatus?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  taskDescription?: string | null;
  activitySubtype?: ScoutTaskStatus | null;
  dueAt?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  completedAt?: string | null;
  completedDate?: string | null;
  completedTime?: string | null;
  occurredAt?: string | null;
  taskAssignedOwner?: string | null;
  materializationStatus?: MaterializationStatus | null;
  materializationReason?: string | null;
  appointmentId?: string | null;
  confirmationTaskId?: string | null;
  payload?: Record<string, unknown>;
};

export type LifecycleMutationEvent = {
  athlete: PipelineActor;
  eventType: string;
  payload: Record<string, unknown>;
  state: PipelineStateSnapshot;
};

export type MeetingSetWriteArgs = PipelineActor & {
  crmStage: string;
  taskStatus: string;
  headScout?: string | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  appointmentId?: string | null;
  sourceEventId?: string | null;
  startsAt?: string | null;
  meetingTimezone?: string | null;
  legacyAssignedTo?: string | null;
  meetingName?: string | null;
  taskDueDate?: string | null;
  payload?: Record<string, unknown>;
};

type ConfirmationQueuedWriteArgs = PipelineActor & {
  crmStage?: string | null;
  taskStatus: string;
  headScout?: string | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  appointmentId?: string | null;
  startsAt?: string | null;
  dueAt?: string | null;
  messagePreview?: string | null;
  lifecycleState?: string | null;
  messageVariant?: string | null;
};

type ConfirmationSentWriteArgs = PipelineActor & {
  crmStage?: string | null;
  taskStatus: string;
  headScout?: string | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  appointmentId?: string | null;
  sentAt?: string | null;
  dueAt?: string | null;
  messagePreview?: string | null;
  messageVariant?: string | null;
};

type VoicemailFollowUpSentWriteArgs = PipelineActor & {
  previousCrmStage?: string | null;
  previousTaskStatus?: string | null;
  crmStage: string;
  taskStatus: string;
  headScout?: string | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  messageVariant?: string | null;
};

type RescheduledWriteArgs = PipelineActor & {
  crmStage: string;
  taskStatus: string;
  headScout?: string | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  previousAppointmentId?: string | null;
  appointmentId?: string | null;
  sourceEventId?: string | null;
  startsAt?: string | null;
  dueAt?: string | null;
  payload?: Record<string, unknown>;
};

type AthletesRow = {
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  athlete_name: string;
  updated_at: string;
};

type CurrentLifecycleStateRow = {
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  crm_stage: string | null;
  task_status: string | null;
  head_scout: string | null;
  current_task_id: string | null;
  current_task_title: string | null;
  current_appointment_id: string | null;
  updated_at: string;
};

type AppointmentRow = {
  id: string;
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  head_scout: string | null;
  starts_at: string | null;
  status: string | null;
  source_event_id: string | null;
  meeting_timezone: string | null;
  meeting_timezone_label: string | null;
  calendar_timezone: string | null;
  previous_appointment_id: string | null;
  original_appointment_id: string | null;
  reschedule_sequence: number;
  operator_owner: string | null;
  operator_owner_key: string | null;
  head_scout_key: string | null;
  appointment_role: string | null;
  status_reason: string | null;
  post_meeting_result: string | null;
  source_system: string | null;
  source_payload: Record<string, unknown>;
  updated_at: string;
};

type LiveBookedMeetingEvent = {
  event_id: string;
  title: string;
  assigned_owner?: string | null;
  start?: string | null;
  end?: string | null;
  date_time_label?: string | null;
};

type LifecycleRetentionAction = 'keep' | 'soft_archive' | 'purge';

type LifecycleRetentionDecision = {
  action: LifecycleRetentionAction;
  effectiveCrmStage: string | null;
  reason: string;
};

type LifecycleEventRow = {
  id: string;
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  event_type: string;
  previous_crm_stage: string | null;
  previous_task_status: string | null;
  crm_stage: string | null;
  task_status: string | null;
  payload_json: Record<string, unknown>;
  created_at: string;
};

export type LifecycleHealthSnapshot = {
  enabled: boolean;
  config?: {
    url: string;
    schema: string;
  };
  stateRows: Array<{
    athlete_key: string;
    athlete_name: string;
    crm_stage: string | null;
    task_status: string | null;
    current_appointment_id: string | null;
    updated_at: string;
  }>;
  eventRows: Array<{
    event_type: string;
    crm_stage: string | null;
    task_status: string | null;
    athlete_id: string;
    athlete_main_id: string;
    created_at: string;
  }>;
};

export type ActiveMeetingFallbackRow = {
  athleteKey: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  crmStage: string | null;
  taskStatus: string | null;
  headScout: string | null;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  currentAppointmentId: string | null;
  appointmentStartsAt: string | null;
  appointmentStatus: string | null;
  updatedAt: string;
};

export type AppointmentPostMeetingResultProjection = {
  appointmentId: string;
  postMeetingResult: 'reschedule_pending';
  statusReason: 'sales_stage_reschedule_pending';
};

export type WeeklyScheduledAppointmentRow = {
  id: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string | null;
  headScout: string | null;
  startsAt: string;
  endsAt: string | null;
  status: string | null;
  sourceEventId: string | null;
  meetingTitle: string | null;
  meetingTimezone: string | null;
  meetingTimezoneLabel: string | null;
  postMeetingResult: string | null;
  previousAppointmentId: string | null;
  originalAppointmentId: string | null;
  rescheduleSequence: number | null;
};

function isEndedAppointmentTimestamp(value?: string | null, now = Date.now()): boolean {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return !Number.isNaN(timestamp) && timestamp <= now;
}

function logInfo(
  event: string,
  step: string,
  status: 'start' | 'success',
  context?: Record<string, unknown>,
) {
  searchLogger.info(event, {
    event,
    step,
    status,
    feature: FEATURE,
    context: context || {},
  });
}

function logFailure(event: string, step: string, error: string, context?: Record<string, unknown>) {
  searchLogger.error(event, {
    event,
    step,
    status: 'failure',
    feature: FEATURE,
    error,
    context: context || {},
  });
}

function readEnvFile(filePath: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const values: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!key) continue;
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function findProjectRoot(): string {
  const starts = [process.cwd(), REPO_ROOT_FALLBACK];
  const seen = new Set<string>();
  for (const start of starts) {
    let current = path.resolve(start);
    while (!seen.has(current)) {
      seen.add(current);
      const packagePath = path.join(current, 'package.json');
      try {
        const raw = fs.readFileSync(packagePath, 'utf8');
        const pkg = JSON.parse(raw) as { name?: string };
        if (pkg?.name === 'prospect-pipeline') {
          return current;
        }
      } catch {
        // keep walking up
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return process.cwd();
}

function readRepoEnv(): Record<string, string> {
  const roots = [findProjectRoot(), REPO_ROOT_FALLBACK]
    .map((value) => path.resolve(value))
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);

  return roots.reduce<Record<string, string>>((acc, root) => {
    return {
      ...acc,
      ...readEnvFile(path.join(root, 'npid-api-layer/.env')),
      ...readEnvFile(path.join(root, '.env')),
      ...readEnvFile(path.join(root, '.overmind.env')),
    };
  }, {});
}

export function getSupabasePersistenceConfig(): SupabaseConfig | null {
  const prefs = readRaycastPreferenceValues();
  const repoEnv = readRepoEnv();
  const url = String(process.env.SUPABASE_URL || repoEnv.SUPABASE_URL || prefs.supabaseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const key = String(
    process.env.SUPABASE_SECRET_KEY ||
      repoEnv.SUPABASE_SECRET_KEY ||
      prefs.supabaseSecretKey ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      repoEnv.SUPABASE_SERVICE_ROLE_KEY ||
      prefs.supabaseServiceRoleKey ||
      '',
  ).trim();
  const schema =
    String(
      process.env.SUPABASE_SCHEMA || repoEnv.SUPABASE_SCHEMA || prefs.supabaseSchema || '',
    ).trim() || DEFAULT_SCHEMA;
  if (!url || !key) {
    return null;
  }
  return { url, key, schema };
}

function normalizeValue(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function normalizeIsoValue(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
}

function normalizeLegacyDateTime(date?: string | null, time?: string | null): string | null {
  const dateValue = normalizeValue(date);
  const timeValue = normalizeValue(time);
  if (!dateValue) return null;
  const normalizedDate = dateValue.includes('/')
    ? (() => {
        const [month, day, year] = dateValue.split('/');
        return month && day && year
          ? `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
          : dateValue;
      })()
    : dateValue;
  const candidate = timeValue
    ? `${normalizedDate}T${timeValue.length === 5 ? `${timeValue}:00` : timeValue}`
    : normalizedDate;
  return normalizeIsoValue(candidate);
}

function payloadOwnerProof(payload?: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const ownerContext = payload.owner_context as Record<string, unknown> | undefined;
  const materializationProof = payload.materialization_proof as Record<string, unknown> | undefined;
  return (
    normalizeValue(payload.owner_proof as string | undefined) ||
    normalizeValue(ownerContext?.owner_proof as string | undefined) ||
    normalizeValue(materializationProof?.owner_proof as string | undefined) ||
    null
  );
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  return normalizeValue(payload[key] as string | null | undefined);
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = Number(payload[key]);
  return Number.isFinite(value) ? value : null;
}

function lifecycleMutationEventType(sourcePost: LifecycleMutationSourcePost): string {
  if (sourcePost === '/sales/stage') return 'sales_stage_changed';
  if (sourcePost === '/tasks/complete') return 'task_completed';
  if (sourcePost === '/sales/meeting-set') return 'meeting_set';
  if (sourcePost === '/tasks/update') return 'task_updated';
  if (sourcePost === '/tasks/call-attempt-3-sent') return 'call_attempt_3_sent';
  if (sourcePost === '/tasks/follow-up-message-sent') return 'follow_up_message_sent';
  return 'laravel_post_mutation';
}

function resolveMutationActivitySubtype(args: LifecycleMutationEventArgs): ScoutTaskStatus {
  if (args.activitySubtype) return args.activitySubtype;
  if (args.sourcePost === '/sales/meeting-set') return 'meeting_set';
  const taskClassification = classifyScoutTask({
    title: args.taskTitle,
    description: args.taskDescription,
    rowText: args.taskStatus || args.crmStage,
  }).taskStatus;
  if (taskClassification !== 'needs_manual_review') return taskClassification;
  const stageStatus = taskStatusForStage(args.crmStage, args.taskStatus);
  if (stageStatus) return stageStatus;
  return taskClassification;
}

function resolveMutationOccurredAt(args: LifecycleMutationEventArgs): {
  occurredAt: string | null;
  completedAt: string | null;
  dueAt: string | null;
  source: string | null;
} {
  const completedAt =
    normalizeIsoValue(args.completedAt) ||
    normalizeLegacyDateTime(args.completedDate, args.completedTime);
  const dueAt =
    normalizeIsoValue(args.dueAt) ||
    normalizeLegacyDateTime(args.dueDate, args.dueTime);
  const explicitOccurredAt = normalizeIsoValue(args.occurredAt);
  if (explicitOccurredAt) {
    return { occurredAt: explicitOccurredAt, completedAt, dueAt, source: 'input.occurred_at' };
  }
  if (completedAt) {
    return { occurredAt: completedAt, completedAt, dueAt, source: 'input.completed_at' };
  }
  if (dueAt) {
    return { occurredAt: dueAt, completedAt, dueAt, source: 'input.due_at' };
  }
  return { occurredAt: null, completedAt, dueAt, source: null };
}

export function buildLifecycleMutationEvent(args: LifecycleMutationEventArgs): LifecycleMutationEvent {
  const actor: PipelineActor = {
    athleteId: normalizeValue(args.athleteId) || '',
    athleteMainId: normalizeValue(args.athleteMainId) || '',
    athleteName: normalizeValue(args.athleteName) || '',
  };
  if (!actor.athleteId || !actor.athleteMainId) {
    throw new Error('Lifecycle mutation events require athleteId and athleteMainId.');
  }

  const activitySubtype = resolveMutationActivitySubtype(args);
  const reporting = classifyCallTrackerReporting(activitySubtype);
  const isCountableActivity = reporting.countsAsDial || reporting.countsAsContact;
  const isMeetingSetMutation = args.sourcePost === '/sales/meeting-set' && reporting.countsAsMeetingSet;
  const taskId = normalizeValue(args.taskId);
  if (isCountableActivity && !isMeetingSetMutation && !taskId) {
    throw new Error('Lifecycle mutation countable activity requires taskId.');
  }
  if (isCountableActivity && !actor.athleteName) {
    throw new Error('Lifecycle mutation countable activity requires athleteName.');
  }
  if (isCountableActivity && !normalizeValue(args.taskAssignedOwner)) {
    throw new Error('Lifecycle mutation countable activity requires taskAssignedOwner for owner proof.');
  }
  if (isCountableActivity && !normalizeValue(args.crmStage)) {
    throw new Error('Lifecycle mutation countable activity requires raw crmStage.');
  }

  const clock = resolveMutationOccurredAt(args);
  if (isCountableActivity && !clock.occurredAt) {
    throw new Error('Lifecycle mutation countable activity requires completedAt, occurredAt, or dueAt.');
  }

  const ownerContext = resolveOwnerContext({
    purpose: reporting.countsAsMeetingSet ? 'meeting_set' : 'call_activity',
    athleteId: actor.athleteId,
    athleteMainId: actor.athleteMainId,
    tasks: taskId || args.taskAssignedOwner
      ? [
          {
            task_id: taskId,
            title: normalizeValue(args.taskTitle),
            description: normalizeValue(args.taskDescription),
            assigned_owner: normalizeValue(args.taskAssignedOwner),
          },
        ]
      : [],
    selectedTaskId: taskId || undefined,
  });
  const canCount = ownerContext.materializationStatus === 'operator_task';
  const ownerProof =
    ownerContext.ownerProof ||
    payloadOwnerProof(args.payload) ||
    (canCount && normalizeValue(args.taskAssignedOwner) ? 'task.assigned_owner' : null);
  if (isCountableActivity && canCount && !ownerProof) {
    throw new Error('Lifecycle mutation countable activity requires owner proof.');
  }

  const payload = {
    ...(args.payload || {}),
    source_post: args.sourcePost,
    athlete_name: actor.athleteName,
    task_id: taskId,
    activity_subtype: reporting.activityKind ? activitySubtype : null,
    activity_kind: reporting.activityKind,
    due_at: clock.dueAt,
    completed_at: clock.completedAt,
    occurred_at: clock.occurredAt,
    occurred_at_source: clock.source,
    ...buildOwnerProofPayload({
      ownerContext,
      ownerProof,
      taskAssignedOwner: args.taskAssignedOwner,
      basePayload: args.payload,
    }),
    athlete_id: actor.athleteId,
    athlete_main_id: actor.athleteMainId,
    tracker_outcome: reporting.trackerOutcome,
    counts_as_dial: canCount ? reporting.countsAsDial : false,
    counts_as_contact: canCount ? reporting.countsAsContact : false,
    counts_as_meeting_set: canCount ? reporting.countsAsMeetingSet : false,
    counts_as_post_meeting_outcome: canCount ? reporting.countsAsPostMeetingOutcome : false,
    appointment_id: normalizeValue(args.appointmentId),
    confirmation_task_id: normalizeValue(args.confirmationTaskId),
  };

  return {
    athlete: actor,
    eventType: lifecycleMutationEventType(args.sourcePost),
    payload,
    state: {
      crmStage: normalizeValue(args.crmStage),
      taskStatus: normalizeValue(args.taskStatus) || normalizeValue(args.taskTitle) || activitySubtype,
      currentTaskId: taskId,
      currentTaskTitle: normalizeValue(args.taskTitle),
      currentAppointmentId: normalizeValue(args.appointmentId),
    },
  };
}

export function buildAthleteKey(athleteId: string, athleteMainId: string): string {
  return `${athleteId.trim()}:${athleteMainId.trim()}`;
}

export function buildAppointmentId(args: {
  athleteId: string;
  athleteMainId: string;
  appointmentId?: string | null;
  sourceEventId?: string | null;
  startsAt?: string | null;
}): string {
  const explicit = normalizeValue(args.appointmentId) || normalizeValue(args.sourceEventId);
  if (explicit) {
    return explicit;
  }
  const startsAt = normalizeIsoValue(args.startsAt);
  if (startsAt) {
    return `appointment:${buildAthleteKey(args.athleteId, args.athleteMainId)}:${startsAt}`;
  }
  return `appointment:${buildAthleteKey(args.athleteId, args.athleteMainId)}`;
}

export function buildReminderDedupeKey(args: {
  appointmentId: string;
  kind: string;
  suffix: string;
  sendAt?: string | null;
}): string {
  return [
    args.appointmentId.trim(),
    args.kind.trim(),
    args.suffix.trim(),
    normalizeIsoValue(args.sendAt) || 'none',
  ].join(':');
}

function buildAthleteRow(actor: PipelineActor, updatedAt: string): AthletesRow {
  return {
    athlete_key: buildAthleteKey(actor.athleteId, actor.athleteMainId),
    athlete_id: actor.athleteId.trim(),
    athlete_main_id: actor.athleteMainId.trim(),
    athlete_name: actor.athleteName.trim(),
    updated_at: updatedAt,
  };
}

function buildCurrentLifecycleStateRow(args: {
  athleteKey: string;
  athleteId: string;
  athleteMainId: string;
  crmStage?: string | null;
  taskStatus?: string | null;
  payload?: Record<string, unknown> | null;
  updatedAt?: string | null;
}): CurrentLifecycleStateRow {
  const payload = args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload)
    ? args.payload
    : {};
  return {
    athlete_key: args.athleteKey,
    athlete_id: args.athleteId,
    athlete_main_id: args.athleteMainId,
    crm_stage: normalizeValue(args.crmStage),
    task_status: normalizeValue(args.taskStatus),
    head_scout: normalizeValue(payload.head_scout as string | null),
    current_task_id: normalizeValue(payload.current_task_id as string | null),
    current_task_title: normalizeValue(payload.current_task_title as string | null),
    current_appointment_id:
      normalizeValue(payload.current_appointment_id as string | null) ||
      normalizeValue(payload.appointment_id as string | null) ||
      normalizeValue(payload.live_event_id as string | null) ||
      normalizeValue(payload.source_event_id as string | null),
    updated_at: normalizeIsoValue(args.updatedAt) || args.updatedAt || new Date().toISOString(),
  };
}

export function buildAppointmentRow(
  actor: PipelineActor,
  appointment: AppointmentSnapshot,
  updatedAt: string,
): AppointmentRow {
  const appointmentId = buildAppointmentId({
    athleteId: actor.athleteId,
    athleteMainId: actor.athleteMainId,
    appointmentId: appointment.appointmentId,
    sourceEventId: appointment.sourceEventId,
    startsAt: appointment.startsAt,
  });
  const headScout = normalizeValue(appointment.headScout);
  const resolvedHeadScout = resolveOwnerByName(headScout);
  return {
    id: appointmentId,
    athlete_key: buildAthleteKey(actor.athleteId, actor.athleteMainId),
    athlete_id: actor.athleteId.trim(),
    athlete_main_id: actor.athleteMainId.trim(),
    head_scout: headScout,
    starts_at: normalizeIsoValue(appointment.startsAt),
    status: normalizeValue(appointment.status),
    source_event_id: normalizeValue(appointment.sourceEventId),
    meeting_timezone: normalizeValue(appointment.meetingTimezone),
    meeting_timezone_label: normalizeValue(appointment.meetingTimezoneLabel),
    calendar_timezone: normalizeValue(appointment.calendarTimezone),
    previous_appointment_id: normalizeValue(appointment.previousAppointmentId),
    original_appointment_id: normalizeValue(appointment.originalAppointmentId),
    reschedule_sequence: Math.max(0, Math.trunc(Number(appointment.rescheduleSequence || 0))),
    operator_owner: normalizeValue(appointment.operatorOwner),
    operator_owner_key: normalizeValue(appointment.operatorOwnerKey),
    head_scout_key: resolvedHeadScout?.ownerKey || null,
    appointment_role: normalizeValue(appointment.appointmentRole),
    status_reason: normalizeValue(appointment.statusReason),
    post_meeting_result: normalizeValue(appointment.postMeetingResult),
    source_system: normalizeValue(appointment.sourceSystem),
    source_payload: appointment.sourcePayload || {},
    updated_at: updatedAt,
  };
}

function buildLifecycleEventRow(
  actor: PipelineActor,
  args: LifecycleWriteArgs,
  createdAt: string,
): LifecycleEventRow | Omit<LifecycleEventRow, 'previous_crm_stage' | 'previous_task_status'> {
  const row = {
    id: randomUUID(),
    athlete_key: buildAthleteKey(actor.athleteId, actor.athleteMainId),
    athlete_id: actor.athleteId.trim(),
    athlete_main_id: actor.athleteMainId.trim(),
    event_type: args.eventType.trim(),
    dedupe_key: normalizeValue(args.dedupeKey),
    crm_stage: normalizeValue(args.state.crmStage),
    task_status: normalizeValue(args.state.taskStatus),
    payload_json: {
      ...(args.payload || {}),
      head_scout: normalizeValue(args.state.headScout),
      current_task_id: normalizeValue(args.state.currentTaskId),
      current_task_title: normalizeValue(args.state.currentTaskTitle),
      current_appointment_id: normalizeValue(args.state.currentAppointmentId),
    },
    created_at: createdAt,
  };

  if (!args.previousState) {
    return row;
  }

  return {
    ...row,
    previous_crm_stage: normalizeValue(args.previousState.crmStage),
    previous_task_status: normalizeValue(args.previousState.taskStatus),
  };
}

async function request(
  config: SupabaseConfig,
  table: string,
  args: {
    method?: 'PATCH' | 'POST';
    rows: unknown[] | Record<string, unknown>;
    onConflict?: string;
    query?: string;
  },
): Promise<void> {
  const params = new URLSearchParams();
  if (args.onConflict) {
    params.set('on_conflict', args.onConflict);
  }
  if (args.query) {
    const queryParams = new URLSearchParams(args.query);
    for (const [key, value] of queryParams.entries()) {
      params.append(key, value);
    }
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  const endpoint = `${config.url}/rest/v1/${encodeURIComponent(table)}${query}`;
  const response = await fetch(endpoint, {
    method: args.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      Prefer: args.onConflict ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
      'Accept-Profile': config.schema,
      'Content-Profile': config.schema,
    },
    body: JSON.stringify(args.rows),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText.slice(0, 300) || `Supabase HTTP ${response.status}`);
  }
}

async function deleteRows(config: SupabaseConfig, table: string, query: string): Promise<void> {
  const endpoint = `${config.url}/rest/v1/${encodeURIComponent(table)}?${query}`;
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      Prefer: 'return=minimal',
      'Accept-Profile': config.schema,
      'Content-Profile': config.schema,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText.slice(0, 300) || `Supabase HTTP ${response.status}`);
  }
}

async function queryTable<T>(config: SupabaseConfig, table: string, query: string): Promise<T[]> {
  const endpoint = `${config.url}/rest/v1/${encodeURIComponent(table)}?${query}`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Accept-Profile': config.schema,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText.slice(0, 300) || `Supabase HTTP ${response.status}`);
  }

  const payload = (await response.json()) as T[];
  return Array.isArray(payload) ? payload : [];
}

async function fetchLiveSelectedSalesStage(athleteId: string): Promise<string | null> {
  const response = await fetch(
    `${API_BASE}/sales/stages/${encodeURIComponent(athleteId.trim())}`,
  ).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | { selected_label?: string | null; selected_value?: string | null }
    | null;
  return normalizeValue(payload?.selected_label) || normalizeValue(payload?.selected_value);
}

async function fetchLiveBookedEvent(args: {
  athleteId: string;
  athleteMainId: string;
  eventId: string;
}): Promise<LiveBookedMeetingEvent | null> {
  const response = await fetch(
    `${API_BASE}/calendar/athlete-booked-meetings?athlete_id=${encodeURIComponent(
      args.athleteId.trim(),
    )}&athlete_main_id=${encodeURIComponent(args.athleteMainId.trim())}`,
  ).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | { events?: LiveBookedMeetingEvent[] | null }
    | null;
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return (
    events.find((event) => String(event.event_id || '').trim() === args.eventId.trim()) || null
  );
}

export function resolveLifecycleRetentionDecision(args: {
  crmStage?: string | null;
  liveCrmStage?: string | null;
  bookedEventTitle?: string | null;
}): LifecycleRetentionDecision {
  const effectiveCrmStage = normalizeValue(args.liveCrmStage) || normalizeValue(args.crmStage);
  const effectiveLifecycle = resolveSalesLifecycle(effectiveCrmStage);
  if (effectiveLifecycle.shouldArchiveFromWorkingViews) {
    return {
      action: 'purge',
      effectiveCrmStage,
      reason: effectiveLifecycle.reason,
    };
  }

  const titleOutcome = resolveAppointmentTitleOutcome(args.bookedEventTitle);
  if (titleOutcome === 'terminal_enrollment') {
    return {
      action: 'purge',
      effectiveCrmStage,
      reason: 'Booked event title shows enrollment, so the lifecycle is complete.',
    };
  }
  if (titleOutcome === 'terminal_close_lost') {
    return {
      action: 'purge',
      effectiveCrmStage,
      reason: 'Booked event title is marked (CL), so the lifecycle is closed lost.',
    };
  }
  if (titleOutcome === 'soft_archive_follow_up') {
    return {
      action: 'soft_archive',
      effectiveCrmStage,
      reason: 'Booked event title is marked (FU), so keep history but remove it from active queues.',
    };
  }
  if (titleOutcome === 'soft_archive_canceled') {
    return {
      action: 'soft_archive',
      effectiveCrmStage,
      reason: 'Booked event title is marked (CAN), so keep the athlete dormant but remove this canceled meeting from active queues.',
    };
  }
  if (titleOutcome === 'soft_archive_no_show') {
    return {
      action: 'soft_archive',
      effectiveCrmStage,
      reason: 'Booked event title is marked (NS), so keep the athlete active but remove this meeting from active queues.',
    };
  }

  return {
    action: 'keep',
    effectiveCrmStage,
    reason: 'Supabase lifecycle is still active.',
  };
}

export function resolveAppointmentPostMeetingResultProjectionForSalesStage(args: {
  crmStage?: string | null;
  appointmentId?: string | null;
}): AppointmentPostMeetingResultProjection | null {
  const appointmentId = normalizeValue(args.appointmentId);
  if (!appointmentId) return null;

  const lifecycle = resolveSalesLifecycle(args.crmStage);
  if (lifecycle.normalizedStage !== 'reschedule_pending') return null;

  return {
    appointmentId,
    postMeetingResult: 'reschedule_pending',
    statusReason: 'sales_stage_reschedule_pending',
  };
}

async function patchAppointmentPostMeetingResultProjection(args: {
  config: SupabaseConfig;
  projection: AppointmentPostMeetingResultProjection;
}): Promise<void> {
  await request(args.config, 'appointments', {
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(args.projection.appointmentId)}`,
    rows: {
      post_meeting_result: args.projection.postMeetingResult,
      status_reason: args.projection.statusReason,
      updated_at: new Date().toISOString(),
    },
  });
}

async function patchPreviousAppointmentRescheduledResult(args: {
  config: SupabaseConfig;
  previousAppointmentId: string;
}): Promise<void> {
  await request(args.config, 'appointments', {
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(args.previousAppointmentId)}`,
    rows: {
      post_meeting_result: 'rescheduled',
      status_reason: 'rescheduled_replaced_by_new_appointment',
      updated_at: new Date().toISOString(),
    },
  });
}

async function softArchiveCurrentAppointment(args: {
  config: SupabaseConfig;
  athleteKey: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  crmStage?: string | null;
  taskStatus?: string | null;
  currentAppointmentId?: string | null;
  bookedEventTitle?: string | null;
  reason: string;
}): Promise<void> {
  const updatedAt = new Date().toISOString();
  await request(args.config, 'lifecycle_events', {
    rows: [
      {
        id: randomUUID(),
        athlete_key: args.athleteKey,
        athlete_id: args.athleteId,
        athlete_main_id: args.athleteMainId,
        event_type: 'meeting_soft_archived',
        crm_stage: normalizeValue(args.crmStage),
        task_status: normalizeValue(args.taskStatus),
        payload_json: {
          current_appointment_id: normalizeValue(args.currentAppointmentId),
          current_task_id: null,
          current_task_title: null,
          booked_event_title: normalizeValue(args.bookedEventTitle),
          reason: args.reason,
        },
        created_at: updatedAt,
      },
    ],
  });
}

async function purgeAthleteLifecycle(args: {
  config: SupabaseConfig;
  athleteKey: string;
}): Promise<void> {
  await deleteRows(args.config, 'athletes', `athlete_key=eq.${encodeURIComponent(args.athleteKey)}`);
}

async function writeLifecycle(args: LifecycleWriteArgs): Promise<{ enabled: boolean }> {
  const config = getSupabasePersistenceConfig();
  if (!config) {
    return { enabled: false };
  }

  const updatedAt = new Date().toISOString();
  const athleteRow = buildAthleteRow(args.athlete, updatedAt);
  const appointmentRow = args.appointment
    ? buildAppointmentRow(args.athlete, args.appointment, updatedAt)
    : null;
  const eventRow = buildLifecycleEventRow(args.athlete, args, updatedAt);

  logInfo('SUPABASE_LIFECYCLE_WRITE', 'request', 'start', {
    eventType: args.eventType,
    athleteKey: athleteRow.athlete_key,
    hasAppointment: Boolean(appointmentRow),
  });

  try {
    await request(config, 'athletes', {
      rows: [athleteRow],
      onConflict: 'athlete_key',
    });

    if (appointmentRow) {
      const [existingAppointment] = await queryTable<AppointmentRow>(
        config,
        'appointments',
        `select=*&id=eq.${encodeURIComponent(appointmentRow.id)}&limit=1`,
      );
      const rowToWrite = mergeAppointmentTruthRow(existingAppointment, appointmentRow);
      assertAppointmentTruthWrite(rowToWrite);
      await request(config, 'appointments', {
        rows: [rowToWrite],
        onConflict: 'id',
      });
    }

    await request(config, 'lifecycle_events', {
      rows: [eventRow],
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logFailure('SUPABASE_LIFECYCLE_WRITE', 'request', message, {
      eventType: args.eventType,
      athleteKey: athleteRow.athlete_key,
    });
    throw error;
  }

  logInfo('SUPABASE_LIFECYCLE_WRITE', 'request', 'success', {
    eventType: args.eventType,
    athleteKey: athleteRow.athlete_key,
    appointmentId: appointmentRow?.id || null,
  });

  return { enabled: true };
}

export async function lifecycleSalesStage(
  args: LifecycleMutationEventArgs,
): Promise<{ enabled: boolean }> {
  const event = buildLifecycleMutationEvent(args);
  const result = await writeLifecycle({
    athlete: event.athlete,
    eventType: event.eventType,
    payload: event.payload,
    state: event.state,
  });
  if (!result.enabled) return result;

  const config = getSupabasePersistenceConfig();
  const appointmentProjection = resolveAppointmentPostMeetingResultProjectionForSalesStage({
    crmStage: event.state.crmStage,
    appointmentId: event.state.currentAppointmentId,
  });
  if (config && appointmentProjection) {
    await patchAppointmentPostMeetingResultProjection({
      config,
      projection: appointmentProjection,
    });
  }

  const activitySubtype = normalizeValue(event.payload.activity_subtype as string | null);
  const taskId = normalizeValue(event.payload.task_id as string | null);
  const occurredAt = normalizeValue(event.payload.occurred_at as string | null);
  const taskAssignedOwner = normalizeValue(event.payload.task_assigned_owner as string | null);
  const countsAsCallActivity =
    event.payload.counts_as_dial === true || event.payload.counts_as_contact === true;

  if (!countsAsCallActivity || !activitySubtype || !taskId || !occurredAt || !taskAssignedOwner) {
    return result;
  }

  if (!config) return result;

  const row = buildCallActivityFact({
    athleteId: event.athlete.athleteId,
    athleteMainId: event.athlete.athleteMainId,
    athleteName: event.athlete.athleteName,
    taskId,
    taskTitle: event.state.currentTaskTitle,
    taskDescription: normalizeValue(args.taskDescription),
    rawCrmStage: event.state.crmStage,
    rawTaskStatus: event.state.taskStatus,
    activitySubtype,
    occurredAt,
    ownerInput: {
      purpose: 'call_activity',
      athleteId: event.athlete.athleteId,
      athleteMainId: event.athlete.athleteMainId,
      athleteName: event.athlete.athleteName,
      tasks: [
        {
          task_id: taskId,
          title: event.state.currentTaskTitle,
          description: normalizeValue(args.taskDescription),
          assigned_owner: taskAssignedOwner,
        },
      ],
      currentTaskId: taskId,
    },
    payload: {
      ...event.payload,
      source: 'raycast_laravel_update',
      lifecycle_event_type: event.eventType,
    },
  });

  await request(config, 'call_log', {
    rows: [buildCallLogFactFromCallActivityFact(row)],
    onConflict: 'dedupe_key',
  });

  return result;
}

export async function recordMeetingSet(args: MeetingSetWriteArgs): Promise<{ enabled: boolean }> {
  const appointmentId = buildAppointmentId(args);
  const recordedAt = new Date().toISOString();
  const dedupeKey = `meeting_set:${buildAthleteKey(args.athleteId, args.athleteMainId)}:${appointmentId}`;
  const existingPayload = args.payload || {};
  const meetingSetTaskOwner =
    normalizeValue(existingPayload.task_assigned_owner as string | undefined) ||
    normalizeValue((existingPayload.owner_context as Record<string, unknown> | undefined)?.task_assigned_owner as string | undefined) ||
    normalizeValue((existingPayload.materialization_proof as Record<string, unknown> | undefined)?.task_assigned_owner as string | undefined);
  const mutationPayload = meetingSetTaskOwner
    ? buildLifecycleMutationEvent({
        sourcePost: '/sales/meeting-set',
        athleteId: args.athleteId,
        athleteMainId: args.athleteMainId,
        athleteName: args.athleteName,
        crmStage: args.crmStage,
        taskStatus: args.taskStatus,
        taskId: args.currentTaskId,
        taskTitle: args.currentTaskTitle,
        taskAssignedOwner: meetingSetTaskOwner,
        dueAt: args.taskDueDate,
        occurredAt: recordedAt,
        appointmentId,
        payload: existingPayload,
      }).payload
    : existingPayload;
  const lifecyclePayload = {
    meeting_timezone: normalizeValue(args.meetingTimezone),
    legacy_assigned_to: normalizeValue(args.legacyAssignedTo),
    meeting_name: normalizeValue(args.meetingName),
    task_due_date: normalizeIsoValue(args.taskDueDate),
    starts_at: normalizeIsoValue(args.startsAt),
    ...mutationPayload,
    occurred_at: recordedAt,
    occurred_at_source: 'scout_prep_action.recordMeetingSet',
  };
  const result = await writeLifecycle({
    athlete: args,
    eventType: 'meeting_set',
    dedupeKey,
    payload: lifecyclePayload,
    appointment: {
      appointmentId,
      sourceEventId: args.sourceEventId || args.appointmentId,
      headScout: args.headScout,
      startsAt: args.startsAt,
      status: 'scheduled',
      meetingTimezone: args.meetingTimezone,
      meetingTimezoneLabel: payloadString(mutationPayload, 'meeting_timezone_label'),
      calendarTimezone: payloadString(mutationPayload, 'calendar_timezone'),
      originalAppointmentId: appointmentId,
      rescheduleSequence: 0,
      operatorOwner: payloadString(mutationPayload, 'operator_owner'),
      operatorOwnerKey: payloadString(mutationPayload, 'operator_owner_key'),
      appointmentRole: 'initial_set',
      statusReason: 'meeting_set_written',
      sourceSystem: 'scout_prep_action',
      sourcePayload: {
        source_event_id: normalizeValue(args.sourceEventId || args.appointmentId),
        meeting_name: normalizeValue(args.meetingName),
        owner_proof: payloadOwnerProof(mutationPayload),
      },
    },
    state: {
      crmStage: args.crmStage,
      taskStatus: args.taskStatus,
      headScout: args.headScout,
      currentTaskId: args.currentTaskId,
      currentTaskTitle: args.currentTaskTitle,
      currentAppointmentId: appointmentId,
    },
  });
  if (!result.enabled) return result;

  const config = getSupabasePersistenceConfig();
  if (!config) return result;

  const factRow = buildMeetingSetFact({
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    crmStage: args.crmStage,
    taskStatus: args.taskStatus,
    payload: lifecyclePayload,
    createdAt: recordedAt,
  });
  await request(config, 'call_log', {
    rows: [buildCallLogFactFromMeetingSetFact(factRow)],
    onConflict: 'dedupe_key',
  });

  return result;
}

export async function recordConfirmationQueued(
  args: ConfirmationQueuedWriteArgs,
): Promise<{ enabled: boolean }> {
  const appointmentId = buildAppointmentId(args);
  return writeLifecycle({
    athlete: args,
    eventType: 'confirmation_queued',
    payload: {
      lifecycle_state: normalizeValue(args.lifecycleState),
      message_preview: normalizeValue(args.messagePreview)?.slice(0, 240) || null,
      message_variant: normalizeValue(args.messageVariant),
    },
    appointment: {
      appointmentId,
      headScout: args.headScout,
      startsAt: args.startsAt,
      status: 'confirmation_queued',
      sourceEventId: args.appointmentId,
      appointmentRole: 'confirmation',
      statusReason: 'confirmation_queued',
    },
    state: {
      crmStage: args.crmStage,
      taskStatus: args.taskStatus,
      headScout: args.headScout,
      currentTaskId: args.currentTaskId,
      currentTaskTitle: args.currentTaskTitle,
      currentAppointmentId: appointmentId,
    },
  });
}

export async function recordConfirmationSent(
  args: ConfirmationSentWriteArgs,
): Promise<{ enabled: boolean }> {
  const appointmentId = buildAppointmentId(args);
  return writeLifecycle({
    athlete: args,
    eventType: 'confirmation_sent',
    payload: {
      message_preview: normalizeValue(args.messagePreview)?.slice(0, 240) || null,
      message_variant: normalizeValue(args.messageVariant),
    },
    appointment: {
      appointmentId,
      headScout: args.headScout,
      status: 'confirmation_sent',
      sourceEventId: args.appointmentId,
      appointmentRole: 'confirmation',
      statusReason: 'confirmation_sent',
    },
    state: {
      crmStage: args.crmStage,
      taskStatus: args.taskStatus,
      headScout: args.headScout,
      currentTaskId: args.currentTaskId,
      currentTaskTitle: args.currentTaskTitle,
      currentAppointmentId: appointmentId,
    },
  });
}

export async function recordVoicemailFollowUpSent(
  args: VoicemailFollowUpSentWriteArgs,
): Promise<{ enabled: boolean }> {
  return writeLifecycle({
    athlete: args,
    eventType: 'voicemail_follow_up_sent',
    previousState: {
      crmStage: args.previousCrmStage,
      taskStatus: args.previousTaskStatus,
    },
    payload: {
      message_variant: normalizeValue(args.messageVariant),
      previous_crm_stage: normalizeValue(args.previousCrmStage),
      previous_task_status: normalizeValue(args.previousTaskStatus),
    },
    state: {
      crmStage: args.crmStage,
      taskStatus: args.taskStatus,
      headScout: args.headScout,
      currentTaskId: args.currentTaskId,
      currentTaskTitle: args.currentTaskTitle,
      currentAppointmentId: null,
    },
  });
}

export async function recordRescheduled(args: RescheduledWriteArgs): Promise<{ enabled: boolean }> {
  const appointmentId = buildAppointmentId(args);
  const previousAppointmentId = normalizeValue(args.previousAppointmentId);
  const payload = args.payload || {};
  const result = await writeLifecycle({
    athlete: args,
    eventType: 'rescheduled',
    payload: {
      previous_appointment_id: previousAppointmentId,
      due_at: normalizeIsoValue(args.dueAt),
      starts_at: normalizeIsoValue(args.startsAt),
    },
    appointment: {
      appointmentId,
      headScout: args.headScout,
      startsAt: args.startsAt,
      status: 'scheduled',
      sourceEventId: args.sourceEventId || args.appointmentId,
      meetingTimezone: payloadString(payload, 'meeting_timezone'),
      meetingTimezoneLabel: payloadString(payload, 'meeting_timezone_label'),
      calendarTimezone: payloadString(payload, 'calendar_timezone'),
      previousAppointmentId,
      originalAppointmentId:
        payloadString(payload, 'original_appointment_id') || previousAppointmentId || appointmentId,
      rescheduleSequence: payloadNumber(payload, 'reschedule_sequence') || (previousAppointmentId ? 1 : 0),
      operatorOwner: payloadString(payload, 'operator_owner'),
      operatorOwnerKey: payloadString(payload, 'operator_owner_key'),
      appointmentRole: 'reschedule',
      statusReason: 'rescheduled_new_appointment_written',
      sourceSystem: 'scout_prep_action',
      sourcePayload: {
        source_event_id: normalizeValue(args.sourceEventId || args.appointmentId),
        previous_appointment_id: previousAppointmentId,
      },
    },
    state: {
      crmStage: args.crmStage,
      taskStatus: args.taskStatus,
      headScout: args.headScout,
      currentTaskId: args.currentTaskId,
      currentTaskTitle: args.currentTaskTitle,
      currentAppointmentId: appointmentId,
    },
  });
  if (!result.enabled || !previousAppointmentId) return result;

  const config = getSupabasePersistenceConfig();
  if (config) {
    await patchPreviousAppointmentRescheduledResult({
      config,
      previousAppointmentId,
    });
  }

  return result;
}

export async function getLifecycleHealthSnapshot(): Promise<LifecycleHealthSnapshot> {
  const config = getSupabasePersistenceConfig();
  if (!config) {
    return {
      enabled: false,
      stateRows: [],
      eventRows: [],
    };
  }

  const [stateEventRows, eventRows] = await Promise.all([
    queryTable<LifecycleEventRow>(
      config,
      'lifecycle_events',
      'select=athlete_key,athlete_id,athlete_main_id,event_type,crm_stage,task_status,payload_json,created_at&order=created_at.desc&limit=100',
    ),
    queryTable<LifecycleHealthSnapshot['eventRows'][number]>(
      config,
      'lifecycle_events',
      'select=event_type,crm_stage,task_status,athlete_id,athlete_main_id,created_at&order=created_at.desc&limit=15',
    )
  ]);

  const latestStateRowsByAthlete = new Map<string, CurrentLifecycleStateRow>();
  for (const row of stateEventRows) {
    const athleteKey = String(row.athlete_key || '').trim();
    if (!athleteKey || latestStateRowsByAthlete.has(athleteKey)) continue;
    latestStateRowsByAthlete.set(athleteKey, buildCurrentLifecycleStateRow({
      athleteKey,
      athleteId: String(row.athlete_id || '').trim(),
      athleteMainId: String(row.athlete_main_id || '').trim(),
      crmStage: row.crm_stage,
      taskStatus: row.task_status,
      payload: row.payload_json,
      updatedAt: row.created_at,
    }));
    if (latestStateRowsByAthlete.size >= 10) break;
  }
  const stateRows = Array.from(latestStateRowsByAthlete.values());
  const athleteKeys = Array.from(new Set(stateRows.map((row) => row.athlete_key).filter(Boolean)));
  const athleteRows = athleteKeys.length
    ? await queryTable<Pick<AthletesRow, 'athlete_key' | 'athlete_name'>>(
        config,
        'athletes',
        `select=athlete_key,athlete_name&athlete_key=in.(${athleteKeys.map((key) => `"${key}"`).join(',')})`,
      )
    : [];
  const athleteNameByKey = new Map(athleteRows.map((row) => [row.athlete_key, row.athlete_name]));

  return {
    enabled: true,
    config: {
      url: config.url,
      schema: config.schema,
    },
    stateRows: stateRows.map((row) => ({
      ...row,
      athlete_name: athleteNameByKey.get(row.athlete_key) || '',
    })),
    eventRows,
  };
}

export async function getActiveMeetingFallbackRows(): Promise<ActiveMeetingFallbackRow[]> {
  const config = getSupabasePersistenceConfig();
  if (!config) {
    return [];
  }

  const [stateEventRows, athleteRows, appointmentRows] = await Promise.all([
    queryTable<LifecycleEventRow>(
      config,
      'lifecycle_events',
      [
        'select=athlete_key,athlete_id,athlete_main_id,event_type,crm_stage,task_status,payload_json,created_at',
        'order=created_at.desc',
        'limit=500',
      ].join('&'),
    ),
    queryTable<{ athlete_key: string; athlete_name: string }>(
      config,
      'athletes',
      'select=athlete_key,athlete_name&limit=500',
    ),
    queryTable<{ id: string; starts_at: string | null; status: string | null; source_event_id: string | null }>(
      config,
      'appointments',
      'select=id,starts_at,status,source_event_id&limit=500',
    ),
  ]);

  const athleteNamesByKey = new Map(
    athleteRows.map((row) => [
      String(row.athlete_key || '').trim(),
      String(row.athlete_name || '').trim(),
    ]),
  );
  const appointmentsById = new Map(
    appointmentRows.map((row) => [String(row.id || '').trim(), row]),
  );

  const now = Date.now();
  const results: ActiveMeetingFallbackRow[] = [];
  const latestStateRowsByAthlete = new Map<string, CurrentLifecycleStateRow>();

  for (const row of stateEventRows) {
    const athleteKey = String(row.athlete_key || '').trim();
    if (!athleteKey || latestStateRowsByAthlete.has(athleteKey)) continue;
    const stateRow = buildCurrentLifecycleStateRow({
      athleteKey,
      athleteId: String(row.athlete_id || '').trim(),
      athleteMainId: String(row.athlete_main_id || '').trim(),
      crmStage: row.crm_stage,
      taskStatus: row.task_status,
      payload: row.payload_json,
      updatedAt: row.created_at,
    });
    if (!normalizeValue(stateRow.current_appointment_id)) continue;
    latestStateRowsByAthlete.set(athleteKey, stateRow);
    if (latestStateRowsByAthlete.size >= 200) break;
  }

  for (const row of latestStateRowsByAthlete.values()) {
    const appointmentId = String(row.current_appointment_id || '').trim();
    const appointment = appointmentId ? appointmentsById.get(appointmentId) : null;
    const athleteKey = String(row.athlete_key || '').trim();
    const storedCrmStage = normalizeValue(row.crm_stage);
    const storedLifecycle = resolveSalesLifecycle(storedCrmStage);

    if (storedLifecycle.shouldArchiveFromWorkingViews) {
      await purgeAthleteLifecycle({ config, athleteKey }).catch(() => undefined);
      continue;
    }

    const appointmentStartsAt = normalizeIsoValue(appointment?.starts_at);
    const appointmentTimestamp = appointmentStartsAt ? Date.parse(appointmentStartsAt) : Number.NaN;
    const shouldReconcileLive =
      !appointmentStartsAt || Number.isNaN(appointmentTimestamp) || appointmentTimestamp <= now;

    if (shouldReconcileLive) {
      const liveCrmStage = await fetchLiveSelectedSalesStage(String(row.athlete_id || '').trim());
      const liveEvent = appointmentId
        ? await fetchLiveBookedEvent({
            athleteId: String(row.athlete_id || '').trim(),
            athleteMainId: String(row.athlete_main_id || '').trim(),
            eventId: String(appointment?.source_event_id || appointmentId).trim(),
          })
        : null;
      const decision = resolveLifecycleRetentionDecision({
        crmStage: storedCrmStage,
        liveCrmStage,
        bookedEventTitle: liveEvent?.title || null,
      });

      if (decision.action === 'purge') {
        await purgeAthleteLifecycle({ config, athleteKey }).catch(() => undefined);
        continue;
      }

      if (decision.action === 'soft_archive') {
        await softArchiveCurrentAppointment({
          config,
          athleteKey,
          athleteId: String(row.athlete_id || '').trim(),
          athleteMainId: String(row.athlete_main_id || '').trim(),
          athleteName: athleteNamesByKey.get(athleteKey) || athleteKey,
          crmStage: decision.effectiveCrmStage || storedCrmStage,
          taskStatus: normalizeValue(row.task_status),
          currentAppointmentId: appointmentId,
          bookedEventTitle: liveEvent?.title || null,
          reason: decision.reason,
        }).catch(() => undefined);
        continue;
      }
    }

    if (isEndedAppointmentTimestamp(appointmentStartsAt, now)) {
      continue;
    }

    results.push({
      athleteKey,
      athleteId: String(row.athlete_id || '').trim(),
      athleteMainId: String(row.athlete_main_id || '').trim(),
      athleteName: athleteNamesByKey.get(athleteKey) || athleteKey,
      crmStage: normalizeValue(row.crm_stage),
      taskStatus: normalizeValue(row.task_status),
      headScout: normalizeValue(row.head_scout),
      currentTaskId: normalizeValue(row.current_task_id),
      currentTaskTitle: normalizeValue(row.current_task_title),
      currentAppointmentId: normalizeValue(row.current_appointment_id),
      appointmentStartsAt,
      appointmentStatus: normalizeValue(appointment?.status),
      updatedAt: normalizeIsoValue(row.updated_at) || row.updated_at,
    });
  }

  return results;
}

export async function getWeeklyScheduledAppointmentRows(args: {
  weekStart: string;
  weekEnd: string;
  operatorOwnerKey?: string | null;
}): Promise<WeeklyScheduledAppointmentRow[]> {
  const config = getSupabasePersistenceConfig();
  if (!config) {
    return [];
  }

  const operatorOwnerKey = normalizeValue(args.operatorOwnerKey);
  const query = [
    'select=id,athlete_key,athlete_id,athlete_main_id,head_scout,starts_at,status,source_event_id,operator_owner_key,meeting_timezone,meeting_timezone_label,post_meeting_result,previous_appointment_id,original_appointment_id,reschedule_sequence,source_payload',
    `starts_at=gte.${encodeURIComponent(args.weekStart)}`,
    `starts_at=lt.${encodeURIComponent(args.weekEnd)}`,
    `status=in.(${ACTIVE_APPOINTMENT_STATUSES.join(',')})`,
    ...(operatorOwnerKey ? [`operator_owner_key=eq.${encodeURIComponent(operatorOwnerKey)}`] : []),
    'order=starts_at.asc',
    'limit=200',
  ].join('&');

  const appointmentRows = await queryTable<{
    id: string;
    athlete_key?: string | null;
    athlete_id?: string | null;
    athlete_main_id?: string | null;
    head_scout?: string | null;
    starts_at?: string | null;
    status?: string | null;
    source_event_id?: string | null;
    meeting_timezone?: string | null;
    meeting_timezone_label?: string | null;
    post_meeting_result?: string | null;
    previous_appointment_id?: string | null;
    original_appointment_id?: string | null;
    reschedule_sequence?: number | null;
    source_payload?: { meeting_name?: string | null } | null;
  }>(config, 'appointments', query);

  const athleteKeys = Array.from(
    new Set(appointmentRows.map((row) => normalizeValue(row.athlete_key)).filter(Boolean)),
  );
  const athleteRows = athleteKeys.length
    ? await queryTable<{ athlete_key: string; athlete_name: string | null }>(
        config,
        'athletes',
        [
          'select=athlete_key,athlete_name',
          `athlete_key=in.(${athleteKeys.map((key) => `"${key}"`).join(',')})`,
          'limit=200',
        ].join('&'),
      ).catch(() => [])
    : [];
  const athleteNamesByKey = new Map(
    athleteRows.map((row) => [String(row.athlete_key || '').trim(), normalizeValue(row.athlete_name)]),
  );

  return appointmentRows
    .map((row) => {
      const startsAt = normalizeIsoValue(row.starts_at);
      if (!startsAt) return null;
      const athleteKey = normalizeValue(row.athlete_key);
      return {
        id: String(row.id || '').trim(),
        athleteId: String(row.athlete_id || '').trim(),
        athleteMainId: String(row.athlete_main_id || '').trim(),
        athleteName: athleteKey ? athleteNamesByKey.get(athleteKey) || null : null,
        headScout: normalizeValue(row.head_scout),
        startsAt,
        endsAt: null,
        status: normalizeValue(row.status),
        sourceEventId: normalizeValue(row.source_event_id),
        meetingTitle: normalizeValue(row.source_payload?.meeting_name),
        meetingTimezone: normalizeValue(row.meeting_timezone),
        meetingTimezoneLabel: normalizeValue(row.meeting_timezone_label),
        postMeetingResult: normalizeValue(row.post_meeting_result),
        previousAppointmentId: normalizeValue(row.previous_appointment_id),
        originalAppointmentId: normalizeValue(row.original_appointment_id),
        rescheduleSequence: Number.isFinite(Number(row.reschedule_sequence))
          ? Number(row.reschedule_sequence)
          : null,
      } satisfies WeeklyScheduledAppointmentRow;
    })
    .filter((row): row is WeeklyScheduledAppointmentRow =>
      Boolean(row?.id && row.athleteId && row.athleteMainId && row.startsAt),
    );
}
