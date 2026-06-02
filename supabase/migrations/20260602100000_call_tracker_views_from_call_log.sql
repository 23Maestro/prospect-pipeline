-- Repoint Call Tracker compatibility views to canonical call_log.
--
-- This keeps the Prospect Web API contract stable while moving read truth to
-- call_log. Old split tables remain in place until source writers migrate and
-- active repo references are gone.

create or replace view public.call_tracker_events as
select
  cl.id,
  cl.athlete_key,
  cl.athlete_id,
  cl.athlete_main_id,
  cl.athlete_name,
  cl.occurred_at,
  cl.source_system as source,
  cl.raw_crm_stage,
  cl.raw_task_status,
  cl.raw_event_type,
  cl.appointment_id,
  cl.booked_event_title,
  cl.revenue_cents,
  cl.tracker_outcome,
  cl.payload_json,
  cl.created_at,
  cl.dedupe_key,
  cl.live_event_id,
  cl.source_owner,
  cl.can_materialize_for_active_operator as is_tracked_owner,
  cl.event_at,
  cl.owner_proof,
  cl.counts_as_dial,
  cl.counts_as_contact,
  cl.counts_as_meeting_set,
  cl.counts_as_post_meeting_outcome,
  cl.reporting_at,
  (cl.reporting_at at time zone 'America/New_York')::date as reporting_date_et
from public.call_log cl;

create or replace view public.call_tracker_events_owner_context
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
  cte.counts_as_post_meeting_outcome,
  cte.reporting_at,
  cte.reporting_date_et
from public.call_tracker_events cte;

create or replace view public.call_tracker_summary as
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
from public.call_tracker_events;

grant select on public.call_tracker_events to anon, authenticated;
grant select on public.call_tracker_events_owner_context to anon, authenticated;
grant select on public.call_tracker_summary to anon, authenticated;
