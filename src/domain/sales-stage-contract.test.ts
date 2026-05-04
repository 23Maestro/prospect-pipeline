import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyMeetingSetStage,
  classifyPostCallActivityStage,
  classifyPostMeetingOutcomeStage,
  isCuratedSalesStageLabel,
  normalizeSalesStageLabelForLaravel,
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

test('new opportunity is recognized but not a completed post-call outcome', () => {
  assert.equal(isCuratedSalesStageLabel('New Opportunity'), true);
  assert.equal(classifyPostCallActivityStage('New Opportunity'), null);
  assert.equal(classifyMeetingSetStage('New Opportunity'), null);
  assert.equal(classifyPostMeetingOutcomeStage('New Opportunity'), null);
});
