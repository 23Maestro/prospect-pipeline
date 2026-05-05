import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  buildLifecycleMutationEvent,
  buildAppointmentId,
  buildAthleteKey,
  buildReminderDedupeKey,
  resolveLifecycleRetentionDecision,
} from './supabase-lifecycle';

test('buildAthleteKey keeps athlete and main id together', () => {
  assert.equal(buildAthleteKey('123', '456'), '123:456');
});

test('buildAppointmentId prefers explicit appointment id', () => {
  assert.equal(
    buildAppointmentId({
      athleteId: '123',
      athleteMainId: '456',
      appointmentId: 'evt_1',
      startsAt: '2026-04-21T10:00:00-04:00',
    }),
    'evt_1',
  );
});

test('buildAppointmentId falls back to athlete key + starts_at', () => {
  assert.equal(
    buildAppointmentId({
      athleteId: '123',
      athleteMainId: '456',
      startsAt: '2026-04-21T10:00:00-04:00',
    }),
    'appointment:123:456:2026-04-21T14:00:00.000Z',
  );
});

test('buildReminderDedupeKey normalizes send_at', () => {
  assert.equal(
    buildReminderDedupeKey({
      appointmentId: 'evt_1',
      kind: 'confirmation',
      suffix: 'queued',
      sendAt: '2026-04-22T09:30:00-04:00',
    }),
    'evt_1:confirmation:queued:2026-04-22T13:30:00.000Z',
  );
});

test('enrollment event titles purge lifecycle rows even if supabase is stale', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Set',
    bookedEventTitle: '(ENR $69) Victor Williams Football 2028 TX',
  });

  assert.equal(result.action, 'purge');
});

test('(FU) event titles soft archive active meeting rows', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Set',
    bookedEventTitle: '(FU) Terry Smith Football 2028 TX',
  });

  assert.equal(result.action, 'soft_archive');
});

test('(CAN) event titles soft archive active meeting rows', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Result - Canceled',
    bookedEventTitle: '(CAN) Levi Childers Football 2026 CA',
  });

  assert.equal(result.action, 'soft_archive');
});

test('(NS) event titles soft archive active meeting rows', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Set',
    bookedEventTitle: '(NS) Terry Smith Football 2028 TX',
  });

  assert.equal(result.action, 'soft_archive');
});

test('(CL) event titles purge lifecycle rows as close lost', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Set',
    bookedEventTitle: '(CL) Terry Smith Football 2028 TX',
  });

  assert.equal(result.action, 'purge');
});

test('terminal crm stages purge lifecycle rows without title help', () => {
  const result = resolveLifecycleRetentionDecision({
    liveCrmStage: 'Actual Meeting Closed Won',
  });

  assert.equal(result.action, 'purge');
});

test('lifecycle mutation event logs left voicemail as dial-only operator activity', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/tasks/complete',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    crmStage: 'Left Voice Mail 1',
    taskId: '9901',
    taskTitle: 'Call Attempt 1',
    taskAssignedOwner: 'Jerami Singleton',
    completedAt: '2026-05-01T14:30:00.000Z',
  });

  assert.equal(event.eventType, 'task_completed');
  assert.equal(event.payload.source_post, '/tasks/complete');
  assert.equal(event.payload.athlete_name, 'Avery Jones');
  assert.equal(event.payload.task_id, '9901');
  assert.equal(event.payload.activity_subtype, 'call_attempt_1');
  assert.equal(event.payload.activity_kind, 'dial');
  assert.equal(event.payload.counts_as_dial, true);
  assert.equal(event.payload.counts_as_contact, false);
  assert.equal(event.payload.completed_at, '2026-05-01T14:30:00.000Z');
  assert.equal(event.payload.occurred_at, '2026-05-01T14:30:00.000Z');
  assert.equal(event.payload.operator_owner, 'Jerami Singleton');
  assert.equal(event.payload.operator_owner_key, 'jerami_singleton');
  assert.equal(event.payload.task_assigned_owner, 'Jerami Singleton');
  assert.equal(event.payload.owner_proof, 'task.assigned_owner');
  assert.equal(event.payload.materialization_status, 'operator_task');
});

test('lifecycle mutation countable activity requires athlete name', () => {
  assert.throws(
    () =>
      buildLifecycleMutationEvent({
        sourcePost: '/tasks/complete',
        athleteId: '1489000',
        athleteMainId: '951000',
        athleteName: '',
        crmStage: 'Left Voice Mail 1',
        taskId: '9901',
        taskTitle: 'Call Attempt 1',
        taskAssignedOwner: 'Jerami Singleton',
        completedAt: '2026-05-01T14:30:00.000Z',
      }),
    /requires athleteName/,
  );
});

test('lifecycle mutation event keeps unable to leave voicemail dial-only', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/tasks/complete',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    crmStage: 'Called - Unable to Leave VM',
    taskId: '9902',
    taskTitle: 'Called - Unable to Leave VM',
    taskAssignedOwner: 'Jerami Singleton',
    completedAt: '2026-05-01T15:30:00.000Z',
  });

  assert.equal(event.payload.activity_subtype, 'unable_to_leave_vm');
  assert.equal(event.payload.activity_kind, 'dial');
  assert.equal(event.payload.counts_as_dial, true);
  assert.equal(event.payload.counts_as_contact, false);
});

test('lifecycle mutation event logs spoke to too young as dial and contact', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/tasks/complete',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    crmStage: 'Spoke to - Too Young',
    taskId: '9903',
    taskTitle: 'Spoke to - Too Young',
    taskAssignedOwner: 'Jerami Singleton',
    completedAt: '2026-05-01T16:30:00.000Z',
  });

  assert.equal(event.payload.activity_subtype, 'spoke_to_too_young');
  assert.equal(event.payload.activity_kind, 'contact');
  assert.equal(event.payload.counts_as_dial, true);
  assert.equal(event.payload.counts_as_contact, true);
});

test('meeting set lifecycle mutation derives owner proof from task assignment when payload proof is absent', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/sales/meeting-set',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    crmStage: 'Meeting Set',
    taskId: '9907',
    taskTitle: 'Confirmation Call',
    taskAssignedOwner: 'Jerami Singleton',
    occurredAt: '2026-05-01T19:30:00.000Z',
    appointmentId: '613999',
  });

  assert.equal(event.eventType, 'meeting_set');
  assert.equal(event.payload.counts_as_dial, true);
  assert.equal(event.payload.counts_as_contact, true);
  assert.equal(event.payload.counts_as_meeting_set, true);
  assert.equal(event.payload.task_assigned_owner, 'Jerami Singleton');
  assert.equal(event.payload.owner_proof, 'task.assigned_owner');
  assert.equal((event.payload.owner_context as Record<string, unknown>).owner_proof, 'task.assigned_owner');
});

test('meeting set lifecycle mutation preserves existing owner proof mirrors while normalizing canonical fields', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/sales/meeting-set',
    athleteId: '1490499',
    athleteMainId: '952328',
    athleteName: 'Elia Imani',
    crmStage: 'Meeting Set',
    taskId: '626651',
    taskTitle: 'Confirmation Call',
    taskAssignedOwner: 'Jerami Singleton',
    occurredAt: '2026-05-04T19:00:00.000Z',
    appointmentId: '588339',
    payload: {
      owner_proof: 'raycast_operator_context',
      booked_meeting_assigned_owner: 'Ryan Lietz',
      owner_context: {
        booked_meeting_assigned_owner: 'Ryan Lietz',
        resolved_owner_name: 'Ryan Lietz',
        appointment_setter_legacy_user_id: '1354049',
      },
      materialization_proof: {
        owner_proof: 'raycast_operator_context',
      },
    },
  });

  const ownerContext = event.payload.owner_context as Record<string, unknown>;
  const materializationProof = event.payload.materialization_proof as Record<string, unknown>;
  assert.equal(event.payload.owner_proof, 'raycast_operator_context');
  assert.equal(event.payload.task_assigned_owner, 'Jerami Singleton');
  assert.equal(event.payload.booked_meeting_assigned_owner, 'Ryan Lietz');
  assert.equal(ownerContext.booked_meeting_assigned_owner, 'Ryan Lietz');
  assert.equal(ownerContext.resolved_owner_name, 'Ryan Lietz');
  assert.equal(ownerContext.appointment_setter_legacy_user_id, '1354049');
  assert.equal(materializationProof.owner_proof, 'raycast_operator_context');
  assert.equal(materializationProof.materialization_status, 'operator_task');
});

test('lifecycle mutation event rejects missing occurrence clock for countable activity', () => {
  assert.throws(
    () =>
      buildLifecycleMutationEvent({
        sourcePost: '/tasks/complete',
        athleteId: '1489000',
        athleteMainId: '951000',
        athleteName: 'Avery Jones',
        crmStage: 'Left Voice Mail 1',
        taskId: '9904',
        taskTitle: 'Call Attempt 1',
        taskAssignedOwner: 'Jerami Singleton',
      }),
    /requires completedAt, occurredAt, or dueAt/,
  );
});

test('lifecycle mutation event rejects missing raw CRM stage for countable activity', () => {
  assert.throws(
    () =>
      buildLifecycleMutationEvent({
        sourcePost: '/tasks/complete',
        athleteId: '1489000',
        athleteMainId: '951000',
        athleteName: 'Avery Jones',
        taskId: '9904',
        taskTitle: 'Call Attempt 1',
        taskAssignedOwner: 'Jerami Singleton',
        completedAt: '2026-05-01T17:30:00.000Z',
      }),
    /requires raw crmStage/,
  );
});

test('lifecycle mutation event rejects missing owner proof for countable activity', () => {
  assert.throws(
    () =>
      buildLifecycleMutationEvent({
        sourcePost: '/tasks/complete',
        athleteId: '1489000',
        athleteMainId: '951000',
        athleteName: 'Avery Jones',
        crmStage: 'Left Voice Mail 1',
        taskId: '9905',
        taskTitle: 'Call Attempt 1',
        completedAt: '2026-05-01T17:30:00.000Z',
      }),
    /requires taskAssignedOwner/,
  );
});

test('lifecycle mutation event keeps Tim-owned call activity non-materialized and non-countable', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/tasks/complete',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    crmStage: 'Spoke to - Too Young',
    taskId: '9906',
    taskTitle: 'Spoke to - Too Young',
    taskAssignedOwner: 'Tim Risner',
    completedAt: '2026-05-01T18:30:00.000Z',
  });

  assert.equal(event.payload.activity_subtype, 'spoke_to_too_young');
  assert.equal(event.payload.materialization_status, 'not_operator_task');
  assert.equal(event.payload.materialization_reason, 'task_assigned_owner_is_other_owner');
  assert.equal(event.payload.counts_as_dial, false);
  assert.equal(event.payload.counts_as_contact, false);
});

test('Laravel POST wrappers call the shared lifecycle mutation writer after success', () => {
  const scoutPrepSource = fs.readFileSync('src/lib/scout-prep.tsx', 'utf8');
  const salesStageSource = fs.readFileSync('src/lib/sales-stage.ts', 'utf8');

  assert.match(scoutPrepSource, /recordLifecycleMutation\(\{\s*sourcePost: '\/tasks\/complete'/);
  assert.match(scoutPrepSource, /recordLifecycleMutation\(\{\s*sourcePost: '\/tasks\/update'/);
  assert.match(scoutPrepSource, /recordLifecycleMutation\(\{\s*sourcePost: '\/tasks\/call-attempt-3-sent'/);
  assert.match(scoutPrepSource, /recordLifecycleMutation\(\{\s*sourcePost: '\/tasks\/follow-up-message-sent'/);
  assert.match(salesStageSource, /recordLifecycleMutation\(\{\s*sourcePost: '\/sales\/stage'/);
});

test('shared lifecycle mutation writer upserts call activity facts at action time', () => {
  const source = fs.readFileSync('src/lib/supabase-lifecycle.ts', 'utf8');

  assert.match(source, /buildCallActivityFact/);
  assert.match(source, /request\(config, 'call_activity_events'/);
  assert.match(source, /onConflict: 'task_id'/);
  assert.match(source, /rawCrmStage: event\.state\.crmStage/);
  assert.match(source, /rawTaskStatus: event\.state\.taskStatus/);
});

test('sales stage wrapper does not let generic lifecycle sync block Meeting Set task completion', () => {
  const salesStageSource = fs.readFileSync('src/lib/sales-stage.ts', 'utf8');

  assert.match(salesStageSource, /classifyMeetingSetStage\(resolvedStage\)/);
  assert.match(salesStageSource, /SALES_STAGE_LIFECYCLE_SYNC/);
  assert.match(salesStageSource, /catch \(error\)/);
});

test('Laravel POST wrappers do not hand-build lifecycle mutation payload keys', () => {
  const scoutPrepSource = fs.readFileSync('src/lib/scout-prep.tsx', 'utf8');
  const salesStageSource = fs.readFileSync('src/lib/sales-stage.ts', 'utf8');
  const forbiddenKeys = [
    'source_post',
    'activity_subtype',
    'owner_proof',
    'materialization_status',
    'materialization_reason',
  ];

  for (const key of forbiddenKeys) {
    assert.doesNotMatch(scoutPrepSource, new RegExp(`${key}\\s*:`));
    assert.doesNotMatch(salesStageSource, new RegExp(`${key}\\s*:`));
  }
});
