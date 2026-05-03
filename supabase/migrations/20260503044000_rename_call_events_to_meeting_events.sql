-- Rename the compatibility post-meeting outcome table to its real domain name.
--
-- call_events was an early name. The rows are meeting/post-meeting outcome
-- facts, while dials and contacts live in call_activity_events and meeting-set
-- daily tracking lives in lifecycle_events.

do $$
begin
  if to_regclass('public.meeting_events') is null
     and to_regclass('public.call_events') is not null then
    alter table public.call_events rename to meeting_events;
  end if;
end $$;

comment on table meeting_events is
  'Meeting/post-meeting outcome facts only. Dial/contact activity belongs in call_activity_events. Meeting-set daily tracking belongs in lifecycle_events.';

comment on column meeting_events.raw_event_type is
  'Domain event type for meeting outcome rows. New writes should use post_meeting_outcome, not call_activity or meeting_set.';

grant select on meeting_events to anon, authenticated;
grant select, insert, update, delete on meeting_events to service_role;

drop view if exists call_events;
create view call_events as
select * from meeting_events;

comment on view call_events is
  'Deprecated compatibility view for old readers. Use meeting_events for post-meeting outcome facts.';

grant select on call_events to anon, authenticated;
