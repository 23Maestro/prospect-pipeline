-- Purge old Call Tracker compatibility views after active readers moved to
-- canonical public.call_log.
--
-- Historical source tables are intentionally not dropped here. This only
-- removes view aliases that kept old read paths alive.

drop view if exists public.weekly_operator_funnel_metrics;
drop view if exists public.call_tracker_summary;
drop view if exists public.call_tracker_events_owner_context;
drop view if exists public.call_tracker_events_deduped;
drop view if exists public.call_tracker_events;
drop view if exists public.call_events;
