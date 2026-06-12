import type {
  RescheduleMeetingSubmitRequest,
  RescheduleMeetingSubmitResponse,
  SalesStageUpdateResponse,
} from '../../../src/features/scout-prep/types';
import {
  applyApprovedParentResponseReschedule,
  type ParentResponseApprovalRequest,
} from '../../../src/lib/parent-response-approval';
import { getFastApiBaseUrl, getFastApiToken, getMissingFastApiEnvMessage } from './env';
import { getServerEnv } from './env';

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
  return applyApprovedParentResponseReschedule(row, {
    submitRescheduleMeeting: (payload: RescheduleMeetingSubmitRequest) =>
      fastApiJson<RescheduleMeetingSubmitResponse>('/api/v1/sales/reschedule-meeting', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      }),
    updateSalesStage: (args) =>
      fastApiJson<SalesStageUpdateResponse>('/api/v1/sales/stage', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          athlete_id: args.athleteId,
          athlete_main_id: args.athleteMainId,
          stage: args.stage,
        }),
      }),
    recordRescheduled: recordRescheduledFromVercel,
  });
}
