-- Canonical owner-context names for call tracker reads.
-- Existing write columns stay as compatibility output from the domain fact builders.

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
  cte.payload_json->>'active_operator_key' as active_operator_key,
  cte.payload_json->>'active_operator_name' as active_operator_name,
  cte.payload_json->>'task_assigned_owner' as task_assigned_owner,
  cte.payload_json->>'booked_meeting_assigned_owner' as booked_meeting_assigned_owner,
  cte.payload_json->>'resolved_owner_name' as resolved_owner_name,
  cte.payload_json->>'resolved_owner_role' as resolved_owner_role,
  coalesce(nullif(cte.payload_json->>'resolved_from_field', ''), nullif(cte.owner_proof, '')) as resolved_owner_source_field,
  cte.payload_json->>'resolved_from_value' as resolved_owner_source_value,
  cte.payload_json->>'materialization_status' as materialization_status,
  cte.payload_json->>'materialization_reason' as materialization_reason,
  cte.source_owner as compatibility_source_owner,
  cte.owner_proof as compatibility_owner_proof,
  cte.is_tracked_owner as can_materialize_for_active_operator,
  cte.payload_json,
  cte.created_at
from call_tracker_events cte;

create index if not exists call_events_materialization_reason_idx
  on call_events ((payload_json->>'materialization_reason'), occurred_at desc)
  where payload_json ? 'materialization_reason';

create index if not exists call_activity_events_materialization_reason_idx
  on call_activity_events ((payload_json->>'materialization_reason'), occurred_at desc)
  where payload_json ? 'materialization_reason';

create index if not exists call_events_resolved_owner_role_idx
  on call_events ((payload_json->>'resolved_owner_role'), occurred_at desc)
  where payload_json ? 'resolved_owner_role';

create index if not exists call_activity_events_resolved_owner_role_idx
  on call_activity_events ((payload_json->>'resolved_owner_role'), occurred_at desc)
  where payload_json ? 'resolved_owner_role';

grant select on call_tracker_events_owner_context to anon, authenticated;
