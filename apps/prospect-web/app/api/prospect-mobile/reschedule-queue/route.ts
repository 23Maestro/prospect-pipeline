import { getSupabaseRestConfig, supabaseHeaders } from '../../tim-lite/access';
import { jsonResponse, methodNotAllowed } from '../../../../lib/response-shapes';

type AppointmentRow = {
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

type AthleteRow = {
  athlete_key?: string | null;
  athlete_name?: string | null;
};

const ACTIVE_RESCHEDULE_REPLACEMENT_STATUSES = new Set([
  'scheduled',
  'confirmation_queued',
  'confirmation_sent',
  'rescheduled',
]);
const ACTIVE_RESCHEDULE_REPLACEMENT_RESULTS = new Set(['', 'rescheduled']);

function asText(value: unknown): string {
  return String(value || '').trim();
}

function isIdentityText(value: unknown): boolean {
  const text = asText(value);
  return /^\d+:\d+(?:\b|$)/.test(text);
}

function realText(value: unknown): string {
  const text = asText(value);
  return text && !isIdentityText(text) ? text : '';
}

function quotePostgrestInValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function payloadFor(row: AppointmentRow): Record<string, unknown> {
  const payload = row.source_payload && typeof row.source_payload === 'object' ? row.source_payload : {};
  const context = payload.workflow_context;
  return context && typeof context === 'object' && !Array.isArray(context)
    ? context as Record<string, unknown>
    : payload;
}

function payloadText(payload: Record<string, unknown>, key: string): string {
  return asText(payload[key]);
}

function payloadRealText(payload: Record<string, unknown>, key: string): string {
  return realText(payload[key]);
}

function cleanTitleName(value: unknown): string {
  const cleaned = asText(value)
    .replace(/^Follow Up -\s*/i, '')
    .replace(/^\([^)]+\)(?:\*\d+)?\s*/i, '')
    .trim();
  if (!cleaned || isIdentityText(cleaned)) return '';
  const match = cleaned.match(/^(.+?)\s+\S+\s+(?:19|20)\d{2}\s+[A-Z]{2}\b/i);
  return realText(match?.[1]) || realText(cleaned);
}

function recentCutoff(days = 7, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString();
}

function addAthleteNames(target: Map<string, string>, rows: AthleteRow[]) {
  for (const row of rows) {
    const key = asText(row.athlete_key);
    const name = realText(row.athlete_name);
    if (key && name && !target.has(key)) target.set(key, name);
  }
}

async function fetchAthleteNameRows(table: string, keys: string[]) {
  const config = getSupabaseRestConfig();
  const query = [
    'select=athlete_key,athlete_name',
    `athlete_key=in.(${keys.map(quotePostgrestInValue).join(',')})`,
    table === 'athletes' ? null : 'order=updated_at.desc',
  ].filter(Boolean).join('&');
  const response = await fetch(`${config.url}/rest/v1/${table}?${query}`, {
    cache: 'no-store',
    headers: supabaseHeaders(config),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(rows.message || rows.error || `Supabase ${table} ${response.status}`);
  }
  return Array.isArray(rows) ? rows as AthleteRow[] : [];
}

async function fetchAthleteNames(keys: string[]) {
  if (!keys.length) return new Map<string, string>();
  const [athleteRows, contactRows, confirmationRows, callLogRows] = await Promise.all([
    fetchAthleteNameRows('athletes', keys),
    fetchAthleteNameRows('athlete_contact_cache', keys),
    fetchAthleteNameRows('set_meeting_confirmation_cache', keys),
    fetchAthleteNameRows('call_log', keys),
  ]);
  const names = new Map<string, string>();
  addAthleteNames(names, athleteRows);
  addAthleteNames(names, contactRows);
  addAthleteNames(names, confirmationRows);
  addAthleteNames(names, callLogRows);
  return names;
}

async function fetchActiveReplacementAppointments(rows: AppointmentRow[]) {
  const athleteKeys = Array.from(new Set(rows.map((row) => asText(row.athlete_key)).filter(Boolean)));
  if (!athleteKeys.length) return new Map<string, AppointmentRow[]>();

  const config = getSupabaseRestConfig();
  const query = [
    'select=id,athlete_key,starts_at,status,post_meeting_result',
    `athlete_key=in.(${athleteKeys.map(quotePostgrestInValue).join(',')})`,
    'status=in.(scheduled,confirmation_queued,confirmation_sent,rescheduled)',
    'order=starts_at.asc',
  ].join('&');
  const response = await fetch(`${config.url}/rest/v1/appointments?${query}`, {
    cache: 'no-store',
    headers: supabaseHeaders(config),
  });
  const replacementRows = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(replacementRows.message || replacementRows.error || `Supabase active appointments ${response.status}`);
  }

  const byAthleteKey = new Map<string, AppointmentRow[]>();
  for (const row of Array.isArray(replacementRows) ? replacementRows as AppointmentRow[] : []) {
    const athleteKey = asText(row.athlete_key);
    const status = asText(row.status).toLowerCase();
    const postMeetingResult = asText(row.post_meeting_result).toLowerCase();
    if (
      !athleteKey ||
      !ACTIVE_RESCHEDULE_REPLACEMENT_STATUSES.has(status) ||
      !ACTIVE_RESCHEDULE_REPLACEMENT_RESULTS.has(postMeetingResult)
    ) {
      continue;
    }
    byAthleteKey.set(athleteKey, [...(byAthleteKey.get(athleteKey) || []), row]);
  }
  return byAthleteKey;
}

function hasNewerActiveReplacement(row: AppointmentRow, activeByAthleteKey: Map<string, AppointmentRow[]>) {
  const athleteKey = asText(row.athlete_key);
  if (!athleteKey) return false;
  const startsAt = Date.parse(asText(row.starts_at));
  if (!Number.isFinite(startsAt)) return false;
  return (activeByAthleteKey.get(athleteKey) || []).some((candidate) => {
    if (asText(candidate.id) === asText(row.id)) return false;
    const candidateStartsAt = Date.parse(asText(candidate.starts_at));
    return Number.isFinite(candidateStartsAt) && candidateStartsAt > startsAt;
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const athleteId = asText(url.searchParams.get('athlete_id'));
  const athleteMainId = asText(url.searchParams.get('athlete_main_id'));

  try {
    const config = getSupabaseRestConfig();
    const filters = [
      'select=id,athlete_key,athlete_id,athlete_main_id,head_scout,starts_at,status,source_event_id,meeting_timezone,meeting_timezone_label,post_meeting_result,source_payload,updated_at',
      'post_meeting_result=eq.reschedule_pending',
      `updated_at=gte.${encodeURIComponent(recentCutoff())}`,
      'order=updated_at.desc',
      'limit=30',
    ];
    if (athleteId) filters.push(`athlete_id=eq.${encodeURIComponent(athleteId)}`);
    if (athleteMainId) filters.push(`athlete_main_id=eq.${encodeURIComponent(athleteMainId)}`);

    const response = await fetch(`${config.url}/rest/v1/appointments?${filters.join('&')}`, {
      cache: 'no-store',
      headers: supabaseHeaders(config),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error(rows.message || rows.error || `Supabase appointments ${response.status}`);
    }

    const appointmentRows = Array.isArray(rows) ? rows as AppointmentRow[] : [];
    const activeByAthleteKey = await fetchActiveReplacementAppointments(appointmentRows);
    const athleteKeys = Array.from(
      new Set(
        appointmentRows
          .filter((row) => !hasNewerActiveReplacement(row, activeByAthleteKey))
          .map((row) => asText(row.athlete_key))
          .filter(Boolean),
      ),
    );
    const athleteNames = await fetchAthleteNames(athleteKeys);
    const events = appointmentRows
      .filter((row) => !hasNewerActiveReplacement(row, activeByAthleteKey))
      .map((row) => {
        const payload = payloadFor(row);
        const athleteKey = asText(row.athlete_key);
        const athleteName =
          payloadRealText(payload, 'athlete_name') ||
          athleteNames.get(athleteKey) ||
          cleanTitleName(payloadText(payload, 'meeting_title_base')) ||
          cleanTitleName(payloadText(payload, 'meeting_title_current')) ||
          'Reschedule pending';
        return {
          key: row.id || row.source_event_id,
          appointment_id: row.id || row.source_event_id,
          athlete_id: row.athlete_id,
          athlete_main_id: row.athlete_main_id,
          athlete_name: athleteName,
          head_scout_name: row.head_scout || payloadText(payload, 'head_scout') || payloadText(payload, 'head_scout_name'),
          previous_meeting_start: row.starts_at,
          meeting_timezone: row.meeting_timezone || payloadText(payload, 'meeting_timezone'),
          meeting_timezone_label: row.meeting_timezone_label || payloadText(payload, 'meeting_timezone_label'),
          updated_at: row.updated_at,
          status: row.status,
          post_meeting_result: row.post_meeting_result,
          previous_meeting_title:
            cleanTitleName(payloadText(payload, 'meeting_title_current')) ||
            cleanTitleName(payloadText(payload, 'meeting_title_base')) ||
            athleteName,
          previous_meeting_text:
            payloadText(payload, 'previous_meeting_text') ||
            payloadText(payload, 'task_description') ||
            payloadText(payload, 'meeting_description') ||
            payloadText(payload, 'description'),
        };
      })
      .filter((event) => event.appointment_id && event.athlete_id && event.athlete_main_id);

    return jsonResponse({
      success: true,
      source: 'appointments',
      stage: 'Meeting Result - Res. Pending',
      window_days: 7,
      count: events.length,
      events,
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

export function POST(request: Request) {
  return methodNotAllowed(request.method, ['GET']);
}
