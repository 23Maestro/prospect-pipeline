import { prospectFetch } from '../../../lib/fastapi-client';
import { jsonResponse, methodNotAllowed } from '../../../lib/response-shapes';

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  return prospectFetch('/api/v1/mobile/contact-reminder-intake', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
