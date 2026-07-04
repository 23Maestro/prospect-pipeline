-- Gate Call Tracker facts by active-operator materialization proof.
-- A real Prospect ID event is not automatically an active-operator dashboard fact.
--
-- SQL proof cases covered by supabase/tests/call-tracker-active-operator-materialization-gate.test.mjs:
-- - Secondary Operator meeting_set lifecycle rows do not appear in call_tracker_events.
-- - Secondary Operator call_activity_events rows do not appear in call_tracker_events.
-- - Jerami operator_task meeting_set rows do appear.
-- - Jerami operator_task call_activity_events rows do appear.
-- - legacy rows without proof are excluded unless they match explicit compatibility rules.

create or replace view call_tracker_events as
with active_operator as (
  select 'Primary Operator'::text as active_operator_name
),
classified as (
  select
    ce.id,
    ce.athlete_key,
    ce.athlete_id,
    ce.athlete_main_id,
    ce.athlete_name,
    ce.occurred_at,
    ce.source,
    ce.raw_crm_stage,
    ce.raw_task_status,
    ce.raw_event_type,
    ce.appointment_id,
    ce.booked_event_title,
    ce.revenue_cents,
    case
      when lower(coalesce(ce.raw_crm_stage, '')) like '%close won%'
        or lower(coalesce(ce.raw_crm_stage, '')) like '%closed won%'
        or lower(coalesce(ce.booked_event_title, '')) like '(enr%' then 'closed_won'
      when lower(coalesce(ce.raw_crm_stage, '')) like '%close lost%'
        or lower(coalesce(ce.raw_crm_stage, '')) like '%closed lost%'
        or lower(coalesce(ce.booked_event_title, '')) like '(cl)%' then 'closed_lost'
      when lower(coalesce(ce.raw_crm_stage, '')) like '%res.%pending%'
        or lower(coalesce(ce.raw_crm_stage, '')) like '%reschedule%pending%'
        or lower(coalesce(ce.booked_event_title, '')) like '(rsp)%' then 'reschedule_pending'
      when lower(coalesce(ce.raw_crm_stage, '')) = 'rescheduled'
        or lower(coalesce(ce.raw_crm_stage, '')) like '%result%rescheduled%' then 'rescheduled'
      when lower(coalesce(ce.raw_crm_stage, '')) like '%canceled%'
        or lower(coalesce(ce.booked_event_title, '')) like '(can)%' then 'canceled'
      when lower(coalesce(ce.raw_crm_stage, '')) like '%meeting set%' then 'meeting_set'
      when lower(coalesce(ce.raw_crm_stage, '')) like 'spoke to%'
        or lower(coalesce(ce.raw_crm_stage, '')) like '%follow up%'
        or lower(coalesce(ce.booked_event_title, '')) like '(fu)%' then 'spoke_follow_up'
      when lower(coalesce(ce.raw_crm_stage, '')) in (
        'left voice mail 1',
        'left voicemail 1',
        'left voice mail 2',
        'left voicemail 2',
        'never spoke to'
      ) then 'voicemail'
      when lower(coalesce(ce.raw_crm_stage, '')) like '%not interested%' then 'not_interested'
      when lower(coalesce(ce.raw_crm_stage, '')) like '%no show%'
        or lower(coalesce(ce.booked_event_title, '')) like '(ns)%' then 'no_show'
      else 'needs_review'
    end as tracker_outcome,
    ce.payload_json,
    ce.created_at,
    ce.dedupe_key,
    ce.live_event_id,
    ce.source_owner,
    ce.is_tracked_owner,
    coalesce(
      nullif(ce.payload_json->>'booked_event_start', '')::timestamp at time zone 'America/New_York',
      appt.starts_at,
      ce.occurred_at
    ) as event_at,
    ce.owner_proof
  from call_events ce
  left join appointments appt
    on appt.id = coalesce(nullif(ce.live_event_id, ''), nullif(ce.appointment_id, ''))
    or appt.id = nullif(ce.appointment_id, '')
  where ce.is_tracked_owner
    and nullif(ce.source_owner, '') is not null
    and nullif(ce.owner_proof, '') is not null
),
trusted as (
  select current_row.*
  from classified current_row
  where current_row.tracker_outcome <> 'needs_review'
    and not exists (
      select 1
      from classified stronger
      where stronger.athlete_key = current_row.athlete_key
        and stronger.tracker_outcome = current_row.tracker_outcome
        and coalesce(stronger.raw_event_type, '') = coalesce(current_row.raw_event_type, '')
        and stronger.id <> current_row.id
        and current_row.dedupe_key is null
        and (
          nullif(stronger.dedupe_key, '') is not null
          or nullif(stronger.live_event_id, '') is not null
        )
        and (
          nullif(current_row.booked_event_title, '') is null
          or nullif(current_row.appointment_id, '') is null
          or nullif(stronger.appointment_id, '') = nullif(current_row.appointment_id, '')
          or nullif(stronger.live_event_id, '') = nullif(current_row.appointment_id, '')
          or lower(coalesce(stronger.booked_event_title, '')) = lower(coalesce(current_row.booked_event_title, ''))
        )
    )
),
ranked as (
  select
    trusted.*,
    row_number() over (
      partition by
        case
          when tracker_outcome in (
            'meeting_set',
            'reschedule_pending',
            'rescheduled',
            'canceled',
            'closed_won',
            'closed_lost',
            'no_show'
          ) then concat_ws(
            '|',
            athlete_key,
            tracker_outcome,
            coalesce(nullif(live_event_id, ''), nullif(appointment_id, ''), lower(coalesce(booked_event_title, '')), event_at::date::text)
          )
          when nullif(dedupe_key, '') is not null then dedupe_key
          else id::text
        end
      order by
        (revenue_cents is not null) desc,
        (booked_event_title is not null) desc,
        (live_event_id is not null) desc,
        created_at desc,
        id desc
    ) as tracker_rank
  from trusted
),
outcome_facts as (
  select
    id,
    athlete_key,
    athlete_id,
    athlete_main_id,
    athlete_name,
    occurred_at,
    source,
    raw_crm_stage,
    raw_task_status,
    raw_event_type,
    appointment_id,
    booked_event_title,
    revenue_cents,
    tracker_outcome,
    payload_json,
    created_at,
    dedupe_key,
    live_event_id,
    source_owner,
    is_tracked_owner,
    event_at,
    owner_proof
  from ranked
  where tracker_rank = 1
),
activity_facts as (
  select
    cae.id,
    cae.athlete_key,
    cae.athlete_id,
    cae.athlete_main_id,
    cae.athlete_name,
    cae.occurred_at,
    'call_activity'::text as source,
    null::text as raw_crm_stage,
    cae.activity_type as raw_task_status,
    'call_activity'::text as raw_event_type,
    null::text as appointment_id,
    cae.task_title as booked_event_title,
    null::integer as revenue_cents,
    case
      when cae.activity_type in ('call_attempt_1', 'call_attempt_2', 'call_attempt_3')
        then 'voicemail'
      when cae.activity_type = 'spoke_to_follow_up'
        then 'spoke_follow_up'
      else 'needs_review'
    end as tracker_outcome,
    cae.payload_json,
    cae.created_at,
    ('activity:' || cae.task_id)::text as dedupe_key,
    null::text as live_event_id,
    cae.source_owner,
    true as is_tracked_owner,
    cae.occurred_at as event_at,
    cae.owner_proof
  from call_activity_events cae
  cross join active_operator
  where cae.activity_type in (
    'call_attempt_1',
    'call_attempt_2',
    'call_attempt_3',
    'spoke_to_follow_up'
  )
    and (
      cae.payload_json->'materialization_proof'->>'materialization_status' = 'operator_task'
      or cae.payload_json->>'materialization_status' = 'operator_task'
      or (
        not (cae.payload_json ? 'materialization_status')
        and cae.source_owner = (select active_operator_name from active_operator)
        and nullif(cae.owner_proof, '') is not null
        and (
          not (cae.payload_json ? 'task_assigned_owner')
          or cae.payload_json->>'task_assigned_owner' = (select active_operator_name from active_operator)
        )
      )
    )
),
lifecycle_meeting_set_facts as (
  select
    le.id,
    le.athlete_key,
    le.athlete_id,
    le.athlete_main_id,
    athletes.athlete_name,
    le.created_at as occurred_at,
    coalesce(nullif(le.payload_json->>'source', ''), 'lifecycle_meeting_set') as source,
    coalesce(nullif(le.crm_stage, ''), 'Meeting Set') as raw_crm_stage,
    le.task_status as raw_task_status,
    'lifecycle_meeting_set'::text as raw_event_type,
    coalesce(
      nullif(le.payload_json->>'appointment_id', ''),
      nullif(le.payload_json->>'booked_event_id', ''),
      nullif(le.payload_json->>'source_event_id', '')
    ) as appointment_id,
    le.payload_json->>'meeting_name' as booked_event_title,
    null::integer as revenue_cents,
    'meeting_set'::text as tracker_outcome,
    le.payload_json,
    le.created_at,
    le.dedupe_key,
    null::text as live_event_id,
    coalesce(
      nullif(le.payload_json->'owner_context'->>'active_operator_name', ''),
      nullif(le.payload_json->'materialization_proof'->>'task_assigned_owner', ''),
      nullif(le.payload_json->>'task_assigned_owner', ''),
      nullif(le.payload_json->>'operator_name', '')
    ) as source_owner,
    true as is_tracked_owner,
    le.created_at as event_at,
    coalesce(
      nullif(le.payload_json->'owner_context'->>'owner_proof', ''),
      nullif(le.payload_json->>'owner_proof', ''),
      'materialization_proof.task_assigned_owner'
    ) as owner_proof
  from lifecycle_events le
  join athletes
    on athletes.athlete_key = le.athlete_key
  cross join active_operator
  where le.event_type = 'meeting_set'
    and (
      le.payload_json->'materialization_proof'->>'materialization_status' = 'operator_task'
      or le.payload_json->>'materialization_status' = 'operator_task'
      or (
        le.payload_json->>'legacy_compatibility_proof' = 'weekly_operator_task_assigned_owner'
        and coalesce(
          nullif(le.payload_json->>'task_assigned_owner', ''),
          nullif(le.payload_json->>'operator_name', '')
        ) = (select active_operator_name from active_operator)
        and nullif(le.payload_json->>'owner_proof', '') is not null
      )
    )
)
select * from outcome_facts
union all
select * from activity_facts
union all
select * from lifecycle_meeting_set_facts;

create or replace view call_tracker_meeting_sets as
with active_operator as (
  select 'Primary Operator'::text as active_operator_name
),
lifecycle_meeting_set_materialized as (
  select le.*
  from lifecycle_events le
  cross join active_operator
  where le.event_type = 'meeting_set'
    and (
      le.payload_json->'materialization_proof'->>'materialization_status' = 'operator_task'
      or le.payload_json->>'materialization_status' = 'operator_task'
      or (
        le.payload_json->>'legacy_compatibility_proof' = 'weekly_operator_task_assigned_owner'
        and coalesce(
          nullif(le.payload_json->>'task_assigned_owner', ''),
          nullif(le.payload_json->>'operator_name', '')
        ) = (select active_operator_name from active_operator)
        and nullif(le.payload_json->>'owner_proof', '') is not null
      )
    )
)
select
  le.id,
  le.athlete_key,
  le.athlete_id,
  le.athlete_main_id,
  athletes.athlete_name,
  le.created_at as occurred_at,
  le.created_at as event_at,
  'meeting_set'::text as tracker_outcome,
  coalesce(nullif(le.crm_stage, ''), 'Meeting Set') as raw_crm_stage,
  le.task_status as raw_task_status,
  'lifecycle_meeting_set'::text as raw_event_type,
  le.payload_json->>'meeting_name' as booked_event_title,
  nullif(le.payload_json->>'starts_at', '')::timestamptz as appointment_starts_at,
  le.payload_json,
  le.created_at
from lifecycle_meeting_set_materialized le
join athletes
  on athletes.athlete_key = le.athlete_key;

create or replace view call_tracker_events_owner_context
with (security_invoker = true) as
select
  cte.id,
  cte.athlete_key,
  cte.athlete_id,
  cte.athlete_main_id,
  cte.athlete_name,
  cte.occurred_at,
  cte.event_at,
  cte.source,
  cte.tracker_outcome,
  cte.raw_crm_stage,
  cte.raw_task_status,
  cte.raw_event_type,
  cte.appointment_id,
  cte.live_event_id,
  cte.booked_event_title,
  cte.revenue_cents,
  cte.dedupe_key,
  coalesce(
    cte.payload_json->'owner_context'->>'active_operator_key',
    cte.payload_json->>'active_operator_key'
  ) as active_operator_key,
  coalesce(
    cte.payload_json->'owner_context'->>'active_operator_name',
    cte.payload_json->>'active_operator_name'
  ) as active_operator_name,
  coalesce(
    cte.payload_json->'owner_context'->>'task_assigned_owner',
    cte.payload_json->>'task_assigned_owner'
  ) as task_assigned_owner,
  coalesce(
    cte.payload_json->'owner_context'->>'booked_meeting_assigned_owner',
    cte.payload_json->>'booked_meeting_assigned_owner'
  ) as booked_meeting_assigned_owner,
  coalesce(
    cte.payload_json->'owner_context'->>'resolved_owner_name',
    cte.payload_json->>'resolved_owner_name'
  ) as resolved_owner_name,
  coalesce(
    cte.payload_json->'owner_context'->>'resolved_owner_role',
    cte.payload_json->>'resolved_owner_role'
  ) as resolved_owner_role,
  coalesce(
    cte.payload_json->'owner_context'->>'resolved_from_field',
    cte.payload_json->>'resolved_from_field',
    nullif(cte.owner_proof, '')
  ) as resolved_owner_source_field,
  coalesce(
    cte.payload_json->'owner_context'->>'resolved_from_value',
    cte.payload_json->>'resolved_from_value'
  ) as resolved_owner_source_value,
  coalesce(
    cte.payload_json->'owner_context'->>'materialization_status',
    cte.payload_json->'materialization_proof'->>'materialization_status',
    cte.payload_json->>'materialization_status'
  ) as materialization_status,
  coalesce(
    cte.payload_json->'owner_context'->>'materialization_reason',
    cte.payload_json->'materialization_proof'->>'reason',
    cte.payload_json->>'materialization_reason'
  ) as materialization_reason,
  cte.source_owner as compatibility_source_owner,
  cte.owner_proof as compatibility_owner_proof,
  cte.is_tracked_owner as can_materialize_for_active_operator,
  cte.payload_json,
  cte.created_at
from call_tracker_events cte;

grant select on call_tracker_events to anon, authenticated;
grant select on call_tracker_meeting_sets to anon, authenticated;
grant select on call_tracker_events_owner_context to anon, authenticated;
