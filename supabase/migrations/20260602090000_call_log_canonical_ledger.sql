-- Canonical Call Tracker ledger.
--
-- call_log is the clean target name for one reporting ledger. It intentionally
-- avoids the old call_events name, which is now compatibility/history only.
--
-- This migration only defines the ledger shape. It does not backfill rows,
-- move readers, or delete compatibility views.

create extension if not exists pgcrypto;

create table if not exists public.call_log (
  id uuid primary key default gen_random_uuid(),

  -- One row is one source-owned reporting fact.
  fact_type text not null,
  tracker_outcome text not null,
  occurred_at timestamptz not null,
  event_at timestamptz,
  reporting_at timestamptz not null,

  athlete_key text,
  athlete_id text,
  athlete_main_id text,
  athlete_name text,

  appointment_id text,
  live_event_id text,
  booked_event_title text,
  booked_event_starts_at timestamptz,
  booked_event_ends_at timestamptz,
  meeting_timezone text,
  head_scout text,
  head_scout_key text,

  raw_crm_stage text,
  raw_task_status text,
  raw_event_type text,
  activity_kind text,
  activity_subtype text,

  source_family text not null,
  source_table text,
  source_row_id text,
  source_system text,
  source_owner text,
  owner_proof text,
  active_operator_key text,
  active_operator_name text,
  task_assigned_owner text,
  resolved_owner_name text,
  resolved_owner_role text,
  resolved_owner_source_field text,
  resolved_owner_source_value text,
  materialization_status text,
  materialization_reason text,
  can_materialize_for_active_operator boolean not null default false,

  counts_as_dial boolean not null default false,
  counts_as_contact boolean not null default false,
  counts_as_meeting_set boolean not null default false,
  counts_as_post_meeting_outcome boolean not null default false,
  counts_as_enrollment boolean not null default false,

  revenue_cents integer,
  commission_cents integer,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_checkout_session_id text,
  payment_confirmed_at timestamptz,

  dedupe_key text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'call_log_fact_type_check'
      and conrelid = 'public.call_log'::regclass
  ) then
    alter table public.call_log
      add constraint call_log_fact_type_check
      check (
        fact_type in (
          'call_activity',
          'meeting_set',
          'post_meeting_outcome',
          'enrollment_payment'
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'call_log_source_family_check'
      and conrelid = 'public.call_log'::regclass
  ) then
    alter table public.call_log
      add constraint call_log_source_family_check
      check (
        source_family in (
          'call_activity_events',
          'lifecycle_events',
          'meeting_events',
          'appointments',
          'stripe',
          'commissions',
          'manual_repair'
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'call_log_count_shape_check'
      and conrelid = 'public.call_log'::regclass
  ) then
    alter table public.call_log
      add constraint call_log_count_shape_check
      check (
        (fact_type = 'call_activity' and counts_as_dial)
        or (fact_type = 'meeting_set' and counts_as_meeting_set)
        or (fact_type = 'post_meeting_outcome' and counts_as_post_meeting_outcome)
        or (fact_type = 'enrollment_payment' and counts_as_enrollment)
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'call_log_payment_shape_check'
      and conrelid = 'public.call_log'::regclass
  ) then
    alter table public.call_log
      add constraint call_log_payment_shape_check
      check (
        fact_type <> 'enrollment_payment'
        or revenue_cents is not null
        or stripe_payment_intent_id is not null
        or stripe_charge_id is not null
        or stripe_checkout_session_id is not null
      ) not valid;
  end if;
end $$;

create unique index if not exists call_log_dedupe_key_idx
  on public.call_log (dedupe_key);

create index if not exists call_log_reporting_at_idx
  on public.call_log (reporting_at desc);

create index if not exists call_log_fact_reporting_idx
  on public.call_log (fact_type, reporting_at desc);

create index if not exists call_log_athlete_reporting_idx
  on public.call_log (athlete_key, reporting_at desc)
  where athlete_key is not null;

create index if not exists call_log_appointment_idx
  on public.call_log (appointment_id)
  where appointment_id is not null;

create index if not exists call_log_live_event_idx
  on public.call_log (live_event_id)
  where live_event_id is not null;

create index if not exists call_log_owner_reporting_idx
  on public.call_log (active_operator_key, reporting_at desc)
  where can_materialize_for_active_operator;

create index if not exists call_log_source_row_idx
  on public.call_log (source_family, source_row_id)
  where source_row_id is not null;

comment on table public.call_log is
  'Canonical Call Tracker ledger. One row is one source-owned reporting fact: call activity, meeting set, post-meeting outcome, or enrollment payment evidence.';

comment on column public.call_log.fact_type is
  'Primary fact bucket: call_activity, meeting_set, post_meeting_outcome, or enrollment_payment.';

comment on column public.call_log.reporting_at is
  'Source-owned reporting clock used by Call Tracker summaries. Consumers must not rewrite it locally.';

comment on column public.call_log.dedupe_key is
  'Canonical uniqueness key for one reporting fact. It prevents duplicate UI counts before reporting views aggregate.';

comment on column public.call_log.source_family is
  'Original source family drained into call_log, such as call_activity_events, lifecycle_events, meeting_events, stripe, or commissions.';

alter table public.call_log enable row level security;

grant select, insert, update, delete on public.call_log to service_role;
