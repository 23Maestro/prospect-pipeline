import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260503050000_call_tracker_count_flag_null_hardening.sql', import.meta.url),
  'utf8',
);

test('count flags are null-hardened in both event views', () => {
  assert.match(sql, /counts_as_dial' then coalesce\(\(unified_events\.payload_json->>'counts_as_dial'\)::boolean, false\)/i);
  assert.match(sql, /counts_as_contact' then coalesce\(\(unified_events\.payload_json->>'counts_as_contact'\)::boolean, false\)/i);
  assert.match(sql, /counts_as_meeting_set' then coalesce\(\(unified_events\.payload_json->>'counts_as_meeting_set'\)::boolean, false\)/i);
  assert.match(sql, /counts_as_post_meeting_outcome' then coalesce\(\(unified_events\.payload_json->>'counts_as_post_meeting_outcome'\)::boolean, false\)/i);
  assert.match(sql, /cte\.counts_as_dial/i);
  assert.match(sql, /cte\.counts_as_contact/i);
  assert.match(sql, /cte\.counts_as_meeting_set/i);
  assert.match(sql, /cte\.counts_as_post_meeting_outcome/i);
});

test('view parity keeps summary dials and contacts sourced from owner-context count flags', () => {
  assert.match(sql, /create or replace view call_tracker_events_owner_context/i);
  assert.match(sql, /create or replace view call_tracker_summary as/i);
  assert.match(sql, /count\(\*\) filter \(where counts_as_dial\)::integer as dials/i);
  assert.match(sql, /count\(\*\) filter \(where counts_as_contact\)::integer as contacts/i);
  assert.doesNotMatch(sql, /count\(\*\) filter \(where activity_kind/i);
});

test('unable-to-leave-vm and meeting outcome rules are unchanged', () => {
  assert.match(sql, /normalized_activity_status = 'unable_to_leave_vm'/i);
  assert.match(sql, /tracker_outcome in \('voicemail', 'unable_to_leave_vm', 'spoke_follow_up', 'not_interested'\) then true/i);
  assert.match(sql, /tracker_outcome in \('spoke_follow_up', 'not_interested'\) then true/i);
  assert.match(sql, /tracker_outcome in \([\s\S]*'closed_won'[\s\S]*'closed_lost'[\s\S]*'reschedule_pending'[\s\S]*'rescheduled'[\s\S]*'canceled'[\s\S]*'no_show'[\s\S]*\) then true/i);
});
