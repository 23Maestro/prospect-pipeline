import { NextResponse } from 'next/server';
import { getFastApiBaseUrl, getFastApiToken, getMissingFastApiEnvMessage, getServerEnv } from '../../../lib/env';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EVENT_LIMIT = Number(process.env.MEETING_READBACK_EVENT_LIMIT || 2000);
const TIME_ZONE = 'America/New_York';
const PAYLOAD_FIELD = ['payload', 'json'].join('_');

const callLogFields = [
  'id',
  'fact_type',
  'tracker_outcome',
  'occurred_at',
  'event_at',
  'reporting_at',
  'athlete_key',
  'athlete_id',
  'athlete_main_id',
  'athlete_name',
  'appointment_id',
  'live_event_id',
  'booked_event_title',
  'booked_event_starts_at',
  'meeting_timezone',
  'head_scout',
  'head_scout_key',
  'raw_crm_stage',
  'raw_task_status',
  'raw_event_type',
  'source_system',
  'resolved_owner_name',
  'counts_as_meeting_set',
  'counts_as_post_meeting_outcome',
  'counts_as_enrollment',
  'revenue_cents',
  'commission_cents',
  'dedupe_key',
  PAYLOAD_FIELD,
  'created_at',
  'updated_at',
];

const appointmentFields = [
  'id',
  'athlete_key',
  'athlete_id',
  'athlete_main_id',
  'head_scout',
  'head_scout_key',
  'starts_at',
  'status',
  'post_meeting_result',
  'status_reason',
  'source_event_id',
  'previous_appointment_id',
  'original_appointment_id',
  'reschedule_sequence',
  'operator_owner',
  'operator_owner_key',
  'appointment_role',
  'source_system',
  'created_at',
  'updated_at',
];

const ACTIVE_MEETING_APPOINTMENT_STATUSES = new Set([
  'scheduled',
  'confirmation_queued',
  'confirmation_sent',
  'rescheduled',
]);

const athleteFields = ['athlete_key', 'athlete_name'];

type JsonRow = Record<string, any>;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('cache-control', 'no-store, max-age=0');
  return response;
}

function getSupabaseConfig() {
  const url = getServerEnv('SUPABASE_URL') || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = getServerEnv('SUPABASE_SECRET_KEY') || getServerEnv('SUPABASE_SERVICE_ROLE_KEY');
  const schema = getServerEnv('SUPABASE_SCHEMA') || 'public';
  if (!url || !key) {
    throw new Error('Missing Supabase server credentials for live meeting readback.');
  }
  return { url: url.replace(/\/+$/, ''), key, schema };
}

async function supabaseGet(path: string) {
  const { url, key, schema } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Accept-Profile': schema,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function payload(row: JsonRow) {
  return row?.[PAYLOAD_FIELD] && typeof row[PAYLOAD_FIELD] === 'object' && !Array.isArray(row[PAYLOAD_FIELD])
    ? row[PAYLOAD_FIELD]
    : {};
}

function normalizeKey(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function statusKey(value: unknown) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function identityKey(row: JsonRow) {
  const athleteKey = normalizeKey(row.athlete_key);
  if (athleteKey) return athleteKey;
  const ids = [normalizeKey(row.athlete_id), normalizeKey(row.athlete_main_id)].filter(Boolean).join(':');
  if (ids) return ids;
  return normalizeKey(row.appointment_id || row.live_event_id || row.athlete_name);
}

function localParts(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDateKey(value: string | Date | null | undefined) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = localParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function activeMonthRange(now = new Date()) {
  const parts = localParts(now);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    startKey: `${parts.year}-${parts.month}-01`,
    endKey: `${String(next.year).padStart(4, '0')}-${String(next.month).padStart(2, '0')}-01`,
    queryStart: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)).toISOString(),
    label: `${new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'long' }).format(now)} Enrollment Tracker`,
  };
}

function isWithinMonth(value: string | null | undefined, range: ReturnType<typeof activeMonthRange>) {
  const key = localDateKey(value);
  return Boolean(key && key >= range.startKey && key < range.endKey);
}

function sourceTime(row: JsonRow) {
  return row.reporting_at || row.event_at || row.occurred_at || row.created_at || null;
}

function eventTime(row: JsonRow) {
  return new Date(sourceTime(row) || 0).getTime() || 0;
}

function appointmentFor(row: JsonRow, appointmentById: Map<string, JsonRow>) {
  const appointmentId = String(row.appointment_id || row.live_event_id || '').trim();
  return appointmentId ? appointmentById.get(appointmentId) || null : null;
}

function appointmentSortTime(row: JsonRow) {
  return new Date(row.starts_at || row.updated_at || row.created_at || 0).getTime() || 0;
}

function latestAppointmentForIdentity(
  identity: string,
  facts: JsonRow[],
  appointmentById: Map<string, JsonRow>,
  appointmentsByAthlete: Map<string, JsonRow[]>,
) {
  const direct = facts
    .map((row) => appointmentFor(row, appointmentById))
    .filter(Boolean) as JsonRow[];
  if (direct.length) {
    return direct.sort((left, right) => appointmentSortTime(right) - appointmentSortTime(left))[0];
  }
  return appointmentsByAthlete.get(identity)?.[0] || null;
}

function cleanTitleName(value: unknown) {
  return String(value || '')
    .replace(/^\((?:ENR|FU|CL|RSP|NS|CAN)(?:\s+\$?\d+(?:\.\d{1,2})?)?(?:\s*-[^)]+)?\)\s*/i, '')
    .replace(/\s+(?:Football|Men's Basketball|Women's Basketball|Baseball|Softball|Volleyball|Soccer|Lacrosse|Track).*$/i, '')
    .trim();
}

function athleteName(row: JsonRow, athleteByKey: Map<string, string>) {
  const body = payload(row);
  return (
    String(row.athlete_name || '').trim() ||
    athleteByKey.get(String(row.athlete_key || '').trim()) ||
    String(body.athlete_name || body.name || '').trim() ||
    cleanTitleName(body.clean_booked_event_title || row.booked_event_title) ||
    'Unknown Athlete'
  );
}

function headScout(row: JsonRow, appointment: JsonRow | null) {
  const body = payload(row);
  return (
    String(appointment?.head_scout || '').trim() ||
    String(row.head_scout || '').trim() ||
    String(body.profile_head_scout || body.booked_event_owner || body.resolved_owner || '').trim() ||
    String(row.resolved_owner_name || '').trim() ||
    'Unassigned'
  );
}

function moneyCents(facts: JsonRow[]) {
  return facts.reduce((total, row) => Math.max(total, Number(row.revenue_cents) || 0), 0);
}

function isActiveMeetingAppointmentStatus(status: unknown) {
  return ACTIVE_MEETING_APPOINTMENT_STATUSES.has(statusKey(status));
}

function outcomeStatusFor(row: JsonRow | null) {
  const keys = [
    statusKey(row?.tracker_outcome),
    statusKey(row?.raw_crm_stage),
    statusKey(row?.raw_task_status),
  ].filter(Boolean);
  if (row?.counts_as_enrollment === true || keys.some((key) => key === 'closed_won' || key === 'actual_meeting_close_won')) return 'Close Won';
  if (keys.some((key) => key === 'closed_lost' || key === 'actual_meeting_close_lost')) return 'Close Lost';
  if (keys.some((key) => key === 'follow_up' || key === 'actual_meeting_follow_up' || key === 'meeting_follow_up')) return 'Follow Up';
  if (keys.some((key) => key === 'no_show' || key === 'meeting_result_no_show')) return 'No Show';
  if (keys.some((key) => key === 'canceled' || key === 'meeting_result_canceled')) return 'Canceled';
  if (keys.some((key) => key === 'reschedule_pending' || key === 'resolution_pending' || key === 'meeting_result_res_pending')) return 'Res. Pending';
  if (keys.some((key) => key === 'rescheduled' || key === 'meeting_result_rescheduled')) return 'Rescheduled';
  return null;
}

function statusFor(latestFact: JsonRow | null, latestAppointment: JsonRow | null) {
  const outcomeStatus = outcomeStatusFor(latestFact);
  if (outcomeStatus) return outcomeStatus;

  const appointmentOutcomeStatus = outcomeStatusFor({
    tracker_outcome: latestAppointment?.post_meeting_result,
  });
  if (appointmentOutcomeStatus) return appointmentOutcomeStatus;

  const outcome = statusKey(latestFact?.tracker_outcome);
  const appointmentStatus = statusKey(latestAppointment?.post_meeting_result || latestAppointment?.status);
  if (outcome === 'meeting_set' && isActiveMeetingAppointmentStatus(appointmentStatus)) {
    return 'Set';
  }
  return null;
}

function shouldDisplayMeetingStatus(status: string | null) {
  return Boolean(status && status !== 'Res. Pending' && status !== 'Canceled');
}

function hasMeetingEnded(value: string | null | undefined, now = Date.now()) {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  return parsed + 60 * 60_000 <= now;
}

function getSelectedSalesStage(payload: JsonRow) {
  const options = Array.isArray(payload?.options) ? payload.options : [];
  const selected = options.find((option) => option?.selected);
  return String(selected?.label || selected?.value || '').trim() || null;
}

async function fetchSelectedSalesStage(athleteId: string) {
  if (!athleteId || getMissingFastApiEnvMessage()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${getFastApiBaseUrl()}/api/v1/sales/stages/${encodeURIComponent(athleteId)}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${getFastApiToken()}`,
        'x-mobile-proxy': 'vercel',
        accept: 'application/json',
      },
    });
    if (!response.ok) return null;
    return getSelectedSalesStage(await response.json().catch(() => ({})));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function outcomeWinner(facts: JsonRow[]) {
  const ordered = [...facts].sort((left, right) => eventTime(right) - eventTime(left));
  const enrollment = ordered.find((row) => row.tracker_outcome === 'closed_won' || row.counts_as_enrollment === true);
  if (enrollment) return enrollment;
  const terminalLost = ordered.find((row) => row.tracker_outcome === 'closed_lost');
  if (terminalLost) return terminalLost;
  return ordered[0] || null;
}

function etLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

async function buildEnrollmentTracker() {
  const month = activeMonthRange();
  const [callLogRows, appointmentRows, athleteRows] = await Promise.all([
    supabaseGet(
      [
        `call_log?select=${encodeURIComponent(callLogFields.join(','))}`,
        'or=(counts_as_meeting_set.eq.true,counts_as_post_meeting_outcome.eq.true,counts_as_enrollment.eq.true)',
        `reporting_at=gte.${month.queryStart}`,
        'order=reporting_at.desc',
        `limit=${EVENT_LIMIT}`,
      ].join('&'),
    ),
    supabaseGet(
      [
        `appointments?select=${encodeURIComponent(appointmentFields.join(','))}`,
        'order=updated_at.desc',
        `limit=${EVENT_LIMIT}`,
      ].join('&'),
    ),
    supabaseGet([`athletes?select=${encodeURIComponent(athleteFields.join(','))}`, `limit=${EVENT_LIMIT}`].join('&')),
  ]);

  const monthFacts = (Array.isArray(callLogRows) ? callLogRows : []).filter((row) => isWithinMonth(sourceTime(row), month));
  const meetingSetFacts = monthFacts.filter((row) => row.counts_as_meeting_set === true);

  const athleteByKey = new Map(
    (Array.isArray(athleteRows) ? athleteRows : [])
      .map((row) => [String(row.athlete_key || '').trim(), String(row.athlete_name || '').trim()])
      .filter(([key, name]) => key && name) as Array<[string, string]>,
  );
  const appointmentById = new Map<string, JsonRow>();
  const appointmentsByAthlete = new Map<string, JsonRow[]>();
  for (const appointment of Array.isArray(appointmentRows) ? appointmentRows : []) {
    const id = String(appointment.id || '').trim();
    if (id) appointmentById.set(id, appointment);
    const identity = identityKey(appointment);
    if (!identity) continue;
    const rows = appointmentsByAthlete.get(identity) || [];
    rows.push(appointment);
    rows.sort((left, right) => appointmentSortTime(right) - appointmentSortTime(left));
    appointmentsByAthlete.set(identity, rows);
  }

  const factsByIdentity = new Map<string, JsonRow[]>();
  for (const fact of monthFacts) {
    const identity = identityKey(fact);
    if (!identity) continue;
    const rows = factsByIdentity.get(identity) || [];
    rows.push(fact);
    factsByIdentity.set(identity, rows);
  }

  const setIdentities = new Set(meetingSetFacts.map(identityKey).filter(Boolean));
  const rows = [...setIdentities]
    .map((identity) => {
      const facts = factsByIdentity.get(identity) || [];
      const setFacts = facts.filter((row) => row.counts_as_meeting_set === true);
      const latestFact = outcomeWinner(facts);
      const latestAppointment = latestAppointmentForIdentity(identity, facts, appointmentById, appointmentsByAthlete);
      const setFact = setFacts.sort((left, right) => eventTime(left) - eventTime(right))[0] || latestFact || {};
      const status = statusFor(latestFact, latestAppointment);
      const when = latestAppointment?.starts_at || latestFact?.booked_event_starts_at || latestFact?.event_at || setFact.event_at || setFact.reporting_at || null;
      return {
        when,
        whenLabel: etLabel(when),
        athleteId: setFact.athlete_id || latestFact?.athlete_id || latestAppointment?.athlete_id || null,
        athleteName: athleteName(latestFact || setFact, athleteByKey),
        status,
        headScout: headScout(latestFact || setFact, latestAppointment),
        moneyCents: moneyCents(facts),
      };
    })
    .filter((row) => row.status)
    .sort((left, right) => new Date(left.when || 0).getTime() - new Date(right.when || 0).getTime());

  await Promise.all(
    rows.map(async (row) => {
      if (row.status !== 'Set' || !hasMeetingEnded(row.when) || !row.athleteId) return;
      const selectedStage = await fetchSelectedSalesStage(String(row.athleteId));
      const outcomeStatus = outcomeStatusFor({ raw_crm_stage: selectedStage });
      if (outcomeStatus) row.status = outcomeStatus;
    }),
  );

  const visibleRows = rows.filter((row) => shouldDisplayMeetingStatus(row.status));
  const enrollments = visibleRows.filter((row) => row.status === 'Close Won').length;
  const actualHeld = visibleRows.filter((row) => row.status === 'Close Won' || row.status === 'Close Lost' || row.status === 'Follow Up').length;
  const generatedAt = new Date().toISOString();

  return {
    contract: 'monthly-enrollment-tracker',
    version: 1,
    generatedFrom: 'apps/prospect-web/app/api/meeting-readback-data/route.ts',
    data: {
      generatedAt,
      generatedAtLabel: etLabel(generatedAt),
      title: month.label,
      monthStart: month.startKey,
      monthEndExclusive: month.endKey,
      supabaseReads: {
        canonicalEventTable: 'call_log',
        appointmentTable: 'appointments',
        athleteTable: 'athletes',
      },
      summary: {
        meetingsSet: visibleRows.length,
        enrollments,
        showRate: visibleRows.length ? Math.round((actualHeld / visibleRows.length) * 100) : 0,
      },
      rows: visibleRows,
    },
  };
}

export async function GET() {
  try {
    return noStoreJson(await buildEnrollmentTracker());
  } catch (error) {
    return noStoreJson(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown enrollment tracker error',
      },
      { status: 500 },
    );
  }
}
