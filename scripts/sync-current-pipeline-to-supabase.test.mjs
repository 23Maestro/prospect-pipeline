import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./sync-current-pipeline-to-supabase.mjs', import.meta.url),
  'utf8',
);

test('current pipeline sync writes canonical facts and snapshots through shared persistence', () => {
  assert.match(source, /buildCallActivityFact/);
  assert.match(source, /buildMeetingSetFact/);
  assert.match(source, /upsertAthletePipelineState/);
  assert.match(source, /upsertCallActivityEvents/);
  assert.match(source, /insertMeetingSetEventsOnce/);
});

test('current pipeline sync no longer writes raw pipeline snapshot rows as lifecycle events', () => {
  assert.doesNotMatch(source, /pipeline_task_backfill_current/);
  assert.doesNotMatch(source, /await supabaseWrite\('lifecycle_events'/);
  assert.doesNotMatch(source, /lifecycleEvents/);
  assert.doesNotMatch(source, /backfill_run_id/);
});

test('current pipeline meeting-set facts preserve first transition time across reruns', () => {
  assert.doesNotMatch(source, /upsertMeetingSetEvents/);
  assert.doesNotMatch(source, /resolution=merge-duplicates[\s\S]*meetingSet/);
  assert.match(source, /meetingSetEventsInsertedOnce/);
});

test('current pipeline meeting-set facts reuse older legacy transition time by athlete and cleaned title', () => {
  assert.match(source, /existingMeetingSetTransitions/);
  assert.match(source, /normalizeMeetingTitleKey/);
  assert.match(source, /createdAt: existingTransitionAt \|\| new Date\(\)\.toISOString\(\)/);
});

test('current pipeline meeting-set facts write materialization proof and reporting flags at the source', () => {
  assert.match(source, /materialization_proof:\s*{/);
  assert.match(source, /owner_context:\s*{/);
  assert.match(source, /task_assigned_owner: ownership\.context\.taskAssignedOwner/);
  assert.match(source, /owner_proof: ownership\.context\.ownerProof/);
  assert.match(source, /counts_as_dial: true/);
  assert.match(source, /counts_as_contact: true/);
  assert.match(source, /counts_as_meeting_set: true/);
  assert.match(source, /counts_as_post_meeting_outcome: false/);
});

test('current pipeline keeps ended active meeting sets in post-meeting polling state', () => {
  assert.match(source, /shouldMonitorEndedMeetingSet/);
  assert.match(source, /hasMeetingEnded\(previousMeeting\)/);
  assert.match(source, /Meeting Set - Awaiting Post Meeting Result/);
  assert.match(source, /post_meeting_update_pending/);
  assert.match(source, /awaiting_post_meeting_update/);
});

test('current pipeline activity facts require task completion clocks instead of open-task due dates', () => {
  assert.match(source, /const completionAt = parseLegacyTaskDate\(taskFromList\?\.completion_date \|\| pipelineTask\.completion_date\)/);
  assert.match(source, /function isOpenNewOpportunityQueueItem/);
  assert.match(source, /normalizeSalesStageKey\(args\.selectedSalesStage\) === 'new opportunity'/);
  assert.match(source, /&& !openNewOpportunityQueueItem\)/);
  assert.match(source, /const activityOccurredAt = completionAt/);
  assert.match(source, /occurredAt: activityOccurredAt/);
  assert.match(source, /occurred_at_source: activityOccurredAtSource/);
  assert.match(source, /missing_completion_date_for_call_activity/);
  assert.doesNotMatch(source, /const activityOccurredAt = completionAt \|\| dueAt/);
  assert.doesNotMatch(source, /occurredAt: dueAt \|\| new Date\(\)\.toISOString\(\)/);
});

test('current pipeline keeps open New Opportunity call-attempt tasks as state, not skipped activity', () => {
  assert.match(source, /crmStage: shouldMonitorEndedMeetingSet[\s\S]*: selectedSalesStage/);
  assert.match(source, /currentTaskTitle: strippedTaskTitle \|\| rawTaskTitle \|\| null/);
  assert.match(source, /openNewOpportunityQueueItem/);
  assert.doesNotMatch(source, /reason: 'open_new_opportunity_queue_item_not_call_activity'/);
});
