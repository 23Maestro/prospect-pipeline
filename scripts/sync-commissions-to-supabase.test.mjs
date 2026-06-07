import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./sync-commissions-to-supabase.mjs', import.meta.url), 'utf8');

test('commission sync uses FastAPI commission source and writes post-meeting outcomes', () => {
  assert.match(source, /\/commissions\/stripe/);
  assert.match(source, /upsertEnrollmentPaymentFacts/);
  assert.doesNotMatch(source, /buildMeetingOutcomeFact/);
  assert.doesNotMatch(source, /upsertPostMeetingOutcomeFacts/);
  assert.doesNotMatch(source, /supabase-lifecycle-translator/);
  assert.doesNotMatch(source, /appointmentStatusForTitleOrStage/);
  assert.match(source, /paymentDedupeKey/);
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

test('commission sync writes payment-level facts instead of collapsing recurring payments into one outcome', () => {
  assert.match(source, /paymentDedupeKey = String\(entry\.duplicate_key \|\| entry\.row_key \|\| entry\.account_id/);
  assert.match(source, /enrollmentPaymentFacts/);
  assert.doesNotMatch(source, /dedupeOutcome: closeWonOutcome/);
  assert.match(source, /Stripe commission rows are paid close-won evidence, not call activity/);
});

test('commission sync skips repeat paid rows that resolve to a second appointment for an existing enrollment', () => {
  assert.match(source, /fetchExistingClosedWonRows/);
  assert.match(source, /selectedClosedWonByAthlete/);
  assert.match(source, /existing_closed_won_enrollment/);
  assert.match(source, /candidate_appointment_id/);
});
