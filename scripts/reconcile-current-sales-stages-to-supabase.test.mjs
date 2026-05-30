import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./reconcile-current-sales-stages-to-supabase.mjs', import.meta.url), 'utf8');
const translatorSource = readFileSync(
  new URL('../src/domain/supabase-lifecycle-translator.ts', import.meta.url),
  'utf8',
);

test('current sales-stage reconciler delegates lifecycle translation to the domain translator', () => {
  assert.match(source, /supabase-lifecycle-translator/);
  assert.match(source, /parseAppointmentTitleOutcome/);
  assert.match(source, /taskStatusForTitleOrStage/);
  assert.match(source, /appointmentStatusForTitleOrStage/);
  assert.match(source, /crmStageForOutcome/);
  assert.doesNotMatch(source, /function normalizeCrmSalesStage/);
  assert.doesNotMatch(source, /function taskStatusForStage/);
  assert.doesNotMatch(source, /function taskStatusForTitleOrStage/);
  assert.doesNotMatch(source, /function appointmentStatusForTitleOrStage/);
  assert.doesNotMatch(source, /function crmStageForOutcome/);
});

test('current sales-stage reconciler stores post-meeting outcomes through meeting-events domain writer', () => {
  assert.match(source, /buildMeetingOutcomeFact/);
  assert.match(source, /upsertPostMeetingOutcomeFacts/);
  assert.match(source, /rawEventType = 'post_meeting_outcome'/);
  assert.match(source, /postMeetingOutcomeFacts\.push\(buildMeetingOutcomeFact/);
  assert.doesNotMatch(source, /callEvents\.push\(\{\s*id:\s*randomUUID\(\)/s);
  assert.doesNotMatch(source, /upsertCallEvents/);
  assert.doesNotMatch(source, /await supabaseWrite\('call_events'/);
  assert.doesNotMatch(source, /await supabaseWrite\('meeting_events'/);
});

test('current sales-stage reconciler does not turn ended active meetings into post-meeting outcomes', () => {
  assert.match(source, /isPostMeetingLifecycleStage/);
  assert.match(source, /matchStrategy: 'selected_stage_post_meeting'/);
  assert.match(source, /return null;\s*\}\s*async function apiFetch/s);
  assert.doesNotMatch(source, /ended_event_fallback/);
});

test('current sales-stage reconciler treats ENR dollar prefixes as close-won title evidence', () => {
  assert.ok(translatorSource.includes('\\(ENR(?:\\s+\\$?([0-9]+(?:\\.[0-9]{1,2})?))?[^)]*\\)\\s*'));
  assert.match(source, /matchStrategy: 'close_won_enrollment_prefix'/);
  assert.match(translatorSource, /revenueCents: Number\.isFinite\(revenue\) \? Math\.round\(revenue \* 100\) : null/);
});

test('current sales-stage reconciler documents stage title commission precedence', () => {
  assert.match(source, /Post-meeting precedence:/);
  assert.match(source, /Sales stage says Actual Meeting - Close Won/);
  assert.match(source, /Commission sync can later enrich the same deduped fact/);
});

test('current sales-stage reconciler keeps ended active meetings in soft archive polling state', () => {
  assert.match(source, /selectEndedMeetingForMonitoring/);
  assert.match(source, /Meeting Set - Awaiting Post Meeting Result/);
  assert.match(source, /post_meeting_update_pending/);
  assert.match(source, /awaiting_post_meeting_update/);
  assert.doesNotMatch(source, /queueStateDelete\(row\.athlete_key, 'awaiting_post_meeting_update'\)/);
});

test('current sales-stage reconciler prepares pending-client watchlist rows for post-meeting follow-up states', () => {
  assert.match(source, /upsertPendingClientWatchlistRows/);
  assert.match(source, /enqueuePendingClientWatchlistRow/);
  assert.match(source, /classifyPendingClientLifecycle/);
  assert.match(source, /selectLatestPendingClientReviewEvent/);
  assert.match(source, /pendingClientWatchlistUpserted/);
});

test('current sales-stage reconciler deletes canceled active state after twenty one days', () => {
  assert.match(source, /lifecycleTextIncludesAny\(stageText, \['canceled', 'cancelled'\]\)/);
  assert.match(source, /row\.task_status === 'canceled'/);
  assert.match(source, /stale_canceled_21_days/);
  assert.match(source, /keep_canceled_under_21_days/);
  assert.match(source, /stale_reschedule_21_days_without_future_meeting/);
});
