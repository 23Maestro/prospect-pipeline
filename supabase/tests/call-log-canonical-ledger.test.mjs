import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260602090000_call_log_canonical_ledger.sql', import.meta.url),
  'utf8',
);
const cleanHouse = readFileSync(
  new URL('../../docs/architecture/supabase-clean-house-truth-map.md', import.meta.url),
  'utf8',
);

test('call_log migration creates the canonical ledger without reusing call_events', () => {
  assert.match(sql, /create table if not exists public\.call_log/i);
  assert.doesNotMatch(sql, /create table if not exists public\.call_events/i);
  assert.doesNotMatch(sql, /create or replace view public\.call_events/i);
  assert.match(sql, /call_events name, which is now compatibility\/history only/i);
});

test('call_log stores one source-owned reporting fact with explicit clocks and count flags', () => {
  for (const column of [
    'fact_type text not null',
    'tracker_outcome text not null',
    'occurred_at timestamptz not null',
    'event_at timestamptz',
    'reporting_at timestamptz not null',
    'counts_as_dial boolean not null default false',
    'counts_as_contact boolean not null default false',
    'counts_as_meeting_set boolean not null default false',
    'counts_as_post_meeting_outcome boolean not null default false',
    'counts_as_enrollment boolean not null default false',
    'dedupe_key text not null',
  ]) {
    assert.match(sql, new RegExp(column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  assert.match(sql, /call_log_fact_type_check/i);
  assert.match(sql, /'call_activity'/i);
  assert.match(sql, /'meeting_set'/i);
  assert.match(sql, /'post_meeting_outcome'/i);
  assert.match(sql, /'enrollment_payment'/i);
  assert.match(sql, /call_log_count_shape_check/i);
  assert.match(sql, /call_log_dedupe_key_idx/i);
});

test('call_log includes appointment, owner proof, and payment evidence fields', () => {
  for (const column of [
    'appointment_id text',
    'live_event_id text',
    'booked_event_starts_at timestamptz',
    'booked_event_ends_at timestamptz',
    'meeting_timezone text',
    'source_family text not null',
    'source_table text',
    'source_row_id text',
    'owner_proof text',
    'materialization_status text',
    'can_materialize_for_active_operator boolean not null default false',
    'revenue_cents integer',
    'commission_cents integer',
    'stripe_payment_intent_id text',
    'stripe_charge_id text',
    'stripe_checkout_session_id text',
    'payment_confirmed_at timestamptz',
  ]) {
    assert.match(sql, new RegExp(column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  assert.match(sql, /call_log_payment_shape_check/i);
  assert.match(sql, /call_log_appointment_idx/i);
  assert.match(sql, /call_log_live_event_idx/i);
  assert.match(sql, /call_log_owner_reporting_idx/i);
  assert.match(sql, /call_log_source_row_idx/i);
});

test('call_log remains service-role only until compatibility readers migrate', () => {
  assert.match(sql, /alter table public\.call_log enable row level security/i);
  assert.match(sql, /grant select, insert, update, delete on public\.call_log to service_role/i);
  assert.doesNotMatch(sql, /grant select on public\.call_log to anon/i);
  assert.doesNotMatch(sql, /grant select on public\.call_log to authenticated/i);
});

test('clean-house map keeps call_log as the target and call_events as retired history', () => {
  assert.match(cleanHouse, /\| `call_log` \| Reporting \/ Pre-Meeting Tasks \/ Enrollments & Outcomes \| Canonical target \|/);
  assert.match(cleanHouse, /\| `call_events` \| Reporting \/ Compatibility \| Deprecated compatibility view name/);
  assert.match(cleanHouse, /The old `call_events` name is intentionally retired/);
});
