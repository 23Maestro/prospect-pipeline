import { getFastApiBaseUrl, getFastApiToken, getMissingFastApiEnvMessage } from '../../../lib/env';
import { jsonResponse, methodNotAllowed, upstreamUnavailable } from '../../../lib/response-shapes';

const OUTCOME_BY_PREFIX = {
  '(RSP)': {
    stage: 'Meeting Result - Res. Pending',
    scoutNoteTitle: 'RSP And Scout Notes',
    operatorNoteTitle: 'Reschedule Pending Reason',
  },
  '(CAN)': {
    stage: 'Meeting Result - Canceled',
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
