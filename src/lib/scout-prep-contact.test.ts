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
  assert.match(card, /### Greeting \/ Reason/);
  assert.match(card, /\*\*If Unaware, Say:\*\*/);
  assert.match(
    card,
    /> No problem, let me take a few steps back\. {2}\n> Prospect ID is a recruiting platform where student-athletes can create an online recruiting resume to help streamline getting connected with college coaches\. {2}\n> We ONLY work with what we call our Top 500: the athletes we choose to work with in each grad year and sport\./,
  );
  assert.match(card, /### Confirm Interest/);
  assert.match(card, /### Scout Notes/);
  assert.match(card, /### Summary \/ Deficit/);
  assert.match(card, /### Set Meeting/);
  assert.match(card, /### Meeting Requirements/);
  assert.equal((card.match(/^### /gm) || []).length, 6);
  assert.match(
    card,
    /> Hi Jamie, I’m Jerami Singleton with Prospect ID\. How are you today\? {2}\n> I’m following up on Bryson\. Bryson made a profile to connect with college coaches and is showing clear interest in playing college football\. Did Bryson mention this to you, or is this kind of a blindside\?/,
  );
  assert.doesNotMatch(card, /\\n/);
  assert.doesNotMatch(card, /^>$/m);
  assert.match(
    card,
    /### Confirm Interest\n\n- Are you comfortable with Bryson taking steps to get in front of college coaches\?/,
  );
  assert.doesNotMatch(card, /still just exploring/);
  assert.match(
    card,
    /We ONLY work with what we call our Top 500: the athletes we choose to work with in each grad year and sport/,
  );
  assert.match(
    card,
    /Some athletes do not make the cut, whether it is grades, character, talent, or fit/,
  );
  assert.doesNotMatch(card, /Is Bryson looking to play college football/);
  assert.doesNotMatch(card, /This call is to see if Bryson fits for football/);
  assert.match(card, /For football, June 15 is when coaches can start calling juniors/);
  assert.match(card, /The goal is to use this window before June 15/);
  assert.match(card, /The goal is to use this window before June 15/);
  assert.doesNotMatch(card, /Maxpreps:/);
  assert.match(
    card,
    /> So the next step is getting you, Bryson, and mom on a Zoom with one of our scouts so they can evaluate where Bryson is and what needs to happen next\./,
  );
  assert.match(
    card,
    /> They have \[Day\/Time Option 1\] or \[Day\/Time Option 2\]\. Which works better\?/,
  );
  assert.match(
    card,
    /Real quick, Jamie: Coach is holding that time specifically for your family, so I want to make sure everyone can be there and ready so it’s a productive meeting for everybody\./,
  );
  assert.doesNotMatch(card, /Real quick, Bryson:/);
  assert.match(card, /- Full family on the call: parent, athlete, and mom\/dad\./);
  assert.match(card, /- Scout will call your cell with the Zoom code\./);
  const deficitSection =
    card.match(/### Summary \/ Deficit\n\n[\s\S]*?\n\n### Set Meeting/)?.[0] || '';
  assert.equal((deficitSection.match(/^- /gm) || []).length, 2);
  assert.doesNotMatch(card, /### Connect the Dots/);
  assert.doesNotMatch(card, /### Qualify/);
  assert.doesNotMatch(card, /### Introduce Scout/);
  assert.doesNotMatch(card, /Let me take a step back and explain/);
  assert.doesNotMatch(card, /He’s one of the best scouts in the entire industry/);
  assert.doesNotMatch(card, /We don’t want to waste your time/);
  assert.doesNotMatch(card, /team of all-star scouts/i);
  assert.doesNotMatch(card, /Top 500 team/i);
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
    /- Are you comfortable with Jance taking steps to get in front of college coaches\?/,
  );
  assert.doesNotMatch(card, /When it comes to college football/);
  assert.match(
    card,
    /- With a 3\.82, academics can be a real strength in the recruiting conversation\. Does Jance know what he may want to major in\?\n- What level was Jance playing at as a sophomore for the Republic Tigers\?\n- At linebacker, is Jance's separator instincts, physicality, coverage, or sideline-to-sideline speed\?\n- Height, weight, 40, shuttle, anything like that you feel coaches usually react to\?/,
  );
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

  assert.match(card, /Does Jamiya know what she may want to major in\?/);
  assert.match(card, /I see Jamiya plays L \| DS\. What does she do best there\?/);
  assert.match(card, /making sure the right coaches actually know who she is/);
  assert.match(
    card,
    /The goal is to use this window before June 15 to make sure the right coaches know who she is/,
  );
  assert.match(card, /so they can evaluate where Jamiya is/);
  assert.match(
    card,
    /> They have \[Day\/Time Option 1\] or \[Day\/Time Option 2\]\. Which works better\?/,
  );
  assert.doesNotMatch(card, /what he may want to major in/);
  assert.doesNotMatch(card, /What does he do best there/);
  assert.doesNotMatch(card, /who he is/);
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

  assert.match(
    card,
    /Jason made a profile to connect with college coaches and is showing clear interest in playing college men's basketball/,
  );
  assert.doesNotMatch(card, /still just exploring/);
  assert.match(card, /serious about men's basketball/);
  assert.match(
    card,
    /For men's basketball, June 15 after sophomore year is the date to be ready for/,
  );
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
  assert.match(junior, /Does Bryson know what he may want to major in\?/);
  assert.match(junior, /For football, June 15 is when coaches can start calling juniors/);
  assert.match(junior, /The goal is to use this window before June 15/);

  const sophomore = buildScoutPrepCard(
    {
      athleteName: 'Bryson Smith',
      parent1Name: 'Jamie Smith',
      gradYear: 'Sophomore',
      sport: 'Football',
    },
    buildContext({ resolved: { gpa: '3.1' } }),
  ).markdown;
  assert.match(sophomore, /A 3\.1 gives coaches something solid to work with academically\./);
  assert.match(sophomore, /For football, June 15 after sophomore year is the date to be ready for/);
  assert.match(sophomore, /move from profile to real coach conversations/);

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
    /Academically, we just want to make sure Bryson stays eligible and nothing gets in the way\./,
  );
  assert.match(senior, /Signing windows are active now/);
  assert.match(senior, /right-fit offer/);
});
