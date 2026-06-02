import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260602113000_purge_call_tracker_compatibility_views.sql', import.meta.url),
  'utf8',
);
const meetingSetsSql = readFileSync(
  new URL('../migrations/20260602114500_purge_call_tracker_meeting_sets_view.sql', import.meta.url),
  'utf8',
);

test('call_log purge migration drops old compatibility views only', () => {
  for (const view of [
    'weekly_operator_funnel_metrics',
    'call_tracker_summary',
    'call_tracker_events_owner_context',
    'call_tracker_events_deduped',
    'call_tracker_events',
    'call_events',
  ]) {
    assert.match(sql, new RegExp(`drop view if exists public\\.${view}`, 'i'));
  }

  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /call_activity_events/i);
  assert.doesNotMatch(sql, /meeting_events/i);
  assert.match(sql, /canonical public\.call_log/i);
});

test('call_log purge migration removes the old meeting-set projection only', () => {
  assert.match(meetingSetsSql, /drop view if exists public\.call_tracker_meeting_sets/i);
  assert.doesNotMatch(meetingSetsSql, /drop table/i);
  assert.doesNotMatch(meetingSetsSql, /drop\s+(view|table)[\s\S]*lifecycle_events/i);
  assert.match(meetingSetsSql, /canonical public\.call_log/i);
});
