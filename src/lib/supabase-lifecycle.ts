import { getPreferenceValues } from '@raycast/api';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { searchLogger } from './logger';

const FEATURE = 'supabase-lifecycle';
const DEFAULT_SCHEMA = 'public';

type Preferences = {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseSchema?: string;
};

type SupabaseConfig = {
  url: string;
  key: string;
  schema: string;
};

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
};

type ReminderSnapshot = {
  appointmentId: string;
  kind: string;
  sendAt?: string | null;
  sentAt?: string | null;
  status: string;
  dedupeSuffix: string;
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
  payload?: Record<string, unknown>;
  appointment?: AppointmentSnapshot | null;
  reminder?: ReminderSnapshot | null;
  state: PipelineStateSnapshot;
};

type MeetingSetWriteArgs = PipelineActor & {
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
  reminderKind?: string | null;
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
  reminderKind?: string | null;
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
};

type AthletesRow = {
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  athlete_name: string;
  updated_at: string;
};

type PipelineStateRow = {
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
  updated_at: string;
};

type LifecycleEventRow = {
  id: string;
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  event_type: string;
  crm_stage: string | null;
  task_status: string | null;
  payload_json: Record<string, unknown>;
  created_at: string;
};

type ReminderRow = {
  id: string;
  appointment_id: string;
  kind: string;
  send_at: string | null;
  sent_at: string | null;
  status: string;
  dedupe_key: string;
  updated_at: string;
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
  reminderRows: Array<{
    appointment_id: string;
    kind: string;
    status: string;
    send_at: string | null;
    sent_at: string | null;
    updated_at: string;
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

function logInfo(event: string, step: string, status: 'start' | 'success', context?: Record<string, unknown>) {
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

function readRepoEnv(): Record<string, string> {
  const cwd = process.cwd();
  return {
    ...readEnvFile(path.join(cwd, 'npid-api-layer/.env')),
    ...readEnvFile(path.join(cwd, '.env')),
    ...readEnvFile(path.join(cwd, '.overmind.env')),
  };
}

function getConfig(): SupabaseConfig | null {
  const prefs = getPreferenceValues<Preferences>();
  const repoEnv = readRepoEnv();
  const url = String(
    process.env.SUPABASE_URL || repoEnv.SUPABASE_URL || prefs.supabaseUrl || '',
  )
    .trim()
    .replace(/\/+$/, '');
  const key = String(
    process.env.SUPABASE_SECRET_KEY ||
      repoEnv.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      repoEnv.SUPABASE_SERVICE_ROLE_KEY ||
      prefs.supabaseServiceRoleKey ||
      '',
  ).trim();
  const schema = String(
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
  const explicit =
    normalizeValue(args.appointmentId) ||
    normalizeValue(args.sourceEventId);
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
  const sendAt = normalizeIsoValue(args.sendAt) || 'none';
  return [
    args.appointmentId.trim(),
    args.kind.trim(),
    args.suffix.trim(),
    sendAt,
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

function buildPipelineStateRow(actor: PipelineActor, state: PipelineStateSnapshot, updatedAt: string): PipelineStateRow {
  return {
    athlete_key: buildAthleteKey(actor.athleteId, actor.athleteMainId),
    athlete_id: actor.athleteId.trim(),
    athlete_main_id: actor.athleteMainId.trim(),
    crm_stage: normalizeValue(state.crmStage),
    task_status: normalizeValue(state.taskStatus),
    head_scout: normalizeValue(state.headScout),
    current_task_id: normalizeValue(state.currentTaskId),
    current_task_title: normalizeValue(state.currentTaskTitle),
    current_appointment_id: normalizeValue(state.currentAppointmentId),
    updated_at: updatedAt,
  };
}

function buildAppointmentRow(actor: PipelineActor, appointment: AppointmentSnapshot, updatedAt: string): AppointmentRow {
  return {
    id: buildAppointmentId({
      athleteId: actor.athleteId,
      athleteMainId: actor.athleteMainId,
      appointmentId: appointment.appointmentId,
      sourceEventId: appointment.sourceEventId,
      startsAt: appointment.startsAt,
    }),
    athlete_key: buildAthleteKey(actor.athleteId, actor.athleteMainId),
    athlete_id: actor.athleteId.trim(),
    athlete_main_id: actor.athleteMainId.trim(),
    head_scout: normalizeValue(appointment.headScout),
    starts_at: normalizeIsoValue(appointment.startsAt),
    status: normalizeValue(appointment.status),
    source_event_id: normalizeValue(appointment.sourceEventId),
    updated_at: updatedAt,
  };
}

function buildLifecycleEventRow(
  actor: PipelineActor,
  args: LifecycleWriteArgs,
  createdAt: string,
): LifecycleEventRow {
  return {
    id: randomUUID(),
    athlete_key: buildAthleteKey(actor.athleteId, actor.athleteMainId),
    athlete_id: actor.athleteId.trim(),
    athlete_main_id: actor.athleteMainId.trim(),
    event_type: args.eventType.trim(),
    crm_stage: normalizeValue(args.state.crmStage),
    task_status: normalizeValue(args.state.taskStatus),
    payload_json: args.payload || {},
    created_at: createdAt,
  };
}

function buildReminderRow(reminder: ReminderSnapshot, updatedAt: string): ReminderRow {
  const dedupeKey = buildReminderDedupeKey({
    appointmentId: reminder.appointmentId,
    kind: reminder.kind,
    suffix: reminder.dedupeSuffix,
    sendAt: reminder.sendAt,
  });
  return {
    id: dedupeKey,
    appointment_id: reminder.appointmentId,
    kind: reminder.kind.trim(),
    send_at: normalizeIsoValue(reminder.sendAt),
    sent_at: normalizeIsoValue(reminder.sentAt),
    status: reminder.status.trim(),
    dedupe_key: dedupeKey,
    updated_at: updatedAt,
  };
}

async function request(
  config: SupabaseConfig,
  table: string,
  args: {
    method?: 'POST';
    rows: unknown[];
    onConflict?: string;
  },
): Promise<void> {
  const query = args.onConflict
    ? `?on_conflict=${encodeURIComponent(args.onConflict)}`
    : '';
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

async function queryTable<T>(
  config: SupabaseConfig,
  table: string,
  query: string,
): Promise<T[]> {
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

async function writeLifecycle(args: LifecycleWriteArgs): Promise<{ enabled: boolean }> {
  const config = getConfig();
  if (!config) {
    return { enabled: false };
  }

  const updatedAt = new Date().toISOString();
  const athleteRow = buildAthleteRow(args.athlete, updatedAt);
  const appointmentRow = args.appointment ? buildAppointmentRow(args.athlete, args.appointment, updatedAt) : null;
  const reminderRow = args.reminder ? buildReminderRow(args.reminder, updatedAt) : null;
  const eventRow = buildLifecycleEventRow(args.athlete, args, updatedAt);
  const stateRow = buildPipelineStateRow(args.athlete, args.state, updatedAt);

  logInfo('SUPABASE_LIFECYCLE_WRITE', 'request', 'start', {
    eventType: args.eventType,
    athleteKey: athleteRow.athlete_key,
    hasAppointment: Boolean(appointmentRow),
    hasReminder: Boolean(reminderRow),
  });

  try {
    await request(config, 'athletes', {
      rows: [athleteRow],
      onConflict: 'athlete_key',
    });

    if (appointmentRow) {
      await request(config, 'appointments', {
        rows: [appointmentRow],
        onConflict: 'id',
      });
    }

    if (reminderRow) {
      await request(config, 'reminders', {
        rows: [reminderRow],
        onConflict: 'dedupe_key',
      });
    }

    await request(config, 'lifecycle_events', {
      rows: [eventRow],
    });

    await request(config, 'athlete_pipeline_state', {
      rows: [stateRow],
      onConflict: 'athlete_key',
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
    reminderId: reminderRow?.id || null,
  });

  return { enabled: true };
}

export async function recordMeetingSet(args: MeetingSetWriteArgs): Promise<{ enabled: boolean }> {
  const appointmentId = buildAppointmentId(args);
  return writeLifecycle({
    athlete: args,
    eventType: 'meeting_set',
    payload: {
      meeting_timezone: normalizeValue(args.meetingTimezone),
      legacy_assigned_to: normalizeValue(args.legacyAssignedTo),
      meeting_name: normalizeValue(args.meetingName),
      task_due_date: normalizeIsoValue(args.taskDueDate),
      starts_at: normalizeIsoValue(args.startsAt),
    },
    appointment: {
      appointmentId,
      sourceEventId: args.sourceEventId || args.appointmentId,
      headScout: args.headScout,
      startsAt: args.startsAt,
      status: 'scheduled',
    },
    reminder: args.taskDueDate
      ? {
          appointmentId,
          kind: 'confirmation',
          sendAt: args.taskDueDate,
          status: 'queued',
          dedupeSuffix: 'meeting_set_confirmation',
        }
      : null,
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
    },
    reminder: {
      appointmentId,
      kind: normalizeValue(args.reminderKind) || 'confirmation',
      sendAt: args.dueAt,
      status: 'queued',
      dedupeSuffix: 'confirmation_queued',
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
    },
    reminder: {
      appointmentId,
      kind: normalizeValue(args.reminderKind) || 'confirmation',
      sendAt: args.dueAt,
      sentAt: args.sentAt || new Date().toISOString(),
      status: 'sent',
      dedupeSuffix: 'confirmation_sent',
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

export async function recordRescheduled(args: RescheduledWriteArgs): Promise<{ enabled: boolean }> {
  const appointmentId = buildAppointmentId(args);
  return writeLifecycle({
    athlete: args,
    eventType: 'rescheduled',
    payload: {
      previous_appointment_id: normalizeValue(args.previousAppointmentId),
      due_at: normalizeIsoValue(args.dueAt),
      starts_at: normalizeIsoValue(args.startsAt),
    },
    appointment: {
      appointmentId,
      headScout: args.headScout,
      startsAt: args.startsAt,
      status: 'rescheduled',
      sourceEventId: args.sourceEventId || args.appointmentId,
    },
    reminder: args.dueAt
      ? {
          appointmentId,
          kind: 'confirmation',
          sendAt: args.dueAt,
          status: 'queued',
          dedupeSuffix: 'rescheduled_confirmation',
        }
      : null,
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

export async function getLifecycleHealthSnapshot(): Promise<LifecycleHealthSnapshot> {
  const config = getConfig();
  if (!config) {
    return {
      enabled: false,
      stateRows: [],
      eventRows: [],
      reminderRows: [],
    };
  }

  const [stateRows, eventRows, reminderRows] = await Promise.all([
    queryTable<LifecycleHealthSnapshot['stateRows'][number]>(
      config,
      'athlete_pipeline_state',
      'select=athlete_key,crm_stage,task_status,current_appointment_id,updated_at&order=updated_at.desc&limit=10',
    ),
    queryTable<LifecycleHealthSnapshot['eventRows'][number]>(
      config,
      'lifecycle_events',
      'select=event_type,crm_stage,task_status,athlete_id,athlete_main_id,created_at&order=created_at.desc&limit=15',
    ),
    queryTable<LifecycleHealthSnapshot['reminderRows'][number]>(
      config,
      'reminders',
      'select=appointment_id,kind,status,send_at,sent_at,updated_at&order=updated_at.desc&limit=10',
    ),
  ]);

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
    reminderRows,
  };
}

export async function getActiveMeetingFallbackRows(): Promise<ActiveMeetingFallbackRow[]> {
  const config = getConfig();
  if (!config) {
    return [];
  }

  const [stateRows, athleteRows, appointmentRows] = await Promise.all([
    queryTable<{
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
    }>(
      config,
      'athlete_pipeline_state',
      [
        'select=athlete_key,athlete_id,athlete_main_id,crm_stage,task_status,head_scout,current_task_id,current_task_title,current_appointment_id,updated_at',
        'not.current_appointment_id=is.null',
        'order=updated_at.desc',
        'limit=200',
      ].join('&'),
    ),
    queryTable<{ athlete_key: string; athlete_name: string }>(
      config,
      'athletes',
      'select=athlete_key,athlete_name&limit=500',
    ),
    queryTable<{ id: string; starts_at: string | null; status: string | null }>(
      config,
      'appointments',
      'select=id,starts_at,status&limit=500',
    ),
  ]);

  const athleteNamesByKey = new Map(
    athleteRows.map((row) => [String(row.athlete_key || '').trim(), String(row.athlete_name || '').trim()]),
  );
  const appointmentsById = new Map(
    appointmentRows.map((row) => [String(row.id || '').trim(), row]),
  );

  return stateRows.map((row) => {
    const appointmentId = String(row.current_appointment_id || '').trim();
    const appointment = appointmentId ? appointmentsById.get(appointmentId) : null;
    const athleteKey = String(row.athlete_key || '').trim();
    return {
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
      appointmentStartsAt: normalizeIsoValue(appointment?.starts_at),
      appointmentStatus: normalizeValue(appointment?.status),
      updatedAt: normalizeIsoValue(row.updated_at) || row.updated_at,
    };
  });
}
