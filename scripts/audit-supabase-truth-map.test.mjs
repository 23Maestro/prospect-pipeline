import fs from 'fs';
import { execFileSync } from 'child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

const deleteTargets = [
  'athlete_lifecycle_current',
  'athlete_lifecycle_timeline',
  'active_athlete_meeting_truth',
  'athlete_pipeline_state',
  'meeting_events',
  'call_activity_events',
  'call_tracker_events',
  'call_tracker_events_deduped',
  'call_tracker_events_owner_context',
  'call_tracker_meeting_sets',
  'call_tracker_summary',
  'weekly_operator_funnel_metrics',
  'meeting_truth_anomalies',
  'reminders',
];

test('clean-house truth map names every Supabase delete target', () => {
  const doc = fs.readFileSync('docs/architecture/supabase-clean-house-truth-map.md', 'utf8');
  for (const target of deleteTargets) {
    assert.match(doc, new RegExp(`\\\`${target}\\\``), `${target} missing from truth map`);
  }
  assert.match(doc, /lifecycleSalesStage/);
  assert.match(doc, /Sales stage is truth/);
});

test('legacy lifecycle writer name is retired in implementation files', () => {
  const files = [
    'src/lib/supabase-lifecycle.ts',
    'src/lib/scout-prep.tsx',
    'src/lib/sales-stage.ts',
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /recordLifecycleMutation/);
    assert.match(source, /lifecycleSalesStage/);
  }
});

test('Supabase truth-map audit script tracks canonical and delete-target surfaces', () => {
  const output = execFileSync('node', ['scripts/audit-supabase-truth-map.mjs', '--json'], {
    encoding: 'utf8',
  });
  const payload = JSON.parse(output);
  const surfaces = new Set(payload.summary.map((row) => row.surface));

  for (const surface of ['athletes', 'athlete_contact_cache', 'appointments', 'lifecycle_events', 'call_events']) {
    assert.equal(surfaces.has(surface), true, `${surface} missing from audit`);
  }
  for (const target of deleteTargets) {
    assert.equal(surfaces.has(target), true, `${target} missing from audit`);
    const row = payload.summary.find((entry) => entry.surface === target);
    assert.equal(row.role, 'delete_target', `${target} must be marked delete_target`);
    assert.equal(typeof row.migrationOwner, 'string', `${target} must have a migration owner`);
    assert.equal(typeof row.replacement, 'string', `${target} must have replacement guidance`);
    assert.equal(typeof row.activeDependencies, 'number', `${target} must report active dependencies`);
  }
});

test('Supabase truth-map audit separates active dependencies from docs and tests', () => {
  const output = execFileSync('node', ['scripts/audit-supabase-truth-map.mjs', '--json'], {
    encoding: 'utf8',
  });
  const payload = JSON.parse(output);
  const row = payload.summary.find((entry) => entry.surface === 'athlete_lifecycle_current');

  assert.ok(row, 'athlete_lifecycle_current missing from audit');
  assert.ok(row.fileKindCounts.doc >= 1, 'expected doc references to be counted separately');
  assert.ok(row.activeDependencies <= row.references, 'active dependencies cannot exceed total references');
});

test('Supabase truth-map audit default output names owner, active dependency, read, and write counts', () => {
  const output = execFileSync('node', ['scripts/audit-supabase-truth-map.mjs'], {
    encoding: 'utf8',
  });

  assert.match(output, /owner=Lifecycle & Stage Truth/);
  assert.match(output, /active=\d+/);
  assert.match(output, /reads=\d+/);
  assert.match(output, /writes=\d+/);
});

test('Supabase truth-map audit can print one active-only surface plan', () => {
  const output = execFileSync(
    'node',
    ['scripts/audit-supabase-truth-map.mjs', '--surface', 'call_tracker_events', '--active-only'],
    { encoding: 'utf8' },
  );

  assert.match(output, /call_tracker_events: delete_target/);
  assert.match(output, /replacement: API\/query over canonical call_events/);
  assert.match(output, /\[(implementation|script|schema_or_migration)\/(reference|read|write_or_mutation)\]/);
  assert.doesNotMatch(output, /\[doc\//);
  assert.doesNotMatch(output, /\[test\//);
});

test('Supabase truth-map audit can emit focused JSON for one surface', () => {
  const output = execFileSync(
    'node',
    ['scripts/audit-supabase-truth-map.mjs', '--surface', 'call_tracker_summary', '--active-only', '--json'],
    { encoding: 'utf8' },
  );
  const payload = JSON.parse(output);

  assert.equal(payload.summary.surface, 'call_tracker_summary');
  assert.equal(Array.isArray(payload.references), true);
  assert.equal(payload.references.every((ref) => ['implementation', 'script', 'schema_or_migration'].includes(ref.fileKind)), true);
});

test('Supabase truth-map audit blocks direct call_events reader migration until canonical shape is ready', () => {
  const output = execFileSync(
    'node',
    ['scripts/audit-supabase-truth-map.mjs', '--surface', 'call_events', '--json'],
    { encoding: 'utf8' },
  );
  const payload = JSON.parse(output);

  assert.equal(payload.summary.surface, 'call_events');
  assert.equal(payload.summary.role, 'canonical_target');
  assert.match(payload.summary.currentState, /Target only/);
  assert.match(payload.summary.currentState, /deprecated compatibility view/);
  assert.match(payload.summary.replacement, /one canonical shape/);
});
