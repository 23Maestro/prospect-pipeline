import { getPreferenceValues } from '@raycast/api';
import fs from 'fs';
import path from 'path';
import {
  buildPendingClientResolvedPatch,
  PENDING_CLIENT_LIST_LIMIT,
  type PendingClientWatchlistRow,
} from '../domain/pending-client-watchlist';
import type { AppointmentTruthRow } from '../domain/appointment-truth';
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

type ActiveAthleteMeetingTruthDisplayRow = {
  athlete_key?: string | null;
  resolved_appointment_id?: string | null;
  current_starts_at?: string | null;
  current_meeting_timezone?: string | null;
  current_meeting_timezone_label?: string | null;
};

export type PendingClientWatchlistDisplayRow = PendingClientWatchlistRow & {
  appointment_starts_at?: string | null;
  meeting_timezone?: string | null;
  meeting_timezone_label?: string | null;
};

export type PendingClientWatchlistLoadResult = {
  rows: PendingClientWatchlistDisplayRow[];
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

function quotePostgrestInValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function extractAppointmentId(row: PendingClientWatchlistRow): string | null {
  return String(row.source_event_id || '').match(/:(\d+)$/)?.[1] || null;
}

function athleteKey(row: PendingClientWatchlistRow): string | null {
  const athleteId = String(row.athlete_id || '').trim();
  const athleteMainId = String(row.athlete_main_id || '').trim();
  return athleteId && athleteMainId ? `${athleteId}:${athleteMainId}` : null;
}

function athleteDedupeKey(row: PendingClientWatchlistDisplayRow): string {
  return [
    String(row.athlete_id || '').trim(),
    String(row.athlete_main_id || '').trim(),
    String(row.athlete_name || '')
      .trim()
      .toLowerCase(),
  ].join(':');
}

function pendingClientRowTime(row: PendingClientWatchlistDisplayRow): number {
  const parsed = Date.parse(
    String(row.appointment_starts_at || row.event_start || row.last_seen_at || '').trim(),
  );
  return Number.isNaN(parsed) ? 0 : parsed;
}

function pendingClientTitleRank(row: PendingClientWatchlistDisplayRow): number {
  const title = String(row.event_title || '').trim();
  if (/^\((?:FU|RSP|CAN)\)(?:\*\d+)?\b/i.test(title)) return 4;
  if (/\bMeeting Rescheduled Pending\b/i.test(title)) return 3;
  if (/\b(?:RSP|CAN|FU) And Scout Notes\b/i.test(title)) return 2;
  if (/^Post Meeting\b/i.test(title)) return 1;
  return 0;
}

function comparePendingClientRows(
  left: PendingClientWatchlistDisplayRow,
  right: PendingClientWatchlistDisplayRow,
): number {
  const titleRankDiff = pendingClientTitleRank(left) - pendingClientTitleRank(right);
  if (titleRankDiff !== 0) return titleRankDiff;
  return pendingClientRowTime(left) - pendingClientRowTime(right);
}

function dedupePendingClientRows(
  rows: PendingClientWatchlistDisplayRow[],
): PendingClientWatchlistDisplayRow[] {
  const byAthlete = new Map<string, PendingClientWatchlistDisplayRow>();
  const unkeyed: PendingClientWatchlistDisplayRow[] = [];

  for (const row of rows) {
    const key = athleteDedupeKey(row);
    if (key === '::') {
      unkeyed.push(row);
      continue;
    }
    const existing = byAthlete.get(key);
    if (!existing || comparePendingClientRows(row, existing) > 0) {
      byAthlete.set(key, row);
    }
  }

  return [...byAthlete.values(), ...unkeyed].sort(
    (left, right) => pendingClientRowTime(right) - pendingClientRowTime(left),
  );
}

async function enrichPendingClientRowsWithAppointmentTruth(
  config: SupabasePersistenceConfig,
  rows: PendingClientWatchlistRow[],
): Promise<PendingClientWatchlistDisplayRow[]> {
  const athleteKeys = Array.from(new Set(rows.map(athleteKey).filter(Boolean) as string[]));
  const activeTruthRows = athleteKeys.length
    ? await readRows<ActiveAthleteMeetingTruthDisplayRow>(
        config,
        'active_athlete_meeting_truth',
        [
          'select=athlete_key,resolved_appointment_id,current_starts_at,current_meeting_timezone,current_meeting_timezone_label',
          `athlete_key=in.(${athleteKeys.map(quotePostgrestInValue).join(',')})`,
        ].join('&'),
      )
    : [];
  const activeTruthByAthleteKey = new Map(
    activeTruthRows.map((truth) => [String(truth.athlete_key || '').trim(), truth]),
  );
  const appointmentIds = Array.from(
    new Set(rows.map(extractAppointmentId).filter(Boolean) as string[]),
  );
  const appointments = appointmentIds.length
    ? await readRows<
        Pick<
          AppointmentTruthRow,
          'id' | 'starts_at' | 'meeting_timezone' | 'meeting_timezone_label'
        >
      >(
        config,
        'appointments',
        [
          'select=id,starts_at,meeting_timezone,meeting_timezone_label',
          `id=in.(${appointmentIds.map(quotePostgrestInValue).join(',')})`,
        ].join('&'),
      )
    : [];
  const appointmentsById = new Map(
    appointments.map((appointment) => [String(appointment.id || '').trim(), appointment]),
  );

  return rows.map((row) => {
    const appointment = appointmentsById.get(extractAppointmentId(row) || '');
    const truth = activeTruthByAthleteKey.get(athleteKey(row) || '');
    if (!appointment && !truth) return row;
    return {
      ...row,
      appointment_starts_at: truth?.current_starts_at || appointment?.starts_at || null,
      meeting_timezone: truth?.current_meeting_timezone || appointment?.meeting_timezone || null,
      meeting_timezone_label:
        truth?.current_meeting_timezone_label || appointment?.meeting_timezone_label || null,
    };
  });
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
  const rows = dedupePendingClientRows(
    await enrichPendingClientRowsWithAppointmentTruth(config, activeRows),
  );

  return {
    rows,
    scannedCount: rows.length,
    confirmedCount: rows.length,
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
