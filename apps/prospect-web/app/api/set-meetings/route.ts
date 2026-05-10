import { buildEasternWeekWindow } from '../../../lib/fastapi-client';
import { methodNotAllowed } from '../../../lib/response-shapes';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

type ReminderRow = {
  appointment_id: string;
  athlete_id: string | null;
  athlete_main_id: string | null;
  athlete_name: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  head_scout_name: string | null;
  meeting_starts_at: string | null;
  meeting_timezone: string | null;
  message_body: string | null;
  admin_url: string | null;
  task_url: string | null;
  kind: 'confirmation_1' | 'confirmation_2';
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const weekWindow = buildEasternWeekWindow(url.searchParams.get('week') || 'this');
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('reminders')
    .select('appointment_id,athlete_id,athlete_main_id,athlete_name,recipient_name,recipient_phone,head_scout_name,meeting_starts_at,meeting_timezone,message_body,admin_url,task_url,kind')
    .eq('status', 'cached')
    .eq('source', 'set_meetings_confirmation')
    .in('kind', ['confirmation_1', 'confirmation_2'])
    .gte('meeting_starts_at', `${weekWindow.start}T00:00:00-04:00`)
    .lt('meeting_starts_at', `${weekWindow.end}T00:00:00-04:00`)
    .order('meeting_starts_at', { ascending: true });

  if (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }

  const grouped = new Map<string, { base: ReminderRow; c1?: string; c2?: string }>();
  for (const row of (data || []) as ReminderRow[]) {
    const key = String(row.appointment_id || '').trim();
    if (!key) continue;
    const existing = grouped.get(key) || { base: row };
    if (row.kind === 'confirmation_1') existing.c1 = row.message_body || '';
    if (row.kind === 'confirmation_2') existing.c2 = row.message_body || '';
    grouped.set(key, existing);
  }

  const events = Array.from(grouped.values()).map((entry) => ({
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
    confirmation_1_message: entry.c1 || '',
    confirmation_2_message: entry.c2 || '',
    admin_url: entry.base.admin_url,
    task_url: entry.base.task_url,
    source: 'supabase_reminders_cache',
  }));

  return Response.json({
    success: true,
    source: 'supabase_reminders_cache',
    backend_required: false,
    week_start: weekWindow.start,
    week_end: weekWindow.end,
    count: events.length,
    events,
  });
}

export function POST(request: Request) {
  return methodNotAllowed(request.method, ['GET']);
}
