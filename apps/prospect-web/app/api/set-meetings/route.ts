import { buildEasternWeekWindow, prospectFetch } from '../../../lib/fastapi-client';
import { methodNotAllowed } from '../../../lib/response-shapes';

export function GET(request: Request) {
  const url = new URL(request.url);
  const weekWindow = buildEasternWeekWindow(url.searchParams.get('week') || 'this');
  const taskRange = weekWindow.week === 'next' ? 'nextWeek' : 'thisWeek';
  const endpoint = `/api/v1/mobile/set-meetings?start=${encodeURIComponent(weekWindow.start)}&end=${encodeURIComponent(weekWindow.end)}&task_range=${encodeURIComponent(taskRange)}`;
  return prospectFetch(endpoint);
}

export function POST(request: Request) {
  return methodNotAllowed(request.method, ['GET']);
}
