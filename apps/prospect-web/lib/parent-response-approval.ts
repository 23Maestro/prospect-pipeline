import { getFastApiBaseUrl, getFastApiToken, getMissingFastApiEnvMessage } from './env';
import { getServerEnv } from './env';

const CONFIRMED_RESCHEDULE_STAGE = 'Meeting Result - Rescheduled';

type RescheduleMeetingSubmitRequest = {
  athlete_id: string;
  athlete_main_id: string;
  meeting_name: string;
  meeting_timezone: string;
  assigned_to: string;
  open_event_id: string;
  task_description: string;
  start_time: string;
  meeting_length: string;
  openmeetings_list_length: string;
  template_id: string;
  keep_as_open_slot: string;
  previous_event_id?: string;
};

type RescheduleMeetingSubmitResponse = {
  success?: boolean;
  stage?: string;
  created_task?: {
    task_id?: string | null;
    title?: string | null;
  } | null;
};

type SalesStageUpdateResponse = {
  success?: boolean;
  stage?: string;
};

type ParentResponseApprovalOption = {
  option_id?: string | null;
  display_label?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  timezone?: string | null;
  timezone_label?: string | null;
  open_event_id?: string | null;
  assigned_to?: string | null;
  head_scout_name?: string | null;
  source_payload?: Record<string, unknown> | null;
};

export type ParentResponseApprovalRequest = {
  id: string;
  appointment_id?: string | null;
  athlete_id: string;
  athlete_main_id: string;
  athlete_name: string;
  original_head_scout_name?: string | null;
  original_meeting_timezone?: string | null;
  request_status: string;
  approval_status: string;
  response_kind?: string | null;
  selected_option_id?: string | null;
  proposed_options: ParentResponseApprovalOption[];
  response_payload?: Record<string, unknown> | null;
  approval_payload?: Record<string, unknown> | null;
};

function asText(value: unknown): string {
  return String(value || '').trim();
}

type RecordRescheduledArgs = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
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

function getSupabaseRestConfig() {
  const url = getServerEnv('SUPABASE_URL') || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getServerEnv('SUPABASE_SECRET_KEY') || getServerEnv('SUPABASE_SERVICE_ROLE_KEY');
  const schema = getServerEnv('SUPABASE_SCHEMA') || 'public';
  if (!url || !key) {
    throw new Error('Missing server Supabase credentials');
  }
  return { url: url.replace(/\/+$/, ''), key, schema };
}

async function supabaseWrite(table: string, args: {
  method?: 'POST' | 'PATCH';
  rows: unknown[] | Record<string, unknown>;
  query?: string;
  onConflict?: string;
}) {
  const config = getSupabaseRestConfig();
  const params = new URLSearchParams(args.query || '');
  if (args.onConflict) params.set('on_conflict', args.onConflict);
  const response = await fetch(
    `${config.url}/rest/v1/${encodeURIComponent(table)}${params.toString() ? `?${params}` : ''}`,
    {
      method: args.method || 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        prefer: args.onConflict ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
        'accept-profile': config.schema,
        'content-profile': config.schema,
      },
      body: JSON.stringify(args.rows),
    },
  );
  if (!response.ok) {
    throw new Error((await response.text().catch(() => '')) || `Supabase ${table} HTTP ${response.status}`);
  }
}

function athleteKey(args: Pick<RecordRescheduledArgs, 'athleteId' | 'athleteMainId'>) {
  return `${args.athleteId.trim()}:${args.athleteMainId.trim()}`;
}

function payloadText(payload: Record<string, unknown> | null | undefined, key: string) {
  return asText(payload?.[key]);
}

function selectedOption(row: ParentResponseApprovalRequest): ParentResponseApprovalOption {
  const selectedOptionId = asText(row.selected_option_id);
  if (!selectedOptionId) throw new Error('Parent response approval requires selected_option_id');
  const option = (row.proposed_options || []).find(
    (candidate) => asText(candidate.option_id) === selectedOptionId,
  );
  if (!option) throw new Error('Selected parent response option was not found');
  return option;
}

function optionPayloadText(option: ParentResponseApprovalOption, key: string): string {
  return payloadText(option.source_payload, key);
}

function buildReschedulePayload(
  row: ParentResponseApprovalRequest,
  option: ParentResponseApprovalOption,
): RescheduleMeetingSubmitRequest {
  const approvalPayload = row.approval_payload || {};
  const openEventId = asText(option.open_event_id) || optionPayloadText(option, 'open_event_id');
  const assignedTo =
    asText(option.assigned_to) ||
    optionPayloadText(option, 'assigned_to') ||
    optionPayloadText(option, 'meeting_for') ||
    payloadText(approvalPayload, 'assigned_to');
  const startTime = asText(option.starts_at) || optionPayloadText(option, 'start_time');
  const meetingTimezone =
    asText(option.timezone) ||
    asText(option.timezone_label) ||
    asText(row.original_meeting_timezone) ||
    payloadText(approvalPayload, 'meeting_timezone');
  const previousAppointmentId =
    payloadText(approvalPayload, 'previous_appointment_id') || asText(row.appointment_id);
  const meetingName =
    payloadText(approvalPayload, 'meeting_name') ||
    payloadText(approvalPayload, 'previous_meeting_title') ||
    asText(row.athlete_name);
  const taskDescription =
    payloadText(approvalPayload, 'task_description') ||
    payloadText(approvalPayload, 'previous_meeting_text') ||
    asText(option.display_label);

  if (!openEventId) throw new Error('Parent response approval requires open_event_id');
  if (!assignedTo) throw new Error('Parent response approval requires assigned_to');
  if (!startTime) throw new Error('Parent response approval requires selected option start time');
  if (!meetingTimezone) throw new Error('Parent response approval requires meeting timezone');
  if (!previousAppointmentId) {
    throw new Error('Parent response approval requires previous appointment identity');
  }

  return {
    athlete_id: asText(row.athlete_id),
    athlete_main_id: asText(row.athlete_main_id),
    meeting_name: meetingName,
    meeting_timezone: meetingTimezone,
    assigned_to: assignedTo,
    open_event_id: openEventId,
    task_description: taskDescription,
    start_time: startTime,
    meeting_length: payloadText(approvalPayload, 'meeting_length') || '01:00',
    openmeetings_list_length: '-1',
    template_id: payloadText(approvalPayload, 'template_id') || '210',
    keep_as_open_slot: 'yes',
    previous_event_id: previousAppointmentId,
  };
}

function getApprovalOperator() {
  return {
    personName: String(process.env.PARENT_RESPONSE_OPERATOR_NAME || '').trim() || 'Primary Operator',
    operatorKey: String(process.env.PARENT_RESPONSE_OPERATOR_KEY || '').trim() || 'operator_primary',
  };
}

function timezoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  const renderedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour) === 24 ? 0 : Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return renderedAsUtc - date.getTime();
}

function localTimeToInstant(value?: string | null, timeZone?: string | null): string | null {
  const raw = asText(value);
  if (!raw) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
  }
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return raw;
  const zone = asText(timeZone) || 'America/New_York';
  const localUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || '0'),
  );
  let instant = new Date(localUtc - timezoneOffsetMs(new Date(localUtc), zone));
  instant = new Date(localUtc - timezoneOffsetMs(instant, zone));
  return instant.toISOString();
}

async function recordRescheduledFromVercel(args: RecordRescheduledArgs): Promise<{ enabled: boolean }> {
  const updatedAt = new Date().toISOString();
  const key = athleteKey(args);
  const appointmentId = asText(args.appointmentId) || asText(args.sourceEventId) || `appointment:${key}`;
  const previousAppointmentId = asText(args.previousAppointmentId);
  const payload = args.payload || {};
  const meetingTimezone = payloadText(payload, 'meeting_timezone') || null;
  const startsAt = localTimeToInstant(args.startsAt, meetingTimezone);
  const dueAt = localTimeToInstant(args.dueAt, meetingTimezone);

  await supabaseWrite('athletes', {
    rows: [
      {
        athlete_key: key,
        athlete_id: args.athleteId.trim(),
        athlete_main_id: args.athleteMainId.trim(),
        athlete_name: args.athleteName.trim(),
        updated_at: updatedAt,
      },
    ],
    onConflict: 'athlete_key',
  });
  await supabaseWrite('appointments', {
    rows: [
      {
        id: appointmentId,
        athlete_key: key,
        athlete_id: args.athleteId.trim(),
        athlete_main_id: args.athleteMainId.trim(),
        head_scout: asText(args.headScout) || null,
        starts_at: startsAt,
        status: 'scheduled',
        source_event_id: asText(args.sourceEventId || args.appointmentId) || null,
        meeting_timezone: meetingTimezone,
        previous_appointment_id: previousAppointmentId || null,
        original_appointment_id: payloadText(payload, 'original_appointment_id') || previousAppointmentId || appointmentId,
        reschedule_sequence: previousAppointmentId ? 1 : 0,
        operator_owner: payloadText(payload, 'operator_owner') || null,
        operator_owner_key: payloadText(payload, 'operator_owner_key') || null,
        appointment_role: 'reschedule',
        status_reason: 'rescheduled_new_appointment_written',
        source_system: 'parent_response_approval',
        source_payload: {
          source_event_id: asText(args.sourceEventId || args.appointmentId) || null,
          previous_appointment_id: previousAppointmentId || null,
          parent_response_request_id: payloadText(payload, 'parent_response_request_id') || null,
        },
        updated_at: updatedAt,
      },
    ],
    onConflict: 'id',
  });
  await supabaseWrite('lifecycle_events', {
    rows: [
      {
        id: crypto.randomUUID(),
        athlete_key: key,
        athlete_id: args.athleteId.trim(),
        athlete_main_id: args.athleteMainId.trim(),
        event_type: 'rescheduled',
        crm_stage: args.crmStage || null,
        task_status: args.taskStatus || null,
        payload_json: {
          previous_appointment_id: previousAppointmentId || null,
          due_at: dueAt,
          starts_at: startsAt,
          head_scout: asText(args.headScout) || null,
          current_task_id: asText(args.currentTaskId) || null,
          current_task_title: asText(args.currentTaskTitle) || null,
          current_appointment_id: appointmentId,
          ...payload,
        },
        created_at: updatedAt,
      },
    ],
  });
  if (previousAppointmentId) {
    await supabaseWrite('appointments', {
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(previousAppointmentId)}`,
      rows: {
        post_meeting_result: 'rescheduled',
        status_reason: 'rescheduled_replaced_by_new_appointment',
        updated_at: updatedAt,
      },
    });
  }
  return { enabled: true };
}

async function fastApiJson<T>(path: string, init: RequestInit): Promise<T> {
  const missingMessage = getMissingFastApiEnvMessage();
  if (missingMessage) {
    throw new Error(missingMessage);
  }

  const response = await fetch(`${getFastApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${getFastApiToken()}`,
      'x-mobile-proxy': 'vercel',
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(async () => ({
    error: await response.text().catch(() => ''),
  }));
  if (!response.ok) {
    throw new Error(
      asText((payload as Record<string, unknown>).detail) ||
        asText((payload as Record<string, unknown>).error) ||
        `HTTP ${response.status}`,
    );
  }
  return payload as T;
}

export async function approveParentResponseRequest(row: ParentResponseApprovalRequest) {
  if (asText(row.response_kind) !== 'selected_slot' || asText(row.request_status) !== 'selected') {
    throw new Error('Only selected parent response slots can be approved');
  }
  if (asText(row.approval_status) !== 'pending') {
    throw new Error('Parent response approval is no longer pending');
  }

  const option = selectedOption(row);
  const reschedulePayload = buildReschedulePayload(row, option);
  const rescheduleResult = await fastApiJson<RescheduleMeetingSubmitResponse>(
    '/api/v1/sales/reschedule-meeting',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(reschedulePayload),
    },
  );
  const salesStageResult = await fastApiJson<SalesStageUpdateResponse>('/api/v1/sales/stage', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      athlete_id: row.athlete_id,
      athlete_main_id: row.athlete_main_id,
      stage: CONFIRMED_RESCHEDULE_STAGE,
    }),
  });
  const approvalOperator = getApprovalOperator();
  const durableWrite = await recordRescheduledFromVercel({
    athleteId: asText(row.athlete_id),
    athleteMainId: asText(row.athlete_main_id),
    athleteName: asText(row.athlete_name),
    crmStage: salesStageResult.stage || CONFIRMED_RESCHEDULE_STAGE,
    taskStatus: rescheduleResult.created_task?.title || 'Confirmation Call',
    headScout: asText(option.head_scout_name) || asText(row.original_head_scout_name) || null,
    currentTaskId: rescheduleResult.created_task?.task_id || null,
    currentTaskTitle: rescheduleResult.created_task?.title || null,
    previousAppointmentId: reschedulePayload.previous_event_id || asText(row.appointment_id) || null,
    appointmentId: reschedulePayload.open_event_id,
    sourceEventId: reschedulePayload.open_event_id,
    startsAt: asText(option.starts_at) || reschedulePayload.start_time,
    dueAt: asText(option.starts_at) || reschedulePayload.start_time,
    payload: {
      meeting_timezone: reschedulePayload.meeting_timezone,
      previous_appointment_id: reschedulePayload.previous_event_id || asText(row.appointment_id) || null,
      operator_owner: approvalOperator.personName,
      operator_owner_key: approvalOperator.operatorKey,
      owner_proof: 'parent_response_operator_approval',
      parent_response_request_id: row.id,
      selected_option_id: row.selected_option_id || null,
    },
  });

  return {
    stage: salesStageResult.stage || CONFIRMED_RESCHEDULE_STAGE,
    selectedOption: option,
    reschedulePayload,
    rescheduleResult,
    salesStageResult,
    durableWrite,
  };
}
