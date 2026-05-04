import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260504091000_exclude_open_queue_items_from_call_tracker_reporting.sql', import.meta.url),
  'utf8',
);

test('suppressed open queue rows are removed from browser event feed', () => {
  assert.match(sql, /create or replace view call_tracker_events_owner_context/i);
  assert.match(sql, /from call_tracker_events cte/i);
  assert.match(sql, /suppressed_from_call_activity_reporting'\)::boolean, false\) = false/i);
});

test('suppressed open queue rows are removed from summary totals', () => {
  assert.match(sql, /create or replace view call_tracker_summary/i);
  assert.match(sql, /from call_tracker_events\s+where coalesce\(\(payload_json->>'suppressed_from_call_activity_reporting'\)::boolean, false\) = false/i);
});

test('nested stale materialization proof is stripped during repair', () => {
  assert.match(sql, /payload_json->'owner_context'[\s\S]*- 'materialization_status'[\s\S]*- 'materialization_reason'[\s\S]*- 'owner_status'/i);
  assert.match(sql, /payload_json->'materialization_proof'[\s\S]*- 'materialization_status'[\s\S]*- 'status'[\s\S]*- 'reason'/i);
  assert.doesNotMatch(sql, /'not_operator_task'/i);
});
