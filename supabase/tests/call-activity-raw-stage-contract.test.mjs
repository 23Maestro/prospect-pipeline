import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260505093000_call_activity_raw_stage_contract.sql', import.meta.url),
  'utf8',
);

test('call activity facts store raw crm stage and task status as source columns', () => {
  assert.match(sql, /alter table call_activity_events[\s\S]*add column if not exists raw_crm_stage text/i);
  assert.match(sql, /add column if not exists raw_task_status text/i);
  assert.match(sql, /comment on column call_activity_events\.raw_crm_stage/i);
  assert.match(sql, /comment on column call_activity_events\.raw_task_status/i);
});

test('call activity repair backfills raw stage from payload before mutable state fallback', () => {
  const updateSql = sql.match(/update call_activity_events cae[\s\S]*?comment on column call_activity_events\.raw_crm_stage/i)?.[0] || '';

  assert.match(updateSql, /nullif\(cae\.payload_json->>'raw_crm_stage', ''\)/i);
  assert.match(updateSql, /nullif\(cae\.payload_json->>'selected_sales_stage', ''\)/i);
  assert.doesNotMatch(updateSql, /athlete_pipeline_state/i);
  assert.doesNotMatch(updateSql, /aps\.crm_stage/i);
});

test('event feed emits call activity raw crm stage instead of hardcoded null', () => {
  assert.doesNotMatch(sql, /null::text as raw_crm_stage/i);
  assert.match(sql, /nullif\(cae\.raw_crm_stage, ''\)/i);
  assert.match(sql, /nullif\(cae\.payload_json->>'selected_sales_stage', ''\)/i);
  assert.match(sql, /nullif\(cae\.raw_task_status, ''\)/i);
  assert.match(sql, /cae\.normalized_activity_status/i);
});
