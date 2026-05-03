-- Call Tracker counting contract.
-- Reporting uses explicit booleans, not activity_kind and not browser-side outcome guesses.
-- Older rows remain compatible through CASE normalization in these views.

create or replace view call_tracker_events as
with active_operator as (
  select 'Jerami Singleton'::text as active_operator_name
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
      when lower(coalesce(ce.raw_crm_stage, '')) in (
        'left voice mail 1',
        'left voicemail 1',
        'left voice mail 2',
        'left voicemail 2',
        'never spoke to'
      ) then 'voicemail'
      when lower(coalesce(ce.raw_crm_stage, '')) like '%called%unable%leave%vm%'
        or lower(coalesce(ce.raw_crm_stage, '')) like '%unable%leave%vm%' then 'unable_to_leave_vm'
      when lower(coalesce(ce.raw_crm_stage, '')) like '%not interested%' then 'not_interested'
      when lower(coalesce(ce.raw_crm_stage, '')) like 'spoke to%'
        or lower(coalesce(ce.raw_crm_stage, '')) like '%follow up%'
        or lower(coalesce(ce.booked_event_title, '')) like '(fu)%' then 'spoke_follow_up'
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
activity_normalized as (
  select
    cae.*,
    case
      when coalesce(nullif(cae.activity_subtype, ''), nullif(cae.activity_type, '')) in ('call_attempt_1', 'call_attempt_2', 'call_attempt_3')
        then coalesce(nullif(cae.activity_subtype, ''), nullif(cae.activity_type, ''))
      when coalesce(nullif(cae.activity_subtype, ''), nullif(cae.activity_type, '')) = 'call_attempt'
        and lower(coalesce(cae.task_title, '')) like '%call attempt 2%' then 'call_attempt_2'
      when coalesce(nullif(cae.activity_subtype, ''), nullif(cae.activity_type, '')) = 'call_attempt'
        and lower(coalesce(cae.task_title, '')) like '%call attempt 3%' then 'call_attempt_3'
      when coalesce(nullif(cae.activity_subtype, ''), nullif(cae.activity_type, '')) = 'call_attempt'
        then 'call_attempt_1'
      when coalesce(nullif(cae.activity_subtype, ''), nullif(cae.activity_type, '')) in ('spoke_to_follow_up', 'spoke_follow_up')
        then 'spoke_to_follow_up'
      when coalesce(nullif(cae.activity_subtype, ''), nullif(cae.activity_type, '')) in ('unable_to_leave_vm', 'called_unable_to_leave_vm')
        or lower(coalesce(cae.task_title, '')) like '%unable%leave%vm%' then 'unable_to_leave_vm'
      when coalesce(nullif(cae.activity_subtype, ''), nullif(cae.activity_type, '')) = 'spoke_to_not_interested'
        or lower(coalesce(cae.task_title, '')) like '%not interested%' then 'spoke_to_not_interested'
      when coalesce(nullif(cae.activity_subtype, ''), nullif(cae.activity_type, '')) = 'spoke_to_athlete_not_parent'
        or lower(coalesce(cae.task_title, '')) like '%athlete%not%parent%' then 'spoke_to_athlete_not_parent'
      when coalesce(nullif(cae.activity_subtype, ''), nullif(cae.activity_type, '')) = 'spoke_to_too_young'
        or lower(coalesce(cae.task_title, '')) like '%too young%' then 'spoke_to_too_young'
      else coalesce(nullif(cae.activity_subtype, ''), nullif(cae.activity_type, ''))
    end as normalized_activity_status
  from call_activity_events cae
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
    cae.normalized_activity_status as raw_task_status,
    'call_activity'::text as raw_event_type,
    null::text as appointment_id,
    cae.task_title as booked_event_title,
    null::integer as revenue_cents,
    case
      when cae.normalized_activity_status in ('call_attempt_1', 'call_attempt_2', 'call_attempt_3')
        then 'voicemail'
      when cae.normalized_activity_status = 'unable_to_leave_vm'
        then 'unable_to_leave_vm'
      when cae.normalized_activity_status = 'spoke_to_not_interested'
        then 'not_interested'
      when cae.normalized_activity_status in ('spoke_to_follow_up', 'spoke_to_athlete_not_parent', 'spoke_to_too_young')
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
  from activity_normalized cae
  cross join active_operator
  where cae.normalized_activity_status in (
    'call_attempt_1',
    'call_attempt_2',
    'call_attempt_3',
    'unable_to_leave_vm',
    'spoke_to_follow_up',
    'spoke_to_not_interested',
    'spoke_to_athlete_not_parent',
    'spoke_to_too_young'
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
),
unified_events as (
  select * from outcome_facts
  union all
  select * from activity_facts
  union all
  select * from lifecycle_meeting_set_facts
)
select
  unified_events.*,
  case
    when unified_events.payload_json ? 'counts_as_dial' then (unified_events.payload_json->>'counts_as_dial')::boolean
    when unified_events.tracker_outcome = 'meeting_set' then true
    when unified_events.raw_event_type = 'call_activity'
      and unified_events.tracker_outcome in ('voicemail', 'unable_to_leave_vm', 'spoke_follow_up', 'not_interested') then true
    when lower(coalesce(unified_events.raw_crm_stage, '')) in (
      'left voice mail 1',
      'left voicemail 1',
      'left voice mail 2',
      'left voicemail 2',
      'never spoke to'
    ) then true
    when lower(coalesce(unified_events.raw_crm_stage, '')) like '%called%unable%leave%vm%' then true
    when lower(coalesce(unified_events.raw_crm_stage, '')) like 'spoke to%' then true
    else false
  end as counts_as_dial,
  case
    when unified_events.payload_json ? 'counts_as_contact' then (unified_events.payload_json->>'counts_as_contact')::boolean
    when unified_events.tracker_outcome = 'meeting_set' then true
    when unified_events.raw_event_type = 'call_activity'
      and unified_events.tracker_outcome in ('spoke_follow_up', 'not_interested') then true
    when lower(coalesce(unified_events.raw_crm_stage, '')) like 'spoke to%' then true
    else false
  end as counts_as_contact,
  case
    when unified_events.payload_json ? 'counts_as_meeting_set' then (unified_events.payload_json->>'counts_as_meeting_set')::boolean
    when unified_events.tracker_outcome = 'meeting_set' then true
    else false
  end as counts_as_meeting_set,
  case
    when unified_events.payload_json ? 'counts_as_post_meeting_outcome' then (unified_events.payload_json->>'counts_as_post_meeting_outcome')::boolean
    when unified_events.tracker_outcome in ('closed_won', 'closed_lost', 'reschedule_pending', 'rescheduled', 'canceled', 'no_show') then true
    else false
  end as counts_as_post_meeting_outcome
from unified_events;

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
  cte.created_at,
  cte.counts_as_dial,
  cte.counts_as_contact,
  cte.counts_as_meeting_set,
  cte.counts_as_post_meeting_outcome
from call_tracker_events cte;

create or replace view call_tracker_summary as
select
  count(*)::integer as total_events,
  count(*) filter (
    where tracker_outcome in (
      'spoke_follow_up',
      'meeting_set',
      'reschedule_pending',
      'rescheduled',
      'canceled',
      'closed_won',
      'closed_lost',
      'not_interested'
    )
  )::integer as spoke_with,
  count(*) filter (where tracker_outcome = 'voicemail')::integer as voicemail_only,
  count(*) filter (where counts_as_meeting_set)::integer as meetings_set,
  count(*) filter (where tracker_outcome = 'reschedule_pending')::integer as reschedule_pending,
  count(*) filter (where tracker_outcome = 'closed_won')::integer as closed_won,
  coalesce(sum(revenue_cents) filter (where tracker_outcome = 'closed_won'), 0)::integer as money_earned_cents,
  min(occurred_at) as first_event_at,
  max(occurred_at) as last_event_at,
  count(distinct appointment_id) filter (where appointment_id is not null)::integer as appointments_tracked,
  count(*) filter (where counts_as_post_meeting_outcome)::integer as meeting_outcomes_total,
  count(*) filter (where tracker_outcome = 'rescheduled')::integer as rescheduled,
  count(*) filter (where tracker_outcome = 'canceled')::integer as canceled,
  count(*) filter (where tracker_outcome = 'no_show')::integer as no_show,
  count(*) filter (where tracker_outcome = 'needs_review')::integer as needs_review,
  count(*) filter (where counts_as_dial)::integer as dials,
  count(*) filter (where counts_as_contact)::integer as contacts
from call_tracker_events;

grant select on call_tracker_events to anon, authenticated;
grant select on call_tracker_events_owner_context to anon, authenticated;
grant select on call_tracker_summary to anon, authenticated;
