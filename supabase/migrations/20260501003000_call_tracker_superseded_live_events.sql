update call_events old_event
set
  is_tracked_owner = false,
  source_owner = coalesce(old_event.source_owner, 'superseded_live_event')
where old_event.source = 'legacy_sales_stage_current'
  and old_event.raw_event_type = 'sales_stage_reconciled'
  and old_event.live_event_id is null
  and exists (
    select 1
    from call_events live_event
    where live_event.source = old_event.source
      and live_event.raw_event_type = old_event.raw_event_type
      and live_event.athlete_key = old_event.athlete_key
      and coalesce(live_event.appointment_id, '') = coalesce(old_event.appointment_id, '')
      and live_event.live_event_id is not null
      and live_event.created_at >= old_event.created_at
  );
