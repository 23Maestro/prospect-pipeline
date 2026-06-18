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
    currentTaskId: 'task-1',
    currentTaskTitle: 'Confirmation Call',
    timezone: 'America/Chicago',
    timezoneLabel: 'CST',
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
  assert.equal(resolutions[0].currentTaskId, 'task-1');
  assert.equal(resolutions[0].timezone, 'America/Chicago');
  assert.equal(resolutions[0].timezoneLabel, 'CST');
  assert.equal(resolutions[0].ambiguity, 'none');
});

test('message resolver omits phones linked to multiple athletes', () => {
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

  assert.deepEqual(resolutions, []);
});

test('message resolver admits duplicate phone when one athlete has review follow-up lifecycle', () => {
  const resolutions = buildStudentAthleteMessageResolutions([
    cacheRow({
      athleteKey: '1500173:954893',
      athleteId: '1500173',
      athleteMainId: '954893',
      athleteName: 'Elijah Burton Jr',
      contactName: 'Latoysha Burton',
      relationshipLabel: 'Parent 1',
      normalizedPhone: '4045871211',
      crmStage: null,
      taskStatus: null,
      currentTaskTitle: null,
    }),
    cacheRow({
      athleteKey: '1500171:954891',
      athleteId: '1500171',
      athleteMainId: '954891',
      athleteName: 'Elijah Burton Jr',
      contactName: 'Latoysha Burton',
      relationshipLabel: 'Parent 1',
      normalizedPhone: '4045871211',
      crmStage: 'Left Voice Mail 1',
      taskStatus: 'call_attempt_1',
      currentTaskTitle: 'Call Attempt 1',
    }),
  ]);

  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].athleteKey, '1500171:954891');
  assert.equal(resolutions[0].crmStage, 'Left Voice Mail 1');
  assert.equal(resolutions[0].currentTaskTitle, 'Call Attempt 1');
});

test('message resolver removes ambiguous family phones from associated contacts', () => {
  const resolutions = buildStudentAthleteMessageResolutions([
    cacheRow({
      athleteKey: 'athlete-1:main-1',
      athleteName: 'Avery Jones',
      contactName: 'Avery Jones',
      relationshipLabel: 'Student Athlete',
      normalizedPhone: '6155552000',
    }),
    cacheRow({
      athleteKey: 'athlete-1:main-1',
      athleteName: 'Avery Jones',
      contactName: 'Tiffany Jones',
      relationshipLabel: 'Mother',
      normalizedPhone: '6155551000',
    }),
    cacheRow({
      athleteKey: 'athlete-2:main-2',
      athleteId: 'athlete-2',
      athleteMainId: 'main-2',
      athleteName: 'Blake Smith',
      contactName: 'Tiffany Jones',
      relationshipLabel: 'Mother',
      normalizedPhone: '6155551000',
    }),
  ]);

  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].normalizedPhone, '6155552000');
  assert.deepEqual(
    resolutions[0].associatedContacts.map((contact) => contact.normalizedPhoneNumber),
    ['6155552000'],
  );
});
