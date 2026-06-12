import { getServerEnv } from '../../../../../lib/env';
import {
  fetchParentResponseRequest,
  updateParentResponseRequest,
} from '../../../../../lib/parent-response';
import { approveParentResponseRequest } from '../../../../../lib/parent-response-approval';
import { jsonResponse, methodNotAllowed, upstreamUnavailable } from '../../../../../lib/response-shapes';

function asText(value: unknown): string {
  return String(value || '').trim();
}

function assertApprovalSecret(value: string) {
  const expected = getServerEnv('PARENT_RESPONSE_APPROVAL_SECRET');
  return Boolean(expected && value && value === expected);
}

function mergeApprovalPayload(
  base: Record<string, unknown> | null | undefined,
  update: Record<string, unknown>,
) {
  return {
    ...(base || {}),
    ...update,
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> | { requestId: string } },
) {
  const params = await context.params;
  const requestId = asText(params.requestId);
  const secret =
    request.headers.get('x-parent-response-approval-secret') ||
    new URL(request.url).searchParams.get('secret') ||
    '';
  if (!assertApprovalSecret(secret)) {
    return jsonResponse({ success: false, error: 'Invalid parent response approval secret' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if ((body as Record<string, unknown>).confirm !== true) {
    return jsonResponse({ success: false, error: 'Approval requires confirm: true' }, { status: 400 });
  }

  const row = await fetchParentResponseRequest(requestId);
  if (!row) {
    return jsonResponse({ success: false, error: 'Response request not found' }, { status: 404 });
  }

  try {
    const result = await approveParentResponseRequest(row);
    const appliedAt = new Date().toISOString();
    await updateParentResponseRequest(requestId, {
      request_status: 'applied',
      approval_status: 'applied',
      approval_payload: mergeApprovalPayload(row.approval_payload, {
        applied_at: appliedAt,
        applied_stage: result.stage,
        applied_open_event_id: result.reschedulePayload.open_event_id,
        applied_previous_event_id: result.reschedulePayload.previous_event_id || null,
        applied_created_task_id: result.rescheduleResult.created_task?.task_id || null,
      }),
      updated_at: appliedAt,
    });

    return jsonResponse({
      success: true,
      request_id: requestId,
      request_status: 'applied',
      approval_status: 'applied',
      stage: result.stage,
      open_event_id: result.reschedulePayload.open_event_id,
      previous_event_id: result.reschedulePayload.previous_event_id || null,
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    await updateParentResponseRequest(requestId, {
      approval_status: 'failed',
      approval_payload: mergeApprovalPayload(row.approval_payload, {
        approval_failed_at: failedAt,
        approval_error: message,
      }),
      updated_at: failedAt,
    }).catch(() => null);
    return upstreamUnavailable(message);
  }
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
