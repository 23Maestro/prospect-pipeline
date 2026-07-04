import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260503043000_backsync_meeting_set_materialization_contract.sql', import.meta.url),
  'utf8',
);

test('meeting-set materialization backsync updates source facts, not reporting fallback logic', () => {
  assert.match(sql, /update lifecycle_events le/i);
  assert.doesNotMatch(sql, /create or replace view call_tracker_events/i);
  assert.doesNotMatch(sql, /create or replace view call_tracker_summary/i);
});

test('weekly booked-meeting rows require matched active operator task proof before backsync', () => {
  assert.match(sql, /payload_json->>'matched_weekly_task_assigned_owner'\s*=\s*'Primary Operator'/i);
  assert.match(sql, /nullif\(payload_json->>'matched_weekly_task_id', ''\) is not null/i);
  assert.match(sql, /'payload\.matched_weekly_task_assigned_owner'::text as proof_field/i);
});

test('legacy local meeting-set writes are normalized into explicit source booleans', () => {
  assert.match(sql, /dedupe_key like 'legacy_meeting_set:%'/i);
  assert.match(sql, /nullif\(payload_json->>'legacy_assigned_to', ''\) is not null/i);
  assert.match(sql, /'legacy_local_meeting_set_write'::text as proof_field/i);
  assert.match(sql, /'counts_as_dial', true/i);
  assert.match(sql, /'counts_as_contact', true/i);
  assert.match(sql, /'counts_as_meeting_set', true/i);
  assert.match(sql, /'counts_as_post_meeting_outcome', false/i);
});

test('backsync writes the same materialization contract expected by strict views', () => {
  assert.match(sql, /'materialization_status', 'operator_task'/i);
  assert.match(sql, /'materialization_reason', 'task_assigned_owner_matches_active_operator'/i);
  assert.match(sql, /'materialization_proof'/i);
  assert.match(sql, /'owner_context'/i);
  assert.match(sql, /'owner_proof'/i);
});
