import {
  assertAppointmentTruthWrite,
  asAppointmentTruthRow,
  mergeAppointmentTruthRow,
} from './appointment-truth';

export type SupabasePersistenceConfig = {
  url: string;
  key: string;
  schema?: string;
};

export type SupabaseWriteResult = {
  table: string;
  count: number;
  onConflict?: string;
};

type RequestArgs = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  table: string;
  rows?: unknown[] | Record<string, unknown>;
  onConflict?: string;
  resolution?: 'merge-duplicates' | 'ignore-duplicates';
  query?: string;
};

function normalizeSchema(schema?: string | null): string {
  return String(schema || '').trim() || 'public';
}

function asRecord(row: unknown): Record<string, unknown> | null {
  return row && typeof row === 'object' && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : null;
}

function quotePostgrestInValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function preserveAppointmentTruthBeforeUpsert(
  config: SupabasePersistenceConfig,
  rows: unknown[],
): Promise<unknown[]> {
  const rowRecords = rows.map(asRecord).filter(Boolean) as Record<string, unknown>[];
  const ids = Array.from(new Set(rowRecords.map((row) => String(row.id || '').trim()).filter(Boolean)));
  if (!ids.length) return rows;

  const quotedIds = ids.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',');
  const existingRows = await readRows<Record<string, unknown>>(
    config,
    'appointments',
    `select=*&id=in.(${quotedIds})`,
  );
  const existingById = new Map<string, Record<string, unknown>>();
  for (const row of existingRows) {
    const id = String(row.id || '').trim();
    if (id) existingById.set(id, row);
  }

  return rows.map((row) => {
    const record = asRecord(row);
    if (!record) return row;
    const id = String(record.id || '').trim();
    const merged = mergeAppointmentTruthRow(existingById.get(id), {
      ...record,
      id,
    });
    const appointmentTruth = asAppointmentTruthRow(merged);
    if (appointmentTruth) assertAppointmentTruthWrite(appointmentTruth);
    return merged;
  });
}

async function preservePendingClientWatchlistBeforeUpsert(
  config: SupabasePersistenceConfig,
  rows: unknown[],
): Promise<unknown[]> {
  const rowRecords = rows.map(asRecord).filter(Boolean) as Record<string, unknown>[];
  const sourceEventIds = Array.from(
    new Set(rowRecords.map((row) => String(row.source_event_id || '').trim()).filter(Boolean)),
  );
  if (!sourceEventIds.length) return rows;

  const existingRows = await readRows<Record<string, unknown>>(
    config,
    'pending_client_watchlist',
    [
      'select=source_event_id,status,first_seen_at,resolved_at,resolved_by_operator,resolved_by_operator_key',
      `source_event_id=in.(${sourceEventIds.map(quotePostgrestInValue).join(',')})`,
    ].join('&'),
  );
  const existingBySourceEventId = new Map(
    existingRows.map((row) => [String(row.source_event_id || '').trim(), row]),
  );

  return rows.flatMap((row) => {
    const record = asRecord(row);
    if (!record) return [row];
    const sourceEventId = String(record.source_event_id || '').trim();
    const existing = existingBySourceEventId.get(sourceEventId);
    const status = String(existing?.status || '').trim();
    if (status === 'resolved' || status === 'expired') return [];
    return [
      {
        ...record,
        first_seen_at: existing?.first_seen_at || record.first_seen_at,
        resolved_at: existing?.resolved_at || null,
        resolved_by_operator: existing?.resolved_by_operator || null,
        resolved_by_operator_key: existing?.resolved_by_operator_key || null,
      },
    ];
  });
}

export async function supabaseRequest<T = unknown>(
  config: SupabasePersistenceConfig,
  args: RequestArgs,
): Promise<T> {
  const params = new URLSearchParams();
  if (args.onConflict) params.set('on_conflict', args.onConflict);
  if (args.query) {
    const queryParams = new URLSearchParams(args.query);
    for (const [key, value] of queryParams.entries()) params.append(key, value);
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  const endpoint = `${config.url.replace(/\/+$/, '')}/rest/v1/${encodeURIComponent(args.table)}${query}`;
  const method = args.method || 'POST';
  const response = await fetch(endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      Prefer: args.onConflict
        ? `resolution=${args.resolution || 'merge-duplicates'},return=minimal`
        : 'return=minimal',
      'Accept-Profile': normalizeSchema(config.schema),
      'Content-Profile': normalizeSchema(config.schema),
    },
    body: method === 'GET' ? undefined : JSON.stringify(args.rows || []),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${args.table} ${method} failed: ${response.status} ${text.slice(0, 300)}`);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function readRows<T = Record<string, unknown>>(
  config: SupabasePersistenceConfig,
  table: string,
  query: string,
): Promise<T[]> {
  const rows = await supabaseRequest<T[]>(config, { method: 'GET', table, query });
  return Array.isArray(rows) ? rows : [];
}

async function writeRows(
  config: SupabasePersistenceConfig,
  table: string,
  rows: unknown[],
  onConflict?: string,
  resolution?: 'merge-duplicates' | 'ignore-duplicates',
): Promise<SupabaseWriteResult> {
  if (!rows.length) return { table, count: 0, onConflict };
  await supabaseRequest(config, { table, rows, onConflict, resolution });
  return { table, count: rows.length, onConflict };
}

export function upsertAthletes(config: SupabasePersistenceConfig, rows: unknown[]) {
  return writeRows(config, 'athletes', rows, 'athlete_key');
}

export async function upsertAppointments(config: SupabasePersistenceConfig, rows: unknown[]) {
  const mergedRows = await preserveAppointmentTruthBeforeUpsert(config, rows);
  return writeRows(config, 'appointments', mergedRows, 'id');
}

export function upsertAthletePipelineState(config: SupabasePersistenceConfig, rows: unknown[]) {
  return writeRows(config, 'athlete_pipeline_state', rows, 'athlete_key');
}

export function insertLifecycleEvents(config: SupabasePersistenceConfig, rows: unknown[]) {
  return writeRows(config, 'lifecycle_events', rows);
}

export function insertMeetingSetEventsOnce(config: SupabasePersistenceConfig, rows: unknown[]) {
  return writeRows(config, 'lifecycle_events', rows, 'dedupe_key', 'ignore-duplicates');
}

export function upsertCallActivityEvents(config: SupabasePersistenceConfig, rows: unknown[]) {
  return writeRows(config, 'call_activity_events', rows, 'task_id');
}

export function upsertPostMeetingOutcomeFacts(config: SupabasePersistenceConfig, rows: unknown[]) {
  return writeRows(config, 'meeting_events', rows, 'dedupe_key');
}

export function upsertSetMeetingConfirmationCacheRows(
  config: SupabasePersistenceConfig,
  rows: unknown[],
) {
  return writeRows(config, 'set_meeting_confirmation_cache', rows, 'dedupe_key');
}

export async function upsertPendingClientWatchlistRows(
  config: SupabasePersistenceConfig,
  rows: unknown[],
) {
  const preservedRows = await preservePendingClientWatchlistBeforeUpsert(config, rows);
  return writeRows(config, 'pending_client_watchlist', preservedRows, 'source_event_id');
}

export function upsertAthleteContactCacheRows(config: SupabasePersistenceConfig, rows: unknown[]) {
  return writeRows(config, 'athlete_contact_cache', rows, 'normalized_phone,athlete_key');
}

export async function hasAthleteContactCacheRows(
  config: SupabasePersistenceConfig,
  athleteKey: string,
): Promise<boolean> {
  const rows = await readRows<{ id: string }>(
    config,
    'athlete_contact_cache',
    `select=id&athlete_key=eq.${encodeURIComponent(athleteKey)}&limit=1`,
  );
  return rows.length > 0;
}

export function patchAthleteContactCacheRowsForAthlete(
  config: SupabasePersistenceConfig,
  athleteKey: string,
  row: Record<string, unknown>,
) {
  return patchRow(config, 'athlete_contact_cache', 'athlete_key', athleteKey, row);
}

export function patchPendingClientWatchlistRow(
  config: SupabasePersistenceConfig,
  sourceEventId: string,
  row: Record<string, unknown>,
) {
  return patchRow(config, 'pending_client_watchlist', 'source_event_id', sourceEventId, row);
}

export async function patchRow(
  config: SupabasePersistenceConfig,
  table: string,
  column: string,
  value: string,
  row: Record<string, unknown>,
): Promise<SupabaseWriteResult> {
  await supabaseRequest(config, {
    method: 'PATCH',
    table,
    query: `${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`,
    rows: row,
  });
  return { table, count: 1 };
}

export async function deleteRows(
  config: SupabasePersistenceConfig,
  table: string,
  column: string,
  value: string,
): Promise<SupabaseWriteResult> {
  await supabaseRequest(config, {
    method: 'DELETE',
    table,
    query: `${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`,
    rows: [],
  });
  return { table, count: 1 };
}
