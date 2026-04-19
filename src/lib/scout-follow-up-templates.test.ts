import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCallAttempt2Message,
  buildConfirmationMessage,
  buildFollowUpRaycastKey,
  buildMinimalFollowUpQueueRecord,
  getReminderTimeLabel,
} from './scout-follow-up-templates';

test('buildFollowUpRaycastKey creates stable keys per task type', () => {
  assert.equal(
    buildFollowUpRaycastKey({
      messageType: 'call_attempt_2',
      athleteId: '1489227',
      taskId: '991',
    }),
    'call-attempt-2:1489227:991',
  );

  assert.equal(
    buildFollowUpRaycastKey({
      messageType: 'confirmation',
      athleteId: '1489227',
      taskId: '992',
    }),
    'confirmation:1489227:992',
  );
});

test('buildCallAttempt2Message fills athlete and recipient names', () => {
  const message = buildCallAttempt2Message({
    recipientName: 'Mr. Brown',
    athleteName: 'Grayson Brown',
    senderName: 'Coach Risner',
  });

  assert.match(message, /Good morning Mr\. Brown/);
  assert.match(message, /learn more about Grayson/);
  assert.match(message, /Coach Risner$/);
});

test('buildConfirmationMessage fills coach and meeting time', () => {
  const dueAt = new Date(2026, 3, 17, 19, 0);
  const message = buildConfirmationMessage({
    headScoutName: 'Ryan Lietz',
    dueAt,
    meetingTimezone: 'CST',
  });

  assert.match(message, /Coach Lietz/);
  assert.match(message, /this evening at 7:00pm central/);
  assert.match(message, /call your cell at 7:00pm/);
});

test('getReminderTimeLabel maps timezone labels to words', () => {
  const dueAt = new Date(2026, 3, 17, 9, 30);
  assert.equal(getReminderTimeLabel(dueAt, 'EST'), '9:30am eastern');
});

test('buildMinimalFollowUpQueueRecord stays lightweight', () => {
  const record = buildMinimalFollowUpQueueRecord({
    messageType: 'confirmation',
    athleteName: 'Victor Williams',
    parent1Name: 'Tiffiny Williams',
    parent2Name: null,
    currentTask: 'Confirmation Call',
    dueAt: new Date('2026-04-17T19:00:00.000Z'),
    raycastKey: 'confirmation:1489227:991',
  });

  assert.deepEqual(record, {
    title: 'Victor Williams',
    status: 'Open',
    messageType: 'confirmation',
    dueAt: '2026-04-17T19:00:00.000Z',
    athlete: 'Victor Williams',
    parent1: 'Tiffiny Williams',
    parent2: null,
    currentTask: 'Confirmation Call',
    raycastKey: 'confirmation:1489227:991',
  });
});
