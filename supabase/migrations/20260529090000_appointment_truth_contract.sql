-- Promote appointments into the durable appointment truth table.
-- athlete_pipeline_state keeps only the current working pointer.

alter table public.appointments
  add column if not exists meeting_timezone text,
  add column if not exists meeting_timezone_label text,
  add column if not exists calendar_timezone text,
  add column if not exists previous_appointment_id text,
  add column if not exists original_appointment_id text,
  add column if not exists reschedule_sequence integer not null default 0,
  add column if not exists operator_owner text,
  add column if not exists operator_owner_key text,
  add column if not exists head_scout_key text,
  add column if not exists appointment_role text,
  add column if not exists status_reason text,
  add column if not exists source_system text,
  add column if not exists source_payload jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointment_truth_active_starts_at_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    -- Staged for the post-backfill validation slice. Existing confirmation writes
    -- can still arrive without starts_at until consumers move to appointment truth.
    alter table public.appointments
      add constraint appointment_truth_active_starts_at_check
      check (
        status is null
        or status not in (
          'scheduled',
          'rescheduled',
          'reschedule_pending',
          'confirmation_queued',
          'confirmation_sent'
        )
        or starts_at is not null
        or source_system is null
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointment_truth_active_timezone_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    -- Staged for the post-backfill validation slice. The anomaly view is the active
    -- enforcement surface until every writer can provide meeting_timezone.
    alter table public.appointments
      add constraint appointment_truth_active_timezone_check
      check (
        status is null
        or status not in (
          'scheduled',
          'rescheduled',
          'reschedule_pending',
          'confirmation_queued',
          'confirmation_sent'
        )
        or meeting_timezone is not null
        or source_system is null
        or source_system in ('sync_current_pipeline', 'sync_booked_meetings')
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointment_truth_reschedule_sequence_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointment_truth_reschedule_sequence_check
      check (reschedule_sequence >= 0) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointment_truth_role_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointment_truth_role_check
      check (
        appointment_role is null
        or appointment_role in (
          'initial_set',
          'reschedule',
          'confirmation',
          'post_meeting_outcome',
          'unknown'
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointment_truth_previous_appointment_fkey'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointment_truth_previous_appointment_fkey
      foreign key (previous_appointment_id)
      references public.appointments(id)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointment_truth_original_appointment_fkey'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointment_truth_original_appointment_fkey
      foreign key (original_appointment_id)
      references public.appointments(id)
      not valid;
  end if;
end $$;

create index if not exists appointments_active_truth_idx
  on public.appointments (athlete_key, updated_at desc, starts_at desc)
  where status in (
    'scheduled',
    'rescheduled',
    'reschedule_pending',
    'confirmation_queued',
    'confirmation_sent'
  );

create index if not exists appointments_reschedule_chain_idx
  on public.appointments (original_appointment_id, reschedule_sequence)
  where original_appointment_id is not null;

create index if not exists appointments_previous_appointment_idx
  on public.appointments (previous_appointment_id)
  where previous_appointment_id is not null;

create or replace view public.active_athlete_meeting_truth as
with active_statuses(status) as (
  values
    ('scheduled'),
    ('rescheduled'),
    ('reschedule_pending'),
    ('confirmation_queued'),
    ('confirmation_sent')
),
confirmation_support as (
  select
    appointment_id,
    max(meeting_timezone) filter (where nullif(meeting_timezone, '') is not null) as meeting_timezone,
    max(meeting_starts_at) as meeting_starts_at
  from public.set_meeting_confirmation_cache
  group by appointment_id
),
contact_support as (
  select
    athlete_key,
    max(timezone) filter (where nullif(timezone, '') is not null) as timezone,
    max(timezone_label) filter (where nullif(timezone_label, '') is not null) as timezone_label
  from public.athlete_contact_cache
  group by athlete_key
),
latest_active_appointment as (
  select distinct on (appointment.athlete_key)
    appointment.*
  from public.appointments appointment
  join active_statuses active
    on active.status = appointment.status
  order by appointment.athlete_key, appointment.updated_at desc, appointment.starts_at desc nulls last
)
select
  state.athlete_key,
  state.athlete_id,
  state.athlete_main_id,
  athlete.athlete_name,
  state.crm_stage,
  state.task_status,
  state.current_task_id,
  state.current_task_title,
  coalesce(current_appt.operator_owner, latest_appt.operator_owner) as operator_owner,
  coalesce(current_appt.operator_owner_key, latest_appt.operator_owner_key) as operator_owner_key,
  coalesce(current_appt.head_scout, latest_appt.head_scout, state.head_scout) as current_head_scout,
  coalesce(current_appt.head_scout_key, latest_appt.head_scout_key) as current_head_scout_key,
  state.current_appointment_id,
  coalesce(current_appt.id, latest_appt.id) as resolved_appointment_id,
  coalesce(current_appt.source_event_id, latest_appt.source_event_id) as current_source_event_id,
  coalesce(current_appt.starts_at, latest_appt.starts_at, current_cache.meeting_starts_at) as current_starts_at,
  coalesce(
    current_appt.meeting_timezone,
    latest_appt.meeting_timezone,
    current_cache.meeting_timezone,
    contact_support.timezone
  ) as current_meeting_timezone,
  coalesce(
    current_appt.meeting_timezone_label,
    latest_appt.meeting_timezone_label,
    contact_support.timezone_label
  ) as current_meeting_timezone_label,
  coalesce(current_appt.calendar_timezone, latest_appt.calendar_timezone) as current_calendar_timezone,
  coalesce(current_appt.status, latest_appt.status) as current_appointment_status,
  coalesce(current_appt.appointment_role, latest_appt.appointment_role) as current_appointment_role,
  coalesce(current_appt.previous_appointment_id, latest_appt.previous_appointment_id) as previous_appointment_id,
  previous_appt.source_event_id as previous_source_event_id,
  previous_appt.starts_at as previous_starts_at,
  coalesce(previous_appt.meeting_timezone, previous_cache.meeting_timezone, contact_support.timezone) as previous_meeting_timezone,
  coalesce(previous_appt.meeting_timezone_label, contact_support.timezone_label) as previous_meeting_timezone_label,
  previous_appt.head_scout as previous_head_scout,
  previous_appt.head_scout_key as previous_head_scout_key,
  coalesce(current_appt.original_appointment_id, latest_appt.original_appointment_id, coalesce(current_appt.id, latest_appt.id)) as original_appointment_id,
  coalesce(current_appt.reschedule_sequence, latest_appt.reschedule_sequence, 0) as reschedule_sequence,
  case
    when current_appt.id is not null then 'current_appointment_pointer'
    when latest_appt.id is not null then 'latest_appointment_repairable'
    else 'missing_appointment'
  end as resolution_source,
  state.updated_at as pipeline_updated_at,
  coalesce(current_appt.updated_at, latest_appt.updated_at) as appointment_updated_at
from public.athlete_pipeline_state state
left join public.athletes athlete
  on athlete.athlete_key = state.athlete_key
left join public.appointments current_appt
  on current_appt.id = state.current_appointment_id
left join latest_active_appointment latest_appt
  on latest_appt.athlete_key = state.athlete_key
left join public.appointments previous_appt
  on previous_appt.id = coalesce(current_appt.previous_appointment_id, latest_appt.previous_appointment_id)
left join confirmation_support current_cache
  on current_cache.appointment_id = coalesce(current_appt.id, latest_appt.id)
left join confirmation_support previous_cache
  on previous_cache.appointment_id = previous_appt.id
left join contact_support
  on contact_support.athlete_key = state.athlete_key
where state.current_appointment_id is not null
   or latest_appt.id is not null
   or state.crm_stage in ('Meeting Set', 'Meeting Set - Rescheduled', 'Rescheduled', 'Meeting Result - Res. Pending')
   or state.task_status in ('confirmation_call', 'reschedule_pending', 'post_meeting_update_pending');

create or replace view public.meeting_truth_anomalies as
with truth as (
  select *
  from public.active_athlete_meeting_truth
),
duplicate_chains as (
  select
    athlete_key,
    original_appointment_id,
    count(*) as active_count
  from truth
  where original_appointment_id is not null
    and current_appointment_status in (
      'scheduled',
      'rescheduled',
      'reschedule_pending',
      'confirmation_queued',
      'confirmation_sent'
    )
  group by athlete_key, original_appointment_id
  having count(*) > 1
),
support_cache_gaps as (
  select distinct cache.appointment_id
  from public.set_meeting_confirmation_cache cache
  join public.appointments appointment
    on appointment.id = cache.appointment_id
  where nullif(cache.meeting_timezone, '') is not null
    and nullif(appointment.meeting_timezone, '') is null
)
select
  anomaly.athlete_key,
  anomaly.athlete_name,
  anomaly.current_appointment_id,
  anomaly.resolved_appointment_id,
  anomaly.anomaly_reason,
  anomaly.recommended_repair,
  anomaly.evidence_json
from (
  select
    truth.athlete_key,
    truth.athlete_name,
    truth.current_appointment_id,
    truth.resolved_appointment_id,
    'missing_current_appointment_pointer'::text as anomaly_reason,
    'set athlete_pipeline_state.current_appointment_id to resolved_appointment_id'::text as recommended_repair,
    jsonb_build_object(
      'resolution_source', truth.resolution_source,
      'current_starts_at', truth.current_starts_at,
      'current_head_scout', truth.current_head_scout
    ) as evidence_json
  from truth
  where truth.current_appointment_id is null
    and truth.resolved_appointment_id is not null

  union all

  select
    truth.athlete_key,
    truth.athlete_name,
    truth.current_appointment_id,
    truth.resolved_appointment_id,
    'stale_current_appointment_pointer',
    'replace stale current_appointment_id with resolved_appointment_id after review',
    jsonb_build_object('resolution_source', truth.resolution_source)
  from truth
  where truth.current_appointment_id is not null
    and truth.resolved_appointment_id is not null
    and truth.current_appointment_id <> truth.resolved_appointment_id

  union all

  select
    truth.athlete_key,
    truth.athlete_name,
    truth.current_appointment_id,
    truth.resolved_appointment_id,
    'missing_current_starts_at',
    'repair appointment.starts_at from live booked meeting evidence',
    jsonb_build_object('current_appointment_status', truth.current_appointment_status)
  from truth
  where truth.resolved_appointment_id is not null
    and truth.current_starts_at is null

  union all

  select
    truth.athlete_key,
    truth.athlete_name,
    truth.current_appointment_id,
    truth.resolved_appointment_id,
    'missing_current_timezone',
    'backfill appointment.meeting_timezone from confirmation or contact support',
    jsonb_build_object('current_appointment_status', truth.current_appointment_status)
  from truth
  where truth.resolved_appointment_id is not null
    and nullif(truth.current_meeting_timezone, '') is null

  union all

  select
    truth.athlete_key,
    truth.athlete_name,
    truth.current_appointment_id,
    truth.resolved_appointment_id,
    'missing_head_scout',
    'backfill appointment.head_scout from booked meeting owner evidence',
    jsonb_build_object('crm_stage', truth.crm_stage, 'task_status', truth.task_status)
  from truth
  where truth.resolved_appointment_id is not null
    and nullif(truth.current_head_scout, '') is null

  union all

  select
    truth.athlete_key,
    truth.athlete_name,
    truth.current_appointment_id,
    truth.resolved_appointment_id,
    'missing_operator_owner',
    'backfill appointment.operator_owner from owner proof payloads',
    jsonb_build_object('current_head_scout', truth.current_head_scout)
  from truth
  where truth.resolved_appointment_id is not null
    and nullif(truth.operator_owner, '') is null

  union all

  select
    truth.athlete_key,
    truth.athlete_name,
    truth.current_appointment_id,
    truth.resolved_appointment_id,
    'reschedule_missing_previous_appointment',
    'repair previous_appointment_id from lifecycle reschedule evidence',
    jsonb_build_object('reschedule_sequence', truth.reschedule_sequence)
  from truth
  where truth.current_appointment_role = 'reschedule'
    and nullif(truth.previous_appointment_id, '') is null

  union all

  select
    truth.athlete_key,
    truth.athlete_name,
    truth.current_appointment_id,
    truth.resolved_appointment_id,
    'reschedule_missing_original_appointment',
    'repair original_appointment_id from the first appointment in the chain',
    jsonb_build_object('previous_appointment_id', truth.previous_appointment_id)
  from truth
  where truth.current_appointment_role = 'reschedule'
    and nullif(truth.original_appointment_id, '') is null

  union all

  select
    truth.athlete_key,
    truth.athlete_name,
    truth.current_appointment_id,
    truth.resolved_appointment_id,
    'duplicate_active_appointment_chain',
    'review active appointments sharing the same original_appointment_id',
    jsonb_build_object('original_appointment_id', truth.original_appointment_id, 'active_count', duplicate_chains.active_count)
  from truth
  join duplicate_chains
    on duplicate_chains.athlete_key = truth.athlete_key
   and duplicate_chains.original_appointment_id = truth.original_appointment_id

  union all

  select
    truth.athlete_key,
    truth.athlete_name,
    truth.current_appointment_id,
    truth.resolved_appointment_id,
    'support_cache_timezone_not_backfilled',
    'copy support cache timezone into appointments.meeting_timezone',
    jsonb_build_object('current_meeting_timezone', truth.current_meeting_timezone)
  from truth
  join support_cache_gaps
    on support_cache_gaps.appointment_id = truth.resolved_appointment_id
) anomaly;
