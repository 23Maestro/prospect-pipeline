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
  }
});
