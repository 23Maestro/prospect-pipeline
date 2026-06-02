import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./sync-supabase-pipeline.sh', import.meta.url), 'utf8');

test('hourly Supabase sync writes workflow data without materializing call tracker JSON', () => {
  const currentPipelineIndex = source.indexOf('npm run sync:current-pipeline-supabase');
  const reconcileIndex = source.indexOf('npm run reconcile:current-sales-stages-supabase');
  const commissionsIndex = source.indexOf('npm run sync:commissions-supabase');
  const completeIndex = source.indexOf('sync complete');

  assert.ok(currentPipelineIndex > -1);
  assert.equal(source.includes('npm run sync:booked-meetings-supabase'), false);
  assert.ok(reconcileIndex > currentPipelineIndex);
  assert.equal(source.includes('backsync-lifecycle-call-activity-events.mjs'), false);
  assert.ok(commissionsIndex > reconcileIndex);
  assert.equal(source.includes('npm run materialize:call-tracker-contract'), false);
  assert.ok(completeIndex > commissionsIndex);
});
