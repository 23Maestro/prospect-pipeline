alter table call_events
  add column if not exists source_owner text,
  add column if not exists is_tracked_owner boolean not null default true;

update call_events
set
  source_owner = coalesce(source_owner, 'Head Scout F'),
  is_tracked_owner = false
where athlete_key = '1489782:951614'
  and appointment_id = '613317';

create or replace view call_tracker_events as
select
  ce.id,
  ce.athlete_key,
  ce.athlete_id,
  ce.athlete_main_id,
  ce.athlete_name,
  ce.occurred_at,
  ce.source,
  ce.raw_crm_stage,
  ce.raw_task_status,
  ce.raw_event_type,
  ce.appointment_id,
  ce.booked_event_title,
  ce.revenue_cents,
  case
    when lower(coalesce(ce.raw_crm_stage, '')) like '%close won%'
      or lower(coalesce(ce.raw_crm_stage, '')) like '%closed won%'
      or lower(coalesce(ce.booked_event_title, '')) like '(enr%' then 'closed_won'
    when lower(coalesce(ce.raw_crm_stage, '')) like '%close lost%'
      or lower(coalesce(ce.raw_crm_stage, '')) like '%closed lost%'
      or lower(coalesce(ce.booked_event_title, '')) like '(cl)%' then 'closed_lost'
    when lower(coalesce(ce.raw_crm_stage, '')) like '%res.%pending%'
      or lower(coalesce(ce.raw_crm_stage, '')) like '%reschedule%pending%'
      or lower(coalesce(ce.booked_event_title, '')) like '(rsp)%' then 'reschedule_pending'
    when lower(coalesce(ce.raw_crm_stage, '')) like '%meeting set%' then 'meeting_set'
    when lower(coalesce(ce.raw_crm_stage, '')) like '%follow up%' then 'spoke_follow_up'
    when lower(coalesce(ce.raw_crm_stage, '')) like '%voice mail%'
      or lower(coalesce(ce.raw_task_status, '')) like '%call_attempt%'
      or lower(coalesce(ce.raw_task_status, '')) like '%call attempt%' then 'voicemail'
    when lower(coalesce(ce.raw_crm_stage, '')) like '%not interested%' then 'not_interested'
    when lower(coalesce(ce.raw_crm_stage, '')) like '%no show%'
      or lower(coalesce(ce.booked_event_title, '')) like '(ns)%' then 'no_show'
    else 'needs_review'
  end as tracker_outcome,
  ce.payload_json,
  ce.created_at,
  ce.dedupe_key,
  ce.live_event_id,
  ce.source_owner,
  ce.is_tracked_owner
from call_events ce
where ce.is_tracked_owner;

create or replace view call_tracker_summary as
select
  count(*)::integer as total_events,
  count(*) filter (where tracker_outcome in ('spoke_follow_up', 'meeting_set', 'reschedule_pending', 'closed_won', 'closed_lost', 'not_interested'))::integer as spoke_with,
  count(*) filter (where tracker_outcome = 'voicemail')::integer as voicemail_only,
  count(*) filter (where tracker_outcome = 'meeting_set')::integer as meetings_set,
  count(*) filter (where tracker_outcome = 'reschedule_pending')::integer as reschedule_pending,
  count(*) filter (where tracker_outcome = 'closed_won')::integer as closed_won,
  coalesce(sum(revenue_cents) filter (where tracker_outcome = 'closed_won'), 0)::integer as money_earned_cents,
  min(occurred_at) as first_event_at,
  max(occurred_at) as last_event_at
from call_tracker_events;
