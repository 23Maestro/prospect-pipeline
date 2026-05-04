import test from 'node:test';
import assert from 'node:assert/strict';
import type { MeetingSetTemplateResponse, ScoutPrepContext } from '../features/scout-prep/types.js';
import { buildScoutPrepCard } from '../features/scout-prep/content.js';
import { CAL_BOOKING_URL } from './scout-follow-up-templates.js';
import {
  buildMeetingTemplateDefaults,
  buildMessagesComposeUrlForRecipients,
  buildProspectContactShortcutPayload,
  buildProspectContactShortcutPayloadFromName,
  buildScoutPrepLeavingVoicemailBody,
  buildVoicemailFollowUpBody,
  getVoicemailFollowUpRecipients,
  getProspectContactShortcutCandidates,
  mapTimezoneToLegacyRecruitZone,
  mergeMeetingDetailsTemplate,
  normalizePhoneForMessages,
  resolveParentHonorificFromRelationship,
  selectScoutPrepContactNumbers,
} from './scout-prep-contact.js';

function buildContext(overrides?: Partial<ScoutPrepContext>): ScoutPrepContext {
  return {
    task: {
      contact_id: '123',
      athlete_main_id: '456',
      athlete_name: 'Bryson Smith',
    },
    resolved: {
      sport: 'Football',
      positions: 'OL / DL',
      gpa: '3.7',
      height: `6'2"`,
      weight: '285 lbs',
      city: 'South St. Paul',
      state: 'MN',
      ...overrides?.resolved,
    },
    contactInfo: {
      contactId: '123',
      studentAthlete: {
        name: 'Bryson Smith',
        email: null,
        phone: '(651) 555-3000',
      },
      parent1: {
        name: 'Jamie Smith',
        relationship: 'Mother',
        email: null,
        phone: '(651) 555-1212',
      },
      parent2: {
        name: 'Chris Smith',
        relationship: 'Father',
        email: null,
        phone: '1-651-555-9898',
      },
      ...overrides?.contactInfo,
    },
    notes: [],
    tasks: [],
    ...overrides,
  };
}

test('normalizePhoneForMessages: normalizes common US inputs', () => {
  assert.equal(normalizePhoneForMessages('(651) 555-1212'), '651-555-1212');
  assert.equal(normalizePhoneForMessages('1-651-555-1212'), '651-555-1212');
  assert.equal(normalizePhoneForMessages('+1 (651) 555-1212'), '651-555-1212');
  assert.equal(normalizePhoneForMessages('abc'), null);
});

test('resolveParentHonorificFromRelationship: maps backend mom and dad labels', () => {
  assert.equal(resolveParentHonorificFromRelationship('Mother'), 'Ms.');
  assert.equal(resolveParentHonorificFromRelationship('Mom'), 'Ms.');
  assert.equal(resolveParentHonorificFromRelationship('Father'), 'Mr.');
  assert.equal(resolveParentHonorificFromRelationship('Dad'), 'Mr.');
  assert.equal(resolveParentHonorificFromRelationship('Guardian'), null);
});

test('selectScoutPrepContactNumbers: prefers parent1, then parent2, then student', () => {
  const selected = selectScoutPrepContactNumbers(buildContext());
  assert.equal(selected.primaryNumber, '651-555-1212');
  assert.equal(selected.backupNumber, '651-555-9898');
  assert.equal(selected.spokeTo, 'Jamie Smith');
  assert.equal(selected.otherParent, 'Chris Smith');
  assert.equal(selected.recipientName, 'Jamie Smith');
});

test('getProspectContactShortcutCandidates: returns available contacts in fixed order', () => {
  const candidates = getProspectContactShortcutCandidates(buildContext());
  assert.deepEqual(
    candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      name: candidate.name,
      phone: candidate.phone,
    })),
    [
      { id: 'parent1', label: 'Parent 1', name: 'Jamie Smith', phone: '651-555-1212' },
      { id: 'parent2', label: 'Parent 2', name: 'Chris Smith', phone: '651-555-9898' },
      {
        id: 'studentAthlete',
        label: 'Student Athlete',
        name: 'Bryson Smith',
        phone: '651-555-3000',
      },
    ],
  );
});

test('mapTimezoneToLegacyRecruitZone: maps common IANA zones', () => {
  assert.equal(mapTimezoneToLegacyRecruitZone('America/Chicago'), 'CST');
  assert.equal(mapTimezoneToLegacyRecruitZone('America/New_York'), 'EST');
  assert.equal(mapTimezoneToLegacyRecruitZone('America/Phoenix'), 'MST');
});

test('mergeMeetingDetailsTemplate: injects contact fields into labeled lines', () => {
  const template = ['Main Number:', 'Backup Number:', 'Spoke To:', 'Other Parent:'].join('\n');

  const merged = mergeMeetingDetailsTemplate(
    template,
    selectScoutPrepContactNumbers(buildContext()),
  );
  assert.match(merged, /Main Number: \(651\) 555-1212/);
  assert.match(merged, /Backup Number: \(651\) 555-9898/);
  assert.match(merged, /Spoke To: Jamie Smith/);
  assert.match(merged, /Other Parent: Chris Smith/);
});

test('mergeMeetingDetailsTemplate: prefills athlete details and optional GPA only when available', () => {
  const template = [
    'Main Number:',
    'Backup Number:',
    'Spoke To:',
    'Other Parent:',
    '',
    'About The Athlete:',
    '',
    'Deficit:',
    '',
    'Other Details:',
  ].join('\n');

  const merged = mergeMeetingDetailsTemplate(
    template,
    selectScoutPrepContactNumbers(
      buildContext({
        resolved: {
          positions: 'S / ATH',
          height: `6'0"`,
          weight: '175',
          high_school: 'Arroyo Grande High School',
          gpa: '3.70',
        },
      }),
    ),
    buildContext({
      resolved: {
        positions: 'S / ATH',
        height: `6'0"`,
        weight: '175',
        high_school: 'Arroyo Grande High School',
        gpa: '3.70',
      },
    }),
  );

  assert.match(
    merged,
    /About The Athlete:\nS \| ATH\n6'0" \| 175\nArroyo Grande High School\n\nGPA 3.70\nDeficit:/,
  );
});

test('buildMeetingTemplateDefaults: prefers computed timezone when option exists', () => {
  const template: MeetingSetTemplateResponse = {
    success: true,
    selected_recruit_timezone: 'EST',
    recruit_timezone_options: ['EST', 'CST', 'MST'].map((value) => ({
      value,
      label: value,
      selected: value === 'EST',
    })),
    details_template: 'Main Number:\nBackup Number:\nSpoke To:\nOther Parent:',
  };

  const defaults = buildMeetingTemplateDefaults(template, buildContext());
  assert.equal(defaults.selected_recruit_timezone, 'CST');
  assert.match(defaults.details_template || '', /Main Number: \(651\) 555-1212/);
});

test('buildMeetingTemplateDefaults: keeps backend timezone when computed option missing', () => {
  const template: MeetingSetTemplateResponse = {
    success: true,
    selected_recruit_timezone: 'EST',
    recruit_timezone_options: ['EST', 'PST'].map((value) => ({
      value,
      label: value,
      selected: value === 'EST',
    })),
    details_template: 'Main Number:\nBackup Number:\nSpoke To:\nOther Parent:',
  };

  const defaults = buildMeetingTemplateDefaults(template, buildContext());
  assert.equal(defaults.selected_recruit_timezone, 'EST');
});

test('getVoicemailFollowUpRecipients: returns parents plus group text option', () => {
  const recipients = getVoicemailFollowUpRecipients(buildContext());

  assert.deepEqual(recipients, [
    {
      id: 'parent1',
      label: 'Parent 1',
      name: 'Jamie Smith',
      phones: ['651-555-1212'],
    },
    {
      id: 'parent2',
      label: 'Parent 2',
      name: 'Chris Smith',
      phones: ['651-555-9898'],
    },
    {
      id: 'studentAthlete',
      label: 'Student Athlete',
      name: 'Bryson Smith',
      phones: ['651-555-3000'],
    },
    {
      id: 'groupAll',
      label: 'Group Text',
      name: 'All Associated Contacts',
      phones: ['651-555-1212', '651-555-9898', '651-555-3000'],
    },
  ]);
});

test('getVoicemailFollowUpRecipients: duplicate parent and athlete phone uses student athlete recipient', () => {
  const recipients = getVoicemailFollowUpRecipients(
    buildContext({
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Jaylin Bailey',
          email: null,
          phone: '(310) 555-1111',
        },
        parent1: {
          name: 'Robert Bailey',
          relationship: 'Father',
          email: null,
          phone: '(310) 555-1111',
        },
        parent2: null,
      },
    }),
  );

  assert.deepEqual(recipients, [
    {
      id: 'studentAthlete',
      label: 'Student Athlete',
      name: 'Jaylin Bailey',
      phones: ['310-555-1111'],
    },
  ]);
});

test('buildVoicemailFollowUpBody: duplicate parent and athlete phone uses student athlete template', () => {
  const body = buildVoicemailFollowUpBody(
    buildContext({
      task: {
        contact_id: '123',
        athlete_main_id: '456',
        athlete_name: 'Jaylin Bailey',
        grad_year: '2027',
      },
      resolved: {
        sport: 'Football',
        city: 'Los Angeles',
        state: 'CA',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Jaylin Bailey',
          email: null,
          phone: '(310) 555-1111',
        },
        parent1: {
          name: 'Robert Bailey',
          relationship: 'Father',
          email: null,
          phone: '(310) 555-1111',
        },
        parent2: null,
      },
    }),
    undefined,
    'call_attempt_1',
    'Left Voice Mail 1',
    'Call Attempt 1',
    new Date('2026-04-17T19:28:00Z'),
  );

  assert.match(
    body,
    /^Good afternoon Jaylin, this is Jerami Singleton with Prospect ID\./,
  );
  assert.match(body, /I received your info about playing college football\./);
  assert.match(
    body,
    /If you’re serious about this, have one of your parents call or text me\./,
  );
  assert.doesNotMatch(body, /football scouting coordinator\nProspect ID/);
  assert.doesNotMatch(body, /Following up on Jaylin's recruiting plan/);
});

test('buildVoicemailFollowUpBody/buildMessagesComposeUrlForRecipients: builds formal parent handoff', () => {
  const body = buildVoicemailFollowUpBody(
    buildContext({
      task: {
        contact_id: '123',
        athlete_main_id: '456',
        athlete_name: 'Bryson Smith',
        grad_year: 'Sophomore',
      },
      resolved: {
        sport: 'Football',
        city: 'South St. Paul',
        state: 'MN',
      },
    }),
    'parent1',
    'call_attempt_1',
    'Left Voice Mail 1',
    'Call Attempt 1',
    new Date('2026-04-17T09:00:00Z'),
  );
  const url = buildMessagesComposeUrlForRecipients(['651-555-1212'], body);
  assert.match(body, /^Good morning Ms\. Smith, this is Jerami Singleton with Prospect ID\./);
  assert.match(
    body,
    /Bryson’s profile came through and I wanted to ask a few quick questions about his college football goals\./,
  );
  assert.doesNotMatch(body, /I just left you a voicemail/);
  assert.match(body, /Would later today or tomorrow work for a quick 10-minute call\?/);
  assert.doesNotMatch(body, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(body, /Enjoy the rest of your weekend\./);
  assert.doesNotMatch(body, /Jerami Singleton\nProspect ID/);
  assert.match(url, /^sms:651-555-1212\?body=/);
  assert.match(url, /profile%20came%20through/);
});

test('buildVoicemailFollowUpBody: group text still uses parent template without nicety closing', () => {
  const body = buildVoicemailFollowUpBody(
    buildContext({
      resolved: {
        sport: 'Football',
        city: 'South St. Paul',
        state: 'MN',
      },
    }),
    'groupAll',
    undefined,
    null,
    null,
    new Date('2026-04-15T09:00:00Z'),
  );

  assert.match(body, /^Good morning Ms\. Smith, this is Jerami Singleton with Prospect ID\./);
  assert.match(body, /Bryson’s profile came through/);
  assert.doesNotMatch(body, /I just left you a voicemail/);
  assert.match(body, /Would later today or tomorrow work for a quick 10-minute call\?/);
  assert.doesNotMatch(body, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(body, /Enjoy the rest of your week\./);
  assert.doesNotMatch(body, /Jerami Singleton\nProspect ID/);
});

test('buildVoicemailFollowUpBody: uses athlete local afternoon greeting', () => {
  const body = buildVoicemailFollowUpBody(
    buildContext({
      task: {
        contact_id: '123',
        athlete_main_id: '456',
        athlete_name: 'Jaylin Bailey',
        grad_year: 'Sophomore',
      },
      resolved: {
        sport: 'Football',
        city: 'Los Angeles',
        state: 'CA',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Jaylin Bailey',
          email: null,
          phone: '(310) 555-0000',
        },
        parent1: {
          name: 'Robert Bailey',
          relationship: 'Father',
          email: null,
          phone: '(310) 555-1111',
        },
        parent2: null,
      },
    }),
    'parent1',
    'call_attempt_1',
    'Left Voice Mail 1',
    'Call Attempt 1',
    new Date('2026-04-17T19:28:00Z'),
  );

  assert.match(body, /^Good afternoon Mr\. Bailey, this is Jerami Singleton with Prospect ID\./);
  assert.match(body, /Jaylin’s profile came through/);
  assert.doesNotMatch(body, /I just left you a voicemail/);
});

test('buildVoicemailFollowUpBody: uses attempt 2 copy when selected', () => {
  const body = buildVoicemailFollowUpBody(
    buildContext({
      task: {
        contact_id: '123',
        athlete_main_id: '456',
        athlete_name: 'Jaylin Bailey',
        grad_year: '2027',
      },
      resolved: {
        sport: 'Football',
        city: 'Los Angeles',
        state: 'CA',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Jaylin Bailey',
          email: null,
          phone: '(310) 555-0000',
        },
        parent1: {
          name: 'Robert Bailey',
          relationship: 'Father',
          email: null,
          phone: '(310) 555-1111',
        },
        parent2: null,
      },
    }),
    'parent1',
    'call_attempt_2',
    'Left Voice Mail 2',
    'Call Attempt 2',
    new Date('2026-04-17T19:28:00Z'),
  );

  assert.match(
    body,
    /^Good afternoon Mr\. Bailey, any updates or questions on this\?/,
  );
  assert.match(body, /If I send you a calendar link, would that be more convenient\?/);
  assert.doesNotMatch(body, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(body, /just left (you )?a voicemail/i);
  assert.doesNotMatch(body, /I just tried you again/);
  assert.doesNotMatch(body, /trying to get a better feel/);
  assert.doesNotMatch(body, /learn his goals/);
  assert.doesNotMatch(body, /Jerami Singleton\nProspect ID/);
});

test('buildVoicemailFollowUpBody: attempt 3 asks parent to triage interest', () => {
  const body = buildVoicemailFollowUpBody(
    buildContext({
      task: {
        contact_id: '123',
        athlete_main_id: '456',
        athlete_name: 'Jaylin Bailey',
        grad_year: '2027',
      },
      resolved: {
        sport: 'Football',
        city: 'Los Angeles',
        state: 'CA',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Jaylin Bailey',
          email: null,
          phone: '(310) 555-0000',
        },
        parent1: {
          name: 'Robert Bailey',
          relationship: 'Father',
          email: null,
          phone: '(310) 555-1111',
        },
        parent2: null,
      },
    }),
    'parent1',
    'call_attempt_3',
    'Never Spoke To',
    'Call Attempt 3',
    new Date('2026-04-17T19:28:00Z'),
  );

  assert.match(
    body,
    /^Good afternoon Mr\. Bailey, choose what’s most relevant so I can be helpful:/,
  );
  assert.match(body, /1 - not interested whatsoever/);
  assert.match(body, /2 - interested but bad timing/);
  assert.match(body, /3 - interested and ready to learn about next steps/);
  assert.doesNotMatch(body, new RegExp(CAL_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(body, /I’ve tried a few times/);
  assert.doesNotMatch(body, /I’ll close this out for now\./);
  assert.doesNotMatch(body, /just left (you )?a voicemail/i);
  assert.doesNotMatch(body, /Jerami Singleton\nProspect ID/);
});

test('buildVoicemailFollowUpBody: student athlete attempt 2 uses shorter action-oriented copy', () => {
  const body = buildVoicemailFollowUpBody(
    buildContext({
      task: {
        contact_id: '123',
        athlete_main_id: '456',
        athlete_name: 'Jayson Bailey',
        grad_year: '2027',
      },
      resolved: {
        sport: 'Football',
        city: 'Los Angeles',
        state: 'CA',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Jayson Bailey',
          email: null,
          phone: '(310) 555-0000',
        },
        parent1: {
          name: 'Robert Bailey',
          relationship: 'Father',
          email: null,
          phone: '(310) 555-1111',
        },
        parent2: null,
      },
    }),
    'studentAthlete',
    'call_attempt_2',
    'Left Voice Mail 2',
    'Call Attempt 2',
    new Date('2026-04-17T19:28:00Z'),
  );

  assert.match(body, /^Good afternoon Jayson, this is Jerami Singleton with Prospect ID\./);
  assert.match(body, /Any updates or questions on playing college football\?/);
  assert.match(
    body,
    /If this is still something you want, have one of your parents call or text me\./,
  );
  assert.doesNotMatch(body, /I left you another voicemail/);
  assert.doesNotMatch(body, /football scouting coordinator\nProspect ID/);
});

test('buildVoicemailFollowUpBody: student athlete attempts stay distinct', () => {
  const context = buildContext({
    task: {
      contact_id: '123',
      athlete_main_id: '456',
      athlete_name: 'Jayson Bailey',
      grad_year: '2027',
    },
    resolved: {
      sport: 'Football',
      city: 'Los Angeles',
      state: 'CA',
    },
    contactInfo: {
      contactId: '123',
      studentAthlete: {
        name: 'Jayson Bailey',
        email: null,
        phone: '(310) 555-0000',
      },
      parent1: {
        name: 'Robert Bailey',
        relationship: 'Father',
        email: null,
        phone: '(310) 555-1111',
      },
      parent2: null,
    },
  });

  const attempt1 = buildVoicemailFollowUpBody(
    context,
    'studentAthlete',
    'call_attempt_1',
    'Left Voice Mail 1',
    'Call Attempt 1',
    new Date('2026-04-17T19:28:00Z'),
  );
  const attempt3 = buildVoicemailFollowUpBody(
    context,
    'studentAthlete',
    'call_attempt_3',
    'Never Spoke To',
    'Call Attempt 3',
    new Date('2026-04-17T19:28:00Z'),
  );

  assert.match(attempt1, /I received your info about playing college football/);
  assert.match(attempt3, /Last follow-up on your college football profile/);
  assert.notEqual(attempt1, attempt3);
});

test('buildVoicemailFollowUpBody: send Cal link option renders simple reply', () => {
  const body = buildVoicemailFollowUpBody(
    buildContext(),
    'parent1',
    'send_cal_link',
    null,
    null,
    new Date('2026-04-17T19:28:00Z'),
  );

  assert.equal(
    body,
    ['Great! Here’s the link to schedule a quick call:', CAL_BOOKING_URL].join('\n'),
  );
});

test('buildVoicemailFollowUpBody: no show uses first name only', () => {
  const body = buildVoicemailFollowUpBody(
    buildContext({
      task: {
        contact_id: '123',
        athlete_main_id: '456',
        athlete_name: 'Aiden Reed',
        grad_year: '2027',
      },
      resolved: {
        sport: 'Football',
        city: 'Los Angeles',
        state: 'CA',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Aiden Reed',
          email: null,
          phone: '(310) 555-0000',
        },
        parent1: {
          name: 'Jamie Reed',
          relationship: 'Mother',
          email: null,
          phone: '(310) 555-1111',
        },
        parent2: null,
      },
    }),
    'parent1',
    'no_show',
    'Meeting Result No Show',
    'No Show',
    new Date('2026-04-24T13:00:00Z'),
  );

  assert.match(
    body,
    /^Hi Jamie, looks like we missed you for Aiden’s meeting with our Head Scout\./,
  );
  assert.doesNotMatch(body, /^Hi Ms\./);
});

test('buildMessagesComposeUrlForRecipients: supports group threads with deduped phone list', () => {
  const url = buildMessagesComposeUrlForRecipients(
    ['651-555-1212', '(651) 555-1212', '651-555-9898'],
    'Hello there',
  );

  assert.equal(url, 'sms:/open?addresses=651-555-1212%2C651-555-9898&body=Hello%20there');
});

test('buildProspectContactShortcutPayload: preserves newline-delimited shortcut format', () => {
  assert.equal(
    buildProspectContactShortcutPayload({
      firstName: 'Joe',
      lastName: 'Wright',
      phone: '4075555555',
    }),
    'Joe\nWright\n407-555-5555',
  );
});

test('buildProspectContactShortcutPayloadFromName: normalizes full name and phone safely', () => {
  const payload = buildProspectContactShortcutPayloadFromName({
    fullName: 'Mary Ann Wright',
    phone: '(407) 555-5555',
  });
  assert.equal(payload, 'Mary\nAnn Wright\n407-555-5555');
});

test('buildProspectContactShortcutPayloadFromName: rejects missing required fields', () => {
  assert.throws(
    () => buildProspectContactShortcutPayloadFromName({ fullName: 'Prince', phone: '4075555555' }),
    /first and last name/i,
  );
  assert.throws(
    () => buildProspectContactShortcutPayload({ firstName: 'Joe', lastName: 'Wright', phone: 'x' }),
    /required/i,
  );
});

test('buildScoutPrepLeavingVoicemailBody: builds son voicemail with parent and athlete first names', () => {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName: 'Jamie Smith',
    athleteName: 'Bryson Smith',
    sport: 'Football',
  });

  assert.match(body, /^Hi Jamie, this is Jerami Singleton/);
  assert.match(body, /college football scout/);
  assert.match(body, /Bryson’s college football profile/);
  assert.match(body, /his academics and football talent/);
  assert.match(body, /407-473-3637/);
  assert.doesNotMatch(body, /came across my desk/);
  assert.doesNotMatch(body, /Again, this is Jerami with Prospect ID/);
});

test('buildScoutPrepLeavingVoicemailBody: uses the provided sport for non-football athletes', () => {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName: 'Amy Torres',
    athleteName: 'Jason Torres',
    sport: "Men's Basketball",
  });

  assert.match(body, /college basketball scout/);
  assert.match(body, /college basketball profile/);
  assert.match(body, /basketball talent/);
  assert.doesNotMatch(body, /football/);
});

test('buildScoutPrepLeavingVoicemailBody: uses daughter and her for softball athletes', () => {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName: 'Amy Torres',
    athleteName: 'Ava Torres',
    sport: 'Softball',
  });

  assert.match(body, /Ava’s college softball profile/);
  assert.match(body, /her academics and softball talent/);
  assert.doesNotMatch(body, /your son/);
});

test('buildScoutPrepLeavingVoicemailBody: uses shorter voicemail for post-first-attempt tasks', () => {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName: 'Jamie Smith',
    athleteName: 'Bryson Smith',
    sport: 'Football',
    currentTask: 'Scheduled Follow Up Call the family second time and leave follow-up voicemail.',
  });

  assert.match(body, /^Hi Jamie, this is Jerami Singleton with Prospect ID\./);
  assert.match(body, /Quick follow-up on Bryson’s college football profile\./);
  assert.match(body, /call or text me back when you can\./);
  assert.match(body, /My number is 407-473-3637\./);
  assert.doesNotMatch(body, /I had a few quick questions/);
  assert.doesNotMatch(body, /came across my desk/);
});

test('buildScoutPrepCard: uses one stable call path and exact connect/scout blocks', () => {
  const card = buildScoutPrepCard(
    {
      athleteName: 'Bryson Smith',
      parent1Name: 'Jamie Smith',
      parent2Name: 'Chris Smith',
      gradYear: 'Junior',
      sport: 'Football',
    },
    buildContext(),
  ).markdown;

  assert.match(card, /## Athlete Snapshot/);
  assert.match(card, /## Call Path/);
  assert.match(card, /### Connect the Dots/);
  assert.match(card, /\*\*If Unaware, Say:\*\*/);
  assert.match(card, /> Let me take a step back and explain\./);
  assert.match(card, /\*\*If Aware, Proceed Here:\*\*/);
  assert.match(card, /### Qualify/);
  assert.equal((card.match(/### Qualify/g) || []).length, 1);
  assert.match(card, /### Summary → Deficit/);
  assert.match(card, /### Introduce Scout/);
  assert.match(card, /### Set Meeting/);
  assert.match(
    card,
    /> So the next step, Jamie, is we’ve gotta get you on the phone with one of our top scouts\./,
  );
  assert.match(
    card,
    /> He’s gonna be calling from a \[Area Code\] phone number, so watch out for his number\./,
  );
  assert.doesNotMatch(card, /team of all-star scouts/i);
  assert.doesNotMatch(card, /Top 500 team/i);
});

test('buildScoutPrepCard: uses resolved sport in live script copy', () => {
  const card = buildScoutPrepCard(
    {
      athleteName: 'Jason Torres',
      parent1Name: 'Amy Torres',
      gradYear: 'Sophomore',
      sport: "Men's Basketball",
    },
    buildContext({
      resolved: {
        sport: "Men's Basketball",
        positions: null,
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Jason Torres',
          email: null,
          phone: null,
        },
        parent1: {
          name: 'Amy Torres',
          relationship: 'Mother',
          email: null,
          phone: null,
        },
        parent2: null,
      },
    }),
  ).markdown;

  assert.match(card, /college men's basketball scout/);
  assert.match(card, /looking to play college men's basketball/);
  assert.match(card, /grad year for men's basketball/);
  assert.doesNotMatch(card, /college football/);
  assert.doesNotMatch(card, /grad year for football/);
});

test('buildScoutPrepCard: branches football prompts by position group', () => {
  const baseValues = {
    athleteName: 'Bryson Smith',
    parent1Name: 'Jamie Smith',
    gradYear: 'Junior' as const,
    sport: 'Football',
  };

  const olCard = buildScoutPrepCard(baseValues, buildContext()).markdown;
  assert.match(olCard, /squat, bench/);
  assert.match(olCard, /quick is he off the ball/);

  const skillCard = buildScoutPrepCard(
    baseValues,
    buildContext({ resolved: { positions: 'WR / RB' } }),
  ).markdown;
  assert.match(skillCard, /production did he have/);
  assert.match(skillCard, /explosive does he look in space/);

  const qbCard = buildScoutPrepCard(
    baseValues,
    buildContext({ resolved: { positions: 'QB' } }),
  ).markdown;
  assert.match(qbCard, /arm talent, accuracy, and decision-making/);

  const dbCard = buildScoutPrepCard(
    baseValues,
    buildContext({ resolved: { positions: 'LB / DB' } }),
  ).markdown;
  assert.match(dbCard, /tackles, coverage plays, turnovers/);
});

test('buildScoutPrepCard: grad year changes deficit and GPA changes tone only', () => {
  const junior = buildScoutPrepCard(
    {
      athleteName: 'Bryson Smith',
      parent1Name: 'Jamie Smith',
      gradYear: 'Junior',
      sport: 'Football',
    },
    buildContext({ resolved: { gpa: '3.8' } }),
  ).markdown;
  assert.match(junior, /With a 3\.8, it sounds like he’s doing his part in the classroom too\./);
  assert.match(junior, /You’re behind in recruiting, we gotta get him caught up\./);

  const sophomore = buildScoutPrepCard(
    {
      athleteName: 'Bryson Smith',
      parent1Name: 'Jamie Smith',
      gradYear: 'Sophomore',
      sport: 'Football',
    },
    buildContext({ resolved: { gpa: '3.1' } }),
  ).markdown;
  assert.match(sophomore, /He can get into college with a 3\.1\./);
  assert.match(sophomore, /For sophomores, the big thing is just getting Bryson on the map\./);

  const senior = buildScoutPrepCard(
    {
      athleteName: 'Bryson Smith',
      parent1Name: 'Jamie Smith',
      gradYear: 'Senior',
      sport: 'Football',
    },
    buildContext({ resolved: { gpa: '2.4' } }),
  ).markdown;
  assert.match(
    senior,
    /Academically, that’s something we’ll want to keep improving, but it doesn’t mean options are gone\./,
  );
  assert.match(senior, /where do things stand right now/);
});
