import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAL_BOOKING_URL,
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
    resolveVoicemailFollowUpVariant({
      crmStage: null,
      currentTask: 'Scheduled Follow Up Call the family second time and leave follow-up voicemail.',
    }),
    'call_attempt_2',
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
    /^Good afternoon Ms\. Messerle, this is Jerami Singleton with Prospect ID\./,
  );
  assert.match(
    message,
    /Wylie’s profile came through and I wanted to ask a few quick questions about his college soccer goals\./,
  );
  assert.doesNotMatch(message, /I just left you a voicemail/);
  assert.match(message, /Would later today or tomorrow work for a quick 10-minute call\?/);
  assert.doesNotMatch(message, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(message, /Enjoy the rest of your week\./);
  assert.doesNotMatch(message, /Jerami Singleton\nProspect ID/);
});

test('buildVoicemailFollowUpMessage uses female pronouns for softball templates', () => {
  const message = buildVoicemailFollowUpMessage({
    variant: 'call_attempt_1',
    greeting: 'Good afternoon Ms. Torres,',
    athleteName: 'Ava',
    sport: 'Softball',
    now: new Date('2026-04-23T23:29:00Z'),
  });

  assert.match(
    message,
    /Ava’s profile came through and I wanted to ask a few quick questions about her college softball goals\./,
  );
  assert.doesNotMatch(message, /serious goal for him/);
});

test('isPastTextTodayCutoff identifies the eastern evening cutoff', () => {
  assert.equal(isPastTextTodayCutoff(new Date('2026-04-23T23:29:00Z')), false);
  assert.equal(isPastTextTodayCutoff(new Date('2026-04-23T23:30:00Z')), true);
});

test('buildVoicemailFollowUpMessage renders attempt 2 calendar permission copy', () => {
  const message = buildVoicemailFollowUpMessage({
    variant: 'call_attempt_2',
    greeting: 'Good evening Mr. Brown,',
    athleteName: 'Grayson Brown',
    sport: 'Football',
    now: new Date('2026-04-23T23:30:00Z'),
  });

  assert.match(message, /^Good evening Mr\. Brown, any updates or questions on this\?/);
  assert.match(message, /If I send you a calendar link, would that be more convenient\?/);
  assert.doesNotMatch(message, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(message, /just left (you )?a voicemail/i);
  assert.doesNotMatch(message, /I just tried you again/);
  assert.doesNotMatch(message, /today or in the next few days/);
  assert.doesNotMatch(message, /trying to get a better feel/);
  assert.doesNotMatch(message, /learn his goals/);
  assert.doesNotMatch(message, /Jerami Singleton\nProspect ID/);
});

test('buildVoicemailFollowUpMessage renders no show triage copy', () => {
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
  assert.match(message, /Choose what’s most relevant so I can be helpful:/);
  assert.match(message, /1 - still interested, just need to reschedule/);
  assert.match(message, /2 - interested, but timing is bad right now/);
  assert.match(message, /3 - no longer interested/);
  assert.doesNotMatch(message, /No worries, things come up/);
  assert.doesNotMatch(message, /Would tomorrow or Monday work better\?/);
  assert.doesNotMatch(message, /calendar link/);
  assert.doesNotMatch(message, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('buildVoicemailFollowUpMessage uses no show triage for student athletes', () => {
  const message = buildVoicemailFollowUpMessage({
    variant: 'no_show',
    recipientType: 'student_athlete',
    greeting: 'Hi Aiden,',
    athleteName: 'Aiden Reed',
    sport: 'Football',
  });

  assert.match(
    message,
    /^Hi Aiden, looks like we missed you for Aiden Reed’s meeting with our Head Scout\./,
  );
  assert.match(message, /Choose what’s most relevant so I can be helpful:/);
  assert.match(message, /1 - still interested, just need to reschedule/);
  assert.match(message, /2 - interested, but timing is bad right now/);
  assert.match(message, /3 - no longer interested/);
  assert.doesNotMatch(message, /have one of your parents call or text me back/);
});

test('buildVoicemailFollowUpMessage renders attempt 3 triage copy', () => {
  const message = buildVoicemailFollowUpMessage({
    variant: 'call_attempt_3',
    greeting: 'Good afternoon Ms. Bowden,',
    athleteName: 'Andrajhez',
    senderName: 'Jerami Singleton',
    sport: 'Football',
    signOffTitle: 'Football Scouting Coordinator',
    closingLine: 'Enjoy the rest of your week.',
  });

  assert.match(
    message,
    /^Good afternoon Ms\. Bowden, choose what’s most relevant so I can be helpful:/,
  );
  assert.match(message, /1 - not interested whatsoever/);
  assert.match(message, /2 - interested but bad timing/);
  assert.match(message, /3 - interested and ready to learn about next steps/);
  assert.doesNotMatch(message, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(message, /I’ve tried a few times/);
  assert.doesNotMatch(message, /I’ll close this out for now\./);
  assert.doesNotMatch(message, /just left (you )?a voicemail/i);
  assert.doesNotMatch(message, /Enjoy the rest of your week\./);
  assert.doesNotMatch(message, /Jerami Singleton\nProspect ID/);
});

test('buildVoicemailFollowUpMessage renders simple Cal link reply without signature', () => {
  const message = buildVoicemailFollowUpMessage({
    variant: 'send_cal_link',
    greeting: 'Good afternoon Ms. Bowden,',
    athleteName: 'Andrajhez',
    senderName: 'Jerami Singleton',
    sport: 'Football',
  });

  assert.equal(
    message,
    ['Great! Here’s the link to schedule a quick call:', CAL_BOOKING_URL].join('\n'),
  );
  assert.doesNotMatch(message, /Jerami Singleton\nProspect ID/);
});

test('buildVoicemailFollowUpMessage renders distinct student athlete attempts', () => {
  const attempt1 = buildVoicemailFollowUpMessage({
    variant: 'call_attempt_1',
    greeting: 'Good afternoon Joenny,',
    athleteName: 'Joenny',
    recipientType: 'student_athlete',
    sport: 'Football',
  });
  const attempt2 = buildVoicemailFollowUpMessage({
    variant: 'call_attempt_2',
    greeting: 'Good afternoon Joenny,',
    athleteName: 'Joenny',
    recipientType: 'student_athlete',
    sport: 'Football',
  });
  const attempt3 = buildVoicemailFollowUpMessage({
    variant: 'call_attempt_3',
    greeting: 'Good afternoon Joenny,',
    athleteName: 'Joenny',
    recipientType: 'student_athlete',
    sport: 'Football',
  });

  assert.match(attempt1, /I received your info about playing college football/);
  assert.match(attempt1, /If you’re serious about this, have one of your parents call or text me/);
  assert.match(attempt2, /Any updates or questions on playing college football/);
  assert.match(
    attempt2,
    /If this is still something you want, have one of your parents call or text me/,
  );
  assert.match(attempt3, /Last follow-up on your college football profile/);
  assert.doesNotMatch(attempt1, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(attempt2, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(attempt3, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(attempt1, /football scouting coordinator\nProspect ID/);
  assert.doesNotMatch(attempt2, /football scouting coordinator\nProspect ID/);
  assert.doesNotMatch(attempt3, /football scouting coordinator\nProspect ID/);
  assert.notEqual(attempt1, attempt2);
  assert.notEqual(attempt2, attempt3);
});

test('buildCallAttempt2Message fills athlete and recipient names', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-23T20:00:00Z') });

  const message = buildCallAttempt2Message({
    recipientName: 'Mr. Brown',
    athleteName: 'Grayson Brown',
    senderName: 'Coach Risner',
    sport: 'Football',
    gradYear: '2027',
  });

  assert.match(message, /Good morning Mr\. Brown, any updates or questions on this\?/);
  assert.match(message, /If I send you a calendar link, would that be more convenient\?/);
  assert.doesNotMatch(message, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(message, /just left (you )?a voicemail/i);
  assert.doesNotMatch(message, /I just tried you again/);
  assert.doesNotMatch(message, /trying to get a better feel/);
  assert.doesNotMatch(message, /learn his goals/);
});

test('buildConfirmationMessage fills coach and meeting time', () => {
  const dueAt = new Date('2026-04-26T19:00:00.000Z');
  const message = buildConfirmationMessage({
    variant: 'confirmation_1',
    headScoutName: 'Ryan Lietz',
    dueAt,
    meetingTimezone: 'CST',
    recipientNames: ['Peter'],
    now: new Date('2026-04-25T16:00:00.000Z'),
  });

  assert.equal(
    message,
    [
      'Good morning Peter! Prospect ID Zoom Meeting tomorrow afternoon 4/26 at 2:00 PM CT with Coach Ryan Lietz.',
      '',
      'He’ll call your cell at 2:00 with the Zoom code. Be on a laptop or tablet so he can share his screen.',
      '',
      'Save his contact so you know it’s him calling.',
    ].join('\n'),
  );
});

test('buildConfirmationMessage uses tonight when first confirmation is for current calendar day', () => {
  const dueAt = new Date('2026-04-29T23:00:00.000Z');
  const message = buildConfirmationMessage({
    variant: 'confirmation_1',
    headScoutName: 'Ryan Lietz',
    dueAt,
    meetingTimezone: 'EST',
    recipientNames: ['Terresita'],
    now: new Date('2026-04-29T13:00:00.000Z'),
  });

  assert.equal(
    message,
    [
      'Good morning Terresita! Prospect ID Zoom Meeting tonight 4/29 at 7:00 PM ET with Coach Ryan Lietz.',
      '',
      'He’ll call your cell at 7:00 with the Zoom code. Be on a laptop or tablet so he can share his screen.',
      '',
      'Save his contact so you know it’s him calling.',
    ].join('\n'),
  );
  assert.doesNotMatch(message, /tomorrow/);
});

test('buildConfirmationMessage uses tomorrow evening for next-day evening appointments', () => {
  const dueAt = new Date('2026-04-30T23:00:00.000Z');
  const message = buildConfirmationMessage({
    variant: 'confirmation_1',
    headScoutName: 'Ryan Lietz',
    dueAt,
    meetingTimezone: 'EST',
    recipientNames: ['Terresita'],
    now: new Date('2026-04-29T13:00:00.000Z'),
  });

  assert.match(
    message,
    /Prospect ID Zoom Meeting tomorrow evening 4\/30 at 7:00 PM ET with Coach Ryan Lietz\./,
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
    /Coach Luther Winfield still has you down for 4:00pm pacific on Friday afternoon\./,
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
    /Coach Luther Winfield still has you down for 4:00pm pacific tomorrow afternoon\./,
  );
  assert.match(message, /Please reply YES to confirm you’ll be able to attend/);
});

test('buildConfirmationMessage does not use tomorrow just because text is sent Friday', () => {
  const dueAt = new Date('2026-04-20T23:00:00.000Z');
  const message = buildConfirmationMessage({
    variant: 'confirmation_2',
    headScoutName: 'Ryan Lietz',
    dueAt,
    meetingTimezone: 'CST',
    now: new Date('2026-04-17T16:00:00.000Z'),
  });

  assert.match(
    message,
    /Coach Ryan Lietz still has you down for 6:00pm central on Monday evening\./,
  );
  assert.doesNotMatch(message, /tomorrow/);
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

  assert.match(
    message,
    /Coach Ryan Lietz still has you down for 6:00pm central tomorrow evening\./,
  );
  assert.match(message, /Please reply YES to confirm you’ll be able to attend/);
});

test('confirmation 1 and confirmation 2 use the same relative phrase resolver', () => {
  const dueAt = new Date('2026-05-02T23:00:00.000Z');
  const now = new Date('2026-05-02T13:00:00.000Z');
  const baseArgs = {
    headScoutName: 'Ryan Lietz',
    dueAt,
    meetingTimezone: 'EST',
    now,
  };

  const confirmation1 = buildConfirmationMessage({
    ...baseArgs,
    variant: 'confirmation_1',
    recipientNames: ['Peter'],
  });
  const confirmation2 = buildConfirmationMessage({
    ...baseArgs,
    variant: 'confirmation_2',
  });

  assert.match(confirmation1, /Prospect ID Zoom Meeting tonight 5\/2 at 7:00 PM ET/);
  assert.match(confirmation2, /still has you down for 7:00pm eastern tonight\./);
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
