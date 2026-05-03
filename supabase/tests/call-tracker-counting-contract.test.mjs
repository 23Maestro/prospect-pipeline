import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';

const sql = readFileSync(
  new URL('../migrations/20260503030000_call_tracker_counting_contract.sql', import.meta.url),
  'utf8',
);

test('migration exposes reporting booleans and does not count from activity_kind', () => {
  assert.match(sql, /counts_as_dial/i);
  assert.match(sql, /counts_as_contact/i);
  assert.match(sql, /counts_as_meeting_set/i);
  assert.match(sql, /counts_as_post_meeting_outcome/i);
  assert.match(sql, /count\(\*\) filter \(where counts_as_dial\)::integer as dials/i);
  assert.match(sql, /count\(\*\) filter \(where counts_as_contact\)::integer as contacts/i);

  const summarySql = sql.match(/create or replace view call_tracker_summary as[\s\S]*?from call_tracker_events;/i)?.[0] || '';
  assert.doesNotMatch(summarySql, /activity_kind/i);
  assert.doesNotMatch(summarySql, /tracker_outcome\s*=\s*'spoke_follow_up'[\s\S]*as contacts/i);
});

async function createFixtureDatabase() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    create table events (
      id integer primary key,
      raw_event_type text not null,
      raw_crm_stage text,
      raw_task_status text,
      tracker_outcome text not null
    );

    create view counted_events as
    select
      *,
      case
        when tracker_outcome = 'meeting_set' then 1
        when raw_event_type = 'call_activity'
          and tracker_outcome in ('voicemail', 'unable_to_leave_vm', 'spoke_follow_up', 'not_interested') then 1
        when lower(coalesce(raw_crm_stage, '')) in (
          'left voice mail 1',
          'left voicemail 1',
          'left voice mail 2',
          'left voicemail 2',
          'never spoke to'
        ) then 1
        when lower(coalesce(raw_crm_stage, '')) like '%called%unable%leave%vm%' then 1
        when lower(coalesce(raw_crm_stage, '')) like 'spoke to%' then 1
        else 0
      end as counts_as_dial,
      case
        when tracker_outcome = 'meeting_set' then 1
        when raw_event_type = 'call_activity'
          and tracker_outcome in ('spoke_follow_up', 'not_interested') then 1
        when lower(coalesce(raw_crm_stage, '')) like 'spoke to%' then 1
        else 0
      end as counts_as_contact,
      case when tracker_outcome = 'meeting_set' then 1 else 0 end as counts_as_meeting_set,
      case
        when tracker_outcome in ('closed_won', 'closed_lost', 'reschedule_pending', 'rescheduled', 'canceled', 'no_show') then 1
        else 0
      end as counts_as_post_meeting_outcome
    from events;
  `);

  return db;
}

function insertEvent(db, id, rawEventType, trackerOutcome, rawCrmStage = null, rawTaskStatus = null) {
  db.run(
    'insert into events (id, raw_event_type, tracker_outcome, raw_crm_stage, raw_task_status) values (?, ?, ?, ?, ?)',
    [id, rawEventType, trackerOutcome, rawCrmStage, rawTaskStatus],
  );
}

function oneRow(db, id) {
  const result = db.exec('select * from counted_events where id = ' + Number(id));
  const { columns, values } = result[0];
  return Object.fromEntries(columns.map((column, index) => [column, values[0][index]]));
}

test('older rows without stored flags resolve to the counting contract', async () => {
  const db = await createFixtureDatabase();

  insertEvent(db, 1, 'call_activity', 'voicemail', null, 'call_attempt_1');
  insertEvent(db, 2, 'call_activity', 'spoke_follow_up', null, 'spoke_to_follow_up');
  insertEvent(db, 3, 'lifecycle_meeting_set', 'meeting_set', 'Meeting Set', 'confirmation_call');
  insertEvent(db, 4, 'post_meeting_outcome', 'closed_won', 'Actual Meeting - Close Won');
  insertEvent(db, 5, 'post_meeting_outcome', 'closed_lost', 'Actual Meeting - Close Lost');
  insertEvent(db, 6, 'post_meeting_outcome', 'no_show', 'Meeting Result - No Show');
  insertEvent(db, 7, 'call_activity', 'not_interested', 'Spoke to - Not Interested');
  insertEvent(db, 8, 'call_activity', 'spoke_follow_up', 'Spoke to - Too Young');
  insertEvent(db, 9, 'call_activity', 'unable_to_leave_vm', 'Called - Unable to Leave VM');

  assert.deepEqual(
    [
      oneRow(db, 1).counts_as_dial,
      oneRow(db, 1).counts_as_contact,
      oneRow(db, 1).counts_as_meeting_set,
      oneRow(db, 1).counts_as_post_meeting_outcome,
    ],
    [1, 0, 0, 0],
  );
  assert.deepEqual([oneRow(db, 2).counts_as_dial, oneRow(db, 2).counts_as_contact], [1, 1]);
  assert.deepEqual(
    [
      oneRow(db, 3).counts_as_dial,
      oneRow(db, 3).counts_as_contact,
      oneRow(db, 3).counts_as_meeting_set,
      oneRow(db, 3).counts_as_post_meeting_outcome,
    ],
    [1, 1, 1, 0],
  );
  for (const id of [4, 5, 6]) {
    assert.deepEqual(
      [
        oneRow(db, id).counts_as_dial,
        oneRow(db, id).counts_as_contact,
        oneRow(db, id).counts_as_post_meeting_outcome,
      ],
      [0, 0, 1],
    );
  }
  assert.deepEqual([oneRow(db, 7).counts_as_dial, oneRow(db, 7).counts_as_contact], [1, 1]);
  assert.notEqual(oneRow(db, 7).tracker_outcome, 'closed_lost');
  assert.deepEqual([oneRow(db, 8).counts_as_dial, oneRow(db, 8).counts_as_contact], [1, 1]);
  assert.notEqual(oneRow(db, 8).tracker_outcome, 'closed_lost');
  assert.notEqual(oneRow(db, 8).tracker_outcome, 'inactive');
  assert.deepEqual([oneRow(db, 9).counts_as_dial, oneRow(db, 9).counts_as_contact], [1, 0]);

  db.close();
});
