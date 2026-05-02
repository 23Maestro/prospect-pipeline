-- One-time normalization from deprecated current-pipeline lifecycle snapshots.
--
-- Current contract:
--   lifecycle_events.event_type = 'meeting_set' is the canonical "became Meeting Set" fact.
--   lifecycle_events.created_at on that row is the daily tracking clock.
--   pipeline_task_backfill_current is not a tracker event going forward.
--
-- Historical reason for this migration:
--   older cron runs wrote pipeline_task_backfill_current rows that already proved
--   crm_stage = Meeting Set, task_status = confirmation_call, current_meeting present,
--   current_appointment_id present, and assigned_owner = Jerami Singleton.
--   Some newer canonical meeting_set rows were inserted later by booked-meeting sync,
--   so their created_at reflected sync time instead of the first observed transition time.

with evidence as (
  select
    athlete_key,
    coalesce(
      nullif(payload_json->>'current_appointment_id', ''),
      nullif(payload_json#>>'{current_meeting,event_id}', ''),
      nullif(payload_json->>'appointment_id', ''),
      nullif(payload_json->>'booked_event_id', '')
    ) as appointment_id,
    min(created_at) as first_observed_at
  from lifecycle_events
  where event_type = 'pipeline_task_backfill_current'
    and lower(coalesce(crm_stage, '')) = 'meeting set'
    and task_status = 'confirmation_call'
    and coalesce(
      nullif(payload_json->>'current_appointment_id', ''),
      nullif(payload_json#>>'{current_meeting,event_id}', ''),
      nullif(payload_json->>'appointment_id', ''),
      nullif(payload_json->>'booked_event_id', '')
    ) is not null
  group by
    athlete_key,
    coalesce(
      nullif(payload_json->>'current_appointment_id', ''),
      nullif(payload_json#>>'{current_meeting,event_id}', ''),
      nullif(payload_json->>'appointment_id', ''),
      nullif(payload_json->>'booked_event_id', '')
    )
)
update lifecycle_events le
set created_at = evidence.first_observed_at
from evidence
where le.event_type = 'meeting_set'
  and le.athlete_key = evidence.athlete_key
  and coalesce(
    nullif(le.payload_json->>'appointment_id', ''),
    nullif(le.payload_json->>'booked_event_id', ''),
    nullif(le.payload_json->>'source_event_id', '')
  ) = evidence.appointment_id
  and evidence.first_observed_at < le.created_at;
