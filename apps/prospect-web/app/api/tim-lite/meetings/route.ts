import {
  buildTimLiteWeekWindow,
  getSupabaseRestConfig,
  supabaseHeaders,
  verifyTimLiteAccess,
} from '../access';
import { jsonResponse, methodNotAllowed } from '../../../../lib/response-shapes';

type ConfirmationCacheRow = {
  appointment_id?: string | null;
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  athlete_name?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  relationship_label?: string | null;
  head_scout_name?: string | null;
  meeting_starts_at?: string | null;
  meeting_ends_at?: string | null;
  meeting_timezone?: string | null;
  meeting_timezone_label?: string | null;
  message_body?: string | null;
  admin_url?: string | null;
  task_url?: string | null;
  kind?: string | null;
  generated_at?: string | null;
};

const ACTIVE_SET_MEETING_STATUSES = new Set([
  'scheduled',
  'confirmation_queued',
  'confirmation_sent',
  'rescheduled',
]);

function parseTime(value?: string | null): number {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function isCurrentMeetingWindow(row: ConfirmationCacheRow, week: string, now = new Date()): boolean {
  if (week !== 'this') return true;
  const startsAt = parseTime(row.meeting_starts_at);
  if (!Number.isFinite(startsAt)) return false;
  const explicitEnd = parseTime(row.meeting_ends_at);
  const endsAt = Number.isFinite(explicitEnd) ? explicitEnd : startsAt + 60 * 60_000;
  return endsAt > now.getTime();
}

type AppointmentReadiness = {
  status: string;
  postMeetingResult: string;
};

async function fetchAppointmentReadiness(appointmentIds: string[]): Promise<Map<string, AppointmentReadiness>> {
  if (!appointmentIds.length) return new Map<string, AppointmentReadiness>();
  const config = getSupabaseRestConfig();
  const query = [
    'select=id,status,post_meeting_result',
    `id=in.(${appointmentIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',')})`,
    `limit=${appointmentIds.length}`,
  ].join('&');
  const response = await fetch(`${config.url}/rest/v1/tim_lite_appointments?${query}`, {
    cache: 'no-store',
    headers: supabaseHeaders(config),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(rows.message || rows.error || `Supabase ${response.status}`);
  }
  const readiness = new Map<string, AppointmentReadiness>();
  for (const row of Array.isArray(rows) ? rows as Array<{ id?: string | null; status?: string | null; post_meeting_result?: string | null }> : []) {
    const id = String(row.id || '').trim();
    if (id) {
      readiness.set(id, {
        status: String(row.status || '').trim().toLowerCase(),
        postMeetingResult: String(row.post_meeting_result || '').trim().toLowerCase(),
      });
    }
  }
  return readiness;
}

export async function GET(request: Request) {
  const accessError = verifyTimLiteAccess(request);
  if (accessError) return accessError;

  const url = new URL(request.url);
  const weekWindow = buildTimLiteWeekWindow(url.searchParams.get('week') || 'this');

  try {
    const config = getSupabaseRestConfig();
    const query = [
      'select=appointment_id,athlete_id,athlete_main_id,athlete_name,recipient_name,recipient_phone,relationship_label,head_scout_name,meeting_starts_at,meeting_ends_at,meeting_timezone,meeting_timezone_label,message_body,admin_url,task_url,kind,generated_at',
      'operator_key=eq.tim_risner',
      'status=eq.cached',
      'kind=in.(confirmation_1,confirmation_2)',
      `meeting_starts_at=gte.${encodeURIComponent(`${weekWindow.start}T00:00:00-04:00`)}`,
      `meeting_starts_at=lt.${encodeURIComponent(`${weekWindow.end}T00:00:00-04:00`)}`,
      'order=meeting_starts_at.asc',
    ].join('&');
    const response = await fetch(`${config.url}/rest/v1/tim_lite_confirmation_cache?${query}`, {
      cache: 'no-store',
      headers: supabaseHeaders(config),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error(rows.message || rows.error || `Supabase ${response.status}`);
    }

    const grouped = new Map<string, { base: ConfirmationCacheRow; c1?: string; c2?: string }>();
    for (const row of Array.isArray(rows) ? rows as ConfirmationCacheRow[] : []) {
      const key = String(row.appointment_id || '').trim();
      if (!key) continue;
      const existing = grouped.get(key) || { base: row };
      if (row.kind === 'confirmation_1') existing.c1 = row.message_body || '';
      if (row.kind === 'confirmation_2') existing.c2 = row.message_body || '';
      grouped.set(key, existing);
    }

    const appointmentReadiness = await fetchAppointmentReadiness(Array.from(grouped.keys()));
    const events = Array.from(grouped.values())
      .filter((entry) => {
        const appointment = appointmentReadiness.get(String(entry.base.appointment_id || '').trim());
        return (
          ACTIVE_SET_MEETING_STATUSES.has(appointment?.status || '') &&
          !appointment?.postMeetingResult &&
          isCurrentMeetingWindow(entry.base, weekWindow.week)
        );
      })
      .map((entry) => ({
        appointment_id: entry.base.appointment_id,
        athlete_id: entry.base.athlete_id,
        athlete_main_id: entry.base.athlete_main_id,
        athlete_name: entry.base.athlete_name,
        head_scout_name: entry.base.head_scout_name,
        start: entry.base.meeting_starts_at,
        end: entry.base.meeting_ends_at,
        meeting_timezone: entry.base.meeting_timezone,
        meeting_timezone_label: entry.base.meeting_timezone_label,
        confirmation_recipient: {
          name: entry.base.recipient_name,
          phone: entry.base.recipient_phone,
          relationship: entry.base.relationship_label,
        },
        confirmation_1_message: entry.c1 || '',
        confirmation_2_message: entry.c2 || '',
        admin_url: entry.base.admin_url,
        task_url: entry.base.task_url,
        source: 'tim_lite_confirmation_cache',
      }));

    return jsonResponse({
      success: true,
      source: 'tim_lite_confirmation_cache',
      week_start: weekWindow.start,
      week_end: weekWindow.end,
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
