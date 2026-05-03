export type JsonRecord = Record<string, unknown>;

export function jsonResponse(payload: JsonRecord, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export function methodNotAllowed(method: string, allowed: string[]) {
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

export function upstreamUnavailable(message: string) {
  return jsonResponse(
    {
      success: false,
      status: 'failed',
      error: message,
      message,
    },
    { status: 502 },
  );
}
