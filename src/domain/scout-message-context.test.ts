import test from 'node:test';
import assert from 'node:assert/strict';
import type { ScoutPrepContext } from '../features/scout-prep/types';

import {
  getMeetingReminderRecipient,
  getVoicemailFollowUpRecipients,
  normalizePhoneForMessages,
} from './scout-contact-selection';
import {
  buildConfirmationMessageContext,
  buildLightweightScoutPrepContextForMessages,
  buildVoicemailFollowUpMessageContext,
} from './scout-message-context';

function buildContext(overrides?: Partial<ScoutPrepContext>): ScoutPrepContext {
  return {
    task: {
      contact_id: '123',
      athlete_main_id: '456',
      athlete_name: 'Bryson Smith',
      grad_year: '2027',
    },
    resolved: {
      sport: 'Football',
      city: 'South St. Paul',
      state: 'MN',
      head_scout: 'Head Scout D',
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
    ...overrides,
  } as ScoutPrepContext;
}

test('meeting reminder recipient selection prefers parent one and carries parent names', () => {
  const recipient = getMeetingReminderRecipient(buildContext());

  assert.deepEqual(recipient, {
    phones: ['651-555-1212'],
    recipientNames: ['Jamie Smith', 'Chris Smith'],
  });
});

test('voicemail recipient selection lets student athlete win duplicate phone dedupe', () => {
  const recipients = getVoicemailFollowUpRecipients(
    buildContext({
      contactInfo: {
        contactId: '123',
        studentAthlete: {
          name: 'Bryson Smith',
          email: null,
          phone: '(651) 555-1212',
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
          phone: null,
        },
      },
    }),
  );

  assert.equal(recipients[0].id, 'studentAthlete');
  assert.deepEqual(recipients[0].phones, ['651-555-1212']);
});

test('confirmation message context uses the outreach phrase resolver', () => {
  const context = buildConfirmationMessageContext({
    context: buildContext(),
    now: new Date('2026-05-01T14:00:00.000Z'),
    meetingStart: new Date('2026-05-01T23:00:00.000Z'),
    meetingTimezone: 'EST',
  });

  assert.equal(context.greeting, 'Good morning');
  assert.equal(context.meetingTimePhrase, 'tonight');
  assert.equal(context.meetingReminderPhrase, '7:00pm eastern tonight');
  assert.deepEqual(context.recipientPhones, ['651-555-1212']);
});

test('phone normalization and voicemail context keep current message-safe shape', () => {
  const context = buildVoicemailFollowUpMessageContext({ context: buildContext() });

  assert.equal(normalizePhoneForMessages('+1 (651) 555-1212'), '651-555-1212');
  assert.equal(context.athleteName, 'Bryson Smith');
  assert.equal(context.sport, 'Football');
  assert.equal(context.recipients.length, 4);
});

test('lightweight pending-client message context uses contact cache without notes or tasks', () => {
  const context = buildLightweightScoutPrepContextForMessages({
    task: {
      contact_id: '1499593',
      athlete_id: '1499593',
      athlete_main_id: '954323',
      athlete_name: 'Gage Henry',
      title: 'Reschedule Pending',
      sport: 'Football',
    },
    contactRows: [
      {
        athlete_key: '1499593:954323',
        athlete_id: '1499593',
        athlete_main_id: '954323',
        athlete_name: 'Gage Henry',
        contact_id: '1499593',
        contact_name: 'Joe Henry',
        relationship_label: 'Parent 1',
        phone: '740-505-4284',
        timezone: 'America/New_York',
        timezone_label: 'EST',
        payload_json: { role: 'parent1' },
      },
      {
        athlete_key: '1499593:954323',
        athlete_id: '1499593',
        athlete_main_id: '954323',
        athlete_name: 'Gage Henry',
        contact_id: '1499593',
        contact_name: 'Gage Henry',
        relationship_label: 'Student Athlete',
        phone: '740-505-0632',
        timezone: 'America/New_York',
        timezone_label: 'EST',
        payload_json: { role: 'studentAthlete' },
      },
    ],
  });

  assert.equal(context.contactInfo.parent1?.name, 'Joe Henry');
  assert.equal(context.contactInfo.studentAthlete.name, 'Gage Henry');
  assert.equal(context.resolved.timezone, 'America/New_York');
  assert.equal(context.notes.length, 0);
  assert.equal(context.tasks.length, 0);
  assert.equal(getVoicemailFollowUpRecipients(context).length, 3);
});
