import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./materialize-call-tracker-data-contract.mjs', import.meta.url), 'utf8');
const artifact = JSON.parse(
  readFileSync(
    new URL('../apps/prospect-web/public/prospect-call-tracker/data-contract.json', import.meta.url),
    'utf8',
  ),
);

test('artifact summary cards keep raw all-time contacts separate from visible correction', () => {
  assert.equal(artifact.data.summary.contacts, artifact.data.ui.summaryCards.rawContacts);
  assert.equal(
    artifact.data.ui.summaryCards.contacts,
    artifact.data.summary.contacts + artifact.data.ui.summaryCards.historicalContactsAdjustment,
  );
  assert.equal(artifact.data.summary.dials, artifact.data.ui.summaryCards.dials);
});

test('period cards are scoped from event booleans, not all-time summary totals', () => {
  assert.match(source, /function rowsForPeriod\(rows, now, period\)/);
  assert.match(source, /const scoped = rowsForPeriod\(rows, now, period\)/);
  assert.match(source, /const dials = scoped\.filter\(\(row\) => row\.counts_as_dial === true\)\.length/);
  assert.match(source, /const contacts = scoped\.filter\(\(row\) => row\.counts_as_contact === true\)\.length/);
  assert.match(source, /contacts: correctedAllTimeContacts/);
  assert.match(source, /rawContacts: rawAllTimeContacts/);
  assert.match(source, /dials: Number\(summary\.dials\) \|\| 0/);
});

test('materializer reads lifecycle task facts directly instead of depending on backsync writes', () => {
  assert.match(source, /buildCallActivityEventFromLifecycle/);
  assert.match(source, /lifecycle_events\?select=/);
  assert.match(source, /lifecycle_call_activity/);
  assert.match(source, /mergeEventRows\(viewEvents, lifecycleEvents\)/);
});

test('materialized event rows carry non-null count booleans with key outcome invariants', () => {
  for (const row of artifact.data.events || []) {
    assert.equal(typeof row.counts_as_dial, 'boolean', `${row.athlete_name || row.dedupe_key} missing dial boolean`);
    assert.equal(typeof row.counts_as_contact, 'boolean', `${row.athlete_name || row.dedupe_key} missing contact boolean`);
    assert.equal(typeof row.counts_as_meeting_set, 'boolean', `${row.athlete_name || row.dedupe_key} missing meeting_set boolean`);
    assert.equal(typeof row.counts_as_post_meeting_outcome, 'boolean', `${row.athlete_name || row.dedupe_key} missing post_meeting boolean`);

    if (row.tracker_outcome === 'unable_to_leave_vm') {
      assert.equal(row.counts_as_dial, true);
      assert.equal(row.counts_as_contact, false);
    }
    if (row.tracker_outcome === 'meeting_set') {
      assert.equal(row.counts_as_meeting_set, true);
    }
    if (['closed_won', 'closed_lost', 'reschedule_pending', 'rescheduled', 'canceled', 'no_show'].includes(row.tracker_outcome)) {
      assert.equal(row.counts_as_post_meeting_outcome, true);
    }
  }
});
