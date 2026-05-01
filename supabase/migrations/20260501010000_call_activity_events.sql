create table if not exists call_activity_events (
  id uuid primary key default gen_random_uuid(),
  athlete_key text not null references athletes (athlete_key) on delete cascade,
  athlete_id text not null,
  athlete_main_id text not null,
  athlete_name text,
  task_id text not null,
  task_title text,
  task_description text,
  activity_type text not null,
  occurred_at timestamptz not null,
  source_owner text not null,
  owner_proof text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists call_activity_events_task_id_idx
  on call_activity_events (task_id);

create index if not exists call_activity_events_occurred_at_idx
  on call_activity_events (occurred_at desc);

create index if not exists call_activity_events_athlete_key_idx
  on call_activity_events (athlete_key, occurred_at desc);

alter table call_activity_events enable row level security;

drop policy if exists "call_activity_events_select" on call_activity_events;
create policy "call_activity_events_select"
  on call_activity_events for select
  using (true);

grant select on call_activity_events to anon, authenticated;
grant select, insert, update, delete on call_activity_events to service_role;
