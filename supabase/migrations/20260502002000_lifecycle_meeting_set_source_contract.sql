alter table lifecycle_events
  add column if not exists dedupe_key text;

with meeting_sets as (
  select
    id,
    athlete_key,
    created_at,
    coalesce(
      nullif(payload_json->>'appointment_id', ''),
      nullif(payload_json->>'booked_event_id', ''),
      nullif(payload_json->>'source_event_id', '')
    ) as appointment_id,
    nullif(
      btrim(
        regexp_replace(
          regexp_replace(
            lower(coalesce(payload_json->>'meeting_name', payload_json->>'booked_title', '')),
            '[^a-z0-9]+',
            ' ',
            'g'
          ),
          '\s+',
          ' ',
          'g'
        )
      ),
      ''
    ) as normalized_meeting_title
  from lifecycle_events
  where event_type = 'meeting_set'
),
ranked as (
  select
    id,
    row_number() over (
      partition by athlete_key, coalesce(normalized_meeting_title, appointment_id, id::text)
      order by
        (appointment_id is not null) desc,
        created_at desc,
        id desc
    ) as rn
  from meeting_sets
)
delete from lifecycle_events le
using ranked
where le.id = ranked.id
  and ranked.rn > 1;

update lifecycle_events
set dedupe_key = concat(
  'meeting_set:',
  athlete_key,
  ':',
  coalesce(
    nullif(payload_json->>'appointment_id', ''),
    nullif(payload_json->>'booked_event_id', ''),
    nullif(payload_json->>'source_event_id', '')
  )
)
where event_type = 'meeting_set'
  and dedupe_key is null
  and coalesce(
    nullif(payload_json->>'appointment_id', ''),
    nullif(payload_json->>'booked_event_id', ''),
    nullif(payload_json->>'source_event_id', '')
  ) is not null;

update lifecycle_events
set dedupe_key = concat('legacy_meeting_set:', athlete_key, ':', id::text)
where event_type = 'meeting_set'
  and dedupe_key is null;

create unique index if not exists lifecycle_events_dedupe_key_unique_idx
  on lifecycle_events (dedupe_key);

create index if not exists lifecycle_events_meeting_set_dedupe_idx
  on lifecycle_events (event_type, dedupe_key, created_at desc)
  where event_type = 'meeting_set';
