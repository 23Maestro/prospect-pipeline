import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./sync-commissions-to-supabase.mjs', import.meta.url), 'utf8');

test('commission sync uses FastAPI commission source and writes post-meeting outcomes', () => {
  assert.match(source, /\/commissions\/stripe/);
  assert.match(source, /buildMeetingOutcomeFact/);
  assert.match(source, /upsertPostMeetingOutcomeFacts/);
  assert.match(source, /supabase-lifecycle-translator/);
  assert.match(source, /crmStageForOutcome/);
  assert.match(source, /taskStatusForTitleOrStage/);
  assert.match(source, /appointmentStatusForTitleOrStage/);
  assert.match(source, /rawEventType: 'post_meeting_outcome'/);
  assert.match(source, /rawCrmStage: closeWonCrmStage/);
});

test('commission sync only materializes paid/payroll commission rows and carries duplicate evidence', () => {
  assert.match(source, /!status \|\| status === 'paid'/);
  assert.match(source, /commission_duplicate_key/);
  assert.match(source, /commission_possible_duplicate/);
  assert.match(source, /commission_source_view/);
  assert.match(source, /COMMISSION_PERIOD/);
});

test('commission sync watches the current and previous commission periods by default', () => {
  assert.match(source, /previousCommissionPeriodForDate/);
  assert.match(source, /commissionPeriodsToSync/);
  assert.match(source, /commissionPeriodForDate\(date\)/);
  assert.match(source, /previousCommissionPeriodForDate\(date\)/);
  assert.match(source, /process\.env\.COMMISSION_PERIOD/);
});

test('commission sync enriches the same close-won outcome fact instead of creating account-specific wins', () => {
  assert.match(source, /dedupeOutcome: closeWonOutcome/);
  assert.doesNotMatch(source, /dedupeOutcome: `closed_won:\$\{entry\.account_id/);
  assert.match(source, /Stripe commission rows are paid close-won evidence, not call activity/);
});
