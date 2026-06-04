import { prospectFetch } from '../../../../../lib/fastapi-client';
import { jsonResponse, methodNotAllowed } from '../../../../../lib/response-shapes';
import { createCoachRisnerSessionSetCookie } from '../../access';

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const email = String(payload.email || payload.username || '').trim();
  const password = String(payload.password || '');

  if (!email || !password) {
    return jsonResponse(
      {
        success: false,
        error: 'Prospect email and password are required',
        code: 'coach_risner_credentials_required',
      },
      { status: 400 },
    );
  }

  const upstream = await prospectFetch('/api/v1/mobile/coach-risner/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await upstream.text();
  let upstreamPayload: Record<string, unknown> = {};
  try {
    upstreamPayload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    upstreamPayload = { success: false, error: text || 'Prospect login failed' };
  }

  if (!upstream.ok || upstreamPayload.success !== true) {
    return jsonResponse(
      {
        success: false,
        error: String(upstreamPayload.error || upstreamPayload.detail || 'Prospect login failed'),
        code: String(upstreamPayload.code || 'coach_risner_login_failed'),
      },
      { status: upstream.status || 502 },
    );
  }

  return jsonResponse(
    {
      success: true,
      operator: 'coach_risner',
      message: 'Prospect login saved',
    },
    {
      headers: {
        'set-cookie': createCoachRisnerSessionSetCookie(),
        'cache-control': 'no-store',
      },
    },
  );
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
