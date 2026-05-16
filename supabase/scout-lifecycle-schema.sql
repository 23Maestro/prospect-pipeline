create extension if not exists pgcrypto;

create table if not exists athletes (
  athlete_key text primary key,
  athlete_id text not null,
  athlete_main_id text not null,
  athlete_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists athletes_athlete_identity_idx
  on athletes (athlete_id, athlete_main_id);

create table if not exists athlete_pipeline_state (
  athlete_key text primary key references athletes (athlete_key) on delete cascade,
  athlete_id text not null,
  athlete_main_id text not null,
  crm_stage text,
  task_status text,
  head_scout text,
  current_task_id text,
  current_task_title text,
  current_appointment_id text,
  updated_at timestamptz not null default now()
);

create table if not exists appointments (
  id text primary key,
  athlete_key text not null references athletes (athlete_key) on delete cascade,
  athlete_id text not null,
  athlete_main_id text not null,
  head_scout text,
  starts_at timestamptz,
  status text,
  source_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists appointments_source_event_id_idx
  on appointments (source_event_id)
  where source_event_id is not null;

create index if not exists appointments_athlete_key_idx
  on appointments (athlete_key, starts_at desc);

create table if not exists lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  athlete_key text not null references athletes (athlete_key) on delete cascade,
  athlete_id text not null,
  athlete_main_id text not null,
  event_type text not null,
  dedupe_key text,
  previous_crm_stage text,
  previous_task_status text,
  crm_stage text,
  task_status text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lifecycle_events_athlete_key_idx
  on lifecycle_events (athlete_key, created_at desc);

create index if not exists lifecycle_events_athlete_event_created_idx
  on lifecycle_events (athlete_key, event_type, created_at desc);

create unique index if not exists lifecycle_events_dedupe_key_unique_idx
  on lifecycle_events (dedupe_key);

create index if not exists lifecycle_events_transition_stage_idx
  on lifecycle_events (previous_crm_stage, crm_stage, created_at desc)
  where previous_crm_stage is not null;

create table if not exists reminders (
  id text primary key,
  appointment_id text not null references appointments (id) on delete cascade,
  kind text not null,
  send_at timestamptz,
  sent_at timestamptz,
  status text not null,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reminders_status_send_at_idx
  on reminders (status, send_at);

create table if not exists set_meeting_confirmation_cache (
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
  on set_meeting_confirmation_cache (status, meeting_starts_at desc)
  where status = 'cached'
    and source = 'set_meetings_confirmation'
    and kind in ('confirmation_1', 'confirmation_2');
