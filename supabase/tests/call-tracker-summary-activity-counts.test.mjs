import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../migrations/20260502001000_call_tracker_summary_activity_counts.sql', import.meta.url), 'utf8');

test('summary exposes dials and contacts from call activity rows', () => {
  assert.match(sql, /as dials\b/i);
  assert.match(sql, /raw_event_type = 'call_activity'[\s\S]*tracker_outcome in \('voicemail', 'spoke_follow_up'\)/i);
  assert.match(sql, /as contacts\b/i);
  assert.match(sql, /raw_event_type = 'call_activity'[\s\S]*tracker_outcome = 'spoke_follow_up'/i);
});

test('summary treats meeting set as contact evidence without making dials depend on meetings', () => {
  const dialsExpression = sql.match(
    /count\(\*\) filter \(\s*where raw_event_type = 'call_activity'[\s\S]*?\)::integer as dials/i,
  )?.[0] || '';
  const contactsExpression = sql.match(
    /count\(\*\) filter \(\s*where \([\s\S]*?\)::integer as contacts/i,
  )?.[0] || '';

  assert.doesNotMatch(dialsExpression, /meeting_set/i);
  assert.match(contactsExpression, /tracker_outcome = 'meeting_set'/i);
});
