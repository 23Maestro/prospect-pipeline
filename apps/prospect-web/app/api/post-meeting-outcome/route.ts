import { getFastApiBaseUrl, getFastApiToken, getMissingFastApiEnvMessage, getServerEnv } from '../../../lib/env';
import { jsonResponse, methodNotAllowed, upstreamUnavailable } from '../../../lib/response-shapes';

const OUTCOME_BY_PREFIX = {
  '(RSP)': {
    stage: 'Meeting Result - Res. Pending',
    postMeetingResult: 'reschedule_pending',
    statusReason: 'sales_stage_reschedule_pending',
    scoutNoteTitle: 'RSP And Scout Notes',
    operatorNoteTitle: 'Reschedule Pending Reason',
  },
  '(CAN)': {
    stage: 'Meeting Result - Canceled',
    postMeetingResult: 'canceled',
    statusReason: 'sales_stage_canceled',
    scoutNoteTitle: 'CAN And Scout Notes',
    operatorNoteTitle: 'Canceled Meeting Reason',
  },
} as const;

type OutcomePrefix = keyof typeof OUTCOME_BY_PREFIX;

function asText(value: unknown): string {
  return String(value || '').trim();
}

function isOutcomePrefix(value: string): value is OutcomePrefix {
  return value === '(RSP)' || value === '(CAN)';
}

async function fastApiJson(path: string, init: RequestInit = {}) {
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
  return payload as Record<string, unknown>;
}

async function addAthleteNote(args: {
  athleteId: string;
  athleteMainId: string;
  title: string;
  description: string;
}) {
  return fastApiJson('/api/v1/notes/add', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      athlete_id: args.athleteId,
      athlete_main_id: args.athleteMainId,
      title: args.title,
      description: args.description,
    }),
  });
}

function getSupabaseRestConfig() {
  const url = getServerEnv('SUPABASE_URL') || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getServerEnv('SUPABASE_SECRET_KEY') || getServerEnv('SUPABASE_SERVICE_ROLE_KEY');
  const schema = getServerEnv('SUPABASE_SCHEMA') || 'public';
  if (!url || !key) {
    throw new Error('Missing server Supabase credentials');
  }
  return { url: url.replace(/\/+$/, ''), key, schema };
}

function supabaseHeaders(config: ReturnType<typeof getSupabaseRestConfig>, prefer = 'return=minimal') {
  return {
    'content-type': 'application/json',
    apikey: config.key,
    authorization: `Bearer ${config.key}`,
    prefer,
    'accept-profile': config.schema,
    'content-profile': config.schema,
  };
}

async function readAppointmentSourcePayload(eventId: string): Promise<Record<string, unknown>> {
  const config = getSupabaseRestConfig();
  const params = new URLSearchParams({
    select: 'source_payload',
    id: `eq.${eventId}`,
    limit: '1',
  });
  const response = await fetch(`${config.url}/rest/v1/appointments?${params.toString()}`, {
    headers: supabaseHeaders(config),
  });
  const payload = await response.json().catch(async () => ({
    error: await response.text().catch(() => ''),
  }));
  if (!response.ok) {
    throw new Error(
      asText((payload as Record<string, unknown>).error) || `Supabase appointments read HTTP ${response.status}`,
    );
  }
  const row = Array.isArray(payload) ? (payload[0] as Record<string, unknown> | undefined) : null;
  const sourcePayload = row?.source_payload;
  return sourcePayload && typeof sourcePayload === 'object' && !Array.isArray(sourcePayload)
    ? (sourcePayload as Record<string, unknown>)
    : {};
}

async function patchAppointmentPostMeetingOutcome(args: {
  eventId: string;
  postMeetingResult: string;
  statusReason: string;
  scoutDescription: string;
  operatorNoteTitle: string;
  operatorNoteDescription: string;
}) {
  const config = getSupabaseRestConfig();
  const sourcePayload = await readAppointmentSourcePayload(args.eventId);
  const response = await fetch(
    `${config.url}/rest/v1/appointments?${new URLSearchParams({ id: `eq.${args.eventId}` }).toString()}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(config),
      body: JSON.stringify({
        post_meeting_result: args.postMeetingResult,
        status_reason: args.statusReason,
        updated_at: new Date().toISOString(),
        source_payload: {
          ...sourcePayload,
          pending_client_scout_note: args.scoutDescription,
          pending_client_operator_note_title: args.operatorNoteTitle,
          pending_client_operator_note: args.operatorNoteDescription,
          post_meeting_outcome_source: 'prospect_web_post_meeting_outcome',
        },
      }),
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Supabase appointments patch HTTP ${response.status}`);
  }
  return {
    appointment_id: args.eventId,
    post_meeting_result: args.postMeetingResult,
    status_reason: args.statusReason,
  };
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const eventId = asText(payload.event_id);
  const eventDate = asText(payload.event_date);
  const prefix = asText(payload.prefix);
  const athleteId = asText(payload.athlete_id);
  const athleteMainId = asText(payload.athlete_main_id);
  const operatorNoteDescription = asText(payload.operator_note_description);
  const operatorNoteTitle = asText(payload.operator_note_title);

  if (
    !eventId ||
    !eventDate ||
    !isOutcomePrefix(prefix) ||
    !athleteId ||
    !athleteMainId ||
    !operatorNoteDescription
  ) {
    return jsonResponse(
      {
        success: false,
        error:
          'event_id, event_date, prefix, athlete_id, athlete_main_id, and operator_note_description are required',
      },
      { status: 400 },
    );
  }

  const outcome = OUTCOME_BY_PREFIX[prefix];

  try {
    const bookedMeetingDetails = await fastApiJson(
      `/api/v1/calendar/booked-meeting/details?${new URLSearchParams({
        event_id: eventId,
        event_date: eventDate,
      }).toString()}`,
      { headers: { accept: 'application/json' } },
    );
    const scoutDescription = asText(bookedMeetingDetails.description);
    if (!scoutDescription) {
      return jsonResponse(
        {
          success: false,
          error: `${outcome.scoutNoteTitle} requires the saved booked-meeting description`,
        },
        { status: 409 },
      );
    }

    const titleResult = await fastApiJson('/api/v1/calendar/booked-meeting/title', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        event_date: eventDate,
        prefix,
      }),
    });

    const stageResult = await fastApiJson('/api/v1/sales/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        athlete_id: athleteId,
        athlete_main_id: athleteMainId,
        stage: outcome.stage,
      }),
    });

    const appointmentOutcomeResult = await patchAppointmentPostMeetingOutcome({
      eventId,
      postMeetingResult: outcome.postMeetingResult,
      statusReason: outcome.statusReason,
      scoutDescription,
      operatorNoteTitle: operatorNoteTitle || outcome.operatorNoteTitle,
      operatorNoteDescription,
    });

    const scoutNoteResult = await addAthleteNote({
      athleteId,
      athleteMainId,
      title: outcome.scoutNoteTitle,
      description: scoutDescription,
    });
    const operatorNoteResult = await addAthleteNote({
      athleteId,
      athleteMainId,
      title: operatorNoteTitle || outcome.operatorNoteTitle,
      description: operatorNoteDescription,
    });

    return jsonResponse({
      success: true,
      prefix,
      stage: outcome.stage,
      title_result: titleResult,
      stage_result: stageResult,
      appointment_outcome_result: appointmentOutcomeResult,
      scout_note_result: scoutNoteResult,
      operator_note_result: operatorNoteResult,
    });
  } catch (error) {
    return upstreamUnavailable(error instanceof Error ? error.message : String(error));
  }
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
