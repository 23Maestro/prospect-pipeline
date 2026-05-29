-- Canonical athlete lifecycle read models.
-- Raw lifecycle_events is audit storage; browser/reporting surfaces should read these views.

create or replace view public.athlete_lifecycle_timeline as
with lifecycle_source as (
  select
    le.id as lifecycle_event_id,
    le.athlete_key,
    le.athlete_id,
    le.athlete_main_id,
    athlete.athlete_name,
    le.event_type,
    le.previous_crm_stage,
    le.previous_task_status,
    le.crm_stage as raw_crm_stage,
    le.task_status as raw_task_status,
    coalesce(nullif(le.crm_stage, ''), nullif(le.task_status, ''), le.event_type) as lifecycle_text,
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(nullif(le.crm_stage, ''), nullif(le.task_status, ''), le.event_type)), '\s*[-–—]\s*', ' ', 'g'),
        '[.,:]+',
        ' ',
        'g'
      ),
      '\s+',
      ' ',
      'g'
    ) as normalized_text,
    coalesce(
      nullif(le.payload_json->>'appointment_id', ''),
      nullif(le.payload_json->>'booked_event_id', ''),
      nullif(le.payload_json->>'source_event_id', '')
    ) as appointment_id,
    coalesce(
      nullif(le.payload_json->>'booked_event_title', ''),
      nullif(le.payload_json->>'meeting_name', ''),
      nullif(le.payload_json->>'task_title', '')
    ) as event_title,
    coalesce(
      nullif(le.payload_json->>'operator_name', ''),
      nullif(le.payload_json->>'task_assigned_owner', ''),
      nullif(le.payload_json->'owner_context'->>'task_assigned_owner', ''),
      nullif(le.payload_json->'materialization_proof'->>'task_assigned_owner', '')
    ) as operator_owner,
    coalesce(
      nullif(le.payload_json->>'head_scout', ''),
      nullif(le.payload_json->>'booked_meeting_assigned_owner', ''),
      nullif(le.payload_json->'owner_context'->>'booked_meeting_assigned_owner', '')
    ) as head_scout,
    nullif(le.payload_json->>'source', '') as event_source,
    case
      when nullif(le.payload_json->>'revenue_cents', '') ~ '^[0-9]+$'
        then (le.payload_json->>'revenue_cents')::integer
      else null
    end as revenue_cents,
    le.payload_json,
    le.created_at as event_at
  from public.lifecycle_events le
  left join public.athletes athlete
    on athlete.athlete_key = le.athlete_key
),
classified as (
  select
    lifecycle_source.*,
    case
      when normalized_text = 'new opportunity' then 'new_opportunity'
      when normalized_text in (
        'left voice mail 1',
        'left voicemail 1',
        'left voice mail 2',
        'left voicemail 2',
        'never spoke to',
        'called unable to leave vm',
        'unable to leave vm',
        'spoke to athlete not parent',
        'athlete not parent'
      ) then 'call_attempt'
      when normalized_text like '%closed won%' or normalized_text like '%close won%' then 'closed_won'
      when normalized_text like '%closed lost%' or normalized_text like '%close lost%' then 'closed_lost'
      when normalized_text like '%inactive%'
        or normalized_text like '%dead lead%'
        or normalized_text like '%archived%'
        or normalized_text like '%not interested%'
        or normalized_text like '%too young%' then 'inactive'
      when normalized_text like '%no show%' or normalized_text like '%noshow%' then 'no_show'
      when normalized_text like '%reschedule pending%'
        or normalized_text like '%rescheduled pending%'
        or normalized_text like '%meeting result res pending%'
        or normalized_text like '%meeting result canceled%'
        or normalized_text like '%actual meeting canceled%' then 'reschedule_pending'
      when normalized_text like '%meeting result rescheduled%'
        or normalized_text like '%actual meeting rescheduled%'
        or normalized_text = 'rescheduled' then 'rescheduled'
      when normalized_text = 'meeting set' then 'meeting_set'
      when normalized_text like '%actual meeting follow up%'
        or normalized_text like '%spoke to i need to follow up%'
        or normalized_text like '%spoke to follow up%'
        or normalized_text like '%meeting follow up%'
        or normalized_text like '%follow-up%'
        or normalized_text like '%follow up%'
        or normalized_text like '%awaiting close%'
        or normalized_text like '%close pending%' then 'meeting_follow_up'
      else 'unknown'
    end as normalized_stage
  from lifecycle_source
)
select
  lifecycle_event_id,
  athlete_key,
  athlete_id,
  athlete_main_id,
  coalesce(athlete_name, payload_json->>'athlete_name', payload_json->>'name') as athlete_name,
  event_type,
  previous_crm_stage,
  previous_task_status,
  raw_crm_stage,
  raw_task_status,
  normalized_stage,
  case
    when normalized_stage in ('new_opportunity', 'call_attempt') then 'active_call_queue'
    when normalized_stage in ('meeting_set', 'rescheduled') then 'active_meeting_queue'
    when normalized_stage = 'reschedule_pending' then 'awaiting_reschedule'
    when normalized_stage = 'meeting_follow_up' then 'awaiting_follow_up'
    when normalized_stage = 'closed_won' then 'won'
    when normalized_stage = 'closed_lost' then 'lost'
    when normalized_stage = 'no_show' then 'no_show'
    when normalized_stage = 'inactive' then 'inactive'
    else 'needs_manual_review'
  end as operator_status,
  case
    when normalized_stage in ('new_opportunity', 'call_attempt') then 'not_set'
    when normalized_stage = 'meeting_set' then 'scheduled'
    when normalized_stage = 'reschedule_pending' then 'reschedule_pending'
    when normalized_stage = 'rescheduled' then 'rescheduled'
    when normalized_stage = 'no_show' then 'no_show'
    when normalized_stage = 'meeting_follow_up' then 'follow_up_due'
    when normalized_stage = 'closed_won' then 'closed_won'
    when normalized_stage = 'closed_lost' then 'closed_lost'
    when normalized_stage = 'inactive' then 'inactive'
    else 'needs_manual_review'
  end as meeting_lifecycle,
  case
    when normalized_stage = 'closed_won' then 'enrolled'
    when normalized_stage = 'closed_lost' then 'closed_lost'
    when normalized_stage = 'inactive' then 'inactive'
    when normalized_stage = 'reschedule_pending' then 'awaiting_reschedule'
    when normalized_stage = 'meeting_follow_up' then 'awaiting_update'
    when normalized_stage = 'no_show' then 'monitor_no_show'
    when normalized_stage in ('meeting_set', 'rescheduled') then 'active_meeting'
    when normalized_stage in ('new_opportunity', 'call_attempt') then 'active_calling'
    else 'needs_manual_review'
  end as pipeline_bucket,
  case
    when normalized_stage = 'closed_won' then 'tally_enrollment_revenue'
    when normalized_stage = 'closed_lost' then 'drop_from_pipeline'
    when normalized_stage = 'inactive' then 'archive_inactive'
    when normalized_stage = 'reschedule_pending' then 'reschedule_client'
    when normalized_stage = 'meeting_follow_up' then 'follow_up_for_result'
    when normalized_stage = 'no_show' then 'monitor_or_reschedule'
    when normalized_stage in ('meeting_set', 'rescheduled') then 'await_meeting_result'
    when normalized_stage in ('new_opportunity', 'call_attempt') then 'continue_calling'
    else 'manual_review'
  end as next_action,
  normalized_stage in ('meeting_set', 'rescheduled', 'reschedule_pending', 'meeting_follow_up', 'no_show', 'new_opportunity', 'call_attempt') as is_active_or_monitoring,
  normalized_stage in ('closed_won', 'closed_lost', 'inactive') as is_terminal,
  normalized_stage in ('closed_won', 'closed_lost', 'reschedule_pending', 'meeting_follow_up') as indicates_showed,
  normalized_stage = 'closed_won' as counts_as_enrollment,
  appointment_id,
  event_title,
  operator_owner,
  head_scout,
  event_source,
  revenue_cents,
  payload_json,
  event_at
from classified;

create or replace view public.athlete_lifecycle_current as
with ranked as (
  select
    timeline.*,
    row_number() over (
      partition by timeline.athlete_key
      order by timeline.event_at desc, timeline.lifecycle_event_id desc
    ) as recency_rank
  from public.athlete_lifecycle_timeline timeline
)
select
  ranked.lifecycle_event_id,
  ranked.athlete_key,
  ranked.athlete_id,
  ranked.athlete_main_id,
  ranked.athlete_name,
  ranked.raw_crm_stage,
  ranked.raw_task_status,
  ranked.normalized_stage,
  ranked.operator_status,
  ranked.meeting_lifecycle,
  ranked.pipeline_bucket,
  ranked.next_action,
  ranked.is_active_or_monitoring,
  ranked.is_terminal,
  ranked.indicates_showed,
  ranked.counts_as_enrollment,
  ranked.appointment_id,
  truth.resolved_appointment_id as current_resolved_appointment_id,
  truth.current_starts_at,
  truth.current_meeting_timezone,
  truth.current_head_scout,
  truth.operator_owner as current_operator_owner,
  ranked.revenue_cents,
  ranked.event_at
from ranked
left join public.active_athlete_meeting_truth truth
  on truth.athlete_key = ranked.athlete_key
where ranked.recency_rank = 1;

grant select on public.athlete_lifecycle_timeline to anon, authenticated;
grant select on public.athlete_lifecycle_current to anon, authenticated;
