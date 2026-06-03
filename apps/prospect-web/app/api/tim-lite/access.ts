import { getServerEnv } from '../../../lib/env';
import { jsonResponse } from '../../../lib/response-shapes';

export function verifyTimLiteAccess(request: Request) {
  const configuredToken = getServerEnv('TIM_LITE_ACCESS_TOKEN');
  if (!configuredToken) return null;

  const url = new URL(request.url);
  const suppliedToken =
    request.headers.get('x-tim-lite-token') ||
    url.searchParams.get('access') ||
    '';

  if (suppliedToken === configuredToken) return null;

  return jsonResponse(
    {
      success: false,
      error: 'Tim Lite access is required',
      code: 'tim_lite_access_required',
    },
    { status: 401 },
  );
}

export function getSupabaseRestConfig() {
  const url = getServerEnv('SUPABASE_URL') || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = getServerEnv('SUPABASE_SECRET_KEY') || getServerEnv('SUPABASE_SERVICE_ROLE_KEY');
  const schema = getServerEnv('SUPABASE_SCHEMA') || 'public';
  if (!url || !key) {
    throw new Error('Missing server Supabase credentials');
  }
  return {
    url: url.replace(/\/+$/, ''),
    key,
    schema,
  };
}

export function supabaseHeaders(config: ReturnType<typeof getSupabaseRestConfig>, extra: HeadersInit = {}) {
  return {
    apikey: config.key,
    authorization: `Bearer ${config.key}`,
    'accept-profile': config.schema,
    'content-profile': config.schema,
    'cache-control': 'no-store',
    ...extra,
  };
}

export function buildTimLiteWeekWindow(week = 'this', now = new Date()) {
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

function toIsoDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
