create or replace view call_tracker_meeting_sets as
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
from lifecycle_events le
join athletes
  on athletes.athlete_key = le.athlete_key
where le.event_type = 'meeting_set';

grant select on call_tracker_meeting_sets to anon, authenticated;
