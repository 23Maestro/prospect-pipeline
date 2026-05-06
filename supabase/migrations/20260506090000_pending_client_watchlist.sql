create table if not exists public.pending_client_watchlist (
  id uuid primary key default gen_random_uuid(),
  source_event_id text not null unique,
  athlete_id text,
  athlete_main_id text,
  athlete_name text,
  head_scout text,
  head_scout_key text,
  calendar_owner_id text,
  detected_by_operator text not null,
  detected_by_operator_key text not null,
  resolved_by_operator text,
  resolved_by_operator_key text,
  event_title text not null,
  event_start text not null,
  event_end text,
  description text not null,
  matched_signals text[] not null default '{}'::text[],
  ai_verdict text not null,
  status text not null default 'watching',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  owner_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pending_client_watchlist_status_check
    check (status in ('watching', 'resolved', 'expired')),
  constraint pending_client_watchlist_ai_verdict_check
    check (ai_verdict = 'pending_client')
);

create index if not exists pending_client_watchlist_active_idx
  on public.pending_client_watchlist (status, expires_at desc, event_start desc)
  where status = 'watching';

create index if not exists pending_client_watchlist_head_scout_idx
  on public.pending_client_watchlist (head_scout_key, event_start desc);

comment on table public.pending_client_watchlist is
  'Operator watchlist for follow-up calendar notes that suggest pending payment or enrollment. This table is intentionally separate from reporting/counting facts.';

grant select, insert, update, delete on public.pending_client_watchlist to service_role;
