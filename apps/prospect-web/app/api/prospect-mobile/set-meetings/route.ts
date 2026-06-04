import { getSupabaseRestConfig, supabaseHeaders } from '../../tim-lite/access';
import { jsonResponse, methodNotAllowed } from '../../../../lib/response-shapes';

const PAYLOAD_FIELD = ['payload', 'json'].join('_');

type ConfirmationCacheRow = {
  appointment_id?: string | null;
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  athlete_name?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  head_scout_name?: string | null;
  meeting_starts_at?: string | null;
  meeting_timezone?: string | null;
  message_body?: string | null;
  admin_url?: string | null;
  task_url?: string | null;
  kind?: string | null;
  [PAYLOAD_FIELD]?: Record<string, unknown> | null;
};

const ACTIVE_SET_MEETING_STATUSES = new Set([
  'scheduled',
  'confirmation_queued',
  'confirmation_sent',
  'rescheduled',
]);

function buildWeekWindow(week = 'this', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const easternDate = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  const dayOfWeek = easternDate.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekOffset = week === 'next' ? 1 : 0;
  const start = new Date(easternDate);
  start.setUTCDate(start.getUTCDate() + mondayOffset + weekOffset * 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return {
    start: toIsoDate(start),
    end: toIsoDate(end),
    week: week === 'next' ? 'next' : 'this',
  };
}

function toIsoDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function normalizePhoneForSms(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

function buildConfirmationCacheContactOptions(row: ConfirmationCacheRow) {
  const payload = row?.[PAYLOAD_FIELD] && typeof row[PAYLOAD_FIELD] === 'object' ? row[PAYLOAD_FIELD] : {};
  const payloadContacts = Array.isArray(payload.recipient_contacts)
    ? payload.recipient_contacts
        .map((contact) => {
          const item = contact && typeof contact === 'object' ? contact as Record<string, unknown> : {};
          return {
            name: String(item.name || '').trim(),
            relationship: String(item.label || item.relationship || '').trim(),
            phone: String(item.phone || '').trim(),
          };
        })
        .filter((contact) => contact.phone)
    : [];
  if (payloadContacts.length) return payloadContacts;

  const phone = String(row?.recipient_phone || payload.recipient_phone || '').trim();
  const name = String(row?.recipient_name || payload.recipient_name || '').trim();
  const relationship = String(payload.relationship_label || payload.relationship || '').trim();
  return [{
    name: name || relationship || 'Contact',
    relationship,
    phone,
  }];
}

async function fetchAppointmentStatuses(appointmentIds: string[]): Promise<Map<string, string>> {
  if (!appointmentIds.length) return new Map<string, string>();
  const config = getSupabaseRestConfig();
  const query = [
    'select=id,status',
    `id=in.(${appointmentIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',')})`,
    `limit=${appointmentIds.length}`,
  ].join('&');
  const response = await fetch(`${config.url}/rest/v1/appointments?${query}`, {
    cache: 'no-store',
    headers: supabaseHeaders(config),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(rows.message || rows.error || `Supabase ${response.status}`);
  }
  const statuses = new Map<string, string>();
  for (const row of Array.isArray(rows) ? rows as Array<{ id?: string | null; status?: string | null }> : []) {
    const id = String(row.id || '').trim();
    if (id) statuses.set(id, String(row.status || '').trim().toLowerCase());
  }
  return statuses;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const weekWindow = buildWeekWindow(url.searchParams.get('week') || 'this');

  try {
    const config = getSupabaseRestConfig();
    const query = [
      `select=appointment_id,athlete_id,athlete_main_id,athlete_name,recipient_name,recipient_phone,head_scout_name,meeting_starts_at,meeting_timezone,message_body,admin_url,task_url,kind,${PAYLOAD_FIELD}`,
      'status=eq.cached',
      'source=eq.set_meetings_confirmation',
      'kind=in.(confirmation_1,confirmation_2)',
      `meeting_starts_at=gte.${encodeURIComponent(`${weekWindow.start}T00:00:00-04:00`)}`,
      `meeting_starts_at=lt.${encodeURIComponent(`${weekWindow.end}T00:00:00-04:00`)}`,
      'order=meeting_starts_at.asc',
    ].join('&');
    const response = await fetch(`${config.url}/rest/v1/set_meeting_confirmation_cache?${query}`, {
      cache: 'no-store',
      headers: supabaseHeaders(config),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error(rows.message || rows.error || `Supabase ${response.status}`);
    }

    const grouped = new Map<string, { base: ConfirmationCacheRow; c1?: string; c2?: string; recipient_contacts: ReturnType<typeof buildConfirmationCacheContactOptions> }>();
    for (const row of Array.isArray(rows) ? rows as ConfirmationCacheRow[] : []) {
      const key = String(row.appointment_id || '').trim();
      if (!key) continue;
      const existing = grouped.get(key) || { base: row, recipient_contacts: [] };
      if (row.kind === 'confirmation_1') existing.c1 = row.message_body || '';
      if (row.kind === 'confirmation_2') existing.c2 = row.message_body || '';
      for (const contact of buildConfirmationCacheContactOptions(row)) {
        if (
          contact.phone &&
          !existing.recipient_contacts.some((candidate) => normalizePhoneForSms(candidate.phone) === normalizePhoneForSms(contact.phone))
        ) {
          existing.recipient_contacts.push(contact);
        }
      }
      grouped.set(key, existing);
    }

    const appointmentStatuses = await fetchAppointmentStatuses(Array.from(grouped.keys()));
    const events = Array.from(grouped.values())
      .filter((entry) => ACTIVE_SET_MEETING_STATUSES.has(appointmentStatuses.get(String(entry.base.appointment_id || '').trim()) || ''))
      .map((entry) => ({
        key: entry.base.appointment_id,
        appointment_id: entry.base.appointment_id,
        athlete_id: entry.base.athlete_id,
        athlete_main_id: entry.base.athlete_main_id,
        athlete_name: entry.base.athlete_name,
        head_scout_name: entry.base.head_scout_name,
        current_meeting_label: entry.base.meeting_starts_at,
        start: entry.base.meeting_starts_at,
        meeting_timezone: entry.base.meeting_timezone,
        confirmation_recipient: {
          name: entry.base.recipient_name,
          phone: entry.base.recipient_phone,
        },
        recipient_contacts: entry.recipient_contacts,
        confirmation_1_message: entry.c1 || '',
        confirmation_2_message: entry.c2 || '',
        admin_url: entry.base.admin_url,
        task_url: entry.base.task_url,
        source: 'supabase_confirmation_cache',
      }));

    return jsonResponse({
      success: true,
      source: 'supabase_confirmation_cache',
      backend_required: false,
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
