import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./sync-supabase-pipeline.sh', import.meta.url), 'utf8');

test('hourly Supabase sync is the single scheduled accurate-update lane', () => {
  const currentPipelineIndex = source.indexOf('npm run sync:current-pipeline-supabase');
  const commissionsIndex = source.indexOf('npm run sync:commissions-supabase');
  const completeIndex = source.indexOf('sync complete');

  assert.ok(currentPipelineIndex > -1);
  assert.ok(commissionsIndex > currentPipelineIndex);
  assert.ok(completeIndex > commissionsIndex);

  assert.equal(source.includes('npm run sync:booked-meetings-supabase'), false);
  assert.equal(source.includes('npm run reconcile:current-sales-stages-supabase'), false);
  assert.equal(source.includes('reconcile-current-sales-stages-to-supabase.mjs'), false);
  assert.equal(source.includes('backsync-lifecycle-call-activity-events.mjs'), false);
  assert.equal(source.includes('npm run materialize:call-tracker-contract'), false);
  assert.equal(source.includes('scripts/sync-booked-meetings-to-supabase.mjs'), false);
});
