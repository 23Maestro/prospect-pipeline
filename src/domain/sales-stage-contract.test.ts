import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyMeetingSetStage,
  classifyPostCallActivityStage,
  classifyPostMeetingOutcomeStage,
  isConfirmedRescheduleSchedulingStage,
  isCuratedSalesStageLabel,
  needsPostCallMeetingSchedulingFields,
  normalizeSalesStageLabelForLaravel,
  postCallStageForAppointmentTitlePrefix,
  POST_CALL_UPDATE_EXCLUDED_STAGE_LABELS,
} from './sales-stage-contract';

test('sales stage aliases normalize to Laravel-visible labels', () => {
  assert.equal(
    normalizeSalesStageLabelForLaravel('Spoke to - Follow Up'),
    'Spoke to - I Need To Follow Up',
  );
  assert.equal(
    normalizeSalesStageLabelForLaravel('Spoke to - I need to follow up'),
    'Spoke to - I Need To Follow Up',
  );
});

test('post-call activity classification owns voicemail and topmost task completion decisions', () => {
  assert.deepEqual(classifyPostCallActivityStage('Left Voice Mail 1'), {
    kind: 'call_activity',
    normalizedStage: 'Left Voice Mail 1',
    voicemailVariant: 'call_attempt_1',
    completesPostCallTask: true,
  });

  assert.deepEqual(classifyPostCallActivityStage('Spoke to - Follow Up'), {
    kind: 'call_activity',
    normalizedStage: 'Spoke to - I Need To Follow Up',
    voicemailVariant: null,
    completesPostCallTask: true,
  });

  for (const stage of [
    'Called - Unable to Leave VM',
    'Spoke to - Not Interested',
    'Spoke to - Athlete, not Parent',
    'Spoke to - Too Young',
    'Spoke to - I Need To Follow Up',
  ]) {
    const classification = classifyPostCallActivityStage(stage);
    assert.equal(classification?.kind, 'call_activity', stage);
    assert.equal(classification?.completesPostCallTask, true, stage);
    assert.equal(classifyPostMeetingOutcomeStage(stage), null, stage);
  }
});

test('meeting-set and post-meeting classifications are separate from post-call activity', () => {
  assert.deepEqual(classifyMeetingSetStage('Meeting Set'), {
    kind: 'meeting_set',
    normalizedStage: 'Meeting Set',
  });
  assert.deepEqual(classifyPostMeetingOutcomeStage('Actual Meeting - Close Won'), {
    kind: 'post_meeting_outcome',
    normalizedStage: 'Actual Meeting - Close Won',
    outcome: 'closed_won',
  });
  assert.equal(classifyPostCallActivityStage('Actual Meeting - Close Won'), null);
});

test('post-call scheduling form is limited to Meeting Set and confirmed reschedules', () => {
  assert.equal(needsPostCallMeetingSchedulingFields('Meeting Set'), true);
  assert.equal(needsPostCallMeetingSchedulingFields('Meeting Result - Rescheduled'), true);
  assert.equal(needsPostCallMeetingSchedulingFields('Rescheduled'), false);
  assert.equal(isCuratedSalesStageLabel('Rescheduled'), false);
  assert.ok(POST_CALL_UPDATE_EXCLUDED_STAGE_LABELS.includes('Rescheduled'));

  assert.equal(needsPostCallMeetingSchedulingFields('Meeting Result - Res. Pending'), false);
  assert.equal(isConfirmedRescheduleSchedulingStage('Meeting Result - Res. Pending'), false);
  assert.deepEqual(classifyPostMeetingOutcomeStage('Meeting Result - Res. Pending'), {
    kind: 'post_meeting_outcome',
    normalizedStage: 'Meeting Result - Res. Pending',
    outcome: 'resolution_pending',
  });
});

test('appointment title prefixes map to post-call outcome stages in the domain', () => {
  assert.equal(postCallStageForAppointmentTitlePrefix('(RSP)'), 'Meeting Result - Res. Pending');
  assert.equal(postCallStageForAppointmentTitlePrefix('(RSP)*2'), 'Meeting Result - Res. Pending');
  assert.equal(postCallStageForAppointmentTitlePrefix('(CAN)'), 'Meeting Result - Canceled');
  assert.equal(postCallStageForAppointmentTitlePrefix('(NS)'), 'Meeting Result - No Show');
  assert.equal(postCallStageForAppointmentTitlePrefix('(CF)'), null);
  assert.equal(postCallStageForAppointmentTitlePrefix(null), null);
});

test('new opportunity is recognized but not a completed post-call outcome', () => {
  assert.equal(isCuratedSalesStageLabel('New Opportunity'), true);
  assert.equal(classifyPostCallActivityStage('New Opportunity'), null);
  assert.equal(classifyMeetingSetStage('New Opportunity'), null);
  assert.equal(classifyPostMeetingOutcomeStage('New Opportunity'), null);
});
