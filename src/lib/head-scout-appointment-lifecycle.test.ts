import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBookedMeetingTitle,
  getSelectedSalesStageLabel,
  resolveAppointmentLifecycle,
  selectAppointmentMeetings,
  type AppointmentTaskSnapshot,
} from './head-scout-appointment-lifecycle';
import {
  buildConfirmationMessage,
  buildMinimalFollowUpQueueRecord,
} from './scout-follow-up-templates';

const weekendMeeting = {
  event_id: 'old-weekend',
  title: 'Victor Williams Football 2027 FL',
  assigned_owner: 'Ryan Lietz',
  start: '2026-04-19T18:00',
  end: '2026-04-19T19:00',
  date_time_label: 'Sun 04/19/26 6:00 PM - 7:00 PM',
};

const thursdayMeeting = {
  event_id: 'new-thursday',
  title: 'Victor Williams Football 2027 FL',
  assigned_owner: 'Ryan Lietz',
  start: '2026-04-23T18:00',
  end: '2026-04-23T19:00',
  date_time_label: 'Thu 04/23/26 6:00 PM - 7:00 PM',
};

const staleConfirmationTask: AppointmentTaskSnapshot = {
  taskId: '991',
  title: 'Confirmation Call',
  description: 'Confirm the meeting set',
  dueDate: '04/19/2026',
};

test('weekend appointment moved to Thursday resolves Thursday as canonical meeting', () => {
  const result = resolveAppointmentLifecycle({
    athleteId: '1489227',
    athleteName: 'Victor Williams',
    crmSalesStage: 'Rescheduled',
    assignedScout: 'Ryan Lietz',
    bookedMeetingTitle: buildBookedMeetingTitle({
      athleteName: 'Victor Williams',
      sport: 'Football',
      gradYear: '2027',
      state: 'FL',
    }),
    bookedMeetings: [weekendMeeting, thursdayMeeting],
    followUpTask: staleConfirmationTask,
    meetingTimezone: 'EST',
    now: new Date('2026-04-20T12:00:00Z'),
  });

  assert.equal(result.currentMeeting?.event_id, 'new-thursday');
  assert.equal(result.previousMeeting?.event_id, 'old-weekend');
  assert.equal(result.lifecycleState, 'rescheduled');
});

test('crm rescheduled with current booked meeting stays active', () => {
  const result = resolveAppointmentLifecycle({
    athleteName: 'Victor Williams',
    crmSalesStage: 'Rescheduled',
    assignedScout: 'Ryan Lietz',
    bookedMeetings: [weekendMeeting, thursdayMeeting],
    followUpTask: staleConfirmationTask,
    meetingTimezone: 'EST',
    now: new Date('2026-04-20T12:00:00Z'),
  });

  assert.equal(result.lifecycleState, 'rescheduled');
  assert.equal(result.needsManualReview, false);
  assert.equal(result.needsConfirmationText, true);
});

test('crm rescheduled without booked meeting becomes manual reconciliation', () => {
  const result = resolveAppointmentLifecycle({
    athleteName: 'Victor Williams',
    crmSalesStage: 'Rescheduled',
    bookedMeetings: [],
    followUpTask: staleConfirmationTask,
    meetingTimezone: 'EST',
    now: new Date('2026-04-20T12:00:00Z'),
  });

  assert.equal(result.lifecycleState, 'needs_manual_review');
  assert.equal(result.needsManualReview, true);
  assert.match(result.reason, /no current booked meeting found/i);
});

test('old follow-up date with newer meeting yields reconciliation warning but keeps current meeting', () => {
  const result = resolveAppointmentLifecycle({
    athleteName: 'Victor Williams',
    crmSalesStage: 'Meeting Set',
    bookedMeetings: [weekendMeeting, thursdayMeeting],
    followUpTask: staleConfirmationTask,
    meetingTimezone: 'EST',
    now: new Date('2026-04-20T12:00:00Z'),
  });

  assert.equal(result.currentMeeting?.event_id, 'new-thursday');
  assert.equal(result.oldFollowUpDateDetected, true);
  assert.equal(result.needsManualReview, false);
});

test('latest future or current meeting wins when multiple meetings match', () => {
  const selected = selectAppointmentMeetings({
    meetings: [weekendMeeting, thursdayMeeting],
    now: new Date('2026-04-20T12:00:00Z'),
  });

  assert.equal(selected.currentMeeting?.event_id, 'new-thursday');
});

test('overdue confirmation task still remains visible in active lifecycle', () => {
  const result = resolveAppointmentLifecycle({
    athleteName: 'Victor Williams',
    crmSalesStage: 'Rescheduled',
    bookedMeetings: [weekendMeeting, thursdayMeeting],
    followUpTask: {
      ...staleConfirmationTask,
      dueDate: '04/18/2026',
    },
    meetingTimezone: 'EST',
    now: new Date('2026-04-20T12:00:00Z'),
  });

  assert.equal(result.lifecycleState, 'rescheduled');
  assert.equal(result.needsConfirmationText, true);
});

test('confirmation text uses resolved current meeting time, not stale task date', () => {
  const result = resolveAppointmentLifecycle({
    athleteName: 'Victor Williams',
    crmSalesStage: 'Rescheduled',
    assignedScout: 'Ryan Lietz',
    bookedMeetings: [weekendMeeting, thursdayMeeting],
    followUpTask: staleConfirmationTask,
    meetingTimezone: 'EST',
    now: new Date('2026-04-20T12:00:00Z'),
  });
  const message = buildConfirmationMessage({
    headScoutName: result.assignedScout,
    dueAt: result.currentMeetingDate || new Date('2026-04-19T18:00:00'),
    meetingTimezone: result.meetingTimezone,
    now: new Date('2026-04-20T12:00:00Z'),
  });

  assert.match(message, /Prospect ID Zoom Meeting on 4\/23 evening at 6:00 PM ET/);
  assert.doesNotMatch(message, /04\/19\/26/);
});

test('selected sales stage helper preserves rescheduled truth', () => {
  assert.equal(
    getSelectedSalesStageLabel([
      { value: 'Meeting Set', label: 'Meeting Set', selected: false },
      { value: 'Rescheduled', label: 'Rescheduled', selected: true },
    ]),
    'Rescheduled',
  );
});

test('queue record preserves crm stage and operator status separately', () => {
  const record = buildMinimalFollowUpQueueRecord({
    messageType: 'confirmation',
    athleteName: 'Victor Williams',
    currentTask: 'Confirmation Call',
    dueAt: new Date('2026-04-23T18:00:00.000Z'),
    raycastKey: 'confirmation:1489227:991',
    crmStage: 'Rescheduled',
    workflowStatus: 'active_meeting_queue',
    lifecycleState: 'rescheduled',
    reason: 'CRM stage is Rescheduled and the latest booked meeting is active.',
  });

  assert.equal(record.crmStage, 'Rescheduled');
  assert.equal(record.workflowStatus, 'active_meeting_queue');
});
