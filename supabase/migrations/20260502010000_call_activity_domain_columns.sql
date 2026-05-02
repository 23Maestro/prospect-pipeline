alter table call_activity_events
  add column if not exists activity_kind text,
  add column if not exists activity_subtype text;

update call_activity_events
set
  activity_kind = coalesce(
    activity_kind,
    nullif(payload_json->>'activity_kind', ''),
    case
      when activity_type in ('call_attempt_1', 'call_attempt_2', 'call_attempt_3') then 'dial'
      when activity_type = 'spoke_to_follow_up' then 'contact'
      else null
    end
  ),
  activity_subtype = coalesce(activity_subtype, nullif(payload_json->>'activity_subtype', ''), activity_type)
where activity_kind is null
   or activity_subtype is null;

create index if not exists call_activity_events_activity_kind_idx
  on call_activity_events (activity_kind, occurred_at desc);

comment on column call_activity_events.activity_kind is
  'Domain activity bucket for dashboard math. Dial/contact counts come from call_activity_events, not call_events.';

comment on column call_activity_events.activity_subtype is
  'Domain activity subtype normalized from task status, such as call_attempt_1 or spoke_to_follow_up.';
