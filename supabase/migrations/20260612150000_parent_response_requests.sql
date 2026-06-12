create table if not exists public.parent_response_requests (
  id uuid primary key default gen_random_uuid(),
  appointment_id text,
  athlete_id text not null,
  athlete_main_id text not null,
  athlete_name text not null,
  recipient_name text,
  recipient_phone text,
  original_head_scout_name text,
  original_head_scout_owner_key text,
  original_meeting_starts_at timestamptz,
  original_meeting_timezone text,
  request_status text not null default 'open',
  approval_status text not null default 'pending',
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  response_kind text,
  selected_option_id text,
  selected_at timestamptz,
  source text not null default 'parent_response_link',
  created_by_operator_key text,
  proposed_options jsonb not null default '[]'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  approval_payload jsonb not null default '{}'::jsonb,
  notification_status text not null default 'pending',
  notification_sent_at timestamptz,
  notification_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parent_response_requests_status_check
    check (request_status in ('open', 'selected', 'none_work', 'ready_later', 'expired', 'canceled', 'applied')),
  constraint parent_response_requests_approval_check
    check (approval_status in ('pending', 'approved', 'applied', 'rejected', 'failed')),
  constraint parent_response_requests_response_kind_check
    check (response_kind is null or response_kind in ('selected_slot', 'none_work', 'ready_later')),
  constraint parent_response_requests_notification_check
    check (notification_status in ('pending', 'sent', 'failed'))
);

create index if not exists parent_response_requests_open_idx
  on public.parent_response_requests (request_status, expires_at);

create index if not exists parent_response_requests_approval_idx
  on public.parent_response_requests (approval_status, updated_at desc);

create index if not exists parent_response_requests_notification_idx
  on public.parent_response_requests (notification_status, updated_at desc);

alter table public.parent_response_requests enable row level security;

drop policy if exists parent_response_requests_service_role_all on public.parent_response_requests;
create policy parent_response_requests_service_role_all
  on public.parent_response_requests
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
