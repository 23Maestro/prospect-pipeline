-- Keep call activity raw CRM stage event-sourced.
-- The prior repair may have populated older rows from mutable pipeline state;
-- remove those inferred values unless the activity payload itself carried stage.

update call_activity_events
set
  raw_crm_stage = null,
  payload_json = payload_json - 'raw_crm_stage',
  updated_at = now()
where nullif(payload_json->>'selected_sales_stage', '') is null
  and nullif(payload_json->>'raw_crm_stage', '') is not null;
