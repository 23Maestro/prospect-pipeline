import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyMeetingSetStage,
  classifyPostCallActivityStage,
  classifyPostMeetingOutcomeStage,
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
