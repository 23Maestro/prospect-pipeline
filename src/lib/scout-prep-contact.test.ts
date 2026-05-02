import test from 'node:test';
import assert from 'node:assert/strict';
import type { MeetingSetTemplateResponse, ScoutPrepContext } from '../features/scout-prep/types.js';
import { buildScoutPrepCard } from '../features/scout-prep/content.js';
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
  const defaultContext: ScoutPrepContext = {
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
    },
    notes: [],
    tasks: [],
  };

  return {
    ...defaultContext,
    ...overrides,
    task: {
      ...defaultContext.task,
      ...overrides?.task,
    },
    resolved: {
      ...defaultContext.resolved,
      ...overrides?.resolved,
    },
    contactInfo: {
      ...defaultContext.contactInfo,
      ...overrides?.contactInfo,
      studentAthlete: {
        ...defaultContext.contactInfo.studentAthlete,
        ...overrides?.contactInfo?.studentAthlete,
      },
      parent1:
        overrides?.contactInfo?.parent1 === null
          ? null
          : {
              ...defaultContext.contactInfo.parent1!,
              ...overrides?.contactInfo?.parent1,
            },
      parent2:
        overrides?.contactInfo?.parent2 === null
          ? null
          : {
              ...defaultContext.contactInfo.parent2!,
              ...overrides?.contactInfo?.parent2,
            },
    },
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
    /^Good afternoon Jaylin, this is Jerami Singleton, college football scout with Prospect ID\./,
  );
  assert.match(
    body,
    /If that’s something you’re serious about, have one of your parents give me a quick call or text\./,
  );
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
  assert.match(
    body,
    /^Good morning Ms\. Smith, this is Jerami Singleton with Prospect ID\. Following up on Bryson's recruiting plan\./,
  );
  assert.match(
    body,
    /If playing college football is still a serious goal for him, I’d like to get a quick 10-minute call scheduled while timing still matters\./,
  );
  assert.match(body, /Would later today or tomorrow work better\?/);
  assert.doesNotMatch(body, /Enjoy the rest of your weekend\./);
  assert.match(url, /^sms:651-555-1212\?body=/);
  assert.match(url, /Bryson's%20recruiting%20plan/);
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

  assert.match(
    body,
    /^Good morning Ms\. Smith, this is Jerami Singleton with Prospect ID\. Following up on Bryson's recruiting plan\./,
  );
  assert.match(body, /Would later today or tomorrow work better\?/);
  assert.doesNotMatch(body, /Enjoy the rest of your week\./);
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

  assert.match(
    body,
    /^Good afternoon Mr\. Bailey, this is Jerami Singleton with Prospect ID\. Following up on Jaylin's recruiting plan\./,
  );
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
    /^Good afternoon Mr\. Bailey, this is Jerami Singleton, college football scout with Prospect ID\./,
  );
  assert.match(
    body,
    /I received Jaylin's info and I’m trying to get a better feel for him as a student athlete and learn his goals for playing college football\./,
  );
  assert.match(
    body,
    /When would you have a 10 min gap today or in the next few days\? I can be flexible on time\./,
  );
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

  assert.match(
    body,
    /^Good afternoon Jayson, this is Jerami Singleton, college football scout with Prospect ID\./,
  );
  assert.match(
    body,
    /I received your info and wanted to learn a little more about your goals for playing in college\./,
  );
  assert.match(
    body,
    /If that’s something you’re serious about, have one of your parents give me a quick call or text\./,
  );
  assert.doesNotMatch(body, /I left you another voicemail/);
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
  assert.match(body, /your son Bryson/);
  assert.match(body, /407-473-3637/);
  assert.match(body, /Thanks Jamie, talk to you soon\. Bye, Bye\.$/);
});

test('buildScoutPrepLeavingVoicemailBody: uses the provided sport for non-football athletes', () => {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName: 'Amy Torres',
    athleteName: 'Jason Torres',
    sport: "Men's Basketball",
  });

  assert.match(body, /college basketball scout/);
  assert.match(body, /desire to play college basketball/);
  assert.match(body, /basketball talent/);
  assert.doesNotMatch(body, /football/);
});

test('buildScoutPrepLeavingVoicemailBody: uses daughter and her for softball athletes', () => {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName: 'Amy Torres',
    athleteName: 'Ava Torres',
    sport: 'Softball',
  });

  assert.match(body, /your daughter Ava/);
  assert.match(body, /her desire to play college softball/);
  assert.match(body, /her academics and softball talent/);
  assert.doesNotMatch(body, /your son/);
});

test('buildScoutPrepCard: uses 2A warm-lead appointment-setting call path', () => {
  const card = buildScoutPrepCard(
    {
      athleteName: 'Bryson Smith',
      parent1Name: 'Jamie Smith',
      parent2Name: 'Chris Smith',
      gradYear: 'Junior',
      sport: 'Football',
    },
    buildContext({ resolved: { head_scout: 'Luther Winfield' } }),
  ).markdown;

  assert.match(card, /## Athlete Snapshot/);
  assert.match(card, /## Call Path/);
  assert.deepEqual(
    Array.from(card.matchAll(/^### (.+)$/gm), (match) => match[1]),
    [
      'Connect the Dots',
      'Qualify',
      'Rapport + Discovery + Build Up',
      'Summary → Deficit',
      'Introduce Scout',
      'Set Meeting',
      'Meeting Requirements',
    ],
  );
  assert.match(card, /> Hi, is this Jamie\?/);
  assert.match(
    card,
    /> The reason I’m calling is Bryson filled out some info about playing in college, did they happen to mention that to you\?/,
  );
  assert.match(card, /> Okay, so a bit of a blindside here\./);
  assert.match(card, /> Let me take a step back and explain\./);
  assert.match(card, /> Do you support Bryson taking this step\? Is he looking to play college football\?/);
  assert.match(card, /- You guys are in MN, right\?/);
  assert.match(card, /- Is football pretty big out there\?/);
  assert.match(card, /- Is Bryson big into following football too\?/);
  assert.match(card, /From your eye test, what do you feel he does best on the field\?/);
  assert.match(card, /Maybe less about the numbers, what does your eye test tell you\?/);
  assert.match(card, /Where are you guys at in the recruiting process right now\? Are you hearing anything\?/);
  assert.match(card, /With his size, strong academics, and no offers or phone calls yet, what do you think is going on\?/);
  assert.match(card, /How come nobody’s calling him\?/);
  assert.match(card, /D2 coaches have already been able to call, and D1 programs are already making offers in this class\./);
  assert.match(
    card,
    /> So the next step, Jamie, is we’ve gotta get you on the phone with one of our top scouts\./,
  );
  assert.match(card, /> I’m gonna schedule you with Luther Winfield\./);
  assert.match(card, /> If I book you with Luther, you guys have to be ready for the call, sound good\?/);
  assert.match(card, /> He’s got one \[Day\] at \[Time\] \[Timezone\], or \[Day\] at \[Time\] \[Timezone\]\. Which one works better\?/);
  assert.match(
    card,
    /> Number one, he needs the full family there, so that means yourself, Bryson, and Chris Smith\./,
  );
  assert.match(card, /> Number two, he’s gonna walk you through a 45 minute Zoom meeting/);
  assert.doesNotMatch(card, /team of all-star scouts/i);
  assert.doesNotMatch(card, /Top 500 team/i);
  assert.doesNotMatch(card, /Anchor:/i);
  assert.doesNotMatch(card, /You’re behind in recruiting, we gotta get him caught up/i);
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

  assert.match(card, /a men's basketball scout/);
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
  assert.match(
    junior,
    /D2 coaches have already been able to call, and D1 programs are already making offers in this class\./,
  );

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
  assert.match(
    sophomore,
    /This is the time to start getting him on the map before coaches already have relationships built with other athletes\./,
  );

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
  assert.match(
    senior,
    /At this point, the window is tight, so we need to figure out quickly whether there’s still a real path\./,
  );
});
