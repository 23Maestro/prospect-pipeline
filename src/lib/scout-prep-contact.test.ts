import test from 'node:test';
import assert from 'node:assert/strict';
import type { MeetingSetTemplateResponse, ScoutPrepContext } from '../features/scout-prep/types.js';
import { buildScoutPrepCard } from '../features/scout-prep/content.js';
import { CAL_BOOKING_URL } from './scout-follow-up-templates.js';
import {
  buildMeetingTemplateDefaults,
  buildMeetingSetCallNotesMarkdown,
  buildMessagesComposeUrlForRecipients,
  buildProspectContactAdminNote,
  buildProspectContactShortcutPayload,
  buildProspectContactShortcutPayloadFromName,
  resolveProspectContactCreateFailureToast,
  buildScoutPrepLeavingVoicemailBody,
  buildVoicemailFollowUpBody,
  getVoicemailFollowUpRecipients,
  getProspectContactShortcutCandidates,
  hydrateMeetingSetTemplateForForm,
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

test('getProspectContactShortcutCandidates: duplicate parent and athlete phone uses student athlete contact', () => {
  const candidates = getProspectContactShortcutCandidates(
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

  assert.deepEqual(candidates, [
    {
      id: 'studentAthlete',
      label: 'Student Athlete',
      name: 'Jaylin Bailey',
      phone: '310-555-1111',
    },
  ]);
});

test('mapTimezoneToLegacyRecruitZone: maps common IANA zones', () => {
  assert.equal(mapTimezoneToLegacyRecruitZone('America/Chicago'), 'CST');
  assert.equal(mapTimezoneToLegacyRecruitZone('America/New_York'), 'EST');
  assert.equal(mapTimezoneToLegacyRecruitZone('America/Phoenix'), 'MST');
});

test('buildProspectContactAdminNote: resolves timezone from athlete city and state', () => {
  const note = buildProspectContactAdminNote(
    buildContext({
      resolved: {
        city: 'New York',
        state: 'NY',
        timezone: null,
      },
    }),
  );

  assert.equal(note, ['Timezone: Eastern', '', 'Bryson Smith'].join('\n'));
});

test('buildProspectContactAdminNote: allows contact creation when timezone is unresolved', () => {
  const note = buildProspectContactAdminNote(
    buildContext({
      resolved: {
        city: '',
        state: '',
        timezone: null,
      },
    }),
  );

  assert.equal(note, 'Bryson Smith');
});

test('buildProspectContactAdminNote: ignores appointment-truth-shaped timezone fields', () => {
  const context = buildContext({
    resolved: {
      city: 'New York',
      state: 'NY',
      timezone: null,
      current_meeting_timezone: 'America/Los_Angeles',
      meetingTimezone: 'America/Los_Angeles',
    } as ScoutPrepContext['resolved'] & Record<string, string | null>,
  });

  assert.equal(
    buildProspectContactAdminNote(context),
    ['Timezone: Eastern', '', 'Bryson Smith'].join('\n'),
  );
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

test('mergeMeetingDetailsTemplate: prepends MaxPreps URL when resolved', () => {
  const template = [
    'Main Number:',
    'Backup Number:',
    'Spoke To:',
    'Other Parent:',
    '',
    'About The Athlete:',
    '',
    'Deficit:',
  ].join('\n');
  const context = buildContext({
    resolved: {
      maxpreps_url: 'https://www.maxpreps.com/mo/republic/republic-tigers/football/',
    },
  });

  const merged = mergeMeetingDetailsTemplate(
    template,
    selectScoutPrepContactNumbers(context),
    context,
  );

  assert.match(
    merged,
    /^https:\/\/www\.maxpreps\.com\/mo\/republic\/republic-tigers\/football\/\n\nMain Number:/,
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

test('hydrateMeetingSetTemplateForForm: fills sparse Meeting Set templates for existing stage updates', () => {
  const template: MeetingSetTemplateResponse = {
    success: true,
    meeting_name: '',
    selected_recruit_timezone: null,
    recruit_timezone_options: [],
    details_template: '',
  };

  const hydrated = hydrateMeetingSetTemplateForForm(template, buildContext(), {
    athleteName: 'Bryson Smith',
    gradYear: 2027,
  });

  assert.equal(hydrated.meeting_name, 'Bryson Smith 2027');
  assert.equal(hydrated.selected_recruit_timezone, 'CST');
  assert.ok(hydrated.recruit_timezone_options.length > 0);
  assert.match(hydrated.details_template || '', /Main Number: \(651\) 555-1212/);
  assert.match(hydrated.details_template || '', /About The Athlete:/);
});

test('buildMeetingSetCallNotesMarkdown: mirrors Meeting Set details without adding old page context', () => {
  assert.equal(
    buildMeetingSetCallNotesMarkdown({
      meetingDetails: 'Main Number: (515) 718-2798\n\nAbout The Athlete:\nWR | RET',
    }),
    'Main Number: (515) 718-2798\n\nAbout The Athlete:\nWR | RET',
  );
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

  assert.match(body, /^Good afternoon Jaylin, this is Jerami Singleton with Prospect ID\./);
  assert.match(body, /I received your info about playing college football\./);
  assert.match(body, /If this is still a real goal, have a parent call or text me back\./);
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
    /Bryson’s football profile came through and I had a few quick questions about college goals\./,
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
  assert.match(body, /Bryson’s football profile came through/);
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
  assert.match(body, /Jaylin’s football profile came through/);
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

  assert.match(body, /^Good afternoon Mr\. Bailey, quick follow-up on Jaylin’s football profile\./);
  assert.match(body, /Would a calendar link be easier, or should I try you later today\?/);
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
    /^Good afternoon Mr\. Bailey, last quick follow-up on Jaylin’s college football profile\./,
  );
  assert.match(body, /Reply with the best fit:/);
  assert.match(body, /1 - interested, ready for next steps/);
  assert.match(body, /2 - interested, bad timing/);
  assert.match(body, /3 - not interested/);
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

  assert.match(body, /^Good afternoon Jayson, quick follow-up on your college football profile\./);
  assert.match(body, /quick follow-up on your college football profile\./);
  assert.match(body, /If you still want help with next steps, have a parent call or text me\./);
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
  assert.match(attempt3, /last quick follow-up on your college football profile/);
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
    [
      'Here is the link to schedule a quick call:',
      '',
      CAL_BOOKING_URL,
      '',
      'Pick the time that works best.',
    ].join('\n'),
  );
});

test('buildVoicemailFollowUpBody: parent contact intro uses student athlete name only', () => {
  const body = buildVoicemailFollowUpBody(
    buildContext({
      task: {
        contact_id: '123',
        athlete_main_id: '456',
        athlete_name: 'Kapri Johnson',
      },
      resolved: {
        sport: 'Basketball',
        city: 'Orlando',
        state: 'FL',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Kapri Johnson',
          email: null,
          phone: '(407) 555-0000',
        },
        parent1: null,
        parent2: null,
      },
    }),
    undefined,
    'parent_contact_intro',
    null,
    null,
    new Date('2026-04-17T19:28:00Z'),
  );

  assert.equal(
    body,
    [
      'Hi [ParentFirst], this is Jerami with Prospect ID.',
      '',
      'Kapri’s recruiting info came through.',
      '',
      'Would today or tomorrow work for a quick call?',
    ].join('\n'),
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
  assert.match(body, /Reply with the best fit:/);
  assert.match(body, /1 - still interested, need to reschedule/);
  assert.match(body, /2 - interested, timing is bad/);
  assert.match(body, /3 - no longer interested/);
  assert.doesNotMatch(body, /^Hi Ms\./);
});

test('buildVoicemailFollowUpBody: reschedule includes previous head scout and selected slots', () => {
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
        head_scout: 'Ryan Lietz',
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
    'reschedule_1',
    null,
    'Reschedule Pending',
    new Date('2026-04-24T13:00:00Z'),
    null,
    null,
    {
      previousHeadScoutName: 'Ryan Lietz',
      slots: ['Thu May 28 3 PM EST', 'Fri May 29 4 PM EST'],
      weekLabel: 'next week',
    },
  );

  assert.match(body, /^Coach Ryan Lietz has me checking what works best to reschedule Aiden:/);
  assert.match(body, /1 - Thu May 28 3 PM EST/);
  assert.match(body, /2 - Fri May 29 4 PM EST/);
  assert.match(body, /Which one works best\?/);
});

test('buildVoicemailFollowUpBody: proposed times uses slots without reschedule language', () => {
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
        head_scout: 'Ryan Lietz',
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
    'propose_times',
    null,
    'Scheduled Follow-Up',
    new Date('2026-04-24T13:00:00Z'),
    null,
    null,
    {
      previousHeadScoutName: 'Ryan Lietz',
      slots: ['Thursday, May 28 at 3PM ET', 'Friday, May 29 at 4PM ET'],
    },
  );

  assert.match(
    body,
    /^Hi Jamie, here are a couple slots we can hold for Aiden with Coach Ryan Lietz:/,
  );
  assert.match(body, /1 - Thursday, May 28 at 3PM ET/);
  assert.match(body, /2 - Friday, May 29 at 4PM ET/);
  assert.doesNotMatch(body, /reschedule/i);
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

test('resolveProspectContactCreateFailureToast: hides duplicate CoreData fault noise', () => {
  const toast = resolveProspectContactCreateFailureToast(
    new Error(
      'CoreData: error: Unhandled error occurred during faulting: Error Domain=NSCocoaErrorDomain Code=134092 "(null)"',
    ),
  );

  assert.deepEqual(toast, {
    title: 'Already exists',
    message: '',
    duplicateLike: true,
  });
});

test('buildScoutPrepLeavingVoicemailBody: builds son voicemail with parent and athlete first names', () => {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName: 'Jamie Smith',
    athleteName: 'Bryson Smith',
    sport: 'Football',
  });

  assert.match(body, /^Hi Jamie, this is Jerami Singleton/);
  assert.match(body, /I’m following up on Bryson’s college football profile\./);
  assert.doesNotMatch(body, /I called about/);
  assert.match(
    body,
    /If playing at the next level is still a real goal, call or text me back at 407-473-3637\./,
  );
  assert.doesNotMatch(body, /came across my desk/);
  assert.doesNotMatch(body, /Again, this is Jerami with Prospect ID/);
});

test('buildScoutPrepLeavingVoicemailBody: uses the provided sport for non-football athletes', () => {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName: 'Amy Torres',
    athleteName: 'Jason Torres',
    sport: "Men's Basketball",
  });

  assert.match(body, /college basketball profile/);
  assert.doesNotMatch(body, /football/);
});

test('buildScoutPrepLeavingVoicemailBody: uses daughter and her for softball athletes', () => {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName: 'Amy Torres',
    athleteName: 'Ava Torres',
    sport: 'Softball',
  });

  assert.match(body, /Ava’s college softball profile/);
  assert.match(
    body,
    /If playing at the next level is still a real goal, call or text me back at 407-473-3637\./,
  );
  assert.doesNotMatch(body, /your son/);
});

test('buildScoutPrepLeavingVoicemailBody: uses shorter voicemail for post-first-attempt tasks', () => {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName: 'Jamie Smith',
    athleteName: 'Bryson Smith',
    sport: 'Football',
    currentTask: 'Scheduled Follow Up Call the family second time and leave follow-up voicemail.',
  });

  assert.match(body, /^Hi Jamie, Jerami with Prospect ID\./);
  assert.match(body, /Checking back on Bryson’s college football profile\./);
  assert.match(
    body,
    /If this is still worth a conversation, call or text me back at 407-473-3637\./,
  );
  assert.doesNotMatch(body, /I had a few quick questions/);
  assert.doesNotMatch(body, /scheduling link/);
  assert.doesNotMatch(body, /came across my desk/);
});

test('buildScoutPrepLeavingVoicemailBody: third attempt uses the same post-first-attempt voicemail', () => {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName: 'Jamie Smith',
    athleteName: 'Bryson Smith',
    sport: 'Football',
    currentTask: 'Call Attempt 3',
  });

  assert.match(body, /^Hi Jamie, Jerami with Prospect ID\./);
  assert.match(body, /Checking back on Bryson’s college football profile\./);
  assert.match(
    body,
    /If this is still worth a conversation, call or text me back at 407-473-3637\./,
  );
  assert.doesNotMatch(body, /Last follow-up/);
  assert.doesNotMatch(body, /scheduling link/);
});

test('buildScoutPrepCard: uses short appointment-setting call path', () => {
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
  const sectionOrder = [
    '### Greeting / Reason',
    '### Prospect ID Frame',
    '### Academics / Major',
    '### Athletic Proof',
    '### Recruiting / Timeline',
    '### Summary / Set Meeting',
    '### Meeting Prep',
  ];
  let previousIndex = -1;
  for (const section of sectionOrder) {
    const currentIndex = card.indexOf(section);
    assert.ok(currentIndex > previousIndex, `${section} should appear in order`);
    previousIndex = currentIndex;
  }
  assert.equal((card.match(/^### /gm) || []).length, 7);
  assert.match(card, /> Hey, this is Coach Singleton\. Is this Jamie\?/);
  assert.match(
    card,
    /> Hey Jamie\. This is Coach Singleton, the head football scouting coordinator at Prospect ID\./,
  );
  assert.match(
    card,
    /> I was reaching out\. Bryson sent us a recruiting application\. Were you aware of this\?/,
  );
  assert.match(card, /> Let me give you a little bit of background\./);
  assert.match(card, /> He sent us a recruiting application with height, weight, grades\./);
  assert.match(
    card,
    /> Really, he’s showing interest in getting help with direct coach contact\./,
  );
  assert.match(
    card,
    /> Are you okay with him taking steps to reach out to coaches and get his name out\?/,
  );
  assert.match(card, /> Safe to say he’s pretty serious about playing in college\?/);
  assert.match(
    card,
    /> What we do at Prospect ID is we introduce certain athletes directly to college coaches\. {2}\n> We send them recruits\. {2}\n> We only work with 500 students per grad year, so we’re strict about academics and what the talent level matches up with\. {2}\n> I’m not looking to blow smoke\. If he’s good enough and has the grades, great, let’s get moving\. If not, we’ve got to focus on the places we’ve got to improve\. {2}\n> Really, I’m reaching out to find out what his academics are like, what he’s like on the field, and if this works for us and works for you guys\./,
  );
  assert.doesNotMatch(card, /\\n/);
  assert.doesNotMatch(card, /^>$/m);
  assert.match(card, /### Academics \/ Major[\s\S]*With a 3\.7, academics can be a real strength in the recruiting conversation\./);
  assert.match(card, /### Academics \/ Major[\s\S]*What about a major\? Has he talked about what he wants to study in college\?/);
  assert.doesNotMatch(card, /GPA branch:/);
  assert.doesNotMatch(card, /### Academics \/ Major[\s\S]*We typically want to get to about that 3\.0 just so certain coaches don’t write you off\./);
  assert.match(card, /### Athletic Proof[\s\S]*Now, what about the fun stuff\?/);
  assert.match(card, /### Athletic Proof[\s\S]*What school does he go to\?/);
  assert.match(
    card,
    /### Athletic Proof[\s\S]*Is he playing JV, varsity, freshman ball\? What level is he at\?/,
  );
  assert.match(card, /### Athletic Proof[\s\S]*You said speed\. What are we talking 40 time\?/);
  assert.match(card, /### Athletic Proof[\s\S]*#### If varsity time is confirmed[\s\S]*That is ahead of schedule, especially if they only pulled up a select few\./);
  assert.match(
    card,
    /### Athletic Proof[\s\S]*What does the weight room look like for him\? What’s his max bench and max squat\?/,
  );
  assert.match(
    card,
    /### Athletic Proof[\s\S]*The reason I was asking about varsity film is college coaches want three things: transcripts, character references, and varsity film\./,
  );
  assert.doesNotMatch(card, /Anytime I hear probably/);
  assert.match(card, /### Recruiting \/ Timeline[\s\S]*What’s going on recruiting-wise for Bryson\?/);
  assert.match(
    card,
    /### Recruiting \/ Timeline[\s\S]*Since September 1, have we had texts, handwritten letters, private messages, or anything direct from coaches\?/,
  );
  assert.match(card, /### Recruiting \/ Timeline[\s\S]*#### If they have emails or letters[\s\S]*Have any coaches called you personally yet, or is it still mostly mail, emails, and camp information\?/);
  assert.match(card, /### Recruiting \/ Timeline[\s\S]*#### If they are getting calls[\s\S]*Have any of those calls turned into an official offer, a roster spot conversation, or a real visit\?/);
  assert.match(card, /### Recruiting \/ Timeline[\s\S]*#### If they have offers[\s\S]*Are those schools places he would seriously consider, or are you still looking for the right-fit options\?/);
  assert.match(
    card,
    /### Recruiting \/ Timeline[\s\S]*#### If this is the first kid in recruiting[\s\S]*Is this the first kid you guys have gone through the recruiting process with\?/,
  );
  assert.match(card, /### Recruiting \/ Timeline[\s\S]*---\n\n## Deficit ladder[\s\S]*- If it is mostly early contact: letters and texts need to turn into calls; calls need to turn into offers\./);
  assert.match(
    card,
    /### Recruiting \/ Timeline[\s\S]*The goal is to use this window before June 15 to make sure the right coaches know who he is\./,
  );
  const recruitingSection =
    card.match(/### Recruiting \/ Timeline\n\n([\s\S]*?)\n\n### Summary \/ Set Meeting/)?.[1] ||
    '';
  assert.ok((recruitingSection.match(/^>/gm) || []).length <= 8);
  assert.match(
    card,
    /### Summary \/ Set Meeting[\s\S]*- Deficit: For football, June 15 is when coaches can start calling juniors/,
  );
  assert.match(card, /### Summary \/ Set Meeting[\s\S]*Recap only what they gave you/);
  const summarySection =
    card.match(/### Summary \/ Set Meeting\n\n([\s\S]*?)\n\n### Meeting Prep/)?.[1] || '';
  assert.equal((summarySection.match(/^- Deficit:/gm) || []).length, 1);
  assert.doesNotMatch(card, /Maxpreps:/);
  assert.match(
    card,
    /> What I’m going to do is look at my head football scout’s schedule\./,
  );
  assert.match(
    card,
    /> I’m going to find a time for us to do about 40 or 45 minutes over Zoom and screen share\./,
  );
  assert.match(
    card,
    /> I’ll have my Head Scout walk you through some of our Top 500 athletes\./,
  );
  assert.match(
    card,
    /> Coach has \[Exact Slot 1\] or \[Exact Slot 2\]\. Which one works best\?/,
  );
  assert.match(
    card,
    /### Summary \/ Set Meeting[\s\S]*What is her schedule Friday\? When is she usually up and moving on Saturday\?/,
  );
  assert.match(card, /### Meeting Prep[\s\S]*I’m going to email you Coach \[Name\]’s bio, background on us as an organization, and my social media\./);
  assert.match(card, /### Meeting Prep[\s\S]*Save it\. That way when Coach calls you at \[time\], answer the call\./);
  assert.match(card, /### Meeting Prep[\s\S]*You won’t have Coach \[Name\]’s Zoom code before the meeting, so don’t stress about that\./);
  assert.match(card, /### Meeting Prep[\s\S]*Coach \[Name\] will give you the Zoom code\./);
  assert.match(card, /### Meeting Prep[\s\S]*Read through what I send over, write down questions, and bring them with you to the meeting\./);
  for (const forbidden of [
    /blindside/i,
    /free recruiting evaluation/i,
    /\bVIP\b/i,
    /\bplatform\b/i,
    /\bwebsite\b/i,
    /\bpain\b/i,
    /usually pretty booked/i,
    /placeholder/i,
    /pencil/i,
    /show up/i,
    /aligned/i,
    /\bbrunt\b/i,
    /any time/i,
    /whatever works/i,
    /Do you have any sort of questions/i,
    /online recruiting resume/i,
    /\*\*Goal:\*\*/i,
    /\*\*Avoid:\*\*/i,
  ]) {
    assert.doesNotMatch(card, forbidden);
  }
});

test('buildScoutPrepCard: MaxPreps context adds snapshot rank and mascot level prompt', () => {
  const card = buildScoutPrepCard(
    {
      athleteName: 'Jance Mercado',
      parent1Name: 'Parent Mercado',
      gradYear: 'Sophomore',
      sport: 'Football',
    },
    buildContext({
      resolved: {
        sport: 'Football',
        gpa: '3.82',
        positions: 'OLB',
        state: 'MO',
        high_school: 'Republic High School',
        maxpreps_mascot: 'Republic Tigers',
        maxpreps_state_rank: '24',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Jance Mercado',
          email: null,
          phone: null,
        },
        parent1: {
          name: 'Parent Mercado',
          relationship: 'Parent',
          email: null,
          phone: null,
        },
        parent2: null,
      },
    }),
  ).markdown;

  assert.match(card, /- \*\*Maxpreps:\*\* Republic Tigers • MO Rank 24/);
  assert.match(
    card,
    /> Are you okay with him taking steps to reach out to coaches and get his name out\?/,
  );
  assert.doesNotMatch(card, /When it comes to college football/);
  assert.match(card, /With a 3\.82, academics can be a real strength in the recruiting conversation\./);
  assert.match(card, /What about a major\? Has he talked about what he wants to study in college\?/);
  assert.match(
    card,
    /What level was Jance playing at as a sophomore for the Republic Tigers\?[\s\S]*At linebacker, is Jance's separator instincts, physicality, coverage, or sideline-to-sideline speed\?[\s\S]*Height, weight, 40, shuttle, anything like that you feel coaches usually react to\?/,
  );
});

test('buildScoutPrepCard: freshman football with unknown GPA uses ask-first go-to lines', () => {
  const card = buildScoutPrepCard(
    {
      athleteName: 'Fred Carpenter',
      parent1Name: 'Parent Carpenter',
      gradYear: 'Freshman',
      sport: 'Football',
    },
    buildContext({
      resolved: {
        sport: 'Football',
        positions: 'WR, CB',
        gpa: null,
        high_school: 'Little Rock Central High School',
        state: 'Arkansas',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Fred Carpenter',
          email: null,
          phone: null,
        },
        parent1: {
          name: 'Parent Carpenter',
          relationship: 'Parent',
          email: null,
          phone: null,
        },
        parent2: null,
      },
    }),
  ).markdown;

  assert.match(card, /### Academics \/ Major[\s\S]*Let’s start with grades\. What’s his GPA right now\?/);
  assert.match(card, /### Academics \/ Major[\s\S]*How is he doing in the classroom right now\?/);
  assert.match(card, /### Academics \/ Major[\s\S]*---\n\n## GPA branch[\s\S]*If GPA comes back low: “Okay, then this is something we need to stay ahead of/);
  assert.match(card, /### Academics \/ Major[\s\S]*If GPA comes back solid: “Good\. That gives us something workable academically\.”/);
  assert.match(card, /### Academics \/ Major[\s\S]*If GPA comes back strong: “Good\. Academics can be a real strength in the recruiting conversation\.”/);
  assert.doesNotMatch(card, /You and I both know he needs to bring those up/);
  assert.doesNotMatch(card, /We typically want to get to about that 3\.0/);
  assert.match(card, /### Athletic Proof[\s\S]*Is Fred's separator speed, production, ball skills, or what he does after contact\?/);
  assert.match(card, /### Recruiting \/ Timeline[\s\S]*How many questionnaires has he filled out, and has he reached out to any coaches yet\?/);
  assert.match(card, /### Recruiting \/ Timeline[\s\S]*We already see freshmen and sophomores with offers, and some have verbally committed\./);
  assert.match(card, /### Recruiting \/ Timeline[\s\S]*---\n\n## Deficit ladder[\s\S]*- If nothing is real yet: this is about getting on the map before the contact window\./);
});

test('buildScoutPrepCard: low-GPA sophomore football includes academic deficit branch', () => {
  const card = buildScoutPrepCard(
    {
      athleteName: 'Amari Green',
      parent1Name: 'Kevin Green',
      gradYear: 'Sophomore',
      sport: 'Football',
    },
    buildContext({
      resolved: {
        sport: 'Football',
        positions: 'WR, CB',
        gpa: '2.5',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Amari Green',
          email: null,
          phone: null,
        },
        parent1: {
          name: 'Kevin Green',
          relationship: 'Father',
          email: null,
          phone: null,
        },
        parent2: null,
      },
    }),
  ).markdown;

  assert.match(card, /### Academics \/ Major[\s\S]*I saw the 2\.5\. How do you feel about that\?/);
  assert.match(card, /### Academics \/ Major[\s\S]*You and I both know he needs to bring those up/);
  assert.match(card, /### Academics \/ Major[\s\S]*We typically want to get to about that 3\.0/);
  assert.doesNotMatch(card, /GPA branch:/);
  assert.match(card, /### Recruiting \/ Timeline[\s\S]*Have we had questionnaires, camp invites, texts, direct messages, or anything from coaches yet\?/);
});

test('buildScoutPrepCard: scheduled calls skip cold-call permission checks', () => {
  const card = buildScoutPrepCard(
    {
      athleteName: 'Bryson Smith',
      parent1Name: 'Jamie Smith',
      gradYear: 'Junior',
      sport: 'Football',
    },
    buildContext({
      task: {
        contact_id: '123',
        athlete_main_id: '456',
        athlete_name: 'Bryson Smith',
        title: 'Scheduled Scout Prep Call',
      },
    }),
  ).markdown;

  assert.match(card, /### Greeting \/ Reason/);
  assert.match(
    card,
    /Hey Jamie, this is Coach Singleton, the head football scouting coordinator at Prospect ID\./,
  );
  assert.match(card, /I’m glad we got connected about Bryson/);
  assert.doesNotMatch(card, /Were you aware of this\?/);
  assert.doesNotMatch(card, /Are you okay with him taking steps/);
});

test('buildScoutPrepCard: uses female athlete pronouns for womens volleyball', () => {
  const card = buildScoutPrepCard(
    {
      athleteName: 'Jamiya Turner',
      parent1Name: 'Tonia Turner',
      gradYear: 'Junior',
      sport: "Women's Volleyball",
    },
    buildContext({
      resolved: {
        sport: "Women's Volleyball",
        positions: 'L | DS',
        gpa: '3.09',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Jamiya Turner',
          email: null,
          phone: null,
        },
        parent1: {
          name: 'Tonia Turner',
          relationship: 'Mother',
          email: null,
          phone: null,
        },
        parent2: null,
      },
    }),
  ).markdown;

  assert.match(card, /> She sent us a recruiting application with height, weight, grades\./);
  assert.match(
    card,
    /> Really, she’s showing interest in getting help with direct coach contact\./,
  );
  assert.match(card, /If she’s good enough and has the grades/);
  assert.match(card, /I saw the 3\.09\. That gives coaches something solid to work with academically\./);
  assert.match(card, /Is she trying to push it higher, or is that about where she usually sits\?/);
  assert.match(card, /Is she playing JV, varsity, freshman ball\? What level is she at\?/);
  assert.match(card, /#### If varsity time is confirmed[\s\S]*That is ahead of schedule, especially if they only pulled up a select few\./);
  assert.match(card, /Let’s go through some of her metrics\./);
  assert.match(card, /What does the weight room look like for her\? What’s her max bench and max squat\?/);
  assert.match(card, /What about a major\? Has she talked about what she wants to study in college\?/);
  assert.match(card, /I see Jamiya plays L \| DS\. What does she do best there\?/);
  assert.match(card, /making sure the right coaches actually know who she is/);
  assert.match(
    card,
    /Since the women's volleyball contact window, have we had phone calls, direct messages, emails, or letters from coaches\?/,
  );
  assert.match(
    card,
    /> Coach has \[Exact Slot 1\] or \[Exact Slot 2\]\. Which one works best\?/,
  );
  assert.doesNotMatch(card, /what he may want to major in/);
  assert.doesNotMatch(card, /What does he do best there/);
  assert.doesNotMatch(card, /who he is/);
  assert.doesNotMatch(card, /he wants a little bit of help getting direct contact/);
  assert.doesNotMatch(card, /Really, the conversation was/);
  assert.doesNotMatch(card, /If he’s good enough/);
  assert.doesNotMatch(card, /What's his GPA/);
  assert.doesNotMatch(card, /Is he playing JV/);
  assert.doesNotMatch(card, /Did he move up/);
  assert.doesNotMatch(card, /Him getting/);
  assert.doesNotMatch(card, /some of his metrics/);
  assert.doesNotMatch(card, /weight room look like for him/);
  assert.doesNotMatch(card, /Does he do any other sports/);
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

  assert.doesNotMatch(card, /still just exploring/);
  assert.match(card, /serious about men's basketball/);
  assert.match(card, /Have we had questionnaires, camp invites, texts, direct messages, or anything from coaches yet\?/);
  assert.doesNotMatch(card, /\bprofile\b/i);
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
  assert.match(
    olCard,
    /On the line, is Bryson's separator size, strength, feet, or how physical he is\?/,
  );
  assert.doesNotMatch(olCard, /squat, bench/);
  assert.doesNotMatch(olCard, /quick is he off the ball/);

  const skillCard = buildScoutPrepCard(
    baseValues,
    buildContext({ resolved: { positions: 'WR / RB' } }),
  ).markdown;
  assert.match(
    skillCard,
    /Is Bryson's separator speed, production, ball skills, or what he does after contact\?/,
  );
  assert.doesNotMatch(skillCard, /explosive does he look in space/);

  const qbCard = buildScoutPrepCard(
    baseValues,
    buildContext({ resolved: { positions: 'QB' } }),
  ).markdown;
  assert.match(
    qbCard,
    /At quarterback, is Bryson's separator arm talent, decision-making, leadership, or production\?/,
  );
  assert.doesNotMatch(qbCard, /arm talent, accuracy, and decision-making/);

  const dbCard = buildScoutPrepCard(
    baseValues,
    buildContext({ resolved: { positions: 'LB / DB' } }),
  ).markdown;
  assert.match(
    dbCard,
    /At linebacker, is Bryson's separator instincts, physicality, coverage, or sideline-to-sideline speed\?/,
  );
});

test('buildScoutPrepCard: uses sport and position map for baseball scout notes', () => {
  const card = buildScoutPrepCard(
    {
      athleteName: 'Cavion Jones',
      parent1Name: 'Jamie Jones',
      gradYear: 'Junior',
      sport: 'Baseball',
    },
    buildContext({
      resolved: {
        sport: 'Baseball',
        positions: 'SS',
        gpa: '3.2',
      },
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Cavion Jones',
          email: null,
          phone: null,
        },
        parent1: {
          name: 'Jamie Jones',
          relationship: 'Mother',
          email: null,
          phone: null,
        },
        parent2: null,
      },
    }),
  ).markdown;

  assert.match(card, /At shortstop, is Cavion more of a defensive anchor, bat-first, or both\?/);
  assert.match(card, /Any 60 time or arm strength numbers\?/);
  assert.match(card, /Since the baseball contact window, have we had phone calls, direct messages, emails, or letters from coaches\?/);
  assert.match(card, /For baseball, August 1 is when coaches can start calling juniors/);
  assert.doesNotMatch(card, /Where does he fit best right now/);
  assert.doesNotMatch(card, /Are there any numbers that really stand out right now/);
});

test('buildScoutPrepCard: uses sport and position map for basketball scout notes', () => {
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
        positions: 'PG',
        gpa: '3.4',
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

  assert.match(
    card,
    /At point guard, is Jason's separator handle, decision-making, shooting, or ability to defend\?/,
  );
  assert.match(card, /varsity role, AAU level, production, shooting, handle, defense/);
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
  assert.match(
    junior,
    /With a 3\.8, academics can be a real strength in the recruiting conversation\./,
  );
  assert.match(junior, /What about a major\? Has he talked about what he wants to study in college\?/);
  assert.match(junior, /For football, June 15 is when coaches can start calling juniors/);
  assert.match(junior, /Since September 1, have we had texts, handwritten letters, private messages, or anything direct from coaches\?/);

  const sophomore = buildScoutPrepCard(
    {
      athleteName: 'Bryson Smith',
      parent1Name: 'Jamie Smith',
      gradYear: 'Sophomore',
      sport: 'Football',
    },
    buildContext({ resolved: { gpa: '3.1' } }),
  ).markdown;
  assert.match(sophomore, /I saw the 3\.1\. That gives coaches something solid to work with academically\./);
  assert.match(sophomore, /For football, coaches can start calling this month on June 15/);
  assert.match(sophomore, /Have we had questionnaires, camp invites, texts, direct messages, or anything from coaches yet\?/);

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
    /I saw the 2\.4\. How do you feel about that\?/,
  );
  assert.doesNotMatch(senior, /GPA branch:/);
  assert.match(senior, /Signing windows are active now/);
  assert.match(senior, /right-fit offer/);
});
