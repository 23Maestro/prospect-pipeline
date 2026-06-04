import { getServerEnv } from '../../../lib/env';
import { jsonResponse } from '../../../lib/response-shapes';
import { createHmac, timingSafeEqual } from 'node:crypto';

const COACH_RISNER_SESSION_COOKIE = 'coach_risner_session';
const COACH_RISNER_OPERATOR = 'coach_risner';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function verifyTimLiteAccess(request: Request) {
  const configuredToken = getServerEnv('TIM_LITE_ACCESS_TOKEN');
  if (hasValidCoachRisnerSession(request, configuredToken)) return null;

  return jsonResponse(
    {
      success: false,
      error: 'Coach Risner login is required',
      code: 'coach_risner_login_required',
    },
    { status: 401 },
  );
}

export function createCoachRisnerSessionSetCookie() {
  const secret = getCoachRisnerSessionSecret();
  if (!secret) {
    throw new Error('A server session signing secret is required for Coach Risner sessions');
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${COACH_RISNER_OPERATOR}.${expiresAt}`;
  const signature = signCoachRisnerSession(payload, secret);
  const value = `${payload}.${signature}`;
  return `${COACH_RISNER_SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function hasValidCoachRisnerSession(request: Request, configuredToken = getCoachRisnerSessionSecret()) {
  if (!configuredToken) return false;
  const rawCookie = request.headers.get('cookie') || '';
  const value = rawCookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COACH_RISNER_SESSION_COOKIE}=`))
    ?.slice(COACH_RISNER_SESSION_COOKIE.length + 1);
  if (!value) return false;

  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [operator, expiresAt, signature] = parts;
  if (operator !== COACH_RISNER_OPERATOR) return false;
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  const expected = signCoachRisnerSession(`${operator}.${expiresAt}`, configuredToken);
  return safeEqual(signature, expected);
}

function getCoachRisnerSessionSecret() {
  return getServerEnv('TIM_LITE_ACCESS_TOKEN') || getServerEnv('INTERNAL_API_SECRET') || getServerEnv('PROSPECT_API_TOKEN');
}

function signCoachRisnerSession(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
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
