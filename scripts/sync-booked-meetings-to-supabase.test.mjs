import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./sync-booked-meetings-to-supabase.mjs', import.meta.url),
  'utf8',
);
const confirmationCacheResolverSource = readFileSync(
  new URL('./resolve-set-meeting-confirmation-cache.mjs', import.meta.url),
  'utf8',
);
const mobileReadinessGuardSource = readFileSync(
  new URL('./verify-set-meetings-mobile-readiness.mjs', import.meta.url),
  'utf8',
);

test('booked meeting sync uses the shared weekly source resolver and fact builders', () => {
  assert.match(source, /buildWeeklyOperatorMeetingSetCandidates/);
  assert.match(source, /buildMeetingSetFact/);
  assert.match(source, /buildOwnerProofPayload/);
  assert.match(source, /resolveOwnerContext/);
  assert.match(source, /supabase-lifecycle-translator/);
  assert.match(source, /taskStatusForStage/);
  assert.match(source, /appointmentStatusForTitleOrStage/);
  assert.match(source, /postMeetingResultForTitleOrStage/);
  assert.match(source, /insertMeetingSetEventsOnce/);
  assert.match(source, /\/scout\/tasks\?range=thisWeek/);
  assert.match(source, /\/calendar\/booked-meetings\?/);
  assert.match(source, /\/calendar\/athlete-booked-meetings\?/);
  assert.doesNotMatch(source, /function inferCrmStage/);
  assert.doesNotMatch(source, /function inferTaskStatus/);
});

test('booked meeting sync does not reintroduce known-athlete prefilter or local Supabase fact writes', () => {
  assert.doesNotMatch(source, /knownAthleteNames/);
  assert.doesNotMatch(source, /await supabaseWrite\('lifecycle_events'/);
  assert.doesNotMatch(source, /insertLifecycleEvents/);
  assert.doesNotMatch(source, /buildLifecycleAuditEvent/);
  assert.doesNotMatch(source, /booked_meeting_gap_reconciled/);
  assert.doesNotMatch(source, /backfill_meeting_set_promotion/);
  assert.doesNotMatch(source, /backfill_run_id/);
});

test('booked meeting sync preserves lifecycle transition time across reruns', () => {
  assert.doesNotMatch(source, /upsertMeetingSetEvents/);
  assert.doesNotMatch(source, /resolution=merge-duplicates[\s\S]*meetingSet/);
  assert.match(source, /meetingSetEventsInsertedOnce/);
});

test('booked meeting sync writes materialized owner proof before inserting meeting-set rows', () => {
  assert.match(source, /legacy_compatibility_proof: 'weekly_operator_task_assigned_owner'/);
  assert.match(source, /ownerProof: 'payload\.matched_weekly_task_assigned_owner'/);
  assert.match(source, /occurred_at: meetingSetOccurredAt/);
  assert.match(source, /createdAt: meetingSetOccurredAt \|\| updatedAt/);
});

test('booked meeting sync only writes Meeting Set facts for true Meeting Set stage', () => {
  assert.match(source, /classifyMeetingSetStage\(crmStage\)/);
  assert.match(source, /nonMeetingSetSkipped/);
  assert.match(source, /booked_meeting_updates_state_only_not_meeting_set_fact/);
});

test('one-time confirmation cache resolver writes cache plus verified appointment truth only', () => {
  assert.match(confirmationCacheResolverSource, /process\.env\.LIMIT \|\| '11'/);
  assert.match(confirmationCacheResolverSource, /buildTodayThroughNextSundayWindow/);
  assert.match(confirmationCacheResolverSource, /START_DATE/);
  assert.match(confirmationCacheResolverSource, /END_DATE/);
  assert.match(confirmationCacheResolverSource, /buildWeeklyOperatorMeetingSetCandidates/);
  assert.match(confirmationCacheResolverSource, /buildSetMeetingConfirmationCacheRows/);
  assert.match(confirmationCacheResolverSource, /buildAppointmentSnapshot/);
  assert.match(confirmationCacheResolverSource, /upsertAppointments/);
  assert.match(confirmationCacheResolverSource, /upsertSetMeetingConfirmationCacheRows/);
  assert.doesNotMatch(confirmationCacheResolverSource, /insertMeetingSetEventsOnce/);
  assert.doesNotMatch(confirmationCacheResolverSource, /upsertAthletePipelineState/);
  assert.doesNotMatch(confirmationCacheResolverSource, /recordMeetingSet/);
});

test('mobile set meetings readiness guard writes cache before checking mobile routes', () => {
  assert.match(mobileReadinessGuardSource, /runResolver\(windowRange\)/);
  assert.match(mobileReadinessGuardSource, /fetchLiveSetMeetings\(windowRange\)/);
  assert.match(mobileReadinessGuardSource, /readConfirmationCacheRows\(supabaseConfig, windowRange\)/);
  assert.match(mobileReadinessGuardSource, /findCacheGaps\(live\.events, cacheRows\)/);
  assert.match(mobileReadinessGuardSource, /checkSchedulesRoute\(windowRange\)/);
  assert.match(mobileReadinessGuardSource, /process\.exitCode = 1/);
});
