import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260504090000_repair_open_new_opportunity_call_activity_rows.sql', import.meta.url),
  'utf8',
);

test('open New Opportunity repair is narrow and non-destructive', () => {
  assert.match(sql, /update call_activity_events/i);
  assert.doesNotMatch(sql, /delete from call_activity_events/i);
  assert.match(sql, /payload_json->>'source'\s*=\s*'scout_tasks_current_pipeline'/i);
  assert.match(sql, /payload_json->>'materialization_reason'\s*=\s*'missing_completion_date_for_call_activity'/i);
  assert.match(sql, /nullif\(payload_json->>'completion_at', ''\) is null/i);
});

test('open New Opportunity repair stops using not_operator_task for uncalled queue work', () => {
  assert.match(sql, /payload_json - 'materialization_status' - 'owner_status'/i);
  assert.match(sql, /payload_json->'owner_context'[\s\S]*- 'materialization_status'[\s\S]*- 'materialization_reason'[\s\S]*- 'owner_status'/i);
  assert.match(sql, /payload_json->'materialization_proof'[\s\S]*- 'materialization_status'[\s\S]*- 'status'[\s\S]*- 'reason'/i);
  assert.match(sql, /'materialization_reason', 'open_new_opportunity_queue_item_not_call_activity'/i);
  assert.match(sql, /'queue_item_status', 'open_queue_item'/i);
  assert.match(sql, /'suppressed_from_call_activity_reporting', true/i);
  assert.match(sql, /'counts_as_dial', false/i);
  assert.match(sql, /'counts_as_contact', false/i);
  assert.doesNotMatch(sql, /'materialization_status', 'open_queue_item'/i);
  assert.doesNotMatch(sql, /'not_operator_task'/i);
});
