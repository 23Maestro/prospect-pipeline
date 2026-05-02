import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../migrations/20260502000000_call_tracker_owner_context_names.sql', import.meta.url), 'utf8');

test('owner-context migration exposes canonical names while preserving compatibility columns', () => {
  assert.match(sql, /create or replace view call_tracker_events_owner_context/i);
  for (const column of [
    'active_operator_key',
    'active_operator_name',
    'task_assigned_owner',
    'booked_meeting_assigned_owner',
    'resolved_owner_name',
    'resolved_owner_role',
    'resolved_owner_source_field',
    'materialization_reason',
    'compatibility_source_owner',
    'compatibility_owner_proof',
    'can_materialize_for_active_operator',
  ]) {
    assert.match(sql, new RegExp(`\\bas\\s+${column}\\b`, 'i'));
  }
});

test('owner-context migration indexes frequently filtered JSON fact names', () => {
  assert.match(sql, /call_events_materialization_reason_idx/i);
  assert.match(sql, /call_activity_events_materialization_reason_idx/i);
  assert.match(sql, /call_events_resolved_owner_role_idx/i);
  assert.match(sql, /call_activity_events_resolved_owner_role_idx/i);
});
