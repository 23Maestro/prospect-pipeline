-- Purge lifecycle and meeting projection views after active readers moved to
-- canonical public.appointments, public.lifecycle_events, public.athletes, and
-- public.call_log.
--
-- This intentionally drops views only. Canonical truth tables stay intact.

drop view if exists public.meeting_truth_anomalies;
drop view if exists public.athlete_lifecycle_current;
drop view if exists public.active_athlete_meeting_truth;
drop view if exists public.athlete_lifecycle_timeline;
