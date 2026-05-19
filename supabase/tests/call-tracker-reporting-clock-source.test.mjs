import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve('supabase/migrations/20260519010000_call_tracker_reporting_clock_source.sql'),
  'utf8',
);
const athleteIdentitySql = readFileSync(
  resolve('supabase/migrations/20260519013000_call_tracker_meeting_set_entry_counts.sql'),
  'utf8',
);

test('call tracker owner-context view exposes a source-owned reporting clock', () => {
  assert.match(sql, /as reporting_at/i);
  assert.match(sql, /reporting_date_et/i);
  assert.match(sql, /cte\.tracker_outcome = 'meeting_set'/i);
  assert.match(sql, /le_source\.payload_json->>'source' = '\/sales\/meeting-set'/i);
  assert.match(sql, /le_source\.payload_json->>'source_post' = '\/sales\/meeting-set'/i);
  assert.match(sql, /when cte\.counts_as_post_meeting_outcome then coalesce\(cte\.event_at, cte\.occurred_at\)/i);
});

test('reporting clock migration keeps reporting_at in Supabase instead of local consumers', () => {
  assert.doesNotMatch(sql, /data-contract\.json/i);
  assert.doesNotMatch(sql, /prospect-web\.vercel\.app/i);
});

test('meeting set dashboard count is first real lifecycle entry per athlete key', () => {
  assert.match(athleteIdentitySql, /and cte\.is_tracked_owner/i);
  assert.match(athleteIdentitySql, /partition by coalesce\(cte\.athlete_key, 'event:' \|\| cte\.id::text\)/i);
  assert.match(athleteIdentitySql, /meeting_set_athlete_sequence = 1/i);
  assert.doesNotMatch(athleteIdentitySql, /partition by .*appointment_id/i);
  assert.doesNotMatch(athleteIdentitySql, /and coalesce\(cte\.counts_as_meeting_set, false\)/i);
});

test('reschedules stay in the reporting view but are not dashboard-countable meeting sets', () => {
  assert.match(athleteIdentitySql, /'rescheduled'/i);
  assert.match(athleteIdentitySql, /'reschedule pending'/i);
  assert.match(athleteIdentitySql, /when cte\.tracker_outcome = 'meeting_set' then coalesce\(cte\.meeting_set_athlete_sequence = 1, false\)/i);
  assert.match(athleteIdentitySql, /cte\.counts_as_post_meeting_outcome/i);
});
