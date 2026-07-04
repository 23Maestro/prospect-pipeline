import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultReminderDate,
  buildReminderAdminUrl,
  buildReminderBody,
  buildReminderDraft,
  buildReminderTitle,
  mapAssociatedContactsToReminderOptions,
  resolveClientReminderTarget,
} from './reminders.js';

test('buildReminderTitle and body produce the expected reminder text', () => {
  assert.equal(
    buildReminderTitle({
      mode: 'call',
      contactName: 'Tiffany Rawls',
    }),
    'Call Tiffany Rawls',
  );
  assert.equal(
    buildReminderBody({
      athleteName: 'Carlos Rawls',
      phone: '615-555-1212',
    }),
    'SA:Carlos Rawls - 615-555-1212',
  );
});

test('buildReminderDraft includes admin url', () => {
  const remindAt = new Date('2026-04-23T15:30:00');
  const draft = buildReminderDraft({
    mode: 'text',
    athleteName: 'Carlos Rawls',
    contactName: 'Carlos Rawls',
    phone: '615-555-3434',
    contactId: '123',
    athleteMainId: '456',
    remindAt,
  });

  assert.equal(draft.title, 'Text Carlos Rawls');
  assert.equal(draft.body, 'SA:Carlos Rawls - 615-555-3434');
  assert.equal(
    draft.url,
    'https://legacy-dashboard.example.com/admin/athletes?contactid=123&athlete_main_id=456',
  );
  assert.equal(draft.listName, 'Prospect ID');
  assert.equal(draft.remindAt?.toISOString(), remindAt.toISOString());
});

test('buildReminderAdminUrl omits athlete_main_id when unavailable', () => {
  assert.equal(
    buildReminderAdminUrl('123', ''),
    'https://legacy-dashboard.example.com/admin/athletes?contactid=123',
  );
});

test('mapAssociatedContactsToReminderOptions keeps parent1, student athlete, parent2 order', () => {
  const options = mapAssociatedContactsToReminderOptions([
    {
      role: 'studentAthlete',
      name: 'Carlos Rawls',
      relationshipLabel: 'Student Athlete',
      normalizedPhoneNumber: '615-555-0003',
    },
    {
      role: 'parent2',
      name: 'Tim Rawls',
      relationshipLabel: 'Parent 2',
      normalizedPhoneNumber: '615-555-0002',
    },
    {
      role: 'parent1',
      name: 'Tiffany Rawls',
      relationshipLabel: 'Parent 1',
      normalizedPhoneNumber: '615-555-0001',
    },
  ]);

  assert.deepEqual(
    options.map((option) => option.id),
    ['parent1', 'studentAthlete', 'parent2'],
  );
});

test('resolveClientReminderTarget returns an immediate option for single-thread matched contact', () => {
  const result = resolveClientReminderTarget({
    isGroup: false,
    matchedPhones: ['6155550001'],
    associatedClients: [
      {
        role: 'parent1',
        name: 'Tiffany Rawls',
        relationshipLabel: 'Parent 1',
        normalizedPhoneNumber: '6155550001',
      },
      {
        role: 'studentAthlete',
        name: 'Carlos Rawls',
        relationshipLabel: 'Student Athlete',
        normalizedPhoneNumber: '6155550003',
      },
    ],
  });

  assert.equal(result.immediateOption?.id, 'parent1');
  assert.equal(result.options.length, 2);
});

test('resolveClientReminderTarget falls back to matched ID contact when pipeline associates are missing', () => {
  const result = resolveClientReminderTarget({
    isGroup: false,
    matchedPhones: ['3864533258'],
    associatedClients: [],
    fallbackContact: {
      id: 'matchedContact',
      label: 'Mom',
      name: 'Danielle Howell',
      phone: '3864533258',
    },
  });

  assert.equal(result.immediateOption?.name, 'Danielle Howell');
  assert.equal(result.immediateOption?.phone, '3864533258');
  assert.equal(result.options.length, 1);
});

test('resolveClientReminderTarget requires chooser for group threads', () => {
  const result = resolveClientReminderTarget({
    isGroup: true,
    matchedPhones: ['6155550001', '6155550003'],
    associatedClients: [
      {
        role: 'parent1',
        name: 'Tiffany Rawls',
        relationshipLabel: 'Parent 1',
        normalizedPhoneNumber: '6155550001',
      },
      {
        role: 'studentAthlete',
        name: 'Carlos Rawls',
        relationshipLabel: 'Student Athlete',
        normalizedPhoneNumber: '6155550003',
      },
    ],
  });

  assert.equal(result.immediateOption, null);
  assert.deepEqual(
    result.options.map((option) => option.id),
    ['parent1', 'studentAthlete'],
  );
});

test('buildDefaultReminderDate rounds forward to the next half hour slot', () => {
  assert.equal(
    buildDefaultReminderDate(new Date('2026-04-23T09:12:00')).toISOString(),
    new Date('2026-04-23T09:30:00').toISOString(),
  );
  assert.equal(
    buildDefaultReminderDate(new Date('2026-04-23T09:42:00')).toISOString(),
    new Date('2026-04-23T10:00:00').toISOString(),
  );
});
