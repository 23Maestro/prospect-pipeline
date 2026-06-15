import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./sync-supabase-pipeline.sh', import.meta.url), 'utf8');

test('scheduled Supabase wrapper does not own front-facing pipeline movement', () => {
  const currentPipelineIndex = source.indexOf('npm run sync:current-pipeline-supabase');
  const currentPipelineRepairIndex = source.indexOf('RUN_CURRENT_PIPELINE_REPAIR');
  const commissionsIndex = source.indexOf('npm run sync:commissions-supabase');
  const commissionSyncIndex = source.indexOf('RUN_COMMISSION_SYNC');
  const completeIndex = source.indexOf('drift wrapper complete');

  assert.ok(currentPipelineRepairIndex > -1);
  assert.ok(commissionSyncIndex > -1);
  assert.ok(currentPipelineIndex > currentPipelineRepairIndex);
  assert.ok(commissionsIndex > commissionSyncIndex);
  assert.ok(completeIndex > -1);
  assert.match(source, /no scheduled Supabase writers enabled/);
  assert.match(source, /action-time Scout Prep writes own lifecycle, meeting, and pending-client movement/);

  assert.equal(source.includes('npm run sync:booked-meetings-supabase'), false);
  assert.equal(source.includes('npm run reconcile:current-sales-stages-supabase'), false);
  assert.equal(source.includes('reconcile-current-sales-stages-to-supabase.mjs'), false);
  assert.equal(source.includes('backsync-lifecycle-call-activity-events.mjs'), false);
  assert.equal(source.includes('npm run materialize:call-tracker-contract'), false);
  assert.equal(source.includes('scripts/sync-booked-meetings-to-supabase.mjs'), false);
});
