import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./sync-booked-meetings-to-supabase.mjs', import.meta.url), 'utf8');

test('booked meeting sync uses the shared weekly source resolver and fact builders', () => {
  assert.match(source, /buildWeeklyOperatorMeetingSetCandidates/);
  assert.match(source, /buildMeetingSetFact/);
  assert.match(source, /insertMeetingSetEventsOnce/);
  assert.match(source, /\/scout\/tasks\?range=thisWeek/);
  assert.match(source, /\/calendar\/booked-meetings\?/);
  assert.match(source, /\/calendar\/athlete-booked-meetings\?/);
});

test('booked meeting sync does not reintroduce known-athlete prefilter or local Supabase fact writes', () => {
  assert.doesNotMatch(source, /knownAthleteNames/);
  assert.doesNotMatch(source, /await supabaseWrite\('lifecycle_events'/);
  assert.doesNotMatch(source, /insertLifecycleEvents/);
  assert.doesNotMatch(source, /buildLifecycleAuditEvent/);
  assert.doesNotMatch(source, /booked_meeting_gap_reconciled/);
  assert.doesNotMatch(source, /backfill_meeting_set_promotion/);
  assert.doesNotMatch(source, /backfill_run_id/);
});

test('booked meeting sync preserves lifecycle transition time across reruns', () => {
  assert.doesNotMatch(source, /upsertMeetingSetEvents/);
  assert.doesNotMatch(source, /resolution=merge-duplicates[\s\S]*meetingSet/);
  assert.match(source, /meetingSetEventsInsertedOnce/);
});
