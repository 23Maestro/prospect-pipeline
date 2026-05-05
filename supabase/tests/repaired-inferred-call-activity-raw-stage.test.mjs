import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260505094500_repair_inferred_call_activity_raw_stage.sql', import.meta.url),
  'utf8',
);

test('repair removes raw crm stage values not carried by the activity payload source', () => {
  assert.match(sql, /update call_activity_events/i);
  assert.match(sql, /raw_crm_stage = null/i);
  assert.match(sql, /payload_json = payload_json - 'raw_crm_stage'/i);
  assert.match(sql, /payload_json->>'selected_sales_stage', ''\) is null/i);
  assert.match(sql, /payload_json->>'raw_crm_stage', ''\) is not null/i);
  assert.doesNotMatch(sql, /athlete_pipeline_state/i);
});
