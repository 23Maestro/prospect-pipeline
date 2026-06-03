create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.tim_lite_appointments (
  id text primary key,
  operator_key text not null default 'tim_risner',
  appointment_id text not null,
  source_event_id text,
  athlete_key text,
  athlete_id text,
  athlete_main_id text,
  athlete_name text not null,
  head_scout_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  meeting_timezone text,
  meeting_timezone_label text,
  status text not null default 'scheduled',
  admin_url text,
  task_url text,
  source text not null default 'tim_lite_sync',
  source_payload jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tim_lite_appointments_operator_check
    check (operator_key = 'tim_risner'),
  constraint tim_lite_appointments_status_check
    check (status in ('scheduled', 'confirmation_queued', 'confirmation_sent', 'rescheduled', 'reschedule_pending', 'canceled', 'stale'))
);

create unique index if not exists tim_lite_appointments_operator_appointment_idx
  on public.tim_lite_appointments (operator_key, appointment_id);

create index if not exists tim_lite_appointments_window_idx
  on public.tim_lite_appointments (operator_key, starts_at asc)
  where status in ('scheduled', 'confirmation_queued', 'confirmation_sent', 'rescheduled');

create table if not exists public.tim_lite_confirmation_cache (
  id text primary key,
  operator_key text not null default 'tim_risner',
  appointment_id text not null,
  kind text not null,
  status text not null default 'cached',
  dedupe_key text not null unique,
  athlete_key text,
  athlete_id text,
  athlete_main_id text,
  athlete_name text not null,
  recipient_name text,
  recipient_phone text,
  normalized_phone text,
  relationship_label text,
  head_scout_name text,
  meeting_starts_at timestamptz,
  meeting_ends_at timestamptz,
  meeting_timezone text,
  meeting_timezone_label text,
  message_body text,
  admin_url text,
  task_url text,
  source text not null default 'tim_lite_sync',
  source_payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tim_lite_confirmation_cache_operator_check
    check (operator_key = 'tim_risner'),
  constraint tim_lite_confirmation_cache_kind_check
    check (kind in ('confirmation_1', 'confirmation_2')),
  constraint tim_lite_confirmation_cache_status_check
    check (status in ('cached', 'sent', 'skipped', 'expired', 'stale')),
  constraint tim_lite_confirmation_cache_phone_check
    check (normalized_phone is null or normalized_phone ~ '^[0-9]{10}$')
);

create index if not exists tim_lite_confirmation_ready_idx
  on public.tim_lite_confirmation_cache (operator_key, status, meeting_starts_at asc)
  where status = 'cached'
    and kind in ('confirmation_1', 'confirmation_2');

create index if not exists tim_lite_confirmation_athlete_trgm_idx
  on public.tim_lite_confirmation_cache using gin ((lower(athlete_name)) gin_trgm_ops)
  where status = 'cached';

create index if not exists tim_lite_confirmation_recipient_trgm_idx
  on public.tim_lite_confirmation_cache using gin ((lower(recipient_name)) gin_trgm_ops)
  where status = 'cached'
    and recipient_name is not null;

alter table public.tim_lite_appointments enable row level security;
alter table public.tim_lite_confirmation_cache enable row level security;

revoke all on table public.tim_lite_appointments from anon, authenticated;
revoke all on table public.tim_lite_confirmation_cache from anon, authenticated;

grant select, insert, update, delete on public.tim_lite_appointments to service_role;
grant select, insert, update, delete on public.tim_lite_confirmation_cache to service_role;

create or replace function public.search_tim_lite_confirmation_cache(input_query text)
returns table (
  appointment_id text,
  athlete_key text,
  athlete_id text,
  athlete_main_id text,
  athlete_name text,
  recipient_name text,
  relationship_label text,
  recipient_phone text,
  normalized_phone text,
  head_scout_name text,
  meeting_starts_at timestamptz,
  meeting_timezone text,
  meeting_timezone_label text,
  admin_url text,
  task_url text,
  last_seen_at timestamptz,
  match_kind text
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized_input as (
    select
      lower(trim(coalesce(input_query, ''))) as query_text,
      case
        when length(regexp_replace(coalesce(input_query, ''), '\D', '', 'g')) = 11
          and regexp_replace(coalesce(input_query, ''), '\D', '', 'g') like '1%'
          then right(regexp_replace(coalesce(input_query, ''), '\D', '', 'g'), 10)
        else regexp_replace(coalesce(input_query, ''), '\D', '', 'g')
      end as phone_digits
  ),
  matches as (
    select
      cache.*,
      case
        when length(input.phone_digits) >= 3
          and cache.normalized_phone like '%' || input.phone_digits || '%'
          then 'phone'
        when length(input.query_text) >= 2
          and lower(coalesce(cache.recipient_name, '')) like '%' || input.query_text || '%'
          then 'contact'
        else 'athlete'
      end as resolved_match_kind,
      case
        when length(input.phone_digits) >= 3
          and cache.normalized_phone = input.phone_digits
          then 0
        when length(input.query_text) >= 2
          and lower(cache.athlete_name) = input.query_text
          then 1
        when length(input.query_text) >= 2
          and lower(coalesce(cache.recipient_name, '')) = input.query_text
          then 2
        when length(input.query_text) >= 2
          and lower(cache.athlete_name) like input.query_text || '%'
          then 3
        when length(input.query_text) >= 2
          and lower(coalesce(cache.recipient_name, '')) like input.query_text || '%'
          then 4
        else 5
      end as match_rank
    from public.tim_lite_confirmation_cache cache
    cross join normalized_input input
    where cache.operator_key = 'tim_risner'
      and cache.status = 'cached'
      and cache.kind = 'confirmation_1'
      and (
        (
          length(input.phone_digits) >= 3
          and cache.normalized_phone like '%' || input.phone_digits || '%'
        )
        or (
          length(input.query_text) >= 2
          and (
            lower(cache.athlete_name) like '%' || input.query_text || '%'
            or lower(coalesce(cache.recipient_name, '')) like '%' || input.query_text || '%'
          )
        )
      )
  )
  select
    matches.appointment_id,
    matches.athlete_key,
    matches.athlete_id,
    matches.athlete_main_id,
    matches.athlete_name,
    matches.recipient_name,
    matches.relationship_label,
    matches.recipient_phone,
    matches.normalized_phone,
    matches.head_scout_name,
    matches.meeting_starts_at,
    matches.meeting_timezone,
    matches.meeting_timezone_label,
    matches.admin_url,
    matches.task_url,
    matches.generated_at as last_seen_at,
    matches.resolved_match_kind as match_kind
  from matches
  order by matches.match_rank asc, matches.generated_at desc, matches.athlete_name asc, matches.recipient_name asc
  limit 40;
$$;

revoke all on function public.search_tim_lite_confirmation_cache(text) from public;
grant execute on function public.search_tim_lite_confirmation_cache(text) to service_role;

comment on table public.tim_lite_appointments is
  'Tim Lite meeting cache for the stripped mobile workflow. This is an experiment-scoped support table, not company-wide appointment truth.';

comment on table public.tim_lite_confirmation_cache is
  'Tim Lite confirmation and contact-search cache for the stripped mobile workflow. This supports message prep and lookup only.';

comment on function public.search_tim_lite_confirmation_cache(text) is
  'Server-side Tim Lite lookup by athlete, recipient, or phone over the Tim-scoped confirmation cache.';
