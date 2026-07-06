import { getDemoMeetingWindow, getSetMeetingEvents } from '../../../../lib/prospect-demo-data';
import { jsonResponse, methodNotAllowed } from '../../../../lib/response-shapes';

function weekWindow(week: string) {
  return getDemoMeetingWindow(week);
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const window = weekWindow(url.searchParams.get('range') || url.searchParams.get('week') || 'this');
  const events = getSetMeetingEvents(window.week);
  return jsonResponse({
    success: true,
    source: 'local_set_meetings_command_demo',
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
