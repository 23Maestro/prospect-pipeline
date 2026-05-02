-- Merge legacy no-appointment meeting_set rows into canonical appointment-keyed rows.
--
-- Going forward, buildMeetingSetFact requires appointment_id/booked_event_id and
-- insertMeetingSetEventsOnce dedupes on meeting_set:<athlete_key>:<appointment_id>.
-- This pass cleans older legacy rows like legacy_meeting_set:<athlete>:<uuid>.

with legacy as (
  select
    id,
    athlete_key,
    created_at,
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
    and dedupe_key like 'legacy_meeting_set:%'
    and coalesce(
      nullif(payload_json->>'appointment_id', ''),
      nullif(payload_json->>'booked_event_id', ''),
      nullif(payload_json->>'source_event_id', '')
    ) is null
),
canonical as (
  select
    id,
    athlete_key,
    created_at,
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
    and dedupe_key like 'meeting_set:%'
    and coalesce(
      nullif(payload_json->>'appointment_id', ''),
      nullif(payload_json->>'booked_event_id', ''),
      nullif(payload_json->>'source_event_id', '')
    ) is not null
),
duplicates as (
  select
    legacy.id as legacy_id,
    legacy.created_at as legacy_created_at,
    canonical.id as canonical_id,
    canonical.created_at as canonical_created_at
  from legacy
  join canonical
    on canonical.athlete_key = legacy.athlete_key
   and canonical.normalized_meeting_title = legacy.normalized_meeting_title
)
update lifecycle_events canonical_row
set created_at = least(canonical_row.created_at, duplicates.legacy_created_at)
from duplicates
where canonical_row.id = duplicates.canonical_id
  and duplicates.legacy_created_at < duplicates.canonical_created_at;

with legacy as (
  select
    id,
    athlete_key,
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
    and dedupe_key like 'legacy_meeting_set:%'
    and coalesce(
      nullif(payload_json->>'appointment_id', ''),
      nullif(payload_json->>'booked_event_id', ''),
      nullif(payload_json->>'source_event_id', '')
    ) is null
),
canonical as (
  select
    athlete_key,
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
    and dedupe_key like 'meeting_set:%'
    and coalesce(
      nullif(payload_json->>'appointment_id', ''),
      nullif(payload_json->>'booked_event_id', ''),
      nullif(payload_json->>'source_event_id', '')
    ) is not null
)
delete from lifecycle_events le
using legacy
where le.id = legacy.id
  and exists (
    select 1
    from canonical
    where canonical.athlete_key = legacy.athlete_key
      and canonical.normalized_meeting_title = legacy.normalized_meeting_title
  );
