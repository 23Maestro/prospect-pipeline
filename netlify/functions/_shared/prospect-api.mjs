const DEFAULT_WEEK = 'this';

export function getEnv(name) {
  if (globalThis.Netlify?.env?.get) {
    return globalThis.Netlify.env.get(name);
  }
  return process.env[name];
}

export function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export function methodNotAllowed(method, allowed) {
  return jsonResponse(
    {
      success: false,
      error: `Method ${method} not allowed`,
    },
    {
      status: 405,
      headers: {
        allow: allowed.join(', '),
      },
    },
  );
}

export function buildEasternWeekWindow(week = DEFAULT_WEEK, now = new Date()) {
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

export async function prospectFetch(path, init = {}) {
  const baseUrl = (getEnv('PROSPECT_API_BASE') || '').replace(/\/+$/, '');
  const token = getEnv('PROSPECT_API_TOKEN') || '';

  if (!baseUrl || !token) {
    return jsonResponse(
      {
        success: false,
        error: 'Netlify is missing PROSPECT_API_BASE or PROSPECT_API_TOKEN',
      },
      { status: 500 },
    );
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'x-mobile-proxy': 'netlify',
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
}

function toIsoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
