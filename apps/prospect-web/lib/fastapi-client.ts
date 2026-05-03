import { getFastApiBaseUrl, getFastApiToken, getMissingFastApiEnvMessage } from './env';
import { upstreamUnavailable } from './response-shapes';

const DEFAULT_TIMEOUT_MS = 30000;

export function buildEasternWeekWindow(week = 'this', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const easternDate = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  const dayOfWeek = easternDate.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekOffset = week === 'next' ? 1 : 0;
  const start = new Date(easternDate);
  start.setUTCDate(start.getUTCDate() + mondayOffset + weekOffset * 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  return {
    start: toIsoDate(start),
    end: toIsoDate(end),
    week: week === 'next' ? 'next' : 'this',
  };
}

export async function prospectFetch(path: string, init: RequestInit = {}) {
  const missingMessage = getMissingFastApiEnvMessage();
  if (missingMessage) {
    return upstreamUnavailable(missingMessage);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.FASTAPI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));

  try {
    const response = await fetch(`${getFastApiBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${getFastApiToken()}`,
        'x-mobile-proxy': 'vercel',
        ...(init.headers || {}),
      },
    });
    const text = await response.text();

    return new Response(text, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'FastAPI request timed out'
      : error instanceof Error
        ? error.message
        : String(error);
    return upstreamUnavailable(message);
  } finally {
    clearTimeout(timeout);
  }
}

function toIsoDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
