create extension if not exists pgcrypto;

create table if not exists public.athlete_contact_cache (
  id uuid primary key default gen_random_uuid(),
  athlete_key text not null,
  athlete_id text not null,
  athlete_main_id text not null,
  athlete_name text not null,
  contact_id text,
  contact_name text not null,
  relationship_label text not null,
  phone text not null,
  normalized_phone text not null,
  admin_url text,
  task_url text,
  source text not null,
  cache_status text not null default 'active',
  inactive_reason text,
  inactive_at timestamptz,
  last_seen_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint athlete_contact_cache_status_check
    check (cache_status in ('active', 'inactive')),
  constraint athlete_contact_cache_phone_check
    check (normalized_phone ~ '^[0-9]{10}$'),
  constraint athlete_contact_cache_unique_phone_athlete
    unique (normalized_phone, athlete_key)
);

create index if not exists athlete_contact_cache_active_phone_idx
  on public.athlete_contact_cache (normalized_phone, last_seen_at desc)
  where cache_status = 'active';

create index if not exists athlete_contact_cache_athlete_key_idx
  on public.athlete_contact_cache (athlete_key, updated_at desc);

alter table public.athlete_contact_cache enable row level security;

revoke all on table public.athlete_contact_cache from anon, authenticated;
grant select, insert, update, delete on public.athlete_contact_cache to service_role;

create or replace function public.lookup_athlete_contact_cache(input_phone text)
returns table (
  athlete_key text,
  athlete_id text,
  athlete_main_id text,
  athlete_name text,
  contact_id text,
  contact_name text,
  relationship_label text,
  phone text,
  normalized_phone text,
  admin_url text,
  task_url text,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized_input as (
    select case
      when length(regexp_replace(coalesce(input_phone, ''), '\D', '', 'g')) = 11
        and regexp_replace(coalesce(input_phone, ''), '\D', '', 'g') like '1%'
        then right(regexp_replace(coalesce(input_phone, ''), '\D', '', 'g'), 10)
      else regexp_replace(coalesce(input_phone, ''), '\D', '', 'g')
    end as phone_digits
  )
  select
    cache.athlete_key,
    cache.athlete_id,
    cache.athlete_main_id,
    cache.athlete_name,
    cache.contact_id,
    cache.contact_name,
    cache.relationship_label,
    cache.phone,
    cache.normalized_phone,
    cache.admin_url,
    cache.task_url,
    cache.last_seen_at
  from public.athlete_contact_cache cache
  join normalized_input input on input.phone_digits = cache.normalized_phone
  where cache.cache_status = 'active'
    and length(input.phone_digits) = 10
  order by cache.last_seen_at desc, cache.athlete_name asc;
$$;

revoke all on function public.lookup_athlete_contact_cache(text) from public;
grant execute on function public.lookup_athlete_contact_cache(text) to anon, authenticated;

comment on table public.athlete_contact_cache is
  'Lookup cache for athlete/contact phone facts captured from normal operator workflows. Browser access is through lookup_athlete_contact_cache only.';
