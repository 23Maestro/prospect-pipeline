import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../migrations/20260602140500_purge_athlete_pipeline_state.sql', import.meta.url),
  'utf8',
);

test('athlete pipeline state purge drops only the deprecated snapshot table', () => {
  assert.match(migration, /drop table if exists public\.athlete_pipeline_state/i);
  assert.doesNotMatch(migration, /\bcascade\b/i);
  assert.doesNotMatch(migration, /drop table if exists public\.lifecycle_events/i);
  assert.doesNotMatch(migration, /drop table if exists public\.appointments/i);
  assert.doesNotMatch(migration, /drop view/i);
});
