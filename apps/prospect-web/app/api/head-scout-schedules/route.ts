import { buildEasternWeekWindow, prospectFetch } from '../../../lib/fastapi-client';
import { methodNotAllowed } from '../../../lib/response-shapes';

export function GET(request: Request) {
  const url = new URL(request.url);
  const weekWindow = buildEasternWeekWindow(url.searchParams.get('week') || 'this');
  const endpoint = `/api/v1/mobile/calendar/head-scout-slots?start=${encodeURIComponent(weekWindow.start)}&end=${encodeURIComponent(weekWindow.end)}`;
  return prospectFetch(endpoint);
}

export function POST(request: Request) {
  return methodNotAllowed(request.method, ['GET']);
}
