import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';

const sql = readFileSync(
  new URL('../migrations/20260502011000_call_tracker_active_operator_materialization_gate.sql', import.meta.url),
  'utf8',
);

test('call tracker meeting-set lifecycle rows require active-operator materialization proof', () => {
  assert.match(sql, /A real Prospect ID event is not automatically an active-operator dashboard fact/i);
  assert.match(sql, /lifecycle_meeting_set_facts as/i);
  assert.match(sql, /from lifecycle_events le/i);
  assert.match(sql, /where le\.event_type = 'meeting_set'/i);
  assert.match(sql, /le\.payload_json->'materialization_proof'->>'materialization_status'\s*=\s*'operator_task'/i);
  assert.match(sql, /le\.payload_json->>'materialization_status'\s*=\s*'operator_task'/i);
  assert.doesNotMatch(sql, /coalesce\(nullif\(le\.payload_json->>'operator_name', ''\), 'Primary Operator'\) as source_owner/i);
  assert.doesNotMatch(sql, /'matched_weekly_task_assigned_owner'::text as owner_proof/i);
});

test('call activity rows require operator_task or explicit legacy compatibility proof', () => {
  assert.match(sql, /activity_facts as/i);
  assert.match(sql, /from call_activity_events cae/i);
  assert.match(sql, /cae\.payload_json->>'materialization_status'\s*=\s*'operator_task'/i);
  assert.match(sql, /cae\.source_owner\s*=\s*\(select active_operator_name from active_operator\)/i);
  assert.match(sql, /nullif\(cae\.owner_proof, ''\) is not null/i);
  assert.match(sql, /cae\.payload_json \? 'task_assigned_owner'/i);
});

test('meeting set side view and owner context view use the same materialization gate', () => {
  assert.match(sql, /create or replace view call_tracker_meeting_sets/i);
  assert.match(sql, /where le\.event_type = 'meeting_set'[\s\S]*lifecycle_meeting_set_materialized/i);
  assert.match(sql, /create or replace view call_tracker_events_owner_context/i);
  assert.match(sql, /coalesce\(\s*cte\.payload_json->'owner_context'->>'materialization_status'/i);
});

test('migration documents Tim and Jerami proof cases in SQL fixtures', () => {
  assert.match(sql, /Secondary Operator meeting_set lifecycle rows do not appear/i);
  assert.match(sql, /Secondary Operator call_activity_events rows do not appear/i);
  assert.match(sql, /Jerami operator_task meeting_set rows do appear/i);
  assert.match(sql, /Jerami operator_task call_activity_events rows do appear/i);
  assert.match(sql, /legacy rows without proof are excluded/i);
});

async function createFixtureDatabase() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // SQL.js executes SQLite, not Postgres. This fixture keeps a SQLite-compatible
  // copy of the materialization predicates, while the regex tests above pin the
  // deployed migration text.
  db.run(`
    create table athletes (
      athlete_key text primary key,
      athlete_name text not null
    );

    create table lifecycle_events (
      id integer primary key,
      athlete_key text not null,
      athlete_id text not null,
      athlete_main_id text not null,
      event_type text not null,
      crm_stage text,
      task_status text,
      payload_json text not null,
      dedupe_key text,
      created_at text not null
    );

    create table call_activity_events (
      id integer primary key,
      athlete_key text not null,
      athlete_id text not null,
      athlete_main_id text not null,
      athlete_name text,
      occurred_at text not null,
      activity_type text not null,
      task_title text,
      task_id text not null,
      source_owner text,
      owner_proof text,
      payload_json text not null,
      created_at text not null
    );

    create view call_tracker_events as
    with active_operator as (
      select 'Primary Operator' as active_operator_name
    ),
    activity_facts as (
      select
        cae.id,
        cae.athlete_key,
        cae.athlete_name,
        cae.task_id,
        'call_activity' as raw_event_type,
        cae.source_owner,
        cae.owner_proof,
        cae.payload_json,
        case
          when cae.activity_type in ('call_attempt_1', 'call_attempt_2', 'call_attempt_3') then 'voicemail'
          when cae.activity_type = 'spoke_to_follow_up' then 'spoke_follow_up'
          else 'needs_review'
        end as tracker_outcome
      from call_activity_events cae
      cross join active_operator
      where cae.activity_type in ('call_attempt_1', 'call_attempt_2', 'call_attempt_3', 'spoke_to_follow_up')
        and (
          json_extract(cae.payload_json, '$.materialization_proof.materialization_status') = 'operator_task'
          or json_extract(cae.payload_json, '$.materialization_status') = 'operator_task'
        )
    ),
    lifecycle_meeting_set_facts as (
      select
        le.id,
        le.athlete_key,
        athletes.athlete_name,
        null as task_id,
        'lifecycle_meeting_set' as raw_event_type,
        coalesce(
          nullif(json_extract(le.payload_json, '$.owner_context.active_operator_name'), ''),
          nullif(json_extract(le.payload_json, '$.materialization_proof.task_assigned_owner'), ''),
          nullif(json_extract(le.payload_json, '$.task_assigned_owner'), ''),
          nullif(json_extract(le.payload_json, '$.operator_name'), '')
        ) as source_owner,
        coalesce(
          nullif(json_extract(le.payload_json, '$.owner_context.owner_proof'), ''),
          nullif(json_extract(le.payload_json, '$.owner_proof'), ''),
          'materialization_proof.task_assigned_owner'
        ) as owner_proof,
        le.payload_json,
        'meeting_set' as tracker_outcome
      from lifecycle_events le
      join athletes on athletes.athlete_key = le.athlete_key
      cross join active_operator
      where le.event_type = 'meeting_set'
        and (
          json_extract(le.payload_json, '$.materialization_proof.materialization_status') = 'operator_task'
          or json_extract(le.payload_json, '$.materialization_status') = 'operator_task'
          or (
            json_extract(le.payload_json, '$.legacy_compatibility_proof') = 'weekly_operator_task_assigned_owner'
            and coalesce(
              nullif(json_extract(le.payload_json, '$.task_assigned_owner'), ''),
              nullif(json_extract(le.payload_json, '$.operator_name'), '')
            ) = (select active_operator_name from active_operator)
            and nullif(json_extract(le.payload_json, '$.owner_proof'), '') is not null
          )
        )
    )
    select * from activity_facts
    union all
    select * from lifecycle_meeting_set_facts;

    create view call_tracker_meeting_sets as
    with active_operator as (
      select 'Primary Operator' as active_operator_name
    ),
    lifecycle_meeting_set_materialized as (
      select le.*
      from lifecycle_events le
      cross join active_operator
      where le.event_type = 'meeting_set'
        and (
          json_extract(le.payload_json, '$.materialization_proof.materialization_status') = 'operator_task'
          or json_extract(le.payload_json, '$.materialization_status') = 'operator_task'
          or (
            json_extract(le.payload_json, '$.legacy_compatibility_proof') = 'weekly_operator_task_assigned_owner'
            and coalesce(
              nullif(json_extract(le.payload_json, '$.task_assigned_owner'), ''),
              nullif(json_extract(le.payload_json, '$.operator_name'), '')
            ) = (select active_operator_name from active_operator)
            and nullif(json_extract(le.payload_json, '$.owner_proof'), '') is not null
          )
        )
    )
    select
      le.id,
      le.athlete_key,
      athletes.athlete_name,
      'meeting_set' as tracker_outcome,
      le.payload_json
    from lifecycle_meeting_set_materialized le
    join athletes on athletes.athlete_key = le.athlete_key;
  `);

  return db;
}

function insertAthlete(db, key, name) {
  db.run('insert into athletes (athlete_key, athlete_name) values (?, ?)', [key, name]);
}

function insertMeetingSet(db, id, athleteKey, payload) {
  db.run(
    `insert into lifecycle_events (
      id, athlete_key, athlete_id, athlete_main_id, event_type, crm_stage, task_status, payload_json, dedupe_key, created_at
    ) values (?, ?, ?, ?, 'meeting_set', 'Meeting Set', 'confirmation_call', ?, ?, '2026-05-02T12:00:00Z')`,
    [id, athleteKey, athleteKey.split(':')[0], athleteKey.split(':')[1], JSON.stringify(payload), `meeting_set:${athleteKey}:${id}`],
  );
}

function insertCallActivity(db, id, athleteKey, payload) {
  db.run(
    `insert into call_activity_events (
      id, athlete_key, athlete_id, athlete_main_id, athlete_name, occurred_at, activity_type, task_title,
      task_id, source_owner, owner_proof, payload_json, created_at
    ) values (?, ?, ?, ?, ?, '2026-05-02T12:00:00Z', 'call_attempt_1', 'Call Attempt 1', ?, ?, ?, ?, '2026-05-02T12:00:00Z')`,
    [
      id,
      athleteKey,
      athleteKey.split(':')[0],
      athleteKey.split(':')[1],
      `Athlete ${id}`,
      `task-${id}`,
      payload.source_owner || null,
      payload.owner_proof || null,
      JSON.stringify(payload),
    ],
  );
}

function allRows(db, sqlText) {
  const result = db.exec(sqlText);
  if (!result[0]) return [];
  const { columns, values } = result[0];
  return values.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
}

test('SQL fixture materializes only active-operator meeting-set lifecycle rows', async () => {
  const db = await createFixtureDatabase();
  const fixtures = [
    ['100:200', 'Jerami Operator Task'],
    ['101:201', 'Tim Calendar Bleed'],
    ['102:202', 'Ryan Calendar Bleed'],
    ['103:203', 'Legacy Jerami Proven'],
    ['104:204', 'Legacy Jerami Unproven'],
  ];
  fixtures.forEach(([key, name]) => insertAthlete(db, key, name));

  insertMeetingSet(db, 1, '100:200', {
    materialization_proof: {
      materialization_status: 'operator_task',
      task_assigned_owner: 'Primary Operator',
    },
    meeting_name: 'Jerami Operator Task',
  });
  insertMeetingSet(db, 2, '101:201', {
    materialization_proof: {
      materialization_status: 'not_operator_task',
      task_assigned_owner: 'Secondary Operator',
    },
    meeting_name: 'Tim Calendar Bleed',
  });
  insertMeetingSet(db, 3, '102:202', {
    materialization_status: 'not_operator_task',
    task_assigned_owner: 'Head Scout D',
    meeting_name: 'Ryan Calendar Bleed',
  });
  insertMeetingSet(db, 4, '103:203', {
    legacy_compatibility_proof: 'weekly_operator_task_assigned_owner',
    task_assigned_owner: 'Primary Operator',
    owner_proof: 'weekly_task.assigned_owner',
    meeting_name: 'Legacy Jerami Proven',
  });
  insertMeetingSet(db, 5, '104:204', {
    task_assigned_owner: 'Primary Operator',
    meeting_name: 'Legacy Jerami Unproven',
  });

  assert.deepEqual(
    allRows(db, "select athlete_name from call_tracker_events where tracker_outcome = 'meeting_set' order by id").map(
      (row) => row.athlete_name,
    ),
    ['Jerami Operator Task', 'Legacy Jerami Proven'],
  );
  assert.deepEqual(
    allRows(db, 'select athlete_name from call_tracker_meeting_sets order by id').map((row) => row.athlete_name),
    ['Jerami Operator Task', 'Legacy Jerami Proven'],
  );

  db.close();
});

test('SQL fixture respects call activity materialization status without Tim-specific assumptions', async () => {
  const db = await createFixtureDatabase();
  insertCallActivity(db, 1, '200:300', {
    materialization_status: 'operator_task',
    source_owner: 'Primary Operator',
    owner_proof: 'task.assigned_owner',
  });
  insertCallActivity(db, 2, '201:301', {
    materialization_status: 'not_operator_task',
    source_owner: 'Other Owner',
    owner_proof: 'task.assigned_owner',
  });

  assert.deepEqual(
    allRows(db, "select task_id from call_tracker_events where raw_event_type = 'call_activity' order by id").map(
      (row) => row.task_id,
    ),
    ['task-1'],
  );

  db.close();
});
