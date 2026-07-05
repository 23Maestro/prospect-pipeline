import { getScoutSchedules } from '../../../lib/prospect-demo-data';
import { jsonResponse, methodNotAllowed } from '../../../lib/response-shapes';

export function GET(request: Request) {
  const url = new URL(request.url);
  const week = url.searchParams.get('week') === 'next' ? 'next' : 'this';
  const scouts = getScoutSchedules(week);
  return jsonResponse({
    success: true,
    source: 'local_roster',
    week,
    count: scouts.reduce((total, scout) => total + scout.slots.length, 0),
    scouts,
  });
}

export function POST(request: Request) {
  return methodNotAllowed(request.method, ['GET']);
}
