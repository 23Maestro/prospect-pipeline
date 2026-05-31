import { getPreferenceValues } from '@raycast/api';
import fs from 'fs';
import path from 'path';
import {
  buildPendingClientResolvedPatch,
  PENDING_CLIENT_LIST_LIMIT,
  type PendingClientWatchlistRow,
} from '../domain/pending-client-watchlist';
import {
  patchPendingClientWatchlistRow,
  readRows,
  type SupabasePersistenceConfig,
} from '../domain/supabase-persistence';

type Preferences = {
  supabaseUrl?: string;
  supabaseSecretKey?: string;
  supabaseServiceRoleKey?: string;
  supabaseSchema?: string;
};

export type PendingClientWatchlistLoadResult = {
  rows: PendingClientWatchlistRow[];
  scannedCount: number;
  confirmedCount: number;
  aiUnavailableCount: number;
};

const DEFAULT_SCHEMA = 'public';
const REPO_ROOT_FALLBACK = '/Users/singleton23/Raycast/prospect-pipeline';

function readEnvFile(filePath: string): Record<string, string> {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.split(/\r?\n/).reduce<Record<string, string>>((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return acc;
      const [key, ...rest] = trimmed.split('=');
      acc[key.trim()] = rest
        .join('=')
        .trim()
        .replace(/^['"]|['"]$/g, '');
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function findProjectRoot(): string {
  let current = process.cwd();
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    try {
      const raw = fs.readFileSync(path.join(current, 'package.json'), 'utf8');
      const pkg = JSON.parse(raw) as { name?: string };
      if (pkg?.name === 'prospect-pipeline') return current;
    } catch {
      // keep walking
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return REPO_ROOT_FALLBACK;
}

function readRepoEnv(): Record<string, string> {
  const roots = [findProjectRoot(), REPO_ROOT_FALLBACK]
    .map((value) => path.resolve(value))
    .filter((value, index, list) => value && list.indexOf(value) === index);

  return roots.reduce<Record<string, string>>(
    (acc, root) => ({
      ...acc,
      ...readEnvFile(path.join(root, 'npid-api-layer/.env')),
      ...readEnvFile(path.join(root, '.env')),
      ...readEnvFile(path.join(root, '.overmind.env')),
    }),
    {},
  );
}

function getSupabaseConfig(): SupabasePersistenceConfig | null {
  const prefs = getPreferenceValues<Preferences>();
  const repoEnv = readRepoEnv();
  const url = String(process.env.SUPABASE_URL || repoEnv.SUPABASE_URL || prefs.supabaseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const key = String(
    process.env.SUPABASE_SECRET_KEY ||
      repoEnv.SUPABASE_SECRET_KEY ||
      prefs.supabaseSecretKey ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      repoEnv.SUPABASE_SERVICE_ROLE_KEY ||
      prefs.supabaseServiceRoleKey ||
      '',
  ).trim();
  const schema =
    String(
      process.env.SUPABASE_SCHEMA || repoEnv.SUPABASE_SCHEMA || prefs.supabaseSchema || '',
    ).trim() || DEFAULT_SCHEMA;
  return url && key ? { url, key, schema } : null;
}

export async function loadPendingClientWatchlist(): Promise<PendingClientWatchlistLoadResult> {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error('Missing Supabase URL or key');
  }

  const now = new Date();
  const activeRows = await readRows<PendingClientWatchlistRow>(
    config,
    'pending_client_watchlist',
    [
      'select=*',
      'status=eq.watching',
      `expires_at=gte.${encodeURIComponent(now.toISOString())}`,
      'order=event_start.desc',
      `limit=${PENDING_CLIENT_LIST_LIMIT}`,
    ].join('&'),
  );

  return {
    rows: activeRows,
    scannedCount: activeRows.length,
    confirmedCount: activeRows.length,
    aiUnavailableCount: 0,
  };
}

export async function markPendingClientResolved(sourceEventId: string): Promise<void> {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error('Missing Supabase URL or key');
  }
  await patchPendingClientWatchlistRow(config, sourceEventId, buildPendingClientResolvedPatch());
}
