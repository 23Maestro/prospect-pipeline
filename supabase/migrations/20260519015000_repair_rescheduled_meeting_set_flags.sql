update lifecycle_events
set payload_json = jsonb_set(
  jsonb_set(
    jsonb_set(
      coalesce(payload_json, '{}'::jsonb),
      '{counts_as_dial}',
      'false'::jsonb,
      true
    ),
    '{counts_as_contact}',
    'false'::jsonb,
    true
  ),
  '{counts_as_meeting_set}',
  'false'::jsonb,
  true
)
where event_type = 'meeting_set'
  and lower(coalesce(
    crm_stage,
    payload_json->>'raw_crm_stage',
    payload_json->'call_tracker_event'->>'raw_crm_stage',
    payload_json->>'selected_sales_stage',
    ''
  )) in (
    'rescheduled',
    'meeting result - rescheduled',
    'meeting result - res. pending',
    'reschedule pending',
    'rescheduled pending'
  );
