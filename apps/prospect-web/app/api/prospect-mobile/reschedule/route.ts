import { randomUUID } from 'node:crypto';
import { getFastApiBaseUrl, getFastApiToken, getMissingFastApiEnvMessage } from '../../../../lib/env';
import { getSupabaseRestConfig, supabaseHeaders } from '../../tim-lite/access';
import { jsonResponse, methodNotAllowed, upstreamUnavailable } from '../../../../lib/response-shapes';

const CONFIRMED_RESCHEDULE_STAGE = 'Meeting Result - Rescheduled';
const PAYLOAD_FIELD = ['payload', 'json'].join('_');

type RescheduleSubmitResponse = {
  success?: boolean;
  stage?: string;
  created_task?: {
    task_id?: string | null;
    title?: string | null;
  } | null;
};

type SalesStageResponse = {
  success?: boolean;
  stage?: string;
};

function asText(value: unknown): string {
  return String(value || '').trim();
}

function requireText(payload: Record<string, unknown>, key: string): string {
  const value = asText(payload[key]);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

async function fastApiJson<T>(path: string, init: RequestInit): Promise<T> {
  const missingMessage = getMissingFastApiEnvMessage();
  if (missingMessage) throw new Error(missingMessage);
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

async function supabaseWrite(table: string, args: {
  method?: 'POST' | 'PATCH';
  rows: unknown[] | Record<string, unknown>;
  query?: string;
  prefer?: string;
}) {
  const config = getSupabaseRestConfig();
  const response = await fetch(
    `${config.url}/rest/v1/${encodeURIComponent(table)}${args.query ? `?${args.query}` : ''}`,
    {
      method: args.method || 'POST',
      headers: supabaseHeaders(config, {
        'content-type': 'application/json',
        prefer: args.prefer || 'return=minimal',
      }),
      body: JSON.stringify(args.rows),
    },
  );
  if (!response.ok) {
    throw new Error((await response.text().catch(() => '')) || `Supabase ${table} HTTP ${response.status}`);
  }
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

function localTimeToInstant(value: string, timeZone: string): string {
  const raw = asText(value);
  if (!raw) return raw;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
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

async function recordMobileRescheduled(args: {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  appointmentId: string;
  previousAppointmentId: string;
  startsAt: string;
  headScout: string;
  meetingTimezone: string;
  meetingTimezoneLabel: string;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  crmStage: string;
}) {
  const updatedAt = new Date().toISOString();
  const athleteKey = `${args.athleteId}:${args.athleteMainId}`;
  const startsAt = localTimeToInstant(args.startsAt, args.meetingTimezone);
  await supabaseWrite('athletes', {
    rows: [{
      athlete_key: athleteKey,
      athlete_id: args.athleteId,
      athlete_main_id: args.athleteMainId,
      athlete_name: args.athleteName,
      updated_at: updatedAt,
    }],
    query: 'on_conflict=athlete_key',
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  await supabaseWrite('appointments', {
    rows: [{
      id: args.appointmentId,
      athlete_key: athleteKey,
      athlete_id: args.athleteId,
      athlete_main_id: args.athleteMainId,
      head_scout: args.headScout || null,
      starts_at: startsAt,
      status: 'scheduled',
      source_event_id: args.appointmentId,
      meeting_timezone: args.meetingTimezone || null,
      meeting_timezone_label: args.meetingTimezoneLabel || null,
      previous_appointment_id: args.previousAppointmentId,
      original_appointment_id: args.previousAppointmentId,
      reschedule_sequence: 1,
      appointment_role: 'reschedule',
      status_reason: 'rescheduled_new_appointment_written',
      source_system: 'prospect_mobile_reschedule',
      source_payload: {
        previous_appointment_id: args.previousAppointmentId,
        selected_by: 'prospect_mobile',
      },
      updated_at: updatedAt,
    }],
    query: 'on_conflict=id',
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  await supabaseWrite('lifecycle_events', {
    rows: [{
      id: randomUUID(),
      athlete_key: athleteKey,
      athlete_id: args.athleteId,
      athlete_main_id: args.athleteMainId,
      event_type: 'rescheduled',
      crm_stage: args.crmStage,
      task_status: args.currentTaskTitle || 'Confirmation Call',
      [PAYLOAD_FIELD]: {
        previous_appointment_id: args.previousAppointmentId,
        starts_at: startsAt,
        head_scout: args.headScout || null,
        current_task_id: args.currentTaskId || null,
        current_task_title: args.currentTaskTitle || null,
        current_appointment_id: args.appointmentId,
        source: 'prospect_mobile_reschedule',
      },
      created_at: updatedAt,
    }],
  });
  await supabaseWrite('appointments', {
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(args.previousAppointmentId)}`,
    rows: {
      post_meeting_result: 'rescheduled',
      status_reason: 'rescheduled_replaced_by_new_appointment',
      updated_at: updatedAt,
    },
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};

  try {
    const athleteId = requireText(payload, 'athlete_id');
    const athleteMainId = requireText(payload, 'athlete_main_id');
    const athleteName = requireText(payload, 'athlete_name');
    const previousAppointmentId = requireText(payload, 'previous_appointment_id');
    const assignedTo = requireText(payload, 'assigned_to');
    const openEventId = requireText(payload, 'open_event_id');
    const startTime = requireText(payload, 'start_time');
    const headScoutName = asText(payload.head_scout_name);
    const meetingTimezone = asText(payload.meeting_timezone) || 'America/New_York';
    const meetingTimezoneLabel = asText(payload.meeting_timezone_label) || meetingTimezone;
    const meetingName = asText(payload.previous_meeting_title) || athleteName;
    const taskDescription = asText(payload.previous_meeting_text) || meetingName;

    const reschedulePayload = {
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
      meeting_name: meetingName,
      meeting_timezone: meetingTimezone,
      assigned_to: assignedTo,
      open_event_id: openEventId,
      task_description: taskDescription,
      start_time: startTime,
      meeting_length: '01:00',
      openmeetings_list_length: '-1',
      template_id: '210',
      keep_as_open_slot: 'yes',
      previous_event_id: previousAppointmentId,
    };

    const rescheduleResult = await fastApiJson<RescheduleSubmitResponse>(
      '/api/v1/sales/reschedule-meeting',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(reschedulePayload),
      },
    );
    const salesStageResult = await fastApiJson<SalesStageResponse>('/api/v1/sales/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        athlete_id: athleteId,
        athlete_main_id: athleteMainId,
        stage: CONFIRMED_RESCHEDULE_STAGE,
      }),
    });

    await recordMobileRescheduled({
      athleteId,
      athleteMainId,
      athleteName,
      previousAppointmentId,
      appointmentId: openEventId,
      startsAt: startTime,
      headScout: headScoutName,
      meetingTimezone,
      meetingTimezoneLabel,
      crmStage: salesStageResult.stage || CONFIRMED_RESCHEDULE_STAGE,
      currentTaskId: rescheduleResult.created_task?.task_id || null,
      currentTaskTitle: rescheduleResult.created_task?.title || null,
    });

    return jsonResponse({
      success: true,
      stage: salesStageResult.stage || CONFIRMED_RESCHEDULE_STAGE,
      open_event_id: openEventId,
      previous_appointment_id: previousAppointmentId,
      created_task: rescheduleResult.created_task || null,
      email_sent: Boolean((rescheduleResult as Record<string, unknown>).email_sent),
    });
  } catch (error) {
    return upstreamUnavailable(error instanceof Error ? error.message : String(error));
  }
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
