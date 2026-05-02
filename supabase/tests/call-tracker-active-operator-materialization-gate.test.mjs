import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260502011000_call_tracker_active_operator_materialization_gate.sql', import.meta.url),
  'utf8',
);

test('call tracker meeting-set lifecycle rows require active-operator materialization proof', () => {
  assert.match(sql, /A real Prospect ID event is not automatically an active-operator dashboard fact/i);
  assert.match(sql, /lifecycle_meeting_set_facts as/i);
  assert.match(sql, /from lifecycle_events le/i);
  assert.match(sql, /where le\.event_type = 'meeting_set'/i);
  assert.match(sql, /le\.payload_json->'materialization_proof'->>'materialization_status'\s*=\s*'operator_task'/i);
  assert.match(sql, /le\.payload_json->>'materialization_status'\s*=\s*'operator_task'/i);
  assert.doesNotMatch(sql, /coalesce\(nullif\(le\.payload_json->>'operator_name', ''\), 'Jerami Singleton'\) as source_owner/i);
  assert.doesNotMatch(sql, /'matched_weekly_task_assigned_owner'::text as owner_proof/i);
});

test('call activity rows require operator_task or explicit legacy compatibility proof', () => {
  assert.match(sql, /activity_facts as/i);
  assert.match(sql, /from call_activity_events cae/i);
  assert.match(sql, /cae\.payload_json->>'materialization_status'\s*=\s*'operator_task'/i);
  assert.match(sql, /cae\.source_owner\s*=\s*\(select active_operator_name from active_operator\)/i);
  assert.match(sql, /nullif\(cae\.owner_proof, ''\) is not null/i);
  assert.match(sql, /cae\.payload_json \? 'task_assigned_owner'/i);
});

test('meeting set side view and owner context view use the same materialization gate', () => {
  assert.match(sql, /create or replace view call_tracker_meeting_sets/i);
  assert.match(sql, /where le\.event_type = 'meeting_set'[\s\S]*lifecycle_meeting_set_materialized/i);
  assert.match(sql, /create or replace view call_tracker_events_owner_context/i);
  assert.match(sql, /coalesce\(\s*cte\.payload_json->'owner_context'->>'materialization_status'/i);
});

test('migration documents Tim and Jerami proof cases in SQL fixtures', () => {
  assert.match(sql, /Tim Risner meeting_set lifecycle rows do not appear/i);
  assert.match(sql, /Tim Risner call_activity_events rows do not appear/i);
  assert.match(sql, /Jerami operator_task meeting_set rows do appear/i);
  assert.match(sql, /Jerami operator_task call_activity_events rows do appear/i);
  assert.match(sql, /legacy rows without proof are excluded/i);
});
