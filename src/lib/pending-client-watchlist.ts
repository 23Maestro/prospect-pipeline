import { getPreferenceValues } from '@raycast/api';
import fs from 'fs';
import path from 'path';
import {
  buildPendingClientWatchlistRow,
  buildPendingClientResolvedPatch,
  cleanPendingClientAthleteName,
  isPendingClientResolvedByFutureConfirmation,
  realPendingClientAthleteName,
  PENDING_CLIENT_LIST_LIMIT,
  type SetMeetingConfirmationCacheRowInput,
  type PendingClientWatchlistRow,
} from '../domain/pending-client-watchlist';
import {
  patchPendingClientWatchlistRow,
  readRows,
  upsertPendingClientWatchlistRows,
  type SupabasePersistenceConfig,
} from '../domain/supabase-persistence';
import { resolveBookedMeetingDetailsForForm } from './booked-meeting-details-resolver';

type Preferences = {
  supabaseUrl?: string;
  supabaseSecretKey?: string;
  supabaseServiceRoleKey?: string;
  supabaseSchema?: string;
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

type AppointmentPendingClientRow = {
  id?: string | null;
  athlete_key?: string | null;
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  head_scout?: string | null;
  starts_at?: string | null;
  status?: string | null;
  source_event_id?: string | null;
  meeting_timezone?: string | null;
  meeting_timezone_label?: string | null;
  post_meeting_result?: string | null;
  source_payload?: Record<string, unknown> | null;
  updated_at?: string | null;
};

type AthleteNameRow = {
  athlete_key?: string | null;
  athlete_name?: string | null;
};

const DEFAULT_SCHEMA = 'public';
const REPO_ROOT_FALLBACK = '/Users/singleton23/Raycast/prospect-pipeline';
const PENDING_CLIENT_APPOINTMENT_OUTCOMES = [
  'follow_up',
  'reschedule_pending',
  'no_show',
  'canceled',
] as const;
const PENDING_CLIENT_APPOINTMENT_OUTCOME_QUERY = PENDING_CLIENT_APPOINTMENT_OUTCOMES.map(
  quotePostgrestInValue,
).join(',');
const ACTIVE_REPLACEMENT_APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmation_queued',
  'confirmation_sent',
  'rescheduled',
] as const;
const ACTIVE_REPLACEMENT_APPOINTMENT_STATUS_QUERY = ACTIVE_REPLACEMENT_APPOINTMENT_STATUSES.map(
  quotePostgrestInValue,
).join(',');
const ACTIVE_REPLACEMENT_POST_MEETING_RESULTS = new Set(['', 'rescheduled']);

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

function extractAppointmentId(row: PendingClientWatchlistRow): string | null {
  const source = String(row.source_event_id || '').trim();
  return source.startsWith('appointment:') ? source.slice('appointment:'.length).trim() : null;
}

function quotePostgrestInValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function pendingClientAppointmentOutcome(row: AppointmentPendingClientRow): string {
  const postMeetingResult = String(row.post_meeting_result || '').trim();
  if (PENDING_CLIENT_APPOINTMENT_OUTCOMES.some((outcome) => outcome === postMeetingResult)) {
    return postMeetingResult;
  }
  const status = String(row.status || '').trim();
  return PENDING_CLIENT_APPOINTMENT_OUTCOMES.some((outcome) => outcome === status) ? status : '';
}

function hasNewerActiveReplacementAppointment(
  row: AppointmentPendingClientRow,
  activeRowsByAthleteKey: Map<string, AppointmentPendingClientRow[]>,
): boolean {
  const athleteKey = String(row.athlete_key || '').trim();
  if (!athleteKey) return false;
  const startsAt = Date.parse(String(row.starts_at || '').trim());
  if (!Number.isFinite(startsAt)) return false;
  return (activeRowsByAthleteKey.get(athleteKey) || []).some((candidate) => {
    if (String(candidate.id || '').trim() === String(row.id || '').trim()) return false;
    const candidateStartsAt = Date.parse(String(candidate.starts_at || '').trim());
    return Number.isFinite(candidateStartsAt) && candidateStartsAt > startsAt;
  });
}

function groupActiveReplacementAppointmentsByAthleteKey(
  rows: AppointmentPendingClientRow[],
): Map<string, AppointmentPendingClientRow[]> {
  const byAthleteKey = new Map<string, AppointmentPendingClientRow[]>();
  for (const row of rows) {
    const athleteKey = String(row.athlete_key || '').trim();
    const status = String(row.status || '').trim().toLowerCase();
    const postMeetingResult = String(row.post_meeting_result || '').trim().toLowerCase();
    if (
      !athleteKey ||
      !ACTIVE_REPLACEMENT_APPOINTMENT_STATUSES.some((candidate) => candidate === status) ||
      !ACTIVE_REPLACEMENT_POST_MEETING_RESULTS.has(postMeetingResult)
    ) {
      continue;
    }
    byAthleteKey.set(athleteKey, [...(byAthleteKey.get(athleteKey) || []), row]);
  }
  return byAthleteKey;
}

function workflowPayload(row: AppointmentPendingClientRow): Record<string, unknown> {
  const payload = row.source_payload && typeof row.source_payload === 'object' ? row.source_payload : {};
  const context = payload.workflow_context;
  return context && typeof context === 'object' && !Array.isArray(context)
    ? (context as Record<string, unknown>)
    : payload;
}

function payloadText(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  const text = String(value || '').trim();
  return text || null;
}

function resolveDisplayAthleteName(
  athleteKey: string,
  payload: Record<string, unknown>,
  athleteNamesByKey: Map<string, string>,
): string | null {
  return (
    realPendingClientAthleteName(payloadText(payload, 'athlete_name')) ||
    realPendingClientAthleteName(athleteNamesByKey.get(athleteKey)) ||
    cleanPendingClientAthleteName(
      payloadText(payload, 'meeting_title_current') || payloadText(payload, 'meeting_title_base'),
    ) ||
    null
  );
}

function pendingClientOutcomeLabel(outcome?: string | null): string {
  switch (String(outcome || '').trim()) {
    case 'follow_up':
      return 'Follow Up';
    case 'no_show':
      return 'No Show';
    case 'canceled':
      return 'Canceled';
    case 'reschedule_pending':
    default:
      return 'Reschedule Pending';
  }
}

function appointmentWatchlistSourceId(row: AppointmentPendingClientRow): string {
  return `appointment:${String(row.id || row.source_event_id || '').trim()}`;
}

function buildPendingClientRowsFromAppointments(
  appointments: AppointmentPendingClientRow[],
  athleteNamesByKey: Map<string, string>,
): PendingClientWatchlistDisplayRow[] {
  return appointments.flatMap((appointment) => {
    const appointmentId = String(appointment.id || appointment.source_event_id || '').trim();
    const startsAt = String(appointment.starts_at || '').trim();
    if (!appointmentId || !startsAt) return [];

    const payload = workflowPayload(appointment);
    const athleteKey = String(appointment.athlete_key || '').trim();
    const athleteName = resolveDisplayAthleteName(athleteKey, payload, athleteNamesByKey);
    const outcome = pendingClientAppointmentOutcome(appointment);
    const title =
      payloadText(payload, 'meeting_title_current') ||
      payloadText(payload, 'meeting_title_base') ||
      `${athleteName || 'Pending Client'} - ${pendingClientOutcomeLabel(outcome)}`;

    const row = buildPendingClientWatchlistRow({
      event: {
        event_id: appointmentWatchlistSourceId(appointment),
        title,
        assigned_owner: appointment.head_scout,
        start: startsAt,
        end: null,
      },
      description: `Pending client review from appointment outcome: ${outcome}.`,
      matchedSignals: [outcome],
      actionTag: 'Operator Input',
      aiVerdict: 'pending_client',
      athleteId: appointment.athlete_id,
      athleteMainId: appointment.athlete_main_id,
      athleteName,
    });

    return [
      {
        ...row,
        appointment_starts_at: startsAt,
        meeting_timezone: appointment.meeting_timezone || null,
        meeting_timezone_label: appointment.meeting_timezone_label || null,
        last_seen_at: appointment.updated_at || row.last_seen_at,
      },
    ];
  });
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
  rows: PendingClientWatchlistRow[],
): Promise<PendingClientWatchlistDisplayRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      const resolved = await resolveBookedMeetingDetailsForForm({
        athleteId: row.athlete_id,
        athleteMainId: row.athlete_main_id,
        appointmentId: extractAppointmentId(row),
        source: 'appointment_truth',
      }).catch(() => null);
      if (!resolved) return row;
      const meeting = resolved.bookedMeeting;
      const startsAt = String(meeting.start || '').trim() || null;
      const timezone = String(resolved.meetingTimezone || '').trim() || null;
      const timezoneLabel =
        String(resolved.formData?.meetingtimezonelabel || '').trim() || timezone;
      return {
        ...row,
        appointment_starts_at: startsAt,
        meeting_timezone: timezone,
        meeting_timezone_label: timezoneLabel,
      };
    }),
  );
}

export async function loadPendingClientWatchlist(): Promise<PendingClientWatchlistLoadResult> {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error('Missing Supabase URL or key');
  }

  const now = new Date();
  const watchStart = new Date(now);
  watchStart.setUTCDate(watchStart.getUTCDate() - 30);
  const appointmentRows = await readRows<AppointmentPendingClientRow>(
    config,
    'appointments',
    [
      'select=id,athlete_key,athlete_id,athlete_main_id,head_scout,starts_at,status,source_event_id,meeting_timezone,meeting_timezone_label,post_meeting_result,source_payload,updated_at',
      `or=(post_meeting_result.in.(${PENDING_CLIENT_APPOINTMENT_OUTCOME_QUERY}),status.in.(${PENDING_CLIENT_APPOINTMENT_OUTCOME_QUERY}))`,
      `starts_at=gte.${encodeURIComponent(watchStart.toISOString())}`,
      'order=starts_at.desc',
      `limit=${PENDING_CLIENT_LIST_LIMIT * 2}`,
    ].join('&'),
  );
  const athleteKeys = Array.from(
    new Set(appointmentRows.map((row) => String(row.athlete_key || '').trim()).filter(Boolean)),
  );
  const activeReplacementRows = athleteKeys.length
    ? await readRows<AppointmentPendingClientRow>(
        config,
        'appointments',
        [
          'select=id,athlete_key,starts_at,status,post_meeting_result',
          `athlete_key=in.(${athleteKeys.map(quotePostgrestInValue).join(',')})`,
          `status=in.(${ACTIVE_REPLACEMENT_APPOINTMENT_STATUS_QUERY})`,
          'order=starts_at.asc',
          `limit=${PENDING_CLIENT_LIST_LIMIT * 4}`,
        ].join('&'),
      ).catch(() => [])
    : [];
  const activeReplacementsByAthleteKey =
    groupActiveReplacementAppointmentsByAthleteKey(activeReplacementRows);
  const actionableAppointmentRows = appointmentRows.filter(
    (row) => !hasNewerActiveReplacementAppointment(row, activeReplacementsByAthleteKey),
  );
  const athleteRows = athleteKeys.length
    ? (
        await Promise.all([
          readRows<AthleteNameRow>(
            config,
            'athletes',
            [
              'select=athlete_key,athlete_name',
              `athlete_key=in.(${athleteKeys.map(quotePostgrestInValue).join(',')})`,
            ].join('&'),
          ).catch(() => []),
          readRows<AthleteNameRow>(
            config,
            'athlete_contact_cache',
            [
              'select=athlete_key,athlete_name',
              `athlete_key=in.(${athleteKeys.map(quotePostgrestInValue).join(',')})`,
              'order=updated_at.desc',
            ].join('&'),
          ).catch(() => []),
          readRows<AthleteNameRow>(
            config,
            'set_meeting_confirmation_cache',
            [
              'select=athlete_key,athlete_name',
              `athlete_key=in.(${athleteKeys.map(quotePostgrestInValue).join(',')})`,
              'order=updated_at.desc',
            ].join('&'),
          ).catch(() => []),
        ])
      ).flat()
    : [];
  const athleteNamesByKey = new Map(
    athleteRows
      .map((row) => [
        String(row.athlete_key || '').trim(),
        realPendingClientAthleteName(row.athlete_name) || '',
      ])
      .filter(([key, name]) => key && name) as Array<[string, string]>,
  );
  const appointmentRowsForDisplay = buildPendingClientRowsFromAppointments(
    actionableAppointmentRows,
    athleteNamesByKey,
  );
  const appointmentSourceIds = appointmentRowsForDisplay.map((row) => row.source_event_id);
  const resolvedRows = appointmentSourceIds.length
    ? await readRows<Pick<PendingClientWatchlistRow, 'source_event_id' | 'status'>>(
        config,
        'pending_client_watchlist',
        [
          'select=source_event_id,status',
          `source_event_id=in.(${appointmentSourceIds.map(quotePostgrestInValue).join(',')})`,
          'status=in.("resolved","expired")',
        ].join('&'),
      ).catch(() => [])
    : [];
  const resolvedSourceIds = new Set(
    resolvedRows.map((row) => String(row.source_event_id || '').trim()).filter(Boolean),
  );
  const confirmationRows = await readRows<SetMeetingConfirmationCacheRowInput>(
    config,
    'set_meeting_confirmation_cache',
    [
      'select=appointment_id,athlete_id,athlete_main_id,athlete_name,meeting_starts_at,meeting_ends_at,source,kind,status',
      'status=eq.cached',
      'source=eq.set_meetings_confirmation',
      `meeting_ends_at=gt.${encodeURIComponent(now.toISOString())}`,
      'order=meeting_starts_at.asc',
      `limit=${PENDING_CLIENT_LIST_LIMIT * 10}`,
    ].join('&'),
  ).catch(() => []);
  const unresolvedRows = appointmentRowsForDisplay.filter(
    (row) =>
      !resolvedSourceIds.has(String(row.source_event_id || '').trim()) &&
      !isPendingClientResolvedByFutureConfirmation(row, confirmationRows, now),
  );
  const rows = dedupePendingClientRows(
    await enrichPendingClientRowsWithAppointmentTruth(unresolvedRows),
  ).slice(0, PENDING_CLIENT_LIST_LIMIT);

  return {
    rows,
    scannedCount: appointmentRowsForDisplay.length,
    confirmedCount: rows.length,
    aiUnavailableCount: 0,
  };
}

export async function markPendingClientResolved(
  rowOrSourceEventId: PendingClientWatchlistRow | string,
): Promise<void> {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error('Missing Supabase URL or key');
  }
  const resolvedPatch = buildPendingClientResolvedPatch();
  if (typeof rowOrSourceEventId === 'string') {
    await patchPendingClientWatchlistRow(config, rowOrSourceEventId, resolvedPatch);
    return;
  }
  const row = rowOrSourceEventId;
  const storageRow: PendingClientWatchlistRow = {
    source_event_id: row.source_event_id,
    athlete_id: row.athlete_id,
    athlete_main_id: row.athlete_main_id,
    athlete_name: row.athlete_name,
    head_scout: row.head_scout,
    head_scout_key: row.head_scout_key,
    calendar_owner_id: row.calendar_owner_id,
    detected_by_operator: row.detected_by_operator,
    detected_by_operator_key: row.detected_by_operator_key,
    owner_context: row.owner_context,
    resolved_by_operator: row.resolved_by_operator,
    resolved_by_operator_key: row.resolved_by_operator_key,
    event_title: row.event_title,
    event_start: row.event_start,
    event_end: row.event_end,
    description: row.description,
    matched_signals: row.matched_signals,
    action_tag: row.action_tag,
    ai_verdict: row.ai_verdict,
    status: row.status,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    expires_at: row.expires_at,
    resolved_at: row.resolved_at,
  };
  await upsertPendingClientWatchlistRows(config, [
    {
      ...storageRow,
      ...resolvedPatch,
      status: 'resolved',
      first_seen_at: row.first_seen_at || new Date().toISOString(),
      last_seen_at: row.last_seen_at || new Date().toISOString(),
      expires_at: row.expires_at || new Date().toISOString(),
    },
  ]);
}
