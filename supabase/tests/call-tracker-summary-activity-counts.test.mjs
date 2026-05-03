import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../migrations/20260503030000_call_tracker_counting_contract.sql', import.meta.url), 'utf8');

test('summary exposes dials and contacts from explicit count flags', () => {
  assert.match(sql, /as dials\b/i);
  assert.match(sql, /count\(\*\) filter \(where counts_as_dial\)::integer as dials/i);
  assert.match(sql, /as contacts\b/i);
  assert.match(sql, /count\(\*\) filter \(where counts_as_contact\)::integer as contacts/i);
});

test('summary treats meeting set as dial contact and meeting evidence through flags', () => {
  assert.match(sql, /count\(\*\) filter \(where counts_as_meeting_set\)::integer as meetings_set/i);
  assert.match(sql, /when unified_events\.tracker_outcome = 'meeting_set' then true/i);
});

test('summary does not let post-meeting outcomes inflate dials or contacts', () => {
  assert.match(sql, /count\(\*\) filter \(where counts_as_post_meeting_outcome\)::integer as meeting_outcomes_total/i);
  assert.match(sql, /tracker_outcome in \('closed_won', 'closed_lost', 'reschedule_pending', 'rescheduled', 'canceled', 'no_show'\) then true/i);
});
