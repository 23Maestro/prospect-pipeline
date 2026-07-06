import { getDemoMeetingWindow, getScoutSchedules } from '../../../lib/prospect-demo-data';
import { jsonResponse, methodNotAllowed } from '../../../lib/response-shapes';

export function GET(request: Request) {
  const url = new URL(request.url);
  const week = url.searchParams.get('range') || (url.searchParams.get('week') === 'next' ? 'next' : 'this');
  const window = getDemoMeetingWindow(week);
  const scouts = getScoutSchedules(week);
  return jsonResponse({
    success: true,
    source: 'local_set_meetings_command_demo',
    week,
    week_start: window.start,
    week_end: window.end,
    count: scouts.reduce((total, scout) => total + scout.slots.length, 0),
    scouts,
  });
}

export function POST(request: Request) {
  return methodNotAllowed(request.method, ['GET']);
}
