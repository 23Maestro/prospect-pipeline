import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260502006000_merge_legacy_meeting_set_duplicates.sql', import.meta.url),
  'utf8',
);

test('legacy meeting-set duplicate merge preserves earliest transition time on canonical row', () => {
  assert.match(sql, /dedupe_key like 'legacy_meeting_set:%'/i);
  assert.match(sql, /dedupe_key like 'meeting_set:%'/i);
  assert.match(sql, /set created_at = least\(canonical_row\.created_at, duplicates\.legacy_created_at\)/i);
});

test('legacy meeting-set duplicate merge deletes only no-appointment legacy rows with canonical match', () => {
  assert.match(sql, /coalesce\([\s\S]*payload_json->>'appointment_id'[\s\S]*\) is null/i);
  assert.match(sql, /delete from lifecycle_events le/i);
  assert.match(sql, /canonical\.athlete_key = legacy\.athlete_key/i);
  assert.match(sql, /canonical\.normalized_meeting_title = legacy\.normalized_meeting_title/i);
});
