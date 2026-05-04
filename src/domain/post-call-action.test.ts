import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPostCallActionPlan } from './post-call-action';

test('Tim Risner tasks can update Laravel but do not materialize Jerami dashboard facts', () => {
  const plan = buildPostCallActionPlan({
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    stageLabel: 'Spoke to - Follow Up',
    tasks: [
      {
        task_id: '9901',
        title: 'Scheduled Follow Up',
        assigned_owner: 'Tim Risner',
        completion_date: '',
      },
    ],
  });

  assert.equal(plan.laravelSalesStageUpdate?.stage, 'Spoke to - I Need To Follow Up');
  assert.equal(plan.laravelTaskCompletion?.taskId, '9901');
  assert.equal(plan.ownerContext.taskAssignedOwner, 'Tim Risner');
  assert.equal(plan.ownerContext.materializationStatus, 'not_operator_task');
  assert.equal(plan.materializationStatus, 'not_operator_task');
  assert.equal(plan.supabaseFactWrite, null);
});

test('Meeting Set submit builds Supabase writes only when active-operator proof exists', () => {
  const operatorPlan = buildPostCallActionPlan({
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    stageLabel: 'Meeting Set',
    tasks: [
      {
        task_id: '9902',
        title: 'Call Attempt 1',
        assigned_owner: 'Jerami Singleton',
        completion_date: '',
      },
    ],
    meetingSet: {
      meetingName: 'Avery Jones Soccer 2027 PA',
      meetingTimezone: 'EST',
      assignedToLegacyUserId: '1418529',
      meetingForLegacyUserId: '1418529',
      openEventId: '613999',
      calendarOwnerId: 'OrJsV8nhBouEzKY',
      bookedMeetingAssignedOwner: 'Jeffrey Stein',
      taskDescription: 'Main Number:\nOther Details:',
      startTime: '19:00',
      startsAt: '2026-05-04T19:00:00-04:00',
      meetingLength: '01:00',
    },
  });

  assert.equal(operatorPlan.ownerContext.materializationStatus, 'operator_task');
  assert.equal(operatorPlan.laravelMeetingSetSubmit?.open_event_id, '613999');
  assert.equal(operatorPlan.supabaseLifecycleWrite?.eventType, 'meeting_set');
  assert.equal(
    operatorPlan.supabaseLifecycleWrite?.args.payload?.owner_context?.materialization_status,
    'operator_task',
  );
  assert.equal(
    operatorPlan.supabaseLifecycleWrite?.args.payload?.owner_context?.materialization_reason,
    'task_assigned_owner_matches_active_operator',
  );
  assert.equal(
    operatorPlan.supabaseLifecycleWrite?.args.payload?.owner_context?.owner_proof,
    'submittedMeetingPayload.assigned_to',
  );
  assert.equal(
    operatorPlan.supabaseLifecycleWrite?.args.payload?.owner_context?.task_assigned_owner,
    'Jerami Singleton',
  );
  assert.equal(
    operatorPlan.supabaseLifecycleWrite?.args.payload?.materialization_proof?.task_assigned_owner,
    'Jerami Singleton',
  );
  assert.equal(
    operatorPlan.supabaseLifecycleWrite?.args.payload?.materialization_proof?.materialization_status,
    'operator_task',
  );
  assert.equal(
    operatorPlan.supabaseLifecycleWrite?.args.payload?.materialization_proof?.reason,
    'task_assigned_owner_matches_active_operator',
  );
  assert.equal(operatorPlan.supabaseFactWrite?.eventType, 'meeting_set');

  const timPlan = buildPostCallActionPlan({
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    stageLabel: 'Meeting Set',
    tasks: [
      {
        task_id: '9903',
        title: 'Call Attempt 1',
        assigned_owner: 'Tim Risner',
        completion_date: '',
      },
    ],
    meetingSet: {
      meetingName: 'Avery Jones Soccer 2027 PA',
      meetingTimezone: 'EST',
      assignedToLegacyUserId: '1418529',
      meetingForLegacyUserId: '1418529',
      openEventId: '614000',
      calendarOwnerId: 'OrJsV8nhBouEzKY',
      bookedMeetingAssignedOwner: 'Jeffrey Stein',
      taskDescription: 'Main Number:\nOther Details:',
      startTime: '19:00',
      startsAt: '2026-05-04T19:00:00-04:00',
      meetingLength: '01:00',
    },
  });

  assert.equal(timPlan.ownerContext.materializationStatus, 'not_operator_task');
  assert.equal(timPlan.laravelMeetingSetSubmit?.open_event_id, '614000');
  assert.equal(timPlan.supabaseLifecycleWrite, null);
  assert.equal(timPlan.supabaseFactWrite, null);
});

test('Meeting Set submit keeps Laravel payload clean while Supabase carries Raycast operator ownership', () => {
  const plan = buildPostCallActionPlan({
    athleteId: '1490499',
    athleteMainId: '952328',
    athleteName: 'Elia Imani',
    stageLabel: 'Meeting Set',
    tasks: [],
    selectedTaskId: '626651',
    meetingSet: {
      meetingName: 'Elia Imani Football 2029 TX',
      meetingTimezone: 'CST',
      assignedToLegacyUserId: '1354049',
      meetingForLegacyUserId: '1354049',
      openEventId: '588339',
      calendarOwnerId: 'nhVvYOz8bAaL57c',
      bookedMeetingAssignedOwner: 'Ryan Lietz',
      taskDescription: 'Main Number:\nOther Details:',
      startTime: '15:00',
      startsAt: '2026-05-04T15:00:00-04:00',
      meetingLength: '01:00',
    },
  });

  assert.equal(plan.ownerContext.taskAssignedOwner, 'Jerami Singleton');
  assert.equal(plan.ownerContext.resolvedOwnerName, 'Ryan Lietz');
  assert.equal(plan.ownerContext.ownerProof, 'submittedMeetingPayload.operator_owner');
  assert.equal(plan.ownerContext.materializationStatus, 'operator_task');
  assert.equal(plan.ownerContext.materializationReason, 'meeting_set_submitted_by_active_operator');
  assert.equal(
    Object.prototype.hasOwnProperty.call(plan.laravelMeetingSetSubmit || {}, 'operator_owner'),
    false,
  );
  assert.equal(plan.supabaseLifecycleWrite?.eventType, 'meeting_set');
  assert.equal(
    plan.supabaseLifecycleWrite?.args.payload?.owner_context?.task_assigned_owner,
    'Jerami Singleton',
  );
  assert.equal(
    plan.supabaseLifecycleWrite?.args.payload?.owner_context?.booked_meeting_assigned_owner,
    'Ryan Lietz',
  );
  assert.equal(
    plan.supabaseLifecycleWrite?.args.payload?.owner_context?.owner_proof,
    'submittedMeetingPayload.operator_owner',
  );
});
