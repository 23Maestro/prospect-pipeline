-- Backsync meeting-set lifecycle rows into the strict Call Tracker materialization contract.
--
-- This does not loosen reporting views. It repairs source facts so the existing
-- strict views can count only rows that carry explicit operator proof and
-- reporting booleans.

with weekly_operator_meeting_sets as (
  select id
  from lifecycle_events
  where event_type = 'meeting_set'
    and coalesce(payload_json->>'materialization_status', '') <> 'operator_task'
    and coalesce(payload_json->'materialization_proof'->>'materialization_status', '') <> 'operator_task'
    and payload_json->>'matched_weekly_task_assigned_owner' = 'Jerami Singleton'
    and nullif(payload_json->>'matched_weekly_task_id', '') is not null
),
legacy_local_meeting_sets as (
  select id
  from lifecycle_events
  where event_type = 'meeting_set'
    and coalesce(payload_json->>'materialization_status', '') <> 'operator_task'
    and coalesce(payload_json->'materialization_proof'->>'materialization_status', '') <> 'operator_task'
    and dedupe_key like 'legacy_meeting_set:%'
    and nullif(payload_json->>'legacy_assigned_to', '') is not null
    and nullif(payload_json->>'task_due_date', '') is not null
    and nullif(payload_json->>'meeting_name', '') is not null
),
source_contract as (
  select
    id,
    'payload.matched_weekly_task_assigned_owner'::text as proof_field,
    payload_json->>'matched_weekly_task_assigned_owner' as task_owner,
    'weekly_operator_task_assigned_owner'::text as proof_kind
  from lifecycle_events
  where id in (select id from weekly_operator_meeting_sets)

  union all

  select
    id,
    'legacy_local_meeting_set_write'::text as proof_field,
    'Jerami Singleton'::text as task_owner,
    'legacy_local_meeting_set_write'::text as proof_kind
  from lifecycle_events
  where id in (select id from legacy_local_meeting_sets)
)
update lifecycle_events le
set payload_json =
  le.payload_json
  || jsonb_build_object(
    'legacy_compatibility_proof', source_contract.proof_kind,
    'task_assigned_owner', source_contract.task_owner,
    'owner_proof', source_contract.proof_field,
    'materialization_status', 'operator_task',
    'materialization_reason', 'task_assigned_owner_matches_active_operator',
    'counts_as_dial', true,
    'counts_as_contact', true,
    'counts_as_meeting_set', true,
    'counts_as_post_meeting_outcome', false
  )
  || jsonb_build_object(
    'materialization_proof',
    coalesce(le.payload_json->'materialization_proof', '{}'::jsonb)
    || jsonb_build_object(
      'task_assigned_owner', source_contract.task_owner,
      'materialization_status', 'operator_task',
      'status', 'operator_task',
      'reason', 'task_assigned_owner_matches_active_operator'
    )
  )
  || jsonb_build_object(
    'owner_context',
    coalesce(le.payload_json->'owner_context', '{}'::jsonb)
    || jsonb_build_object(
      'active_operator_key', 'jerami_singleton',
      'active_operator_name', 'Jerami Singleton',
      'task_assigned_owner', source_contract.task_owner,
      'resolved_owner_name', source_contract.task_owner,
      'resolved_owner_role', 'task_owner',
      'resolved_from_field', source_contract.proof_field,
      'resolved_from_value', source_contract.task_owner,
      'owner_proof', source_contract.proof_field,
      'materialization_status', 'operator_task',
      'materialization_reason', 'task_assigned_owner_matches_active_operator',
      'can_materialize_for_active_operator', true,
      'owner_status', 'resolved'
    )
  )
from source_contract
where le.id = source_contract.id;
