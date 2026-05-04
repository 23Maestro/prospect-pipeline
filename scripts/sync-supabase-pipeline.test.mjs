import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./sync-supabase-pipeline.sh', import.meta.url), 'utf8');

test('hourly Supabase sync materializes the call tracker JSON artifact after writes', () => {
  const currentPipelineIndex = source.indexOf('npm run sync:current-pipeline-supabase');
  const bookedMeetingsIndex = source.indexOf('npm run sync:booked-meetings-supabase');
  const reconcileIndex = source.indexOf('npm run reconcile:current-sales-stages-supabase');
  const commissionsIndex = source.indexOf('npm run sync:commissions-supabase');
  const materializeIndex = source.indexOf('npm run materialize:call-tracker-contract');
  const completeIndex = source.indexOf('sync complete');

  assert.ok(currentPipelineIndex > -1);
  assert.ok(bookedMeetingsIndex > currentPipelineIndex);
  assert.ok(reconcileIndex > bookedMeetingsIndex);
  assert.ok(commissionsIndex > reconcileIndex);
  assert.ok(materializeIndex > commissionsIndex);
  assert.ok(completeIndex > materializeIndex);
});
