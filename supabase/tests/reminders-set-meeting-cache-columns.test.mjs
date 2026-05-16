import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../migrations/20260510090000_expand_reminders_set_meeting_cache.sql', import.meta.url), 'utf8');
const cacheTableSql = readFileSync(
  new URL('../migrations/20260515223000_set_meeting_confirmation_cache_table.sql', import.meta.url),
  'utf8',
);
const persistence = readFileSync(
  new URL('../../src/domain/supabase-persistence.ts', import.meta.url),
  'utf8',
);
const pendingClientWatchlist = readFileSync(
  new URL('../../src/lib/pending-client-watchlist.ts', import.meta.url),
  'utf8',
);
const publicReadSql = readFileSync(
  new URL(
    '../migrations/20260515224500_public_set_meeting_confirmation_cache_read.sql',
    import.meta.url,
  ),
  'utf8',
);
const prospectMobileApp = readFileSync(
  new URL('../../apps/prospect-web/public/prospect-mobile/app.js', import.meta.url),
  'utf8',
);

test('migration adds set meeting cache columns to reminders without dropping existing columns', () => {
  assert.match(sql, /alter table if exists reminders/i);
  assert.match(sql, /add column if not exists athlete_key text/i);
  assert.match(sql, /add column if not exists meeting_starts_at timestamptz/i);
  assert.match(sql, /add column if not exists meeting_duration_minutes integer/i);
  assert.match(sql, /add column if not exists meeting_ends_at timestamptz/i);
  assert.match(sql, /add column if not exists message_body text/i);
  assert.match(sql, /add column if not exists payload_json jsonb not null default '\{\}'::jsonb/i);
  assert.doesNotMatch(sql, /drop column/i);
});

test('set meeting confirmations use a named confirmation cache table', () => {
  assert.match(
    cacheTableSql,
    /create table if not exists public\.set_meeting_confirmation_cache/i,
  );
  assert.match(cacheTableSql, /alter table if exists public\.reminders/i);
  assert.match(cacheTableSql, /add column if not exists meeting_duration_minutes integer/i);
  assert.match(cacheTableSql, /meeting_ends_at timestamptz/i);
  assert.match(cacheTableSql, /message_body text/i);
  assert.match(cacheTableSql, /source text not null default 'set_meetings_confirmation'/i);
  assert.match(cacheTableSql, /insert into public\.set_meeting_confirmation_cache/i);
  assert.match(cacheTableSql, /from public\.reminders/i);
  assert.match(cacheTableSql, /enable row level security/i);
  assert.match(cacheTableSql, /revoke all on table public\.set_meeting_confirmation_cache from anon, authenticated/i);
  assert.match(cacheTableSql, /grant select, insert, update, delete on public\.set_meeting_confirmation_cache to service_role/i);
  assert.match(
    persistence,
    /writeRows\(config, 'set_meeting_confirmation_cache', rows, 'dedupe_key'\)/,
  );
  assert.match(pendingClientWatchlist, /'set_meeting_confirmation_cache'/);
  assert.doesNotMatch(
    pendingClientWatchlist,
    /readRows<SetMeetingConfirmationCacheRow>\(\s*config,\s*'reminders'/,
  );
});

test('prospect mobile can read only cached set meeting confirmations from the named table', () => {
  assert.match(prospectMobileApp, /\/rest\/v1\/set_meeting_confirmation_cache/);
  assert.doesNotMatch(prospectMobileApp, /\/rest\/v1\/reminders/);
  assert.match(
    publicReadSql,
    /create policy "public can read cached set meeting confirmations"/i,
  );
  assert.match(publicReadSql, /for select\s+to anon, authenticated/i);
  assert.match(publicReadSql, /status = 'cached'/i);
  assert.match(publicReadSql, /source = 'set_meetings_confirmation'/i);
  assert.match(publicReadSql, /kind in \('confirmation_1', 'confirmation_2'\)/i);
  assert.match(
    publicReadSql,
    /grant select on public\.set_meeting_confirmation_cache to anon, authenticated/i,
  );
});
