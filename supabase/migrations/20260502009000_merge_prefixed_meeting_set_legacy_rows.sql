-- Merge Ancel-style legacy meeting_set rows where the old row had no appointment id
-- and the canonical row later arrived with an active confirmation prefix like ACF/CF.

with legacy as (
  select
    id,
    athlete_key,
    created_at,
    nullif(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                lower(coalesce(payload_json->>'meeting_name', payload_json->>'booked_title', '')),
                '^follow up -\s*',
                '',
                'i'
              ),
              '^\([^)]*\)\s*',
              '',
              'i'
            ),
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
            regexp_replace(
              regexp_replace(
                lower(coalesce(payload_json->>'meeting_name', payload_json->>'booked_title', '')),
                '^follow up -\s*',
                '',
                'i'
              ),
              '^\([^)]*\)\s*',
              '',
              'i'
            ),
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
            regexp_replace(
              regexp_replace(
                lower(coalesce(payload_json->>'meeting_name', payload_json->>'booked_title', '')),
                '^follow up -\s*',
                '',
                'i'
              ),
              '^\([^)]*\)\s*',
              '',
              'i'
            ),
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
),
canonical as (
  select
    athlete_key,
    nullif(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                lower(coalesce(payload_json->>'meeting_name', payload_json->>'booked_title', '')),
                '^follow up -\s*',
                '',
                'i'
              ),
              '^\([^)]*\)\s*',
              '',
              'i'
            ),
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

-- The tracker no longer uses compatibility call_events rows for meeting-set facts.
-- Keep meeting_set daily tracking in lifecycle_events only.
delete from call_events
where raw_event_type = 'sales_stage_reconciled'
  and (
    lower(coalesce(raw_crm_stage, '')) like '%meeting set%'
    or lower(coalesce(raw_task_status, '')) = 'confirmation_call'
  );
