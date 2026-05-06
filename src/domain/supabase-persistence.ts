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

export function upsertAppointments(config: SupabasePersistenceConfig, rows: unknown[]) {
  return writeRows(config, 'appointments', rows, 'id');
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

export function upsertReminders(config: SupabasePersistenceConfig, rows: unknown[]) {
  return writeRows(config, 'reminders', rows, 'dedupe_key');
}

export function upsertPendingClientWatchlistRows(
  config: SupabasePersistenceConfig,
  rows: unknown[],
) {
  return writeRows(config, 'pending_client_watchlist', rows, 'source_event_id');
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
