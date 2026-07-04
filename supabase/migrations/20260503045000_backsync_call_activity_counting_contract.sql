-- Backsync call activity rows into the explicit counting contract.
--
-- This closes the old-row loophole where call attempts existed as
-- activity_type = call_attempt with activity_kind null and no payload booleans.

with normalized as (
  select
    id,
    case
      when coalesce(nullif(activity_subtype, ''), nullif(activity_type, '')) in ('call_attempt_1', 'call_attempt_2', 'call_attempt_3')
        then coalesce(nullif(activity_subtype, ''), nullif(activity_type, ''))
      when coalesce(nullif(activity_subtype, ''), nullif(activity_type, '')) = 'call_attempt'
        and lower(coalesce(task_title, '')) like '%call attempt 2%' then 'call_attempt_2'
      when coalesce(nullif(activity_subtype, ''), nullif(activity_type, '')) = 'call_attempt'
        and lower(coalesce(task_title, '')) like '%call attempt 3%' then 'call_attempt_3'
      when coalesce(nullif(activity_subtype, ''), nullif(activity_type, '')) = 'call_attempt'
        then 'call_attempt_1'
      when coalesce(nullif(activity_subtype, ''), nullif(activity_type, '')) in ('spoke_to_follow_up', 'spoke_follow_up')
        then 'spoke_to_follow_up'
      when coalesce(nullif(activity_subtype, ''), nullif(activity_type, '')) in ('unable_to_leave_vm', 'called_unable_to_leave_vm')
        or lower(coalesce(task_title, '')) like '%unable%leave%vm%' then 'unable_to_leave_vm'
      when coalesce(nullif(activity_subtype, ''), nullif(activity_type, '')) = 'spoke_to_not_interested'
        or lower(coalesce(task_title, '')) like '%not interested%' then 'spoke_to_not_interested'
      when coalesce(nullif(activity_subtype, ''), nullif(activity_type, '')) = 'spoke_to_athlete_not_parent'
        or lower(coalesce(task_title, '')) like '%athlete%not%parent%' then 'spoke_to_athlete_not_parent'
      when coalesce(nullif(activity_subtype, ''), nullif(activity_type, '')) = 'spoke_to_too_young'
        or lower(coalesce(task_title, '')) like '%too young%' then 'spoke_to_too_young'
      else coalesce(nullif(activity_subtype, ''), nullif(activity_type, ''))
    end as normalized_activity_subtype
  from call_activity_events
),
contract as (
  select
    id,
    normalized_activity_subtype,
    case
      when normalized_activity_subtype in ('call_attempt_1', 'call_attempt_2', 'call_attempt_3', 'unable_to_leave_vm')
        then 'dial'
      when normalized_activity_subtype in (
        'spoke_to_follow_up',
        'spoke_to_not_interested',
        'spoke_to_athlete_not_parent',
        'spoke_to_too_young'
      ) then 'contact'
      else null
    end as normalized_activity_kind,
    case
      when normalized_activity_subtype in (
        'call_attempt_1',
        'call_attempt_2',
        'call_attempt_3',
        'unable_to_leave_vm',
        'spoke_to_follow_up',
        'spoke_to_not_interested',
        'spoke_to_athlete_not_parent',
        'spoke_to_too_young'
      ) then true
      else false
    end as counts_as_dial,
    case
      when normalized_activity_subtype in (
        'spoke_to_follow_up',
        'spoke_to_not_interested',
        'spoke_to_athlete_not_parent',
        'spoke_to_too_young'
      ) then true
      else false
    end as counts_as_contact,
    case
      when normalized_activity_subtype = 'unable_to_leave_vm' then 'unable_to_leave_vm'
      when normalized_activity_subtype = 'spoke_to_not_interested' then 'not_interested'
      when normalized_activity_subtype in ('spoke_to_follow_up', 'spoke_to_athlete_not_parent', 'spoke_to_too_young')
        then 'spoke_follow_up'
      when normalized_activity_subtype in ('call_attempt_1', 'call_attempt_2', 'call_attempt_3') then 'voicemail'
      else 'needs_review'
    end as tracker_outcome
  from normalized
)
update call_activity_events cae
set
  activity_type = contract.normalized_activity_subtype,
  activity_subtype = contract.normalized_activity_subtype,
  activity_kind = contract.normalized_activity_kind,
  payload_json =
    cae.payload_json
    || jsonb_build_object(
      'activity_kind', contract.normalized_activity_kind,
      'activity_subtype', contract.normalized_activity_subtype,
      'counts_as_dial', contract.counts_as_dial,
      'counts_as_contact', contract.counts_as_contact,
      'counts_as_meeting_set', false,
      'counts_as_post_meeting_outcome', false,
      'tracker_outcome', contract.tracker_outcome
    )
    || case
      when coalesce(cae.payload_json->>'materialization_status', '') = ''
       and coalesce(cae.payload_json->'materialization_proof'->>'materialization_status', '') = ''
       and cae.source_owner = 'Primary Operator'
       and nullif(cae.owner_proof, '') is not null then
        jsonb_build_object(
          'materialization_status', 'operator_task',
          'materialization_reason', 'task_assigned_owner_matches_active_operator',
          'task_assigned_owner', cae.source_owner,
          'materialization_proof',
          jsonb_build_object(
            'task_assigned_owner', cae.source_owner,
            'materialization_status', 'operator_task',
            'status', 'operator_task',
            'reason', 'task_assigned_owner_matches_active_operator'
          )
        )
      else '{}'::jsonb
    end,
  updated_at = now()
from contract
where cae.id = contract.id
  and contract.normalized_activity_subtype in (
    'call_attempt_1',
    'call_attempt_2',
    'call_attempt_3',
    'unable_to_leave_vm',
    'spoke_to_follow_up',
    'spoke_to_not_interested',
    'spoke_to_athlete_not_parent',
    'spoke_to_too_young'
  )
  and (
    cae.activity_type is distinct from contract.normalized_activity_subtype
    or cae.activity_subtype is distinct from contract.normalized_activity_subtype
    or cae.activity_kind is distinct from contract.normalized_activity_kind
    or cae.payload_json->>'counts_as_dial' is distinct from contract.counts_as_dial::text
    or cae.payload_json->>'counts_as_contact' is distinct from contract.counts_as_contact::text
    or cae.payload_json->>'counts_as_meeting_set' is distinct from 'false'
    or cae.payload_json->>'counts_as_post_meeting_outcome' is distinct from 'false'
    or cae.payload_json->>'tracker_outcome' is distinct from contract.tracker_outcome
    or (
      coalesce(cae.payload_json->>'materialization_status', '') = ''
      and coalesce(cae.payload_json->'materialization_proof'->>'materialization_status', '') = ''
      and cae.source_owner = 'Primary Operator'
      and nullif(cae.owner_proof, '') is not null
    )
  );
