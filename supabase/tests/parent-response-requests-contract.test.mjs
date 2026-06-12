import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260612150000_parent_response_requests.sql',
  'utf8',
);

test('parent response requests store intent but not lifecycle truth', () => {
  assert.match(migration, /create table if not exists public\.parent_response_requests/);
  assert.match(migration, /request_status text not null/);
  assert.match(migration, /token_hash text not null/);
  assert.match(migration, /response_kind text/);
  assert.match(migration, /selected_option_id text/);
  assert.match(migration, /approval_status text not null default 'pending'/);
  assert.match(migration, /notification_status text not null default 'pending'/);
  assert.match(migration, /notification_status in \('pending', 'sent', 'failed'\)/);
  assert.match(migration, /'ready_later'/);
  assert.doesNotMatch(migration, /lifecycle_events/i);
  assert.doesNotMatch(migration, /update public\.appointments/i);
});
