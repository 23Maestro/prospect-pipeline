import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudentAthleteMessageResolutions } from './student-athlete-message-resolver';
import type { AthleteContactCacheClientMatch } from './athlete-contact-cache';

function cacheRow(
  overrides: Partial<AthleteContactCacheClientMatch>,
): AthleteContactCacheClientMatch {
  return {
    athleteKey: 'athlete-1:main-1',
    athleteId: 'athlete-1',
    athleteMainId: 'main-1',
    athleteName: 'Avery Jones',
    contactId: 'athlete-1',
    contactName: 'Tiffany Jones',
    relationshipLabel: 'Mother',
    phone: '615-555-1000',
    normalizedPhone: '6155551000',
    crmStage: 'Meeting Set',
    taskStatus: 'Meeting Set',
    currentTaskTitle: 'Confirmation Call',
    ...overrides,
  };
}

test('message resolver groups athlete family contacts for matched phones', () => {
  const resolutions = buildStudentAthleteMessageResolutions([
    cacheRow({
      contactName: 'Tiffany Jones',
      relationshipLabel: 'Mother',
      normalizedPhone: '6155551000',
    }),
    cacheRow({
      contactName: 'Avery Jones',
      relationshipLabel: 'Student Athlete',
      normalizedPhone: '6155552000',
    }),
  ]);

  assert.equal(resolutions.length, 2);
  assert.deepEqual(
    resolutions[0].associatedContacts.map((contact) => contact.role),
    ['parent1', 'studentAthlete'],
  );
  assert.equal(resolutions[0].athleteName, 'Avery Jones');
  assert.equal(resolutions[0].displayName, 'Tiffany Jones');
  assert.deepEqual(
    resolutions[0].associatedContacts.map((contact) => `${contact.role}:${contact.name}`),
    ['parent1:Tiffany Jones', 'studentAthlete:Avery Jones'],
  );
  assert.equal(resolutions[0].ambiguity, 'none');
});

test('message resolver dedupes parent and athlete shared phone to student athlete default', () => {
  const resolutions = buildStudentAthleteMessageResolutions([
    cacheRow({
      contactName: 'Robert Bailey',
      relationshipLabel: 'Father',
      normalizedPhone: '3105551111',
      athleteName: 'Jaylin Bailey',
    }),
    cacheRow({
      contactName: 'Jaylin Bailey',
      relationshipLabel: 'Student Athlete',
      normalizedPhone: '3105551111',
      athleteName: 'Jaylin Bailey',
    }),
  ]);

  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].ambiguity, 'none');
  assert.equal(resolutions[0].athleteName, 'Jaylin Bailey');
  assert.equal(resolutions[0].displayName, 'Jaylin Bailey');
  assert.equal(resolutions[0].primaryContact?.role, 'studentAthlete');
  assert.deepEqual(resolutions[0].associatedContacts, [
    {
      role: 'studentAthlete',
      name: 'Jaylin Bailey',
      relationshipLabel: 'Student Athlete',
      normalizedPhoneNumber: '3105551111',
    },
  ]);
});

test('message resolver flags a phone linked to multiple athletes', () => {
  const resolutions = buildStudentAthleteMessageResolutions([
    cacheRow({ athleteKey: 'athlete-1:main-1', athleteName: 'Avery Jones' }),
    cacheRow({
      athleteKey: 'athlete-2:main-2',
      athleteId: 'athlete-2',
      athleteMainId: 'main-2',
      athleteName: 'Blake Smith',
      normalizedPhone: '6155551000',
    }),
  ]);

  assert.deepEqual(
    resolutions.map((resolution) => resolution.ambiguity),
    ['multiple_athletes', 'multiple_athletes'],
  );
});
