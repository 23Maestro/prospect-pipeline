import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260602100000_call_tracker_views_from_call_log.sql', import.meta.url),
  'utf8',
);

test('call tracker compatibility event view reads canonical call_log', () => {
  assert.match(sql, /create or replace view public\.call_tracker_events as/i);
  assert.match(sql, /from public\.call_log cl/i);
  assert.match(sql, /cl\.source_system as source/i);
  assert.match(sql, /cl\.can_materialize_for_active_operator as is_tracked_owner/i);
  assert.match(sql, /cl\.reporting_at/i);
  assert.doesNotMatch(sql, /from public\.call_events/i);
  assert.doesNotMatch(sql, /from call_activity_events/i);
  assert.doesNotMatch(sql, /from meeting_events/i);
});

test('call tracker owner-context view preserves Prospect Web API columns', () => {
  for (const column of [
    'active_operator_key',
    'active_operator_name',
    'task_assigned_owner',
    'booked_meeting_assigned_owner',
    'resolved_owner_name',
    'resolved_owner_role',
    'resolved_owner_source_field',
    'materialization_status',
    'materialization_reason',
    'compatibility_source_owner',
    'compatibility_owner_proof',
    'can_materialize_for_active_operator',
    'reporting_date_et',
  ]) {
    assert.match(sql, new RegExp(column, 'i'));
  }
});

test('call tracker summary aggregates from call_log-backed event view', () => {
  assert.match(sql, /create or replace view public\.call_tracker_summary as/i);
  assert.match(sql, /from public\.call_tracker_events/i);
  assert.match(sql, /count\(\*\) filter \(where counts_as_dial\)::integer as dials/i);
  assert.match(sql, /count\(\*\) filter \(where counts_as_contact\)::integer as contacts/i);
  assert.match(sql, /count\(\*\) filter \(where counts_as_meeting_set\)::integer as meetings_set/i);
  assert.match(sql, /count\(\*\) filter \(where counts_as_post_meeting_outcome\)::integer as meeting_outcomes_total/i);
  assert.match(sql, /grant select on public\.call_tracker_summary to anon, authenticated/i);
});
