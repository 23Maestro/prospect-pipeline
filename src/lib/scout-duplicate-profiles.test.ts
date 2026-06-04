import test from 'node:test';
import assert from 'node:assert/strict';
import type { ScoutPortalTask } from '../features/scout-prep/types.js';
import {
  buildRepeatProfileDescription,
  classifyDuplicateProfileEnvelope,
  getDuplicateIdentityEvidence,
  isCallAttempt1PortalTask,
  runDuplicateProfileResolutionForTask,
  selectDuplicateCallAttempt1Task,
  selectDuplicateCandidates,
  splitAthleteName,
  toDuplicateSearchRow,
} from './scout-duplicate-profiles.js';

function buildTask(overrides: Partial<ScoutPortalTask> = {}): ScoutPortalTask {
  return {
    contact_id: '1489567',
    athlete_id: '1489567',
    athlete_main_id: '951406',
    athlete_name: 'Wylie Robinson',
    grad_year: '2027',
    sport: 'Football',
    high_school: 'North High School',
    state: 'TX',
    title: 'Call Attempt 1',
    description: 'Call the family',
    ...overrides,
  };
}

function buildContactInfo(overrides: Record<string, unknown> = {}) {
  return {
    contactId: '1489567',
    studentAthlete: {
      name: 'Wylie Robinson',
      email: 'wylie@example.com',
      phone: '555-100-2000',
    },
    parent1: {
      name: 'Pat Robinson',
      relationship: 'Parent',
      email: 'pat@example.com',
      phone: '555-222-3333',
    },
    parent2: null,
    ...overrides,
  };
}

function buildEnvelope(overrides: any = {}) {
  return {
    athleteId: '1489567',
    athleteMainId: '951406',
    name: { firstName: 'Wylie', lastName: 'Robinson', fullName: 'Wylie Robinson' },
    profile: {
      gradYear: '2027',
      sport: 'Football',
      highSchool: 'North High School',
      city: 'Dallas',
      state: 'TX',
    },
    contacts: {
      student: { name: 'Wylie Robinson', email: 'wylie@example.com', phone: '555-100-2000' },
      parent1: { name: 'Pat Robinson', email: 'pat@example.com', phone: '555-222-3333' },
      parent2: null,
    },
    ...overrides,
  };
}

test('splitAthleteName preserves first and last name segments', () => {
  assert.deepEqual(splitAthleteName('Wylie Robinson'), {
    firstName: 'Wylie',
    lastName: 'Robinson',
  });
  assert.deepEqual(splitAthleteName('Mary Kate Smith'), {
    firstName: 'Mary',
    lastName: 'Kate Smith',
  });
});

test('toDuplicateSearchRow ignores rows without exact first and last name values', () => {
  assert.equal(
    toDuplicateSearchRow({
      athlete_id: '123',
      name: 'Wylie',
    }),
    null,
  );
});

test('selectDuplicateCandidates keeps the current row clean and selects other exact-name matches', () => {
  const rows = [
    {
      athleteId: '1489567',
      athleteMainId: '951406',
      firstName: 'Wylie',
      lastName: 'Robinson',
      fullName: 'Wylie Robinson',
    },
    {
      athleteId: '1490000',
      athleteMainId: '951499',
      firstName: 'Wylie',
      lastName: 'Robinson',
      fullName: 'Wylie Robinson',
      gradYear: '2027',
    },
    {
      athleteId: '1490001',
      athleteMainId: '951500',
      firstName: 'Wylie',
      lastName: 'Roberts',
      fullName: 'Wylie Roberts',
    },
  ];

  const candidates = selectDuplicateCandidates({
    rows,
    currentAthleteId: '1489567',
    currentAthleteMainId: '951406',
    targetName: { firstName: 'Wylie', lastName: 'Robinson' },
  });

  assert.deepEqual(
    candidates.map((row) => row.athleteId),
    ['1490000'],
  );
});

test('buildRepeatProfileDescription appends marker once without wiping content', () => {
  assert.equal(buildRepeatProfileDescription('Call the family'), 'Call the family\nRepeat Profile');
  assert.equal(buildRepeatProfileDescription('Call the family\nRepeat Profile'), 'Call the family\nRepeat Profile');
  assert.equal(buildRepeatProfileDescription(''), 'Repeat Profile');
});

test('getDuplicateIdentityEvidence requires proof beyond exact name', () => {
  assert.deepEqual(
    getDuplicateIdentityEvidence(
      {
        athleteId: '1490000',
        athleteMainId: '951499',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
      },
      buildTask(),
    ),
    [],
  );

  assert.deepEqual(
    getDuplicateIdentityEvidence(
      {
        athleteId: '1490000',
        athleteMainId: '951499',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
        gradYear: '2027',
        highSchool: 'North High School',
      },
      buildTask(),
    ),
    ['grad_year', 'high_school'],
  );
});

test('classifyDuplicateProfileEnvelope allows same-family multi-sport matches', () => {
  const decision = classifyDuplicateProfileEnvelope({
    current: buildEnvelope(),
    candidate: buildEnvelope({
      athleteId: '1490000',
      athleteMainId: '951499',
      profile: {
        gradYear: '2027',
        sport: 'Baseball',
        highSchool: 'North High School',
        city: 'Dallas',
        state: 'TX',
      },
    }),
  });

  assert.equal(decision.isDuplicate, true);
  assert.equal(decision.reason, 'likely_same_kid_multi_sport');
  assert.ok(decision.evidence.includes('contact_phone'));
});

test('classifyDuplicateProfileEnvelope leaves different sport unresolved without contact match', () => {
  const decision = classifyDuplicateProfileEnvelope({
    current: buildEnvelope(),
    candidate: buildEnvelope({
      athleteId: '1490000',
      athleteMainId: '951499',
      profile: {
        gradYear: '2027',
        sport: 'Baseball',
        highSchool: 'North High School',
        city: 'Dallas',
        state: 'TX',
      },
      contacts: {
        student: { name: 'Wylie Robinson', email: 'other@example.com', phone: '555-999-0000' },
        parent1: { name: 'Other Parent', email: 'other-parent@example.com', phone: '555-888-0000' },
        parent2: null,
      },
    }),
  });

  assert.equal(decision.isDuplicate, false);
  assert.equal(decision.reason, 'different_sport_contact_mismatch');
});

test('classifyDuplicateProfileEnvelope allows different state only with contact match', () => {
  const decision = classifyDuplicateProfileEnvelope({
    current: buildEnvelope(),
    candidate: buildEnvelope({
      athleteId: '1490000',
      athleteMainId: '951499',
      profile: {
        gradYear: '2027',
        sport: 'Football',
        highSchool: 'North High School',
        city: 'Tulsa',
        state: 'OK',
      },
    }),
  });

  assert.equal(decision.isDuplicate, true);
  assert.equal(decision.reason, 'contact_match_different_state');
});

test('runDuplicateProfileResolutionForTask skips exact-name matches without secondary proof', async () => {
  const result = await runDuplicateProfileResolutionForTask(buildTask(), {
    searchRows: async () => [
      {
        athleteId: '1489567',
        athleteMainId: '951406',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
      },
      {
        athleteId: '1490000',
        athleteMainId: '951499',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
      },
    ],
    loadContactInfo: async (contactId) =>
      contactId === '1489567'
        ? (buildContactInfo() as any)
        : (buildContactInfo({
            contactId: '1490000',
            studentAthlete: { name: 'Wylie Robinson', email: 'other@example.com', phone: '555-999-0000' },
            parent1: {
              name: 'Other Parent',
              relationship: 'Parent',
              email: 'other-parent@example.com',
              phone: '555-888-0000',
            },
          }) as any),
    fetchAthleteDetails: async () => null,
  });

  assert.equal(result.matchCount, 2);
  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.skipped, [{ athleteId: '1490000', reason: 'needs_secondary_identity_match' }]);
});

test('selectDuplicateCallAttempt1Task chooses newest incomplete call attempt 1 task', () => {
  const task = selectDuplicateCallAttempt1Task([
    {
      task_id: '1001',
      title: 'Call Attempt 1',
      completion_date: '04/24/2026',
    },
    {
      task_id: '1003',
      title: '(SC Move This Task) Call Attempt 1',
      completion_date: null,
      description: 'Call the family',
    },
    {
      task_id: '1002',
      title: 'Call Attempt 1',
      completion_date: null,
    },
  ]);

  assert.equal(task?.task_id, '1003');
});

test('isCallAttempt1PortalTask only allows call attempt 1 rows', () => {
  assert.equal(isCallAttempt1PortalTask(buildTask()), true);
  assert.equal(isCallAttempt1PortalTask(buildTask({ title: 'Call Attempt 2' })), false);
});

test('runDuplicateProfileResolutionForTask does nothing when no duplicate is found', async () => {
  const result = await runDuplicateProfileResolutionForTask(buildTask(), {
    searchRows: async () => [
      {
        athleteId: '1489567',
        athleteMainId: '951406',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
      },
    ],
  });

  assert.equal(result.matchCount, 1);
  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.skipped, []);
});

test('runDuplicateProfileResolutionForTask updates and completes duplicate-side call attempt 1 task', async () => {
  const updates: Array<Record<string, string | null | undefined>> = [];
  const completions: Array<Record<string, string | null | undefined>> = [];

  const result = await runDuplicateProfileResolutionForTask(buildTask(), {
    searchRows: async () => [
      {
        athleteId: '1489567',
        athleteMainId: '951406',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
      },
      {
        athleteId: '1490000',
        athleteMainId: '951499',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
        gradYear: '2027',
      },
    ],
    resolveAthleteMainId: async () => '951499',
    loadContactInfo: async () => buildContactInfo() as any,
    fetchAthleteDetails: async () => null,
    fetchTasks: async () => [
      {
        task_id: '2500',
        title: 'Call Attempt 1',
        assigned_owner: 'Jerami Singleton',
        description: 'Call the family',
        completion_date: null,
      },
    ],
    updateTask: async (payload) => {
      updates.push(payload);
      return { success: true, task_id: payload.taskId };
    },
    completeTask: async (payload) => {
      completions.push(payload);
      return { success: true, task_id: payload.taskId };
    },
  });

  assert.equal(result.matchCount, 2);
  assert.equal(result.completed.length, 1);
  assert.deepEqual(result.skipped, []);
  assert.equal(updates[0]?.description, 'Call the family\nRepeat Profile');
  assert.equal(String(completions[0]?.taskId), '2500');
});

test('runDuplicateProfileResolutionForTask creates saved repeat task when duplicate profile has no call attempt task', async () => {
  const createdTasks: Array<Record<string, string | Date | null | undefined>> = [];
  const result = await runDuplicateProfileResolutionForTask(buildTask(), {
    searchRows: async () => [
      {
        athleteId: '1489567',
        athleteMainId: '951406',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
      },
      {
        athleteId: '1490000',
        athleteMainId: '951499',
        firstName: 'Wylie',
        lastName: 'Robinson',
        fullName: 'Wylie Robinson',
        gradYear: '2027',
      },
    ],
    resolveAthleteMainId: async () => '951499',
    loadContactInfo: async () => buildContactInfo() as any,
    fetchAthleteDetails: async () => null,
    fetchTasks: async () => [],
    createRepeatTask: async (payload) => {
      createdTasks.push(payload);
      return { success: true, task_id: '2600' };
    },
  });

  assert.equal(result.completed.length, 1);
  assert.deepEqual(result.skipped, []);
  assert.equal(createdTasks[0]?.taskTitle, 'REPEAT');
  assert.equal(createdTasks[0]?.description, '');
  assert.equal(createdTasks[0]?.assignedTo, '1408164');
  assert.equal(result.completed[0]?.taskId, '2600');
  assert.equal(result.completed[0]?.taskTitle, 'REPEAT');
});
