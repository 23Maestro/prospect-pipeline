import { getRescheduleEvents } from '../../../../lib/prospect-demo-data';
import { jsonResponse, methodNotAllowed } from '../../../../lib/response-shapes';

export function GET(request: Request) {
  const url = new URL(request.url);
  const athleteId = String(url.searchParams.get('athlete_id') || '').trim();
  const athleteMainId = String(url.searchParams.get('athlete_main_id') || '').trim();
  const events = getRescheduleEvents().filter((event) => {
    if (athleteId && String(event.athlete_id) !== athleteId) return false;
    if (athleteMainId && String(event.athlete_main_id) !== athleteMainId) return false;
    return true;
  });
  return jsonResponse({
    success: true,
    source: 'appointments',
    stage: 'Meeting Result - Res. Pending',
    window_days: 7,
    count: events.length,
    events,
  });
}

export function POST(request: Request) {
  return methodNotAllowed(request.method, ['GET']);
}
