import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260529090000_appointment_truth_contract.sql', import.meta.url),
  'utf8',
);

test('appointments gets durable timezone, owner, source, and reschedule-chain columns', () => {
  for (const column of [
    'meeting_timezone text',
    'meeting_timezone_label text',
    'calendar_timezone text',
    'previous_appointment_id text',
    'original_appointment_id text',
    'reschedule_sequence integer not null default 0',
    'operator_owner text',
    'operator_owner_key text',
    'head_scout_key text',
    'appointment_role text',
    'status_reason text',
    'source_system text',
    "source_payload jsonb not null default '{}'::jsonb",
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column.replace(/[{}]/g, '\\$&')}`, 'i'));
  }
});

test('appointment truth constraints and indexes are added safely', () => {
  assert.match(sql, /do \$\$/i);
  assert.match(sql, /pg_constraint/i);
  assert.match(sql, /appointment_truth_active_starts_at_check/i);
  assert.match(sql, /appointment_truth_active_timezone_check/i);
  assert.match(sql, /appointment_truth_reschedule_sequence_check/i);
  assert.match(sql, /appointment_truth_role_check/i);
  assert.match(sql, /appointment_truth_previous_appointment_fkey/i);
  assert.match(sql, /appointment_truth_original_appointment_fkey/i);
  assert.match(sql, /not valid/i);
  assert.match(sql, /appointments_active_truth_idx/i);
  assert.match(sql, /appointments_reschedule_chain_idx/i);
});

test('canonical appointment truth and anomaly views exist', () => {
  assert.match(sql, /create or replace view public\.active_athlete_meeting_truth as/i);
  assert.match(sql, /create or replace view public\.meeting_truth_anomalies as/i);

  for (const column of [
    'current_appointment_id',
    'current_starts_at',
    'current_meeting_timezone',
    'current_head_scout',
    'operator_owner',
    'previous_appointment_id',
    'previous_starts_at',
    'original_appointment_id',
    'reschedule_sequence',
    'resolution_source',
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, 'i'));
  }
});

test('anomaly view exposes the appointment truth repair queue', () => {
  for (const reason of [
    'missing_current_appointment_pointer',
    'stale_current_appointment_pointer',
    'missing_current_starts_at',
    'missing_current_timezone',
    'missing_head_scout',
    'missing_operator_owner',
    'reschedule_missing_previous_appointment',
    'reschedule_missing_original_appointment',
    'duplicate_active_appointment_chain',
    'support_cache_timezone_not_backfilled',
  ]) {
    assert.match(sql, new RegExp(reason, 'i'));
  }
  assert.match(sql, /recommended_repair/i);
  assert.match(sql, /evidence_json/i);
});
