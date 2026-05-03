import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activityCountFlagsForTaskStatus,
  activityKindForTaskStatus,
  classifyCallTrackerReporting,
  classifyCrmStage,
  classifyScoutTask,
  trackerOutcomeForTaskStatus,
} from './scout-task-classifier';

test('call tracker activity contract counts outbound attempts separately from contacts', () => {
  for (const status of ['call_attempt_1', 'call_attempt_2', 'call_attempt_3'] as const) {
    assert.equal(activityKindForTaskStatus(status), 'dial');
    assert.deepEqual(activityCountFlagsForTaskStatus(status), {
      countsAsDial: true,
      countsAsContact: false,
      countsAsMeetingSet: false,
      countsAsPostMeetingOutcome: false,
    });
    assert.equal(trackerOutcomeForTaskStatus(status), 'voicemail');
  }
});

test('unable to leave voicemail counts as dial only, not contact', () => {
  assert.equal(activityKindForTaskStatus('unable_to_leave_vm'), 'dial');
  assert.deepEqual(classifyCallTrackerReporting('unable_to_leave_vm'), {
    trackerOutcome: 'unable_to_leave_vm',
    activityKind: 'dial',
    countsAsDial: true,
    countsAsContact: false,
    countsAsMeetingSet: false,
    countsAsPostMeetingOutcome: false,
  });
});

test('call tracker contact outcomes count as both dial and contact', () => {
  for (const status of [
    'spoke_to_not_interested',
    'spoke_to_athlete_not_parent',
    'spoke_to_too_young',
    'spoke_to_follow_up',
  ] as const) {
    assert.equal(activityKindForTaskStatus(status), 'contact');
    assert.deepEqual(activityCountFlagsForTaskStatus(status), {
      countsAsDial: true,
      countsAsContact: true,
      countsAsMeetingSet: false,
      countsAsPostMeetingOutcome: false,
    });
  }
});

test('meeting set counts as dial and contact but stays a lifecycle meeting fact', () => {
  assert.equal(activityKindForTaskStatus('meeting_set'), null);
  assert.deepEqual(activityCountFlagsForTaskStatus('meeting_set'), {
    countsAsDial: true,
    countsAsContact: true,
    countsAsMeetingSet: true,
    countsAsPostMeetingOutcome: false,
  });
  assert.equal(trackerOutcomeForTaskStatus('meeting_set'), 'meeting_set');
});

test('post-meeting outcomes are not dial or contact activity', () => {
  for (const status of ['closed_won', 'closed_lost', 'reschedule_pending', 'no_show', 'canceled'] as const) {
    assert.deepEqual(activityCountFlagsForTaskStatus(status), {
      countsAsDial: false,
      countsAsContact: false,
      countsAsMeetingSet: false,
      countsAsPostMeetingOutcome: true,
    });
  }
});

test('confirmed Laravel contact labels classify to contact activity statuses', () => {
  assert.equal(classifyCrmStage('Called - unable to leave vm'), 'unable_to_leave_vm');
  assert.equal(classifyCrmStage('Spoke to - Not Interested'), 'spoke_to_not_interested');
  assert.equal(classifyCrmStage('Spoke to - Athlete, not Parent'), 'spoke_to_athlete_not_parent');
  assert.equal(classifyCrmStage('Spoke to - Too Young'), 'spoke_to_too_young');
  assert.equal(classifyCrmStage('Spoke to - I Need To Follow Up'), 'spoke_to_follow_up');
  assert.equal(classifyCrmStage('Meeting Set'), 'meeting_set');
  assert.equal(classifyCrmStage('Meeting Result - Canceled'), 'canceled');
});

test('task titles classify legacy call attempts from the task text', () => {
  assert.equal(classifyScoutTask({ title: 'Call Attempt 1' }).taskStatus, 'call_attempt_1');
  assert.equal(classifyScoutTask({ title: 'Call Attempt 2' }).taskStatus, 'call_attempt_2');
  assert.equal(classifyScoutTask({ title: 'Call Attempt 3' }).taskStatus, 'call_attempt_3');
  assert.equal(classifyScoutTask({ title: 'SCHEDULED FOLLOW-UP' }).taskStatus, 'spoke_to_follow_up');
});
