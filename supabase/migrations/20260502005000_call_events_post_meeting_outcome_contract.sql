comment on table call_events is
  'Compatibility table for post-meeting outcome facts only. Dial/contact activity belongs in call_activity_events. Meeting-set daily tracking belongs in lifecycle_events where event_type = meeting_set.';

comment on column call_events.raw_event_type is
  'Domain event type for compatibility call_events rows. New writes should use post_meeting_outcome, not call_activity or meeting_set.';
