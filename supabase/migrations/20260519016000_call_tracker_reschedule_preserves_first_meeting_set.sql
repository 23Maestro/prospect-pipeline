create or replace view call_tracker_events_owner_context
with (security_invoker = true) as
with events_with_reporting_clock as (
  select
    cte.*,
    case
      when cte.counts_as_post_meeting_outcome then coalesce(cte.event_at, cte.occurred_at)
      else cte.occurred_at
    end as reporting_at
  from call_tracker_events cte
)
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
  cte.counts_as_post_meeting_outcome,
  cte.reporting_at,
  (cte.reporting_at at time zone 'America/New_York')::date as reporting_date_et
from events_with_reporting_clock cte;

grant select on call_tracker_events_owner_context to anon, authenticated;

with first_rescheduled_meeting_sets as (
  select le.id
  from lifecycle_events le
  where le.event_type = 'meeting_set'
    and lower(coalesce(
      le.crm_stage,
      le.payload_json->>'raw_crm_stage',
      le.payload_json->'call_tracker_event'->>'raw_crm_stage',
      le.payload_json->>'selected_sales_stage',
      ''
    )) in (
      'rescheduled',
      'meeting result - rescheduled',
      'meeting result - res. pending',
      'reschedule pending',
      'rescheduled pending'
    )
    and not exists (
      select 1
      from lifecycle_events earlier
      where earlier.event_type = 'meeting_set'
        and earlier.athlete_key = le.athlete_key
        and earlier.created_at < le.created_at
        and (
          lower(coalesce(earlier.payload_json->>'counts_as_meeting_set', 'false')) = 'true'
          or lower(coalesce(
            earlier.crm_stage,
            earlier.payload_json->>'raw_crm_stage',
            earlier.payload_json->'call_tracker_event'->>'raw_crm_stage',
            earlier.payload_json->>'selected_sales_stage',
            ''
          )) = 'meeting set'
        )
    )
)
update lifecycle_events le
set payload_json = jsonb_set(
  jsonb_set(
    jsonb_set(
      coalesce(le.payload_json, '{}'::jsonb),
      '{counts_as_dial}',
      'true'::jsonb,
      true
    ),
    '{counts_as_contact}',
    'true'::jsonb,
    true
  ),
  '{counts_as_meeting_set}',
  'true'::jsonb,
  true
)
from first_rescheduled_meeting_sets first_rows
where le.id = first_rows.id;
