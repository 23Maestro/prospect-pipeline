import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  buildCallActivityEventFromLifecycle,
  classifyLifecycleActivityCandidate,
} from './lifecycle-call-tracker-backsync-core.mjs';

function lifecycle(overrides = {}) {
  return {
    id: overrides.id || '00000000-0000-4000-8000-000000000001',
    athlete_key: 'athlete:1:2',
    athlete_id: '1',
    athlete_main_id: '2',
    event_type: 'sales_stage_changed',
    crm_stage: overrides.crm_stage || null,
    task_status: overrides.task_status || null,
    dedupe_key: overrides.dedupe_key || null,
    payload_json: {
      materialization_status: 'operator_task',
      task_assigned_owner: 'Jerami Singleton',
      owner_proof: 'payload.task_assigned_owner',
      ...(overrides.payload_json || {}),
    },
    created_at: overrides.created_at || '2026-04-15T15:00:00.000Z',
    ...overrides,
  };
}

test('Left Voice Mail 1 lifecycle row becomes dial only call activity', () => {
  const row = buildCallActivityEventFromLifecycle(lifecycle({ crm_stage: 'Left Voice Mail 1' }), {
    updatedAt: '2026-05-03T12:00:00.000Z',
  });

  assert.equal(row.activity_subtype, 'call_attempt_1');
  assert.equal(row.activity_kind, 'dial');
  assert.equal(row.payload_json.counts_as_dial, true);
  assert.equal(row.payload_json.counts_as_contact, false);
});

test('lifecycle activity uses due_at as occurrence time before lifecycle sync time', () => {
  const row = buildCallActivityEventFromLifecycle(lifecycle({
    crm_stage: 'Left Voice Mail 1',
    created_at: '2026-05-01T20:30:00.000Z',
    payload_json: {
      materialization_status: 'operator_task',
      task_assigned_owner: 'Jerami Singleton',
      owner_proof: 'payload.task_assigned_owner',
      due_at: '2026-04-29T14:15:00.000Z',
    },
  }));

  assert.equal(row.occurred_at, '2026-04-29T14:15:00.000Z');
  assert.equal(row.payload_json.lifecycle_created_at, '2026-05-01T20:30:00.000Z');
  assert.equal(row.payload_json.occurred_at_source, 'payload.due_at');
});

test('lifecycle activity uses completion_date before due_at when present', () => {
  const row = buildCallActivityEventFromLifecycle(lifecycle({
    crm_stage: 'Spoke to - Not Interested',
    payload_json: {
      materialization_status: 'operator_task',
      task_assigned_owner: 'Jerami Singleton',
      owner_proof: 'payload.task_assigned_owner',
      due_at: '2026-04-29T14:15:00.000Z',
      completion_date: '2026-04-30T18:45:00.000Z',
    },
  }));

  assert.equal(row.occurred_at, '2026-04-30T18:45:00.000Z');
  assert.equal(row.payload_json.occurred_at_source, 'payload.completion_date');
});

test('Called - Unable to Leave VM lifecycle row stays dial only', () => {
  const row = buildCallActivityEventFromLifecycle(lifecycle({ crm_stage: 'Called - Unable to Leave VM' }));

  assert.equal(row.activity_subtype, 'unable_to_leave_vm');
  assert.equal(row.activity_kind, 'dial');
  assert.equal(row.payload_json.counts_as_dial, true);
  assert.equal(row.payload_json.counts_as_contact, false);
});

test('Spoke to - Not Interested lifecycle row becomes dial plus contact', () => {
  const row = buildCallActivityEventFromLifecycle(lifecycle({ crm_stage: 'Spoke to - Not Interested' }));

  assert.equal(row.activity_subtype, 'spoke_to_not_interested');
  assert.equal(row.activity_kind, 'contact');
  assert.equal(row.payload_json.counts_as_dial, true);
  assert.equal(row.payload_json.counts_as_contact, true);
});

test('Spoke to - Too Young lifecycle row becomes dial plus contact', () => {
  const row = buildCallActivityEventFromLifecycle(lifecycle({ crm_stage: 'Spoke to - Too Young' }));

  assert.equal(row.activity_subtype, 'spoke_to_too_young');
  assert.equal(row.activity_kind, 'contact');
  assert.equal(row.payload_json.counts_as_dial, true);
  assert.equal(row.payload_json.counts_as_contact, true);
});

test('lifecycle promotion preserves athlete name from payload or row snapshot', () => {
  const payloadNamedRow = buildCallActivityEventFromLifecycle(lifecycle({
    crm_stage: 'Spoke to - Not Interested',
    payload_json: {
      materialization_status: 'operator_task',
      task_assigned_owner: 'Jerami Singleton',
      owner_proof: 'payload.task_assigned_owner',
      athlete_name: 'Payload Prospect',
    },
  }));
  const rowNamedRow = buildCallActivityEventFromLifecycle(lifecycle({
    crm_stage: 'Spoke to - Not Interested',
    athlete_name: 'Row Prospect',
  }));

  assert.equal(payloadNamedRow.athlete_name, 'Payload Prospect');
  assert.equal(rowNamedRow.athlete_name, 'Row Prospect');
});

test('lifecycle row without active-operator proof is excluded', () => {
  const candidate = classifyLifecycleActivityCandidate(lifecycle({
    crm_stage: 'Left Voice Mail 1',
    payload_json: {},
  }));

  assert.equal(candidate.eligible, false);
  assert.equal(candidate.reason, 'missing_operator_proof');
});

test('lifecycle row with Tim owner proof is excluded', () => {
  const candidate = classifyLifecycleActivityCandidate(lifecycle({
    crm_stage: 'Spoke to - Not Interested',
    payload_json: {
      materialization_status: 'operator_task',
      task_assigned_owner: 'Tim Risner',
      owner_proof: 'payload.task_assigned_owner',
    },
  }));

  assert.equal(candidate.eligible, false);
  assert.equal(candidate.reason, 'tim_or_non_operator_proof');
});

test('pipeline_task_backfill_current snapshot without proof is excluded', () => {
  const candidate = classifyLifecycleActivityCandidate(lifecycle({
    event_type: 'pipeline_task_backfill_current',
    crm_stage: 'Left Voice Mail 2',
    payload_json: {},
  }));

  assert.equal(candidate.eligible, false);
  assert.equal(candidate.reason, 'snapshot_without_task_id');
});

test('operator-owned pipeline snapshot with task id is eligible activity evidence', () => {
  const candidate = classifyLifecycleActivityCandidate(lifecycle({
    event_type: 'pipeline_task_backfill_current',
    crm_stage: 'Left Voice Mail 2',
    payload_json: {
      task_id: '626001',
      assigned_owner: 'Jerami Singleton',
    },
  }));

  assert.equal(candidate.eligible, true);
  assert.equal(candidate.taskId, '626001');
  assert.equal(candidate.activity.activitySubtype, 'call_attempt_2');
});

test('crm stage wins over stale task status when classifying lifecycle activity', () => {
  const row = buildCallActivityEventFromLifecycle(lifecycle({
    event_type: 'pipeline_task_backfill_current',
    crm_stage: 'Spoke to - Follow Up',
    task_status: 'call_attempt_3',
    payload_json: {
      task_id: '626382',
      assigned_owner: 'Jerami Singleton',
    },
  }));

  assert.equal(row.activity_subtype, 'spoke_to_follow_up');
  assert.equal(row.activity_kind, 'contact');
  assert.equal(row.payload_json.counts_as_dial, true);
  assert.equal(row.payload_json.counts_as_contact, true);
});

test('meeting_set lifecycle rows are not promoted into call activity', () => {
  const candidate = classifyLifecycleActivityCandidate(lifecycle({
    event_type: 'meeting_set',
    crm_stage: 'Meeting Set',
    task_status: 'Call Attempt 2',
  }));

  assert.equal(candidate.eligible, false);
  assert.equal(candidate.reason, 'meeting_set_lifecycle_event');
});

test('backsync replaces suppressed open queue placeholders when completed lifecycle facts arrive', () => {
  const source = readFileSync(new URL('./backsync-lifecycle-call-activity-events.mjs', import.meta.url), 'utf8');

  assert.match(source, /source_family=eq\.call_activity_events&fact_type=eq\.call_activity/);
  assert.match(source, /upsertCallActivityEvents/);
  assert.doesNotMatch(source, /call_activity_events\?on_conflict=task_id/);
  assert.match(source, /function isSuppressedOpenQueuePlaceholder/);
  assert.match(source, /suppressed_from_call_activity_reporting === true/);
  assert.match(source, /queue_item_status === 'open_queue_item'/);
  assert.match(source, /open_new_opportunity_queue_item_not_call_activity/);
  assert.match(source, /!isSuppressedOpenQueuePlaceholder\(existing\)/);
});
