import { getServerEnv } from '../../../../../lib/env';
import { fetchParentResponseRequest, updateParentResponseRequest } from '../../../../../lib/parent-response';
import { jsonResponse, methodNotAllowed, upstreamUnavailable } from '../../../../../lib/response-shapes';

function asText(value: unknown): string {
  return String(value || '').trim();
}

function assertNotifySecret(value: string) {
  const expected = getServerEnv('PARENT_RESPONSE_NOTIFY_SECRET');
  return Boolean(expected && value && value === expected);
}

function responseLabel(kind?: string | null) {
  if (kind === 'selected_slot') return 'selected a slot';
  if (kind === 'none_work') return 'said none of the slots work';
  if (kind === 'ready_later') return 'said they will follow up when ready';
  return 'submitted a response';
}

function selectedSlotLabel(row: Awaited<ReturnType<typeof fetchParentResponseRequest>>) {
  const selectedOptionId = asText(row?.selected_option_id);
  if (!selectedOptionId) return '';
  const option = row?.proposed_options?.find((candidate) => candidate.option_id === selectedOptionId);
  return option?.display_label || selectedOptionId;
}

function buildEmailText(row: NonNullable<Awaited<ReturnType<typeof fetchParentResponseRequest>>>, requestUrl: URL) {
  const selectedLabel = selectedSlotLabel(row);
  const responsePayload = row.response_payload || {};
  const parentNote = asText(responsePayload.parent_note);
  const manualReviewUrl = new URL('/prospect-mobile/scout-schedules', requestUrl.origin).toString();

  return [
    `${row.athlete_name} parent response`,
    '',
    `Response: ${responseLabel(row.response_kind)}`,
    selectedLabel ? `Selected slot: ${selectedLabel}` : '',
    row.recipient_name ? `Contact: ${row.recipient_name}` : '',
    row.recipient_phone ? `Phone: ${row.recipient_phone}` : '',
    row.original_head_scout_name ? `Original head scout: ${row.original_head_scout_name}` : '',
    parentNote ? `Parent note: ${parentNote}` : '',
    '',
    `Manual review: ${manualReviewUrl}`,
  ].filter((line) => line !== '').join('\n');
}

async function sendResendEmail(args: { subject: string; text: string }) {
  const apiKey = getServerEnv('RESEND_API_KEY');
  const from = getServerEnv('PARENT_RESPONSE_NOTIFY_FROM');
  const to = getServerEnv('PARENT_RESPONSE_NOTIFY_TO');
  if (!apiKey || !from || !to) {
    throw new Error('Missing Resend notification environment');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: args.subject,
      text: args.text,
    }),
  });

  const payload = await response.json().catch(async () => ({
    error: await response.text().catch(() => ''),
  }));
  if (!response.ok) {
    throw new Error(asText((payload as Record<string, unknown>).error) || `Resend HTTP ${response.status}`);
  }

  return payload as Record<string, unknown>;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> | { requestId: string } },
) {
  const params = await context.params;
  const requestId = asText(params.requestId);
  const secret = request.headers.get('x-parent-response-secret') || new URL(request.url).searchParams.get('secret') || '';
  if (!assertNotifySecret(secret)) {
    return jsonResponse({ success: false, error: 'Invalid parent response notify secret' }, { status: 401 });
  }

  try {
    const row = await fetchParentResponseRequest(requestId);
    if (!row) {
      return jsonResponse({ success: false, error: 'Response request not found' }, { status: 404 });
    }
    if (!row.response_kind) {
      return jsonResponse({ success: false, error: 'Response request has no submitted response' }, { status: 409 });
    }

    const requestUrl = new URL(request.url);
    let resendResult: Record<string, unknown>;
    try {
      resendResult = await sendResendEmail({
        subject: `${row.athlete_name}: parent ${responseLabel(row.response_kind)}`,
        text: buildEmailText(row, requestUrl),
      });
      await updateParentResponseRequest(requestId, {
        notification_status: 'sent',
        notification_sent_at: new Date().toISOString(),
        notification_error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateParentResponseRequest(requestId, {
        notification_status: 'failed',
        notification_error: message,
      }).catch(() => null);
      throw error;
    }

    return jsonResponse({
      success: true,
      request_id: requestId,
      response_kind: row.response_kind,
      resend_result: resendResult,
    });
  } catch (error) {
    return upstreamUnavailable(error instanceof Error ? error.message : String(error));
  }
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
