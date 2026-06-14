import {
  buildParentResponseIntent,
  updateParentResponseRequest,
  validateParentResponseRequest,
} from '../../../../../lib/parent-response';
import { getServerEnv } from '../../../../../lib/env';
import { jsonResponse, methodNotAllowed, upstreamUnavailable } from '../../../../../lib/response-shapes';

function asText(value: unknown): string {
  return String(value || '').trim();
}

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }

  return {};
}

async function triggerParentResponseNotification(request: Request, requestId: string) {
  const secret = getServerEnv('PARENT_RESPONSE_NOTIFY_SECRET');
  if (!secret) {
    return { status: 'skipped', error: 'Missing PARENT_RESPONSE_NOTIFY_SECRET' };
  }

  const response = await fetch(new URL(`/api/parent-response/${encodeURIComponent(requestId)}/notify`, request.url), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'x-parent-response-secret': secret,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      status: 'failed',
      error: asText((payload as Record<string, unknown>).error) || `Notify HTTP ${response.status}`,
    };
  }
  return { status: 'sent', error: '' };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> | { requestId: string } },
) {
  const params = await context.params;
  const requestId = asText(params.requestId);
  const payload = await readPayload(request);
  const token = asText(payload.token);

  try {
    const validation = await validateParentResponseRequest({ requestId, token });
    if (!validation.ok) {
      return jsonResponse({ success: false, error: validation.error }, { status: validation.status });
    }

    const selectedAt = new Date().toISOString();
    const update = buildParentResponseIntent({
      optionId: asText(payload.option_id),
      responseKind: asText(payload.response_kind),
      responsePayload: {
        parent_note: asText(payload.parent_note),
        user_agent: request.headers.get('user-agent') || '',
      },
      selectedAt,
    });
    const row = await updateParentResponseRequest(requestId, update);
    const notification = await triggerParentResponseNotification(request, requestId).catch((error) => ({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }));

    return jsonResponse({
      success: true,
      request_id: requestId,
      request_status: row?.request_status || update.request_status,
      response_kind: row?.response_kind || update.response_kind,
      selected_option_id: row?.selected_option_id || update.selected_option_id,
      notification,
    });
  } catch (error) {
    return upstreamUnavailable(error instanceof Error ? error.message : String(error));
  }
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
