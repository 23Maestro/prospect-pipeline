import { getSetMeetingEvents } from '../../../../lib/prospect-demo-data';
import { jsonResponse, methodNotAllowed } from '../../../../lib/response-shapes';

function weekWindow(week: string) {
  return week === 'next'
    ? { start: '2026-07-11', end: '2026-07-18', week: 'next' }
    : { start: '2026-07-04', end: '2026-07-11', week: 'this' };
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const window = weekWindow(url.searchParams.get('week') || 'this');
  const events = getSetMeetingEvents(window.week);
  return jsonResponse({
    success: true,
    source: 'local_roster',
    backend_required: false,
    week_start: window.start,
    week_end: window.end,
    count: events.length,
    events,
  });
}

export function POST(request: Request) {
  return methodNotAllowed(request.method, ['GET']);
}
