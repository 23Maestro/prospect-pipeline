import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';

const migrationDir = new URL('../migrations/', import.meta.url);
const migrationName = '20260506090000_pending_client_watchlist.sql';
const migration = readFileSync(new URL(`../migrations/${migrationName}`, import.meta.url), 'utf8');

test('pending_client_watchlist is isolated from call tracker storage and views', () => {
  assert.match(migration, /create table if not exists public\.pending_client_watchlist/i);
  assert.match(migration, /source_event_id text not null unique/i);
  assert.match(migration, /status text not null default 'watching'/i);
  assert.match(migration, /owner_context jsonb not null default '\{\}'::jsonb/i);
  assert.match(migration, /detected_by_operator_key text not null/i);
  assert.match(migration, /resolved_by_operator_key text/i);
  assert.doesNotMatch(migration, /call_tracker/i);
  assert.doesNotMatch(migration, /meeting_events/i);
  assert.doesNotMatch(migration, /lifecycle_events/i);
});

test('call tracker migrations do not reference pending_client_watchlist', () => {
  const offenders = readdirSync(migrationDir)
    .filter((file) => file.endsWith('.sql') && file !== migrationName)
    .flatMap((file) => {
      const text = readFileSync(join(migrationDir.pathname, file), 'utf8');
      return /pending_client_watchlist/i.test(text) ? [basename(file)] : [];
    });

  assert.deepEqual(offenders, []);
});
