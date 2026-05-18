import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScoutPrepContext } from '../features/scout-prep/types';
import {
  type AthleteContactCacheSyncPlan,
  buildAthleteContactCacheSyncPlan,
  normalizeContactCachePhone,
} from './athlete-contact-cache';

function assertUpsertPlan(
  plan: AthleteContactCacheSyncPlan,
): asserts plan is Extract<AthleteContactCacheSyncPlan, { action: 'upsert' }> {
  assert.equal(plan.action, 'upsert');
}

function assertSoftInactivatePlan(
  plan: AthleteContactCacheSyncPlan,
): asserts plan is Extract<AthleteContactCacheSyncPlan, { action: 'soft_inactivate' }> {
  assert.equal(plan.action, 'soft_inactivate');
}

function buildContext(overrides?: Partial<ScoutPrepContext>): ScoutPrepContext {
  return {
    task: {
      task_id: 'task-1',
      contact_id: '1489000',
      athlete_main_id: '951000',
      athlete_name: 'Avery Jones',
      title: 'Call Attempt 1',
      athlete_task_url: 'https://dashboard.nationalpid.com/admin/tasks/1',
    },
    resolved: {
      athlete_id: '1489000',
      athlete_main_id: '951000',
    },
    contactInfo: {
      contactId: '1489000',
      studentAthlete: {
        name: 'Avery Jones',
        email: null,
        phone: '(615) 555-3000',
      },
      parent1: {
        name: 'Tiffany Jones',
        relationship: 'Mother',
        email: null,
        phone: '1-615-555-1212',
      },
      parent2: {
        name: 'Carlos Jones',
        relationship: 'Father',
        email: null,
        phone: '615.555.9898',
      },
    },
    notes: [],
    tasks: [],
    ...overrides,
  } as ScoutPrepContext;
}

test('normalizeContactCachePhone stores ten digit lookup keys', () => {
  assert.equal(normalizeContactCachePhone('+1 (615) 555-1212'), '6155551212');
  assert.equal(normalizeContactCachePhone('615-555-1212'), '6155551212');
  assert.equal(normalizeContactCachePhone('abc'), null);
});

test('buildAthleteContactCacheSyncPlan builds active rows from Scout Prep contacts', () => {
  const plan = buildAthleteContactCacheSyncPlan({
    context: buildContext(),
    crmStage: 'Call Attempt 1',
    source: 'scout_prep',
    seenAt: '2026-05-14T18:00:00.000Z',
  });

  assertUpsertPlan(plan);
  assert.equal(plan.athleteKey, '1489000:951000');
  assert.equal(plan.rows.length, 3);
  assert.equal(plan.rows[0].admin_url, 'https://dashboard.nationalpid.com/admin/athletes?contactid=1489000&athlete_main_id=951000');
  assert.deepEqual(
    plan.rows.map((row) => row.normalized_phone).sort(),
    ['6155551212', '6155553000', '6155559898'],
  );
  assert.equal(plan.rows[0].cache_status, 'active');
});

test('duplicate same-athlete phones keep one cache row and let student athlete win', () => {
  const plan = buildAthleteContactCacheSyncPlan({
    context: buildContext({
      contactInfo: {
        contactId: '1489000',
        studentAthlete: {
          name: 'Avery Jones',
          email: null,
          phone: '(615) 555-1212',
        },
        parent1: {
          name: 'Tiffany Jones',
          relationship: 'Mother',
          email: null,
          phone: '(615) 555-1212',
        },
        parent2: null,
      },
    }),
    crmStage: 'Call Attempt 1',
    source: 'scout_prep',
    seenAt: '2026-05-14T18:00:00.000Z',
  });

  assertUpsertPlan(plan);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].contact_name, 'Avery Jones');
  assert.equal(plan.rows[0].relationship_label, 'Student Athlete');
});

test('inactive lifecycle stages soft-inactivate cache rows', () => {
  const plan = buildAthleteContactCacheSyncPlan({
    context: buildContext(),
    crmStage: 'Spoke to - Too Young',
    source: 'scout_prep',
    seenAt: '2026-05-14T18:00:00.000Z',
  });

  assertSoftInactivatePlan(plan);
  assert.equal(plan.athleteKey, '1489000:951000');
  assert.match(plan.inactiveReason, /inactive/i);
});
