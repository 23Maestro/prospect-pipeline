alter table if exists public.reminders
  add column if not exists athlete_key text,
  add column if not exists athlete_id text,
  add column if not exists athlete_main_id text,
  add column if not exists athlete_name text,
  add column if not exists recipient_name text,
  add column if not exists recipient_phone text,
  add column if not exists head_scout_name text,
  add column if not exists meeting_starts_at timestamptz,
  add column if not exists meeting_duration_minutes integer,
  add column if not exists meeting_ends_at timestamptz,
  add column if not exists meeting_timezone text,
  add column if not exists message_body text,
  add column if not exists admin_url text,
  add column if not exists task_url text,
  add column if not exists source text,
  add column if not exists generated_at timestamptz,
  add column if not exists payload_json jsonb not null default '{}'::jsonb;

create table if not exists public.set_meeting_confirmation_cache (
  id text primary key,
  appointment_id text not null,
  kind text not null,
  send_at timestamptz,
  sent_at timestamptz,
  status text not null default 'cached',
  dedupe_key text not null unique,
  athlete_key text,
  athlete_id text,
  athlete_main_id text,
  athlete_name text,
  recipient_name text,
  recipient_phone text,
  head_scout_name text,
  meeting_starts_at timestamptz,
  meeting_duration_minutes integer,
  meeting_ends_at timestamptz,
  meeting_timezone text,
  message_body text,
  admin_url text,
  task_url text,
  source text not null default 'set_meetings_confirmation',
  generated_at timestamptz,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint set_meeting_confirmation_cache_kind_check
    check (kind in ('confirmation_1', 'confirmation_2')),
  constraint set_meeting_confirmation_cache_status_check
    check (status in ('cached', 'sent', 'skipped', 'expired')),
  constraint set_meeting_confirmation_cache_source_check
    check (source = 'set_meetings_confirmation')
);

create index if not exists set_meeting_confirmation_cache_ready_idx
  on public.set_meeting_confirmation_cache (status, meeting_starts_at desc)
  where status = 'cached'
    and source = 'set_meetings_confirmation'
    and kind in ('confirmation_1', 'confirmation_2');

create index if not exists set_meeting_confirmation_cache_athlete_idx
  on public.set_meeting_confirmation_cache (athlete_key, meeting_starts_at desc)
  where athlete_key is not null;

insert into public.set_meeting_confirmation_cache (
  id,
  appointment_id,
  kind,
  send_at,
  sent_at,
  status,
  dedupe_key,
  athlete_key,
  athlete_id,
  athlete_main_id,
  athlete_name,
  recipient_name,
  recipient_phone,
  head_scout_name,
  meeting_starts_at,
  meeting_duration_minutes,
  meeting_ends_at,
  meeting_timezone,
  message_body,
  admin_url,
  task_url,
  source,
  generated_at,
  payload_json,
  created_at,
  updated_at
)
select
  id,
  appointment_id,
  kind,
  send_at,
  sent_at,
  status,
  dedupe_key,
  athlete_key,
  athlete_id,
  athlete_main_id,
  athlete_name,
  recipient_name,
  recipient_phone,
  head_scout_name,
  meeting_starts_at,
  meeting_duration_minutes,
  meeting_ends_at,
  meeting_timezone,
  message_body,
  admin_url,
  task_url,
  source,
  generated_at,
  payload_json,
  created_at,
  updated_at
from public.reminders
where source = 'set_meetings_confirmation'
  and kind in ('confirmation_1', 'confirmation_2')
on conflict (dedupe_key) do update set
  send_at = excluded.send_at,
  sent_at = excluded.sent_at,
  status = excluded.status,
  athlete_key = excluded.athlete_key,
  athlete_id = excluded.athlete_id,
  athlete_main_id = excluded.athlete_main_id,
  athlete_name = excluded.athlete_name,
  recipient_name = excluded.recipient_name,
  recipient_phone = excluded.recipient_phone,
  head_scout_name = excluded.head_scout_name,
  meeting_starts_at = excluded.meeting_starts_at,
  meeting_duration_minutes = excluded.meeting_duration_minutes,
  meeting_ends_at = excluded.meeting_ends_at,
  meeting_timezone = excluded.meeting_timezone,
  message_body = excluded.message_body,
  admin_url = excluded.admin_url,
  task_url = excluded.task_url,
  source = excluded.source,
  generated_at = excluded.generated_at,
  payload_json = excluded.payload_json,
  updated_at = excluded.updated_at;

comment on table public.set_meeting_confirmation_cache is
  'Cache of generated set-meeting confirmation messages. This is not a native Reminder object.';

alter table public.set_meeting_confirmation_cache enable row level security;
revoke all on table public.set_meeting_confirmation_cache from anon, authenticated;
grant select, insert, update, delete on public.set_meeting_confirmation_cache to service_role;
