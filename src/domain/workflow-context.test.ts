import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorkflowId,
  isFabricatedMeetingTitle,
  resolveWorkflowContext,
} from './workflow-context';

test('workflow id is stable for athlete and appointment scoped work', () => {
  assert.equal(
    buildWorkflowId({ athleteId: '1499010', athleteMainId: '953777' }),
    'athlete:1499010:953777',
  );
  assert.equal(
    buildWorkflowId({ athleteId: '1499010', athleteMainId: '953777', appointmentId: '588446' }),
    'meeting:1499010:953777:588446',
  );
  assert.equal(buildWorkflowId({ athleteId: '1499010' }), null);
});

test('workflow context resolves canonical profile and meeting title values without guessing', () => {
  assert.deepEqual(
    resolveWorkflowContext({
      athleteId: '1499010',
      athleteMainId: '953777',
      athleteName: 'Wenstan Penermon',
      sport: 'Football',
      gradYear: '2027',
      state: 'Georgia',
      salesStage: 'Meeting Set',
      appointmentId: '588446',
      meetingTitle: '(ACF*2) Wenstan Penermon Football 2027 GA',
    }),
    {
      workflow_id: 'meeting:1499010:953777:588446',
      athlete_key: '1499010:953777',
      athlete_id: '1499010',
      athlete_main_id: '953777',
      athlete_name: 'Wenstan Penermon',
      sport: 'Football',
      grad_year: '2027',
      state: 'GA',
      sales_stage: 'meeting_set',
      task_status: 'confirmation_call',
      appointment_id: '588446',
      appointment_status: 'scheduled',
      post_meeting_result: null,
      meeting_title_base: 'Wenstan Penermon Football 2027 GA',
      meeting_title_prefix: '(ACF*2)',
      meeting_title_current: '(ACF*2) Wenstan Penermon Football 2027 GA',
    },
  );
});

test('workflow context treats title prefix as signal without blocking stale sales stage', () => {
  const context = resolveWorkflowContext({
    athleteId: '1499010',
    athleteMainId: '953777',
    athleteName: 'Wenstan Penermon',
    sport: 'Football',
    gradYear: '2027',
    state: 'GA',
    salesStage: 'Meeting Set',
    appointmentId: '588446',
    meetingTitle: '(RSP) Wenstan Penermon Football 2027 GA',
  });

  assert.equal(context.sales_stage, 'meeting_set');
  assert.equal(context.task_status, 'reschedule_pending');
  assert.equal(context.appointment_status, null);
  assert.equal(context.post_meeting_result, 'reschedule_pending');
  assert.equal(context.meeting_title_prefix, '(RSP)');
});

test('workflow context never turns scout names into meeting titles', () => {
  assert.equal(isFabricatedMeetingTitle('Post Meeting - Ryan Lietz'), true);

  const context = resolveWorkflowContext({
    athleteId: '1499010',
    athleteMainId: '953777',
    athleteName: 'Wenstan Penermon',
    salesStage: 'Rescheduled',
    appointmentId: '586604',
    meetingTitle: 'Post Meeting - Ryan Lietz',
  });

  assert.equal(context.meeting_title_current, null);
  assert.equal(context.meeting_title_base, null);
  assert.equal(context.meeting_title_prefix, null);
  assert.equal(context.appointment_status, 'scheduled');
  assert.equal(context.post_meeting_result, 'rescheduled');
});

test('canceled sales stage owns post-meeting result projection', () => {
  const context = resolveWorkflowContext({
    athleteId: '1490563',
    athleteMainId: '952390',
    athleteName: 'Josiah Meza',
    sport: 'Football',
    gradYear: '2028',
    state: 'FL',
    salesStage: 'Meeting Result - Canceled',
    appointmentId: '587244',
    appointmentStatus: 'reschedule_pending',
    postMeetingResult: 'reschedule_pending',
    meetingTitle: '(CAN) Josiah Meza Football 2028 FL',
  });

  assert.equal(context.sales_stage, 'canceled');
  assert.equal(context.task_status, 'canceled');
  assert.equal(context.appointment_status, null);
  assert.equal(context.post_meeting_result, 'canceled');
  assert.equal(context.meeting_title_base, 'Josiah Meza Football 2028 FL');
  assert.equal(context.meeting_title_prefix, '(CAN)');
});
