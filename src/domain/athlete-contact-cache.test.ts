import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { ScoutPrepContext } from '../features/scout-prep/types';
import {
  type AthleteContactCacheSyncPlan,
  buildManualAdditionalAthleteContactCacheRow,
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
      athlete_task_url: 'https://legacy-dashboard.example.com/admin/tasks/1',
    },
    resolved: {
      athlete_id: '1489000',
      athlete_main_id: '951000',
      city: 'Nashville',
      state: 'TN',
      timezone: 'America/Chicago',
      timezone_label: 'CST',
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
  assert.equal(plan.rows[0].admin_url, 'https://legacy-dashboard.example.com/admin/athletes?contactid=1489000&athlete_main_id=951000');
  assert.deepEqual(
    plan.rows.map((row) => row.normalized_phone).sort(),
    ['6155551212', '6155553000', '6155559898'],
  );
  assert.equal(plan.rows[0].cache_status, 'active');
  assert.equal(plan.rows[0].timezone, 'America/Chicago');
  assert.equal(plan.rows[0].timezone_label, 'CST');
});

test('buildManualAdditionalAthleteContactCacheRow builds an active support row for redirected parent phones', () => {
  const row = buildManualAdditionalAthleteContactCacheRow({
    context: buildContext(),
    contactName: 'Sarah Samuels',
    relationshipLabel: 'Mother redirected to dad',
    phone: '+1 (407) 555-0123',
    email: 'sarah@example.com',
    note: 'Mom redirected operator to dad as the best contact.',
    seenAt: '2026-06-17T15:00:00.000Z',
  });

  assert.ok(row);
  assert.equal(row.athlete_key, '1489000:951000');
  assert.equal(row.athlete_id, '1489000');
  assert.equal(row.athlete_main_id, '951000');
  assert.equal(row.athlete_name, 'Avery Jones');
  assert.equal(row.contact_id, '1489000');
  assert.equal(row.contact_name, 'Sarah Samuels');
  assert.equal(row.relationship_label, 'Parent 2');
  assert.equal(row.phone, '407-555-0123');
  assert.equal(row.normalized_phone, '4075550123');
  assert.equal(row.admin_url, 'https://legacy-dashboard.example.com/admin/athletes?contactid=1489000&athlete_main_id=951000');
  assert.equal(row.task_url, 'https://legacy-dashboard.example.com/admin/tasks/1');
  assert.equal(row.timezone, 'America/Chicago');
  assert.equal(row.timezone_label, 'CST');
  assert.equal(row.source, 'scout_prep_manual_contact');
  assert.equal(row.cache_status, 'active');
  assert.equal(row.payload_json.role, 'manual_additional_contact');
  assert.equal(row.payload_json.relationship_label, 'Parent 2');
  assert.equal(row.payload_json.manual_relationship_label, 'Mother redirected to dad');
  assert.equal(row.payload_json.email, 'sarah@example.com');
  assert.equal(row.payload_json.note, 'Mom redirected operator to dad as the best contact.');
  assert.equal(row.payload_json.provenance, 'operator_added_from_scout_prep_contact_info');
});

test('buildManualAdditionalAthleteContactCacheRow strips paste corruption from phone display', () => {
  const row = buildManualAdditionalAthleteContactCacheRow({
    context: buildContext(),
    contactName: 'Sarah Samuels',
    relationshipLabel: 'Mom',
    phone: '‚Ä™+1 (712) 261-1974‚Ä¨',
    seenAt: '2026-06-17T15:00:00.000Z',
  });

  assert.ok(row);
  assert.equal(row.phone, '712-261-1974');
  assert.equal(row.normalized_phone, '7122611974');
});

test('buildManualAdditionalAthleteContactCacheRow rejects missing names and invalid phones', () => {
  assert.equal(
    buildManualAdditionalAthleteContactCacheRow({
      context: buildContext(),
      contactName: 'Sarah Samuels',
      relationshipLabel: 'Mother',
      phone: 'No phone',
    }),
    null,
  );
  assert.equal(
    buildManualAdditionalAthleteContactCacheRow({
      context: buildContext(),
      contactName: '',
      relationshipLabel: 'Mother',
      phone: '407-555-0123',
    }),
    null,
  );
});

test('active contact cache rows require resolved timezone going forward', () => {
  const plan = buildAthleteContactCacheSyncPlan({
    context: buildContext({
      resolved: {
        athlete_id: '1489000',
        athlete_main_id: '951000',
        city: '',
        state: '',
      },
    }),
    crmStage: 'Call Attempt 1',
    source: 'scout_prep',
    seenAt: '2026-05-14T18:00:00.000Z',
  });

  assert.equal(plan.action, 'skip');
  assert.equal(plan.reason, 'missing_resolved_timezone');
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

test('client-message contact cache admission reads lifecycle events instead of projection labels', () => {
  const source = fs.readFileSync('src/lib/athlete-contact-cache.ts', 'utf8');
  assert.match(source, /lifecycle_events/);
  assert.match(source, /normalizeCrmSalesStage/);
  assert.match(source, /shouldAdmitContactCacheMatch/);
  assert.match(source, /select=athlete_key,crm_stage,task_status,event_type,payload_json,created_at/);
  assert.match(source, /payload\.current_task_id/);
  assert.doesNotMatch(source, /athlete_lifecycle_current/);
  assert.doesNotMatch(source, /'athlete_pipeline_state'/);
});

test('client-message contact cache config validates candidates instead of trusting one env key', () => {
  const source = fs.readFileSync('src/lib/athlete-contact-cache.ts', 'utf8');
  assert.match(source, /buildSupabaseConfigCandidates/);
  assert.match(source, /isSupabaseConfigUsable/);
  assert.match(source, /await getSupabaseConfig\('athlete_contact_cache'\)/);
  assert.doesNotMatch(source, /process\.env\.SUPABASE_SECRET_KEY \|\|\s*repoEnv\.SUPABASE_SECRET_KEY/);
});

test('client-message directory load does not hide contact cache failures as an empty inbox', () => {
  const source = fs.readFileSync('src/lib/client-message-sandbox.ts', 'utf8');
  assert.match(source, /const contactCacheResolutions = await resolveStudentAthleteMessagesForPhones\(chatPhones\)/);
  assert.doesNotMatch(source, /resolveStudentAthleteMessagesForPhones\(chatPhones\)\.catch/);
});
