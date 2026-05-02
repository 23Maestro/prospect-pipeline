alter table lifecycle_events
  add column if not exists previous_crm_stage text,
  add column if not exists previous_task_status text;

create index if not exists lifecycle_events_athlete_event_created_idx
  on lifecycle_events (athlete_key, event_type, created_at desc);

create index if not exists lifecycle_events_transition_stage_idx
  on lifecycle_events (previous_crm_stage, crm_stage, created_at desc)
  where previous_crm_stage is not null;
