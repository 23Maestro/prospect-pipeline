import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVoicemailFollowUpMessage,
  buildCallAttempt2Message,
  buildConfirmationMessage,
  buildFollowUpRaycastKey,
  buildMinimalFollowUpQueueRecord,
  getReminderTimeLabel,
  isPastTextTodayCutoff,
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

test('resolveVoicemailFollowUpVariant prefers no-show and later attempt states before falling back to attempt 1', () => {
  assert.equal(
    resolveVoicemailFollowUpVariant({ crmStage: 'Meeting Result No Show', currentTask: 'No Show' }),
    'no_show',
  );
  assert.equal(
    resolveVoicemailFollowUpVariant({ crmStage: 'Meeting Set', currentTask: 'Call Attempt 3' }),
    'call_attempt_3',
  );
  assert.equal(
    resolveVoicemailFollowUpVariant({
      crmStage: 'Left Voice Mail 2',
      currentTask: 'Call Attempt 2',
    }),
    'call_attempt_2',
  );
  assert.equal(
    resolveVoicemailFollowUpVariant({
      crmStage: 'Left Voice Mail 1',
      currentTask: 'Call Attempt 1',
    }),
    'call_attempt_1',
  );
  assert.equal(
    resolveVoicemailFollowUpVariant({ crmStage: 'Meeting Set', currentTask: 'Something Else' }),
    'call_attempt_1',
  );
});

test('resolveConfirmationFollowUpVariant stays conservative unless explicit second reminder signal exists', () => {
  assert.equal(
    resolveConfirmationFollowUpVariant({
      crmStage: 'Meeting Set',
      currentTask: 'Confirmation Call',
    }),
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
    greeting: 'Good afternoon Ms. Messerle,',
    athleteName: 'Wylie',
    sport: 'Soccer',
    signOffTitle: 'Soccer Scouting Coordinator',
    closingLine: 'Enjoy the rest of your week.',
    now: new Date('2026-04-23T23:29:00Z'),
  });

  assert.match(
    message,
    /^Good afternoon Ms\. Messerle, this is Jerami Singleton with Prospect ID\. Following up on Wylie's recruiting plan\./,
  );
  assert.match(
    message,
    /If playing college soccer is still a serious goal for him, I’d like to get a quick 10-minute call scheduled while timing still matters\./,
  );
  assert.match(message, /Would later today or tomorrow work better\?/);
  assert.match(message, /Enjoy the rest of your week\./);
  assert.match(message, /Jerami Singleton\nSoccer Scouting Coordinator\nProspect ID/);
});

test('buildVoicemailFollowUpMessage removes today after 7:30pm eastern cutoff', () => {
  assert.equal(isPastTextTodayCutoff(new Date('2026-04-23T23:29:00Z')), false);
  assert.equal(isPastTextTodayCutoff(new Date('2026-04-23T23:30:00Z')), true);

  const message = buildVoicemailFollowUpMessage({
    variant: 'call_attempt_1',
    greeting: 'Good afternoon Ms. Messerle,',
    athleteName: 'Wylie',
    sport: 'Soccer',
    now: new Date('2026-04-23T23:30:00Z'),
  });

  assert.match(message, /Would tomorrow or the next day work better\?/);
  assert.doesNotMatch(message, /later today or tomorrow/);
});

test('buildVoicemailFollowUpMessage removes today from attempt 2 after cutoff', () => {
  const message = buildVoicemailFollowUpMessage({
    variant: 'call_attempt_2',
    greeting: 'Good evening Mr. Brown,',
    athleteName: 'Grayson Brown',
    sport: 'Football',
    now: new Date('2026-04-23T23:30:00Z'),
  });

  assert.match(message, /When would you have a 10 min gap tomorrow\?/);
  assert.doesNotMatch(message, /today or in the next few days/);
});

test('buildVoicemailFollowUpMessage renders no show copy with simple next best day logic', () => {
  const message = buildVoicemailFollowUpMessage({
    variant: 'no_show',
    greeting: 'Hi Jamie,',
    athleteName: 'Aiden Reed',
    sport: 'Football',
    now: new Date('2026-04-24T13:00:00Z'),
  });

  assert.match(
    message,
    /^Hi Jamie, looks like we missed you for Aiden Reed’s meeting with our Head Scout\./,
  );
  assert.match(
    message,
    /No worries, things come up\. If playing college football is still a serious goal for him, let’s get you back on the schedule while timing still matters\./,
  );
  assert.match(message, /Would tomorrow or Monday work better\?/);
});

test('buildVoicemailFollowUpMessage renders attempt 3 copy', () => {
  const message = buildVoicemailFollowUpMessage({
    variant: 'call_attempt_3',
    greeting: 'Good afternoon Ms. Torres,',
    athleteName: 'Jason',
    senderName: 'Jerami Singleton',
    sport: "Men's Basketball",
    signOffTitle: 'Basketball Scouting Coordinator',
    closingLine: 'Enjoy the rest of your week.',
  });

  assert.match(message, /^Good afternoon Ms\. Torres, this is Jerami Singleton with Prospect ID\./);
  assert.match(message, /Just checking one last time on Jason\./);
  assert.match(
    message,
    /If playing college basketball is still a serious goal worth exploring, I’m happy to connect\./,
  );
  assert.match(message, /I can go ahead and mark this as no interest for now, and revisit later\?/);
  assert.match(message, /Enjoy the rest of your week\./);
  assert.match(message, /Jerami Singleton\nBasketball Scouting Coordinator\nProspect ID/);
});

test('buildCallAttempt2Message fills athlete and recipient names', () => {
  const message = buildCallAttempt2Message({
    recipientName: 'Mr. Brown',
    athleteName: 'Grayson Brown',
    senderName: 'Coach Risner',
    sport: 'Football',
    gradYear: '2027',
  });

  assert.match(
    message,
    /Good morning Mr\. Brown, this is Coach Risner, college football scout with Prospect ID\./,
  );
  assert.match(
    message,
    /I received Grayson Brown's info and I’m trying to get a better feel for where he’s at academically, athletically, and what his goals are for playing college football\./,
  );
  assert.match(message, /With him being a 2027, timing matters in the recruiting process/);
});

test('buildConfirmationMessage fills coach and meeting time', () => {
  const dueAt = new Date('2026-04-26T19:00:00.000Z');
  const message = buildConfirmationMessage({
    variant: 'confirmation_1',
    headScoutName: 'Ryan Lietz',
    dueAt,
    meetingTimezone: 'CST',
    recipientNames: ['Peter'],
  });

  assert.equal(
    message,
    [
      'Good morning Peter! Prospect ID Zoom tomorrow 4/26 at 2:00 PM CT with Coach Ryan Lietz.',
      '',
      'He’ll call your cell at 2:00 with the Zoom code. Be on a laptop or tablet so he can share his screen.',
      '',
      'Save his contact so you know it’s him calling.',
    ].join('\n'),
  );
});

test('buildConfirmationMessage renders short second confirmation copy', () => {
  const dueAt = new Date('2026-04-17T23:00:00.000Z');
  const message = buildConfirmationMessage({
    variant: 'confirmation_2',
    headScoutName: 'Luther Winfield',
    dueAt,
    meetingTimezone: 'PST',
    now: new Date('2026-04-15T16:00:00.000Z'),
  });

  assert.match(
    message,
    /Coach Luther Winfield still has you down for 4:00pm pacific this afternoon\./,
  );
  assert.match(message, /Please reply YES to confirm you’ll be able to attend/);
  assert.doesNotMatch(message, /zoom code/);
});

test('buildConfirmationMessage uses tomorrow for Friday confirmation 2 Saturday appointments', () => {
  const dueAt = new Date('2026-04-18T23:00:00.000Z');
  const message = buildConfirmationMessage({
    variant: 'confirmation_2',
    headScoutName: 'Luther Winfield',
    dueAt,
    meetingTimezone: 'PST',
    now: new Date('2026-04-17T16:00:00.000Z'),
  });

  assert.match(
    message,
    /Coach Luther Winfield still has you down for 4:00pm pacific tomorrow\./,
  );
  assert.match(message, /Please reply YES to confirm you’ll be able to attend/);
});

test('buildConfirmationMessage uses tomorrow for Saturday confirmation 2 Sunday appointments', () => {
  const dueAt = new Date('2026-04-19T23:00:00.000Z');
  const message = buildConfirmationMessage({
    variant: 'confirmation_2',
    headScoutName: 'Ryan Lietz',
    dueAt,
    meetingTimezone: 'CST',
    now: new Date('2026-04-18T16:00:00.000Z'),
  });

  assert.match(message, /Coach Ryan Lietz still has you down for 6:00pm central tomorrow\./);
  assert.match(message, /Please reply YES to confirm you’ll be able to attend/);
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
