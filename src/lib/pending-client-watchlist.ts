import { getPreferenceValues } from '@raycast/api';
import fs from 'fs';
import path from 'path';
import {
  buildPendingClientResolvedPatch,
  buildPendingClientWatchlistRow,
  filterReadySetMeetingConfirmationGroups,
  findPendingClientSignals,
  hasPendingClientWatchNote,
  PENDING_CLIENT_LIST_LIMIT,
  PENDING_CLIENT_WATCH_WINDOW_DAYS,
  selectLatestPendingClientReviewEvent,
  type PendingClientWatchlistRow,
  type ReadySetMeetingConfirmationGroup,
} from '../domain/pending-client-watchlist';
import { getActiveOperator } from '../domain/owners';
import {
  patchPendingClientWatchlistRow,
  readRows,
  type SupabasePersistenceConfig,
  upsertPendingClientWatchlistRows,
} from '../domain/supabase-persistence';
import { confirmPendingClientWithRayAI } from './raycast-ai';
import { fetchAthleteBookedMeetings } from './head-scout-schedules';
import { fetchCuratedSalesStageOptions } from './sales-stage';

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

type ExistingPendingClientRow = Pick<
  PendingClientWatchlistRow,
  | 'source_event_id'
  | 'status'
  | 'first_seen_at'
  | 'resolved_at'
  | 'resolved_by_operator'
  | 'resolved_by_operator_key'
>;

type SetMeetingConfirmationCacheRow = {
  appointment_id: string | null;
  athlete_id: string | null;
  athlete_main_id: string | null;
  athlete_name: string | null;
  head_scout_name: string | null;
  meeting_starts_at: string | null;
  meeting_ends_at: string | null;
  meeting_duration_minutes: number | null;
  source: string | null;
  kind: string | null;
  status: string | null;
  message_body: string | null;
  payload_json: Record<string, unknown> | null;
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

async function readSetMeetingConfirmationCacheRows(
  config: SupabasePersistenceConfig,
  now: Date,
): Promise<SetMeetingConfirmationCacheRow[]> {
  const since = new Date(now);
  since.setDate(since.getDate() - PENDING_CLIENT_WATCH_WINDOW_DAYS);
  return readRows<SetMeetingConfirmationCacheRow>(
    config,
    'set_meeting_confirmation_cache',
    [
      'select=appointment_id,athlete_id,athlete_main_id,athlete_name,head_scout_name,meeting_starts_at,meeting_ends_at,meeting_duration_minutes,source,kind,status,message_body,payload_json',
      'status=eq.cached',
      'source=eq.set_meetings_confirmation',
      'kind=in.(confirmation_1,confirmation_2)',
      `meeting_starts_at=gte.${encodeURIComponent(since.toISOString())}`,
      `meeting_starts_at=lte.${encodeURIComponent(now.toISOString())}`,
      'order=meeting_starts_at.desc',
    ].join('&'),
  );
}

async function fetchSelectedSalesStage(athleteId: string): Promise<string | null> {
  try {
    const options = await fetchCuratedSalesStageOptions(athleteId);
    return options.find((option) => option.selected)?.label || null;
  } catch {
    return null;
  }
}

async function buildConfirmedRowsFromReadySetMeetings(
  meetings: ReadySetMeetingConfirmationGroup[],
): Promise<{
  rows: PendingClientWatchlistRow[];
  scannedCount: number;
  confirmedCount: number;
  aiUnavailableCount: number;
}> {
  const rows: PendingClientWatchlistRow[] = [];
  let aiUnavailableCount = 0;

  for (const meeting of meetings) {
    const athleteMeetings = await fetchAthleteBookedMeetings({
      athleteId: meeting.athleteId,
      athleteMainId: meeting.athleteMainId,
    }).catch(() => ({ events: [] }));

    const reviewEvent = selectLatestPendingClientReviewEvent(
      {
        event_id: meeting.appointmentId,
        title: meeting.athleteName,
        assigned_owner: meeting.headScoutName,
        start: meeting.meetingStartsAt,
        end: meeting.meetingEndsAt,
      },
      athleteMeetings.events || [],
    );
    if (!reviewEvent) continue;

    const salesStage = await fetchSelectedSalesStage(meeting.athleteId);
    const description = reviewEvent.description || '';
    const matchedSignals = findPendingClientSignals(description);
    if (!hasPendingClientWatchNote(description)) continue;

    let aiVerdict: 'pending_client' | null = 'pending_client';
    if (matchedSignals.length) {
      aiVerdict = await confirmPendingClientWithRayAI({
        title: reviewEvent.title || meeting.athleteName,
        description: [`Sales Stage: ${salesStage || 'Unknown'}`, description].join('\n'),
        matchedSignals,
      });
      if (!aiVerdict) {
        aiUnavailableCount += 1;
        continue;
      }
    }

    rows.push(
      buildPendingClientWatchlistRow({
        event: {
          event_id: reviewEvent.event_id || meeting.appointmentId,
          title: reviewEvent.title || meeting.athleteName,
          assigned_owner: reviewEvent.assigned_owner || meeting.headScoutName,
          start: reviewEvent.start || meeting.meetingStartsAt,
          end: reviewEvent.end || null,
          date_time_label: reviewEvent.date_time_label,
        },
        description: [`Sales Stage: ${salesStage || 'Unknown'}`, description].join('\n\n'),
        matchedSignals,
        aiVerdict,
        athleteId: meeting.athleteId,
        athleteMainId: meeting.athleteMainId,
        athleteName: meeting.athleteName,
      }),
    );
  }

  return {
    rows,
    scannedCount: meetings.length,
    confirmedCount: rows.length,
    aiUnavailableCount,
  };
}

function quotePostgrestInValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function buildRowsForUpsert(
  config: SupabasePersistenceConfig,
  rows: PendingClientWatchlistRow[],
): Promise<PendingClientWatchlistRow[]> {
  if (!rows.length) return [];

  const existingRows = await readRows<ExistingPendingClientRow>(
    config,
    'pending_client_watchlist',
    [
      'select=source_event_id,status,first_seen_at,resolved_at,resolved_by_operator,resolved_by_operator_key',
      `source_event_id=in.(${rows.map((row) => quotePostgrestInValue(row.source_event_id)).join(',')})`,
    ].join('&'),
  );
  const existingByEventId = new Map(existingRows.map((row) => [row.source_event_id, row]));

  return rows.flatMap((row) => {
    const existing = existingByEventId.get(row.source_event_id);
    if (existing?.status === 'resolved' || existing?.status === 'expired') {
      return [];
    }
    return [
      {
        ...row,
        first_seen_at: existing?.first_seen_at || row.first_seen_at,
        resolved_at: existing?.resolved_at || null,
        resolved_by_operator: existing?.resolved_by_operator || null,
        resolved_by_operator_key: existing?.resolved_by_operator_key || null,
      },
    ];
  });
}

export async function loadPendingClientWatchlist(): Promise<PendingClientWatchlistLoadResult> {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error('Missing Supabase URL or key');
  }

  const now = new Date();
  const cacheRows = await readSetMeetingConfirmationCacheRows(config, now);
  const activeOperator = getActiveOperator();
  const readyMeetings = filterReadySetMeetingConfirmationGroups(cacheRows, {
    now,
    activeOperatorKey: activeOperator.operatorKey,
  });
  const scan = await buildConfirmedRowsFromReadySetMeetings(readyMeetings);

  if (scan.rows.length) {
    await upsertPendingClientWatchlistRows(config, await buildRowsForUpsert(config, scan.rows));
  }

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
    ...scan,
    rows: activeRows,
  };
}

export async function markPendingClientResolved(sourceEventId: string): Promise<void> {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error('Missing Supabase URL or key');
  }
  await patchPendingClientWatchlistRow(config, sourceEventId, buildPendingClientResolvedPatch());
}
