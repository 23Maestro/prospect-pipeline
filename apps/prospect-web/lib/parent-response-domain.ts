import { createHash } from 'node:crypto';

export type ParentResponseRequestState = {
  request_status?: string | null;
  used_at?: string | null;
  expires_at?: string | null;
};

export type ParentResponseIntentUpdate = {
  request_status: 'selected' | 'none_work' | 'ready_later';
  response_kind: 'selected_slot' | 'none_work' | 'ready_later';
  selected_option_id: string | null;
  selected_at: string;
  used_at: string;
  response_payload: Record<string, unknown>;
  updated_at: string;
};

function asText(value: unknown): string {
  return String(value || '').trim();
}

export async function hashParentResponseToken(token: string, secret: string): Promise<string> {
  const normalizedToken = asText(token);
  const normalizedSecret = asText(secret);
  if (!normalizedToken) {
    throw new Error('Missing parent response token');
  }
  if (!normalizedSecret) {
    throw new Error('Missing parent response token secret');
  }

  return createHash('sha256')
    .update(`${normalizedSecret}:${normalizedToken}`)
    .digest('hex');
}

export function isParentResponseRequestOpen(
  request: ParentResponseRequestState,
  now = new Date(),
): boolean {
  if (asText(request.request_status) !== 'open') return false;
  if (asText(request.used_at)) return false;

  const expiresAt = Date.parse(asText(request.expires_at));
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt > now.getTime();
}

export function selectParentResponseOption(args: {
  optionId: string;
  responsePayload?: Record<string, unknown>;
  selectedAt: string;
}): ParentResponseIntentUpdate {
  const optionId = asText(args.optionId);
  if (!optionId) {
    throw new Error('Missing selected parent response option');
  }

  return {
    request_status: 'selected',
    response_kind: 'selected_slot',
    selected_option_id: optionId,
    selected_at: args.selectedAt,
    used_at: args.selectedAt,
    response_payload: args.responsePayload || {},
    updated_at: args.selectedAt,
  };
}

export function selectNoParentResponseOptionsWork(args: {
  responsePayload?: Record<string, unknown>;
  selectedAt: string;
}): ParentResponseIntentUpdate {
  return {
    request_status: 'none_work',
    response_kind: 'none_work',
    selected_option_id: null,
    selected_at: args.selectedAt,
    used_at: args.selectedAt,
    response_payload: args.responsePayload || {},
    updated_at: args.selectedAt,
  };
}

export function selectParentReadyLater(args: {
  responsePayload?: Record<string, unknown>;
  selectedAt: string;
}): ParentResponseIntentUpdate {
  return {
    request_status: 'ready_later',
    response_kind: 'ready_later',
    selected_option_id: null,
    selected_at: args.selectedAt,
    used_at: args.selectedAt,
    response_payload: args.responsePayload || {},
    updated_at: args.selectedAt,
  };
}
