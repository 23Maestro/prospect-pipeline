import { buildEasternWeekWindow, methodNotAllowed, prospectFetch } from './_shared/prospect-api.mjs';

export default async (req) => {
  if (req.method !== 'GET') {
    return methodNotAllowed(req.method, ['GET']);
  }

  const url = new URL(req.url);
  const week = url.searchParams.get('week') || 'this';
  const weekWindow = buildEasternWeekWindow(week);
  const taskRange = weekWindow.week === 'next' ? 'nextWeek' : 'thisWeek';
  const endpoint = `/api/v1/mobile/calendar/booked-meetings?start=${encodeURIComponent(weekWindow.start)}&end=${encodeURIComponent(weekWindow.end)}&task_range=${encodeURIComponent(taskRange)}`;
  return prospectFetch(endpoint);
};

export const config = {
  path: '/api/set-meetings',
};
