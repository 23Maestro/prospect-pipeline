import { jsonResponse, methodNotAllowed } from '../../../lib/response-shapes';

const OUTCOME_BY_PREFIX: Record<string, { stage: string; postMeetingResult: string }> = {
  '(RSP)': {
    stage: 'Meeting Result - Res. Pending',
    postMeetingResult: 'reschedule_pending',
  },
  '(CAN)': {
    stage: 'Meeting Result - Canceled',
    postMeetingResult: 'canceled',
  },
};

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const prefix = String(payload.prefix || '').trim();
  const outcome = OUTCOME_BY_PREFIX[prefix];
  if (!outcome) {
    return jsonResponse(
      { success: false, error: 'Supported outcome prefix is required' },
      { status: 400 },
    );
  }

  return jsonResponse({
    success: true,
    stage: outcome.stage,
    post_meeting_result: outcome.postMeetingResult,
    event_id: String(payload.event_id || ''),
    athlete_id: String(payload.athlete_id || ''),
    athlete_main_id: String(payload.athlete_main_id || ''),
  });
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
