import {
  hashParentResponseToken,
  isParentResponseRequestOpen,
  selectNoParentResponseOptionsWork,
  selectParentReadyLater,
  selectParentResponseOption,
  type ParentResponseIntentUpdate,
} from './parent-response-domain';
import { getServerEnv } from './env';

export type ParentResponseOption = {
  option_id: string;
  display_label: string;
  starts_at?: string | null;
  ends_at?: string | null;
  timezone?: string | null;
  timezone_label?: string | null;
  open_event_id?: string | null;
};

export type ParentResponseRequestRow = {
  id: string;
  appointment_id?: string | null;
  athlete_id: string;
  athlete_main_id: string;
  athlete_name: string;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  original_head_scout_name?: string | null;
  original_meeting_starts_at?: string | null;
  original_meeting_timezone?: string | null;
  request_status: string;
  approval_status: string;
  token_hash: string;
  expires_at: string;
  used_at?: string | null;
  response_kind?: string | null;
  selected_option_id?: string | null;
  proposed_options: ParentResponseOption[];
  response_payload?: Record<string, unknown> | null;
  approval_payload?: Record<string, unknown> | null;
  notification_status?: string | null;
  notification_sent_at?: string | null;
  notification_error?: string | null;
};

export type ParentResponseValidation =
  | { ok: true; row: ParentResponseRequestRow }
  | { ok: false; status: number; error: string };

function asText(value: unknown): string {
  return String(value || '').trim();
}

function getSupabaseRestConfig() {
  const url = getServerEnv('SUPABASE_URL') || process.env.NEXT_PUBLIC_SUPABASE_URL;
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

function supabaseHeaders(extra: Record<string, string> = {}) {
  const config = getSupabaseRestConfig();
  return {
    apikey: config.key,
    authorization: `Bearer ${config.key}`,
    'content-type': 'application/json',
    accept: 'application/json',
    'accept-profile': config.schema,
    'content-profile': config.schema,
    ...extra,
  };
}

export async function fetchParentResponseRequest(
  requestId: string,
): Promise<ParentResponseRequestRow | null> {
  const config = getSupabaseRestConfig();
  const id = asText(requestId);
  if (!id) return null;

  const response = await fetch(
    `${config.url}/rest/v1/parent_response_requests?${new URLSearchParams({
      id: `eq.${id}`,
      select: '*',
    }).toString()}`,
    { headers: supabaseHeaders() },
  );
  if (!response.ok) {
    throw new Error((await response.text().catch(() => '')) || `Supabase read HTTP ${response.status}`);
  }

  const rows = (await response.json()) as ParentResponseRequestRow[];
  return rows[0] || null;
}

export async function updateParentResponseRequest(
  requestId: string,
  update: ParentResponseIntentUpdate | Record<string, unknown>,
): Promise<ParentResponseRequestRow | null> {
  const config = getSupabaseRestConfig();
  const id = asText(requestId);
  if (!id) {
    throw new Error('Missing parent response request id');
  }

  const response = await fetch(
    `${config.url}/rest/v1/parent_response_requests?${new URLSearchParams({
      id: `eq.${id}`,
      select: '*',
    }).toString()}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders({ prefer: 'return=representation' }),
      body: JSON.stringify(update),
    },
  );
  if (!response.ok) {
    throw new Error((await response.text().catch(() => '')) || `Supabase update HTTP ${response.status}`);
  }

  const rows = (await response.json()) as ParentResponseRequestRow[];
  return rows[0] || null;
}

export async function validateParentResponseRequest(args: {
  requestId: string;
  token: string;
  now?: Date;
}): Promise<ParentResponseValidation> {
  const token = asText(args.token);
  if (!token) {
    return { ok: false, status: 401, error: 'Missing response token' };
  }

  const row = await fetchParentResponseRequest(args.requestId);
  if (!row) {
    return { ok: false, status: 404, error: 'Response request not found' };
  }

  const expectedHash = await hashParentResponseToken(
    token,
    getServerEnv('PARENT_RESPONSE_TOKEN_SECRET'),
  );
  if (expectedHash !== row.token_hash) {
    return { ok: false, status: 401, error: 'Invalid response token' };
  }
  if (!isParentResponseRequestOpen(row, args.now || new Date())) {
    return { ok: false, status: 409, error: 'Response request is no longer open' };
  }

  return { ok: true, row };
}

export function buildParentResponseIntent(args: {
  optionId?: string | null;
  responseKind?: string | null;
  responsePayload?: Record<string, unknown>;
  selectedAt: string;
}): ParentResponseIntentUpdate {
  if (asText(args.responseKind) === 'none_work') {
    return selectNoParentResponseOptionsWork({
      responsePayload: args.responsePayload,
      selectedAt: args.selectedAt,
    });
  }
  if (asText(args.responseKind) === 'ready_later') {
    return selectParentReadyLater({
      responsePayload: args.responsePayload,
      selectedAt: args.selectedAt,
    });
  }

  return selectParentResponseOption({
    optionId: asText(args.optionId),
    responsePayload: args.responsePayload,
    selectedAt: args.selectedAt,
  });
}
