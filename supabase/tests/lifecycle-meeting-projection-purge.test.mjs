import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260602120000_purge_lifecycle_meeting_projection_views.sql', import.meta.url),
  'utf8',
);

test('lifecycle and meeting projection purge drops views only', () => {
  for (const view of [
    'active_athlete_meeting_truth',
    'athlete_lifecycle_timeline',
    'athlete_lifecycle_current',
    'meeting_truth_anomalies',
  ]) {
    assert.match(sql, new RegExp(`drop view if exists public\\.${view}`, 'i'));
  }

  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /drop\s+(view|table)\s+if\s+exists\s+public\.appointments/i);
  assert.doesNotMatch(sql, /drop\s+(view|table)\s+if\s+exists\s+public\.lifecycle_events/i);
  assert.doesNotMatch(sql, /drop\s+(view|table)\s+if\s+exists\s+public\.athletes/i);
  assert.doesNotMatch(sql, /drop\s+(view|table)\s+if\s+exists\s+public\.call_log/i);
  assert.match(sql, /canonical public\.appointments, public\.lifecycle_events, public\.athletes, and\s+-- public\.call_log/i);
});
