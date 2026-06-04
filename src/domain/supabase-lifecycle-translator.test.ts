import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appointmentStatusForTitleOrStage,
  crmStageForOutcome,
  parseAppointmentTitleOutcome,
  taskStatusForStage,
  taskStatusForTitleOrStage,
} from './supabase-lifecycle-translator';

test('event prefixes translate directly for Supabase lifecycle state', () => {
  const noShow = parseAppointmentTitleOutcome('(NS)*2 Raul Agramonte Football 2027 FL');
  assert.equal(noShow.outcome, 'soft_archive_no_show');
  assert.equal(crmStageForOutcome(noShow.outcome, 'Actual Meeting - Follow Up'), 'Meeting Result - No Show');
  assert.equal(
    taskStatusForTitleOrStage(noShow.originalTitle, 'Actual Meeting - Follow Up', 'meeting_follow_up'),
    'no_show',
  );
  assert.equal(appointmentStatusForTitleOrStage('Actual Meeting - Follow Up', noShow.originalTitle), 'no_show');
});

test('CRM stage translates without producing manual-review task status', () => {
  assert.equal(taskStatusForStage('', null), null);
  assert.equal(taskStatusForStage('Not A Laravel Stage', null), null);
  assert.equal(taskStatusForStage('Actual Meeting - Follow Up', null), 'meeting_follow_up');
  assert.equal(taskStatusForStage('Meeting Result - No Show', null), 'no_show');
  assert.equal(taskStatusForStage('Meeting Result - Canceled', null), 'canceled');
  assert.equal(appointmentStatusForTitleOrStage('Meeting Result - Canceled', null), 'canceled');
});

test('known close and follow-up prefixes map to established stages and statuses', () => {
  const enrolled = parseAppointmentTitleOutcome('(ENR $99 - Post Date) Sample Athlete Football 2027 TX');
  assert.equal(enrolled.outcome, 'terminal_enrollment');
  assert.equal(enrolled.revenueCents, 9900);
  assert.equal(crmStageForOutcome(enrolled.outcome, null), 'Actual Meeting - Close Won');
  assert.equal(taskStatusForTitleOrStage(enrolled.originalTitle, null, null), 'closed_won');

  const followUp = parseAppointmentTitleOutcome('(FU) Sample Athlete Football 2027 TX');
  assert.equal(followUp.outcome, 'soft_archive_follow_up');
  assert.equal(crmStageForOutcome(followUp.outcome, null), 'Actual Meeting - Follow Up');
  assert.equal(taskStatusForTitleOrStage(followUp.originalTitle, null, null), 'meeting_follow_up');

  const canceled = parseAppointmentTitleOutcome('(CAN) Sample Athlete Football 2027 TX');
  assert.equal(canceled.outcome, 'soft_archive_canceled');
  assert.equal(crmStageForOutcome(canceled.outcome, null), 'Meeting Result - Canceled');
  assert.equal(taskStatusForTitleOrStage(canceled.originalTitle, null, null), 'canceled');
  assert.equal(appointmentStatusForTitleOrStage(null, canceled.originalTitle), 'canceled');

  const parentDidNotQualify = parseAppointmentTitleOutcome('(PAR - DNQ) Sample Athlete Football 2027 TX');
  assert.equal(parentDidNotQualify.outcome, 'terminal_close_lost');
  assert.equal(crmStageForOutcome(parentDidNotQualify.outcome, null), 'Actual Meeting - Close Lost');
  assert.equal(taskStatusForTitleOrStage(parentDidNotQualify.originalTitle, null, null), 'closed_lost');
  assert.equal(appointmentStatusForTitleOrStage(null, parentDidNotQualify.originalTitle), 'closed_lost');
});
