import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260503045000_backsync_call_activity_counting_contract.sql', import.meta.url),
  'utf8',
);

test('call activity backsync updates source rows instead of loosening reporting views', () => {
  assert.match(sql, /update call_activity_events cae/i);
  assert.doesNotMatch(sql, /create or replace view call_tracker_events/i);
  assert.doesNotMatch(sql, /create or replace view call_tracker_summary/i);
});

test('old generic call_attempt rows are normalized to exact attempt subtypes from task title', () => {
  assert.match(sql, /activity_type, ''\)\) = 'call_attempt'[\s\S]*task_title, ''\)\) like '%call attempt 2%' then 'call_attempt_2'/i);
  assert.match(sql, /activity_type, ''\)\) = 'call_attempt'[\s\S]*task_title, ''\)\) like '%call attempt 3%' then 'call_attempt_3'/i);
  assert.match(sql, /activity_type, ''\)\) = 'call_attempt'[\s\S]*then 'call_attempt_1'/i);
});

test('call activity backsync writes explicit reporting flags and tracker outcome', () => {
  assert.match(sql, /'counts_as_dial', contract\.counts_as_dial/i);
  assert.match(sql, /'counts_as_contact', contract\.counts_as_contact/i);
  assert.match(sql, /'counts_as_meeting_set', false/i);
  assert.match(sql, /'counts_as_post_meeting_outcome', false/i);
  assert.match(sql, /'tracker_outcome', contract\.tracker_outcome/i);
});

test('unable to leave vm stays dial only in the source contract', () => {
  assert.match(sql, /normalized_activity_subtype in \('call_attempt_1', 'call_attempt_2', 'call_attempt_3', 'unable_to_leave_vm'\)[\s\S]*then 'dial'/i);
  const contactCase = sql.match(/case\s+when normalized_activity_subtype in \(\s*'spoke_to_follow_up'[\s\S]*?end as counts_as_contact/i)?.[0] || '';
  assert.doesNotMatch(contactCase, /unable_to_leave_vm/i);
});

test('old Jerami-owned activity rows get operator materialization proof at the source', () => {
  assert.match(sql, /cae\.source_owner = 'Jerami Singleton'/i);
  assert.match(sql, /nullif\(cae\.owner_proof, ''\) is not null/i);
  assert.match(sql, /'materialization_status', 'operator_task'/i);
  assert.match(sql, /'task_assigned_owner', cae\.source_owner/i);
  assert.match(sql, /'materialization_proof'/i);
});
