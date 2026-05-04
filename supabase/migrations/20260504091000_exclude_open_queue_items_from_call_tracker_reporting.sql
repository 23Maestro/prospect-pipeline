-- Suppressed open queue items can remain in call_activity_events for audit/debugging,
-- but they are not call tracker reporting rows.

update call_activity_events
set
  payload_json =
    jsonb_set(
      jsonb_set(
        payload_json - 'materialization_status' - 'owner_status',
        '{owner_context}',
        coalesce(payload_json->'owner_context', '{}'::jsonb)
          - 'materialization_status'
          - 'materialization_reason'
          - 'owner_status',
        true
      ),
      '{materialization_proof}',
      coalesce(payload_json->'materialization_proof', '{}'::jsonb)
        - 'materialization_status'
        - 'status'
        - 'reason',
      true
    )
    || jsonb_build_object(
      'materialization_reason', 'open_new_opportunity_queue_item_not_call_activity',
      'queue_item_status', 'open_queue_item',
      'counts_as_dial', false,
      'counts_as_contact', false,
      'counts_as_meeting_set', false,
      'counts_as_post_meeting_outcome', false,
      'suppressed_from_call_activity_reporting', true,
      'repair_reason', 'open queue current-pipeline task is not a completed dial fact'
    ),
  updated_at = now()
where payload_json->>'source' = 'scout_tasks_current_pipeline'
  and nullif(payload_json->>'completion_at', '') is null
  and (
    payload_json->>'suppressed_from_call_activity_reporting' = 'true'
    or payload_json->>'materialization_reason' = 'missing_completion_date_for_call_activity'
    or payload_json->'owner_context'->>'materialization_reason' = 'missing_completion_date_for_call_activity'
    or payload_json->'materialization_proof'->>'reason' = 'missing_completion_date_for_call_activity'
  );

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
from call_tracker_events cte
where coalesce((cte.payload_json->>'suppressed_from_call_activity_reporting')::boolean, false) = false;

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
from call_tracker_events
where coalesce((payload_json->>'suppressed_from_call_activity_reporting')::boolean, false) = false;

grant select on call_tracker_events_owner_context to anon, authenticated;
grant select on call_tracker_summary to anon, authenticated;
