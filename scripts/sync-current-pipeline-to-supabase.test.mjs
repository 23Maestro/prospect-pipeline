import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./sync-current-pipeline-to-supabase.mjs', import.meta.url),
  'utf8',
);

test('current pipeline sync writes canonical facts and does not revive pipeline snapshots', () => {
  assert.match(source, /buildCallActivityFact/);
  assert.match(source, /buildMeetingSetFact/);
  assert.match(source, /supabase-lifecycle-translator/);
  assert.match(source, /taskStatusForStage/);
  assert.doesNotMatch(source, /appointmentStatusForTitleOrStage/);
  assert.match(source, /normalizeCrmSalesStage/);
  assert.match(source, /resolveWorkflowContext/);
  assert.match(source, /CURRENT_PIPELINE_SYNC_LOCK_DIR/);
  assert.match(source, /current_pipeline_sync_already_running/);
  assert.match(source, /function acquireLock/);
  assert.match(source, /metadata\.json/);
  assert.match(source, /readLockPid/);
  assert.match(source, /rmSync\(LOCK_DIR, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(source, /rmdirSync\(LOCK_DIR\)/);
  assert.match(source, /process\.once\('SIGTERM'/);
  assert.match(source, /workflow_id: workflowContext\.workflow_id/);
  assert.match(source, /workflow_context: workflowContext/);
  assert.match(source, /post_meeting_result: workflowContext\.post_meeting_result/);
  assert.match(source, /currentLifecycleStateProjected/);
  assert.doesNotMatch(source, /upsertAthletePipelineState/);
  assert.doesNotMatch(source, /athlete_pipeline_state/);
  assert.match(source, /upsertCallActivityEvents/);
  assert.match(source, /insertMeetingSetEventsOnce/);
  assert.doesNotMatch(source, /function normalizeSalesStageKey/);
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
  assert.match(source, /buildOwnerProofPayload/);
  assert.match(source, /ownerContext: ownership\.context/);
  assert.match(source, /ownerProof: ownership\.context\.ownerProof/);
  assert.match(source, /counts_as_dial: true/);
  assert.match(source, /counts_as_contact: true/);
  assert.match(source, /counts_as_meeting_set: true/);
  assert.match(source, /counts_as_post_meeting_outcome: false/);
});

test('current pipeline keeps ended active meeting sets in post-meeting polling state', () => {
  assert.match(source, /shouldMonitorEndedMeetingSet/);
  assert.match(source, /hasMeetingEnded\(previousMeeting\)/);
  assert.match(source, /Meeting Set - Needs Post Meeting Review/);
  assert.match(source, /post_meeting_update_pending/);
  assert.match(source, /needs_post_meeting_review/);
  assert.match(source, /buildPendingClientWatchlistRow/);
  assert.match(source, /upsertPendingClientWatchlistRows/);
  assert.match(source, /const pendingClientWatchlistResult = await upsertPendingClientWatchlistRows/);
  assert.match(source, /pendingClientWatchlistCandidates: pendingClientRows\.length/);
  assert.match(source, /pendingClientWatchlistUpserted: pendingClientWatchlistResult\.count/);
  assert.match(source, /event_id: `appointment:\$\{appointmentId\}`/);
  assert.doesNotMatch(source, /post_meeting_result:\s*'awaiting_post_meeting_update'/);
  assert.doesNotMatch(source, /patchAppointmentPostMeetingResultIfMissing/);
  assert.doesNotMatch(source, /current_pipeline_sync_ended_meeting_set/);
  assert.doesNotMatch(source, /status:\s*'awaiting_post_meeting_update'/);
  assert.doesNotMatch(source, /awaiting_post_meeting_update/);
  assert.doesNotMatch(source, /patchAppointmentStatus/);
});

test('current pipeline routes only pending-client outcomes into pending client work', () => {
  assert.match(
    source,
    /\['follow_up', 'reschedule_pending', 'no_show', 'canceled'\]\.includes\(pendingClientResult\)/,
  );
  assert.doesNotMatch(source, /'rescheduled'\]\.includes\(pendingClientResult\)/);
  assert.doesNotMatch(source, /pendingClientResult === 'rescheduled'/);
});

test('current pipeline activity facts require task completion clocks instead of open-task due dates', () => {
  assert.match(source, /const completionAt = parseLegacyTaskDate\(taskFromList\?\.completion_date \|\| pipelineTask\.completion_date\)/);
  assert.match(source, /function isOpenNewOpportunityQueueItem/);
  assert.match(source, /normalizeCrmSalesStage\(args\.selectedSalesStage\) === 'new_opportunity'/);
  assert.match(source, /&& !openNewOpportunityQueueItem\)/);
  assert.match(source, /const activityOccurredAt = completionAt/);
  assert.match(source, /occurredAt: activityOccurredAt/);
  assert.match(source, /rawCrmStage: selectedSalesStage/);
  assert.match(source, /rawTaskStatus: mapping\.taskStatus/);
  assert.match(source, /occurred_at_source: activityOccurredAtSource/);
  assert.match(source, /missing_completion_date_for_call_activity/);
  assert.doesNotMatch(source, /const activityOccurredAt = completionAt \|\| dueAt/);
  assert.doesNotMatch(source, /occurredAt: dueAt \|\| new Date\(\)\.toISOString\(\)/);
});

test('current pipeline keeps open New Opportunity call-attempt tasks as state, not skipped activity', () => {
  assert.match(source, /crmStage: shouldMonitorEndedMeetingSet[\s\S]*: selectedSalesStage/);
  assert.match(source, /currentTaskTitle: strippedTaskTitle \|\| rawTaskTitle \|\| null/);
  assert.match(source, /openNewOpportunityQueueItem/);
  assert.match(source, /taskStatus: shouldMonitorEndedMeetingSet[\s\S]*: translatedTaskStatus/);
  assert.doesNotMatch(source, /reason: 'open_new_opportunity_queue_item_not_call_activity'/);
});
