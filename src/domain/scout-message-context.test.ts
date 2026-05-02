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
      head_scout: 'Ryan Lietz',
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
