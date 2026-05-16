import { prospectFetch } from '../../../lib/fastapi-client';
import { jsonResponse, methodNotAllowed } from '../../../lib/response-shapes';

const ALLOWED_PREFIXES = new Set(['(ACF)', '(ACF*2)', '(CF)', '(RSP)', '(CAN)']);

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const eventId = String(payload.event_id || '').trim();
  const eventDate = String(payload.event_date || '').trim();
  const prefix = String(payload.prefix || '').trim();

  if (!eventId || !eventDate || !ALLOWED_PREFIXES.has(prefix)) {
    return jsonResponse(
      {
        success: false,
        error: 'event_id, event_date, and supported prefix are required',
      },
      { status: 400 },
    );
  }

  return prospectFetch('/api/v1/calendar/booked-meeting/title', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: eventId,
      event_date: eventDate,
      prefix,
    }),
  });
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
