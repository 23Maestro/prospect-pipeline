import { getPreferenceValues } from '@raycast/api';
import fs from 'fs';
import path from 'path';
import {
  buildPendingClientResolvedPatch,
  buildPendingClientWatchlistRow,
  classifyPendingClientLifecycle,
  findPendingClientSignals,
  PENDING_CLIENT_LIST_LIMIT,
  selectLatestPendingClientReviewEvent,
  shouldResolvePendingClientForLifecycle,
  type PendingClientWatchlistRow,
} from '../domain/pending-client-watchlist';
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

type PipelineStateRow = {
  athlete_key: string | null;
  athlete_id: string | null;
  athlete_main_id: string | null;
  crm_stage: string | null;
  task_status: string | null;
  head_scout: string | null;
  current_appointment_id: string | null;
  updated_at: string | null;
};

type AthleteRow = {
  athlete_key: string | null;
  athlete_name: string | null;
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

async function readCurrentPipelineRows(
  config: SupabasePersistenceConfig,
): Promise<PipelineStateRow[]> {
  return readRows<PipelineStateRow>(
    config,
    'athlete_pipeline_state',
    [
      'select=athlete_key,athlete_id,athlete_main_id,crm_stage,task_status,head_scout,current_appointment_id,updated_at',
      'order=updated_at.desc',
      'limit=1000',
    ].join('&'),
  );
}

async function readAthleteRows(config: SupabasePersistenceConfig): Promise<AthleteRow[]> {
  return readRows<AthleteRow>(
    config,
    'athletes',
    'select=athlete_key,athlete_name&limit=1000',
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

function isEnded(value?: string | null, now = new Date()): boolean {
  const parsed = Date.parse(String(value || ''));
  return !Number.isNaN(parsed) && parsed <= now.getTime();
}

function buildPendingClientSourceEventId(row: PipelineStateRow): string {
  const athleteKey = String(row.athlete_key || `${row.athlete_id}:${row.athlete_main_id}`).trim();
  const appointmentId = String(row.current_appointment_id || 'no-current-appointment').trim();
  return `pending-client:${athleteKey}:${appointmentId}`;
}

async function buildConfirmedRowsFromPipelineState(
  stateRows: PipelineStateRow[],
  athleteNameByKey: Map<string, string>,
  config: SupabasePersistenceConfig,
  now = new Date(),
): Promise<{
  rows: PendingClientWatchlistRow[];
  scannedCount: number;
  confirmedCount: number;
  aiUnavailableCount: number;
}> {
  const rows: PendingClientWatchlistRow[] = [];
  let aiUnavailableCount = 0;

  for (const state of stateRows) {
    const athleteId = String(state.athlete_id || '').trim();
    const athleteMainId = String(state.athlete_main_id || '').trim();
    const currentAppointmentId = String(state.current_appointment_id || '').trim();
    if (!athleteId || !athleteMainId) continue;
    if (!currentAppointmentId) continue;

    const athleteMeetings = await fetchAthleteBookedMeetings({
      athleteId,
      athleteMainId,
    }).catch(() => ({ events: [] }));
    const currentMeeting =
      (athleteMeetings.events || []).find(
        (event) => String(event.event_id || '').trim() === currentAppointmentId,
      ) ||
      (athleteMeetings.events || [])
        .filter((event) => isEnded(event.end || event.start, now))
        .sort((left, right) => String(right.end || right.start).localeCompare(String(left.end || left.start)))[0] ||
      null;
    if (!currentMeeting || !isEnded(currentMeeting.end || currentMeeting.start, now)) continue;

    const salesStage = (await fetchSelectedSalesStage(athleteId)) || state.crm_stage || '';
    if (
      shouldResolvePendingClientForLifecycle({
        crmStage: salesStage,
        bookedEventTitle: currentMeeting.title,
      })
    ) {
      await patchPendingClientWatchlistRow(
        config,
        buildPendingClientSourceEventId(state),
        buildPendingClientResolvedPatch(),
      ).catch(() => undefined);
      continue;
    }

    const reviewEvent = selectLatestPendingClientReviewEvent(
      {
        event_id: currentMeeting.event_id,
        title: currentMeeting.title,
        assigned_owner: currentMeeting.assigned_owner || state.head_scout,
        start: currentMeeting.start,
        end: currentMeeting.end,
      },
      athleteMeetings.events || [],
    );

    const decision = classifyPendingClientLifecycle({
      crmStage: salesStage,
      reviewEventTitle: reviewEvent?.title || currentMeeting.title,
      reviewDescription: reviewEvent?.description || currentMeeting.description || '',
    });
    if (!decision.eligible) continue;

    const description = reviewEvent?.description || currentMeeting.description || '';
    const matchedSignals = findPendingClientSignals(description);

    let aiVerdict: 'pending_client' | null = 'pending_client';
    if (matchedSignals.length) {
      aiVerdict = await confirmPendingClientWithRayAI({
        title: reviewEvent?.title || currentMeeting.title,
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
          event_id: buildPendingClientSourceEventId(state),
          title: reviewEvent?.title || currentMeeting.title,
          assigned_owner: reviewEvent?.assigned_owner || currentMeeting.assigned_owner || state.head_scout,
          start: reviewEvent?.start || currentMeeting.start,
          end: reviewEvent?.end || currentMeeting.end || null,
          date_time_label: reviewEvent?.date_time_label || currentMeeting.date_time_label,
        },
        description: [
          `Sales Stage: ${salesStage || 'Unknown'}`,
          `Lifecycle: ${decision.normalizedStage}`,
          description || decision.reason,
        ].join('\n\n'),
        matchedSignals,
        aiVerdict,
        athleteId,
        athleteMainId,
        athleteName: athleteNameByKey.get(String(state.athlete_key || '').trim()) || null,
      }),
    );
  }

  return {
    rows,
    scannedCount: stateRows.length,
    confirmedCount: rows.length,
    aiUnavailableCount,
  };
}

export async function loadPendingClientWatchlist(): Promise<PendingClientWatchlistLoadResult> {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error('Missing Supabase URL or key');
  }

  const now = new Date();
  const [stateRows, athleteRows] = await Promise.all([
    readCurrentPipelineRows(config),
    readAthleteRows(config),
  ]);
  const athleteNameByKey = new Map(
    athleteRows.map((row) => [
      String(row.athlete_key || '').trim(),
      String(row.athlete_name || '').trim(),
    ]),
  );
  const scan = await buildConfirmedRowsFromPipelineState(stateRows, athleteNameByKey, config, now);

  if (scan.rows.length) {
    await upsertPendingClientWatchlistRows(config, scan.rows);
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
