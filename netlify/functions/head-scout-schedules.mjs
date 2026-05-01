import { buildEasternWeekWindow, methodNotAllowed, prospectFetch } from './_shared/prospect-api.mjs';

export default async (req) => {
  if (req.method !== 'GET') {
    return methodNotAllowed(req.method, ['GET']);
  }

  const url = new URL(req.url);
  const weekWindow = buildEasternWeekWindow(url.searchParams.get('week') || 'this');
  const endpoint = `/api/v1/mobile/calendar/head-scout-slots?start=${encodeURIComponent(weekWindow.start)}&end=${encodeURIComponent(weekWindow.end)}`;
  return prospectFetch(endpoint);
};

export const config = {
  path: '/api/head-scout-schedules',
};
