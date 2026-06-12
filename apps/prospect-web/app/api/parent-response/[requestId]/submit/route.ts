import {
  buildParentResponseIntent,
  updateParentResponseRequest,
  validateParentResponseRequest,
} from '../../../../../lib/parent-response';
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

    return jsonResponse({
      success: true,
      request_id: requestId,
      request_status: row?.request_status || update.request_status,
      response_kind: row?.response_kind || update.response_kind,
      selected_option_id: row?.selected_option_id || update.selected_option_id,
    });
  } catch (error) {
    return upstreamUnavailable(error instanceof Error ? error.message : String(error));
  }
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
