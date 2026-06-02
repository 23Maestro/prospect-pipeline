import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';

const migrationDir = new URL('../migrations/', import.meta.url);
const migrationName = '20260506090000_pending_client_watchlist.sql';
const migration = readFileSync(new URL(`../migrations/${migrationName}`, import.meta.url), 'utf8');
const rlsMigrationName = '20260512120000_enable_rls_pending_client_watchlist.sql';
const rlsMigration = readFileSync(
  new URL(`../migrations/${rlsMigrationName}`, import.meta.url),
  'utf8',
);
const actionTagMigrationName = '20260530130000_pending_client_watchlist_action_tag.sql';
const actionTagMigration = readFileSync(
  new URL(`../migrations/${actionTagMigrationName}`, import.meta.url),
  'utf8',
);
const eventTimeMigrationName = '20260602125000_pending_client_watchlist_event_time_instants.sql';
const eventTimeMigration = readFileSync(
  new URL(`../migrations/${eventTimeMigrationName}`, import.meta.url),
  'utf8',
);

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
    .filter(
      (file) =>
        file.endsWith('.sql') &&
        ![migrationName, rlsMigrationName, actionTagMigrationName, eventTimeMigrationName].includes(
          file,
        ),
    )
    .flatMap((file) => {
      const text = readFileSync(join(migrationDir.pathname, file), 'utf8');
      return /pending_client_watchlist/i.test(text) ? [basename(file)] : [];
    });

  assert.deepEqual(offenders, []);
});

test('pending_client_watchlist stores meeting times as timestamp instants', () => {
  assert.match(eventTimeMigration, /alter column event_start type timestamptz/i);
  assert.match(eventTimeMigration, /alter column event_end type timestamptz/i);
  assert.match(eventTimeMigration, /event_start::timestamp at time zone 'America\/New_York'/i);
  assert.match(eventTimeMigration, /event_end::timestamp at time zone 'America\/New_York'/i);
  assert.doesNotMatch(eventTimeMigration, /call_tracker/i);
  assert.doesNotMatch(eventTimeMigration, /lifecycle_events/i);
});

test('pending_client_watchlist stores one helper action tag without touching lifecycle tables', () => {
  assert.match(actionTagMigration, /add column if not exists action_tag text not null default 'Missing Notes'/i);
  assert.match(actionTagMigration, /Operator Input/);
  assert.match(actionTagMigration, /Scout Update/);
  assert.match(actionTagMigration, /Payment Watch/);
  assert.match(actionTagMigration, /Missing Notes/);
  assert.doesNotMatch(actionTagMigration, /athlete_pipeline_state/i);
  assert.doesNotMatch(actionTagMigration, /lifecycle_events/i);
});

test('pending_client_watchlist is protected by RLS and service-role only grants', () => {
  assert.match(
    rlsMigration,
    /alter table public\.pending_client_watchlist enable row level security/i,
  );
  assert.match(
    rlsMigration,
    /revoke all on table public\.pending_client_watchlist from anon, authenticated/i,
  );
  assert.match(
    rlsMigration,
    /grant select, insert, update, delete on public\.pending_client_watchlist to service_role/i,
  );
  assert.doesNotMatch(rlsMigration, /create policy/i);
});
