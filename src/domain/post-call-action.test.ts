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
