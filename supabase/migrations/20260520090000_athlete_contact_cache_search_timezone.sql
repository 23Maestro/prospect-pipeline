create extension if not exists pg_trgm;

alter table public.athlete_contact_cache
  add column if not exists timezone text,
  add column if not exists timezone_label text;

create index if not exists athlete_contact_cache_active_athlete_name_trgm_idx
  on public.athlete_contact_cache using gin ((lower(athlete_name)) gin_trgm_ops)
  where cache_status = 'active';

create index if not exists athlete_contact_cache_active_contact_name_trgm_idx
  on public.athlete_contact_cache using gin ((lower(contact_name)) gin_trgm_ops)
  where cache_status = 'active';

create or replace function public.search_athlete_contact_cache(input_query text)
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
  timezone text,
  timezone_label text,
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
          and lower(cache.contact_name) like '%' || input.query_text || '%'
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
          and lower(cache.contact_name) = input.query_text
          then 2
        when length(input.query_text) >= 2
          and lower(cache.athlete_name) like input.query_text || '%'
          then 3
        when length(input.query_text) >= 2
          and lower(cache.contact_name) like input.query_text || '%'
          then 4
        else 5
      end as match_rank
    from public.athlete_contact_cache cache
    cross join normalized_input input
    where cache.cache_status = 'active'
      and (
        (
          length(input.phone_digits) >= 3
          and cache.normalized_phone like '%' || input.phone_digits || '%'
        )
        or (
          length(input.query_text) >= 2
          and (
            lower(cache.athlete_name) like '%' || input.query_text || '%'
            or lower(cache.contact_name) like '%' || input.query_text || '%'
          )
        )
      )
  )
  select
    matches.athlete_key,
    matches.athlete_id,
    matches.athlete_main_id,
    matches.athlete_name,
    matches.contact_id,
    matches.contact_name,
    matches.relationship_label,
    matches.phone,
    matches.normalized_phone,
    matches.admin_url,
    matches.task_url,
    matches.timezone,
    matches.timezone_label,
    matches.last_seen_at,
    matches.resolved_match_kind as match_kind
  from matches
  order by matches.match_rank asc, matches.last_seen_at desc, matches.athlete_name asc, matches.contact_name asc
  limit 40;
$$;

revoke all on function public.search_athlete_contact_cache(text) from public;
grant execute on function public.search_athlete_contact_cache(text) to anon, authenticated;

comment on function public.search_athlete_contact_cache(text) is
  'Browser-safe athlete/contact lookup by name or phone. Direct table reads remain blocked by RLS.';
