-- Purge the remaining Call Tracker meeting-set projection after readers moved
-- to canonical public.call_log.
--
-- Historical lifecycle_events rows stay intact. This removes only the
-- reporting projection that duplicated meeting-set facts.

drop view if exists public.call_tracker_meeting_sets;
