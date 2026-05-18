import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPostCallActionPlan } from './post-call-action';

type TestPayload = {
  owner_context?: Record<string, unknown>;
  materialization_proof?: Record<string, unknown>;
  operator_owner?: string;
  operator_owner_key?: string;
  booked_meeting_assigned_owner?: string;
};

function meetingSetFixture(overrides: {
  athleteId?: string;
  athleteMainId?: string;
  meetingName: string;
  meetingTimezone: string;
  assignedToLegacyUserId: string;
  meetingForLegacyUserId: string;
  openEventId: string;
  calendarOwnerId: string;
  bookedMeetingAssignedOwner: string;
  taskDescription: string;
  startTime: string;
  startsAt: string;
  meetingLength: string;
}) {
  return {
    athleteId: overrides.athleteId || '1489000',
    athleteMainId: overrides.athleteMainId || '951000',
    ...overrides,
  };
}

function lifecyclePayload(plan: ReturnType<typeof buildPostCallActionPlan>): TestPayload {
  return (plan.supabaseLifecycleWrite?.args.payload || {}) as TestPayload;
}

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
  assert.equal(plan.laravelTaskCompletion?.crmStage, 'Spoke to - I Need To Follow Up');
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
    meetingSet: meetingSetFixture({
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
    }),
  });
  const operatorPayload = lifecyclePayload(operatorPlan);

  assert.equal(operatorPlan.ownerContext.materializationStatus, 'operator_task');
  assert.equal(operatorPlan.laravelMeetingSetSubmit?.open_event_id, '613999');
  assert.equal(operatorPlan.supabaseLifecycleWrite?.eventType, 'meeting_set');
  assert.equal(
    operatorPayload.owner_context?.materialization_status,
    'operator_task',
  );
  assert.equal(
    operatorPayload.owner_context?.materialization_reason,
    'task_assigned_owner_matches_active_operator',
  );
  assert.equal(
    operatorPayload.owner_context?.owner_proof,
    'raycast_operator_context',
  );
  assert.equal(
    operatorPayload.owner_context?.task_assigned_owner,
    'Jerami Singleton',
  );
  assert.equal(
    operatorPayload.materialization_proof?.task_assigned_owner,
    'Jerami Singleton',
  );
  assert.equal(
    operatorPayload.materialization_proof?.materialization_status,
    'operator_task',
  );
  assert.equal(
    operatorPayload.materialization_proof?.reason,
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
    meetingSet: meetingSetFixture({
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
    }),
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
    meetingSet: meetingSetFixture({
      athleteId: '1490499',
      athleteMainId: '952328',
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
    }),
  });
  const payload = lifecyclePayload(plan);

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
    payload.owner_context?.task_assigned_owner,
    'Jerami Singleton',
  );
  assert.equal(
    payload.owner_context?.booked_meeting_assigned_owner,
    'Ryan Lietz',
  );
  assert.equal(
    payload.owner_context?.owner_proof,
    'raycast_operator_context',
  );
  assert.equal(payload.operator_owner, 'Jerami Singleton');
  assert.equal(payload.operator_owner_key, 'jerami_singleton');
  assert.equal(
    payload.booked_meeting_assigned_owner,
    'Ryan Lietz',
  );
});

test('Meeting Set submit supports Logan and Kenton through the same head scout fields', () => {
  const owners = [
    {
      name: 'Logan Lord',
      id: '2254',
      calendarOwnerId: 'd9UDl0bRSqQ1owt',
      openEventId: '624180',
      startTime: '17:00',
      startsAt: '2026-05-11T17:00:00-04:00',
    },
    {
      name: 'Kenton Manis',
      id: '1486538',
      calendarOwnerId: 'A4H3xiZJdyrEh2X',
      openEventId: '624048',
      startTime: '14:30',
      startsAt: '2026-05-17T14:30:00-04:00',
    },
  ];

  for (const owner of owners) {
    const plan = buildPostCallActionPlan({
      athleteId: '1490499',
      athleteMainId: '952328',
      athleteName: 'Elia Imani',
      stageLabel: 'Meeting Set',
      tasks: [],
      meetingSet: meetingSetFixture({
        athleteId: '1490499',
        athleteMainId: '952328',
        meetingName: `Elia Imani Football 2029 TX`,
        meetingTimezone: 'EST',
        assignedToLegacyUserId: owner.id,
        meetingForLegacyUserId: owner.id,
        openEventId: owner.openEventId,
        calendarOwnerId: owner.calendarOwnerId,
        bookedMeetingAssignedOwner: owner.name,
        taskDescription: 'Main Number:\nOther Details:',
        startTime: owner.startTime,
        startsAt: owner.startsAt,
        meetingLength: '01:00',
      }),
    });

    assert.equal(plan.laravelMeetingSetSubmit?.assigned_to, owner.id);
    assert.equal(plan.laravelMeetingSetSubmit?.meeting_for, owner.id);
    assert.equal(plan.laravelMeetingSetSubmit?.meetingfor, owner.id);
    assert.equal(plan.laravelMeetingSetSubmit?.calendar_owner_id, owner.calendarOwnerId);
    assert.equal(plan.laravelMeetingSetSubmit?.booked_meeting_assigned_owner, owner.name);
    assert.equal(plan.laravelMeetingSetSubmit?.open_event_id, owner.openEventId);
    assert.equal(plan.ownerContext.resolvedOwnerName, owner.name);
    assert.equal(plan.ownerContext.materializationStatus, 'operator_task');
    assert.equal(lifecyclePayload(plan).booked_meeting_assigned_owner, owner.name);
  }
});
