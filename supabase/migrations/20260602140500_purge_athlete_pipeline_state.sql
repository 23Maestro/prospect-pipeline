-- Purge the deprecated mutable lifecycle snapshot.
--
-- Current lifecycle state is projected from public.lifecycle_events. Meeting
-- timing and appointment identity stay in public.appointments. Any unexpected
-- dependent object should fail this migration loudly.

drop table if exists public.athlete_pipeline_state;
