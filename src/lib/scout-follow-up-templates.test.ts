import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVoicemailFollowUpMessage,
  buildCallAttempt2Message,
  buildConfirmationMessage,
  buildFollowUpRaycastKey,
  buildMinimalFollowUpQueueRecord,
  getReminderTimeLabel,
  resolveConfirmationFollowUpVariant,
  resolveVoicemailFollowUpVariant,
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

test('resolveVoicemailFollowUpVariant prefers attempt 2 states and otherwise falls back to attempt 1', () => {
  assert.equal(
    resolveVoicemailFollowUpVariant({ crmStage: 'Meeting Result No Show', currentTask: 'No Show' }),
    'no_show',
  );
  assert.equal(
    resolveVoicemailFollowUpVariant({ crmStage: 'Left Voice Mail 2', currentTask: 'Call Attempt 2' }),
    'call_attempt_2',
  );
  assert.equal(
    resolveVoicemailFollowUpVariant({ crmStage: 'Left Voice Mail 1', currentTask: 'Call Attempt 1' }),
    'call_attempt_1',
  );
  assert.equal(
    resolveVoicemailFollowUpVariant({ crmStage: 'Meeting Set', currentTask: 'Something Else' }),
    'call_attempt_1',
  );
});

test('resolveConfirmationFollowUpVariant stays conservative unless explicit second reminder signal exists', () => {
  assert.equal(
    resolveConfirmationFollowUpVariant({ crmStage: 'Meeting Set', currentTask: 'Confirmation Call' }),
    'confirmation_1',
  );
  assert.equal(
    resolveConfirmationFollowUpVariant({ crmStage: 'Meeting Set', currentTask: 'Confirmation 2' }),
    'confirmation_2',
  );
});

test('buildVoicemailFollowUpMessage renders attempt 1 copy', () => {
  const message = buildVoicemailFollowUpMessage({
    variant: 'call_attempt_1',
    greeting: 'Good morning Mr. Brown,',
    athleteName: 'Grayson Brown',
    sport: 'Football',
    gradYear: '2028',
    signOffTitle: 'Football Scouting Coordinator',
    closingLine: 'Enjoy the rest of your week.',
  });

  assert.match(message, /^Good morning Mr\. Brown, this is Jerami Singleton, football scout with Prospect ID\./);
  assert.match(message, /Following up about Grayson Brown's recruiting plan\./);
  assert.match(message, /When would you have a 10 min gap today or tomorrow\?/);
});

test('buildVoicemailFollowUpMessage renders no show copy with simple next best day logic', () => {
  const message = buildVoicemailFollowUpMessage({
    variant: 'no_show',
    greeting: 'Hi Jamie,',
    athleteName: 'Aiden Reed',
    sport: 'Football',
    now: new Date('2026-04-24T13:00:00Z'),
  });

  assert.match(message, /^Hi Jamie, looks like we missed you for Aiden Reed’s meeting with our Head Scout\./);
  assert.match(message, /If playing college football is still a real goal for him/);
  assert.match(message, /Would tomorrow or Monday work better\?/);
});

test('buildCallAttempt2Message fills athlete and recipient names', () => {
  const message = buildCallAttempt2Message({
    recipientName: 'Mr. Brown',
    athleteName: 'Grayson Brown',
    senderName: 'Coach Risner',
    sport: 'Football',
    gradYear: '2027',
  });

  assert.match(message, /Good morning Mr\. Brown, this is Coach Risner with Prospect ID\./);
  assert.match(message, /I left you another voicemail about Grayson Brown's recruiting profile\./);
  assert.match(message, /With him being a 2027, timing matters in the recruiting process/);
});

test('buildConfirmationMessage fills coach and meeting time', () => {
  const dueAt = new Date('2026-04-17T23:00:00.000Z');
  const message = buildConfirmationMessage({
    variant: 'confirmation_1',
    headScoutName: 'Ryan Lietz',
    dueAt,
    meetingTimezone: 'CST',
  });

  assert.match(message, /Coach Ryan Lietz/);
  assert.match(message, /this evening at 6:00pm central/);
  assert.match(message, /call your cell at 6:00pm/);
  assert.match(message, /give you all the zoom code to login/);
});

test('buildConfirmationMessage renders short second confirmation copy', () => {
  const dueAt = new Date('2026-04-17T23:00:00.000Z');
  const message = buildConfirmationMessage({
    variant: 'confirmation_2',
    headScoutName: 'Luther Winfield',
    dueAt,
    meetingTimezone: 'PST',
  });

  assert.match(message, /Coach Luther Winfield still has you down for 4:00pm pacific this afternoon\./);
  assert.match(message, /Please reply YES to confirm you’ll be able to attend/);
  assert.doesNotMatch(message, /zoom code/);
});

test('getReminderTimeLabel maps timezone labels to words', () => {
  const dueAt = new Date('2026-04-17T13:30:00.000Z');
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
    messageVariant: 'confirmation_1',
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
    crmStage: null,
    workflowStatus: null,
    lifecycleState: null,
    reason: null,
    messageVariant: 'confirmation_1',
  });
});
