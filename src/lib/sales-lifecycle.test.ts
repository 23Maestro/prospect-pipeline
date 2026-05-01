import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isActiveCallQueueItem,
  isActiveMeetingQueueItem,
  resolveSalesLifecycle,
  shouldDropFromWorkingQueue,
} from './sales-lifecycle';

test('new opportunity resolves to active call queue', () => {
  const lifecycle = resolveSalesLifecycle('New Opportunity');
  assert.equal(lifecycle.rawCrmStage, 'New Opportunity');
  assert.equal(lifecycle.normalizedStage, 'new_opportunity');
  assert.equal(lifecycle.operatorStatus, 'active_call_queue');
  assert.equal(lifecycle.meetingLifecycle, 'not_set');
  assert.equal(lifecycle.isActiveQueueItem, true);
  assert.equal(isActiveCallQueueItem(lifecycle), true);
});

test('meeting set resolves to active meeting queue', () => {
  const lifecycle = resolveSalesLifecycle('Meeting Set');
  assert.equal(lifecycle.normalizedStage, 'meeting_set');
  assert.equal(lifecycle.operatorStatus, 'active_meeting_queue');
  assert.equal(lifecycle.meetingLifecycle, 'scheduled');
  assert.equal(isActiveMeetingQueueItem(lifecycle), true);
});

test('meeting result reschedule pending resolves to active meeting work', () => {
  const lifecycle = resolveSalesLifecycle('Meeting Result Reschedule Pending');
  assert.equal(lifecycle.normalizedStage, 'reschedule_pending');
  assert.equal(lifecycle.operatorStatus, 'awaiting_reschedule');
  assert.equal(lifecycle.meetingLifecycle, 'reschedule_pending');
  assert.equal(lifecycle.isActiveQueueItem, true);
});

test('meeting result res. pending resolves to active meeting work', () => {
  const lifecycle = resolveSalesLifecycle('Meeting Result - Res. Pending');
  assert.equal(lifecycle.normalizedStage, 'reschedule_pending');
  assert.equal(lifecycle.operatorStatus, 'awaiting_reschedule');
  assert.equal(lifecycle.meetingLifecycle, 'reschedule_pending');
  assert.equal(lifecycle.isActiveQueueItem, true);
});

test('meeting result rescheduled resolves to active meeting queue', () => {
  const lifecycle = resolveSalesLifecycle('Meeting Result Rescheduled');
  assert.equal(lifecycle.normalizedStage, 'rescheduled');
  assert.equal(lifecycle.operatorStatus, 'active_meeting_queue');
  assert.equal(lifecycle.meetingLifecycle, 'rescheduled');
  assert.equal(lifecycle.isActiveQueueItem, true);
});

test('meeting result hyphenated rescheduled resolves to active meeting queue', () => {
  const lifecycle = resolveSalesLifecycle('Meeting Result - Rescheduled');
  assert.equal(lifecycle.normalizedStage, 'rescheduled');
  assert.equal(lifecycle.operatorStatus, 'active_meeting_queue');
  assert.equal(lifecycle.meetingLifecycle, 'rescheduled');
  assert.equal(lifecycle.isActiveQueueItem, true);
});

test('meeting result no show stays active', () => {
  const lifecycle = resolveSalesLifecycle('Meeting Result No Show');
  assert.equal(lifecycle.normalizedStage, 'no_show');
  assert.equal(lifecycle.operatorStatus, 'no_show');
  assert.equal(lifecycle.meetingLifecycle, 'no_show');
  assert.equal(lifecycle.isActiveQueueItem, true);
  assert.equal(isActiveMeetingQueueItem(lifecycle), false);
  assert.equal(shouldDropFromWorkingQueue(lifecycle), false);
});

test('meeting result hyphenated no show stays active', () => {
  const lifecycle = resolveSalesLifecycle('Meeting Result - No Show');
  assert.equal(lifecycle.normalizedStage, 'no_show');
  assert.equal(lifecycle.operatorStatus, 'no_show');
  assert.equal(lifecycle.meetingLifecycle, 'no_show');
  assert.equal(isActiveMeetingQueueItem(lifecycle), false);
});

test('actual meeting hyphenated follow up stays active', () => {
  const lifecycle = resolveSalesLifecycle('Actual Meeting - Follow Up');
  assert.equal(lifecycle.normalizedStage, 'meeting_follow_up');
  assert.equal(lifecycle.operatorStatus, 'awaiting_follow_up');
  assert.equal(lifecycle.meetingLifecycle, 'follow_up_due');
  assert.equal(lifecycle.isActiveQueueItem, true);
});

test('actual meeting follow up stays active', () => {
  const lifecycle = resolveSalesLifecycle('Actual Meeting Follow Up');
  assert.equal(lifecycle.normalizedStage, 'meeting_follow_up');
  assert.equal(lifecycle.operatorStatus, 'awaiting_follow_up');
  assert.equal(lifecycle.meetingLifecycle, 'follow_up_due');
  assert.equal(lifecycle.isActiveQueueItem, true);
});

test('spoke to need follow up resolves as follow-up alias', () => {
  const lifecycle = resolveSalesLifecycle('Spoke to - I Need To Follow Up');
  assert.equal(lifecycle.normalizedStage, 'meeting_follow_up');
  assert.equal(lifecycle.operatorStatus, 'awaiting_follow_up');
  assert.equal(lifecycle.meetingLifecycle, 'follow_up_due');
  assert.equal(lifecycle.isActiveQueueItem, true);
});

test('spoke to athlete not parent stays in call queue', () => {
  const lifecycle = resolveSalesLifecycle('Spoke to - Athlete, not Parent');
  assert.equal(lifecycle.normalizedStage, 'call_attempt');
  assert.equal(lifecycle.operatorStatus, 'active_call_queue');
  assert.equal(lifecycle.meetingLifecycle, 'not_set');
  assert.equal(lifecycle.isActiveQueueItem, true);
});

test('spoke to too young drops from working queue', () => {
  const lifecycle = resolveSalesLifecycle('Spoke to - Too Young');
  assert.equal(lifecycle.normalizedStage, 'inactive');
  assert.equal(lifecycle.operatorStatus, 'inactive');
  assert.equal(lifecycle.isTerminal, true);
  assert.equal(lifecycle.shouldArchiveFromWorkingViews, true);
});

test('meeting result canceled resolves to awaiting reschedule', () => {
  const lifecycle = resolveSalesLifecycle('Meeting Result - Canceled');
  assert.equal(lifecycle.normalizedStage, 'reschedule_pending');
  assert.equal(lifecycle.operatorStatus, 'awaiting_reschedule');
  assert.equal(lifecycle.meetingLifecycle, 'reschedule_pending');
  assert.equal(lifecycle.isActiveQueueItem, true);
});

test('actual meeting close won drops from working queue', () => {
  const lifecycle = resolveSalesLifecycle('Actual Meeting - Close Won');
  assert.equal(lifecycle.normalizedStage, 'closed_won');
  assert.equal(lifecycle.operatorStatus, 'won');
  assert.equal(lifecycle.isTerminal, true);
  assert.equal(lifecycle.shouldArchiveFromWorkingViews, true);
});

test('actual meeting closed won drops from working queue', () => {
  const lifecycle = resolveSalesLifecycle('Actual Meeting Closed Won');
  assert.equal(lifecycle.normalizedStage, 'closed_won');
  assert.equal(lifecycle.operatorStatus, 'won');
  assert.equal(lifecycle.isTerminal, true);
  assert.equal(lifecycle.shouldArchiveFromWorkingViews, true);
  assert.equal(shouldDropFromWorkingQueue(lifecycle), true);
});

test('actual meeting close lost drops from working queue', () => {
  const lifecycle = resolveSalesLifecycle('Actual Meeting - Close Lost');
  assert.equal(lifecycle.normalizedStage, 'closed_lost');
  assert.equal(lifecycle.operatorStatus, 'lost');
  assert.equal(lifecycle.isTerminal, true);
  assert.equal(lifecycle.shouldArchiveFromWorkingViews, true);
});

test('actual meeting closed lost drops from working queue', () => {
  const lifecycle = resolveSalesLifecycle('Actual Meeting Closed Lost');
  assert.equal(lifecycle.normalizedStage, 'closed_lost');
  assert.equal(lifecycle.operatorStatus, 'lost');
  assert.equal(lifecycle.isTerminal, true);
  assert.equal(lifecycle.shouldArchiveFromWorkingViews, true);
  assert.equal(shouldDropFromWorkingQueue(lifecycle), true);
});

test('unknown crm stage stays visible for manual review', () => {
  const lifecycle = resolveSalesLifecycle('Completely New CRM Stage');
  assert.equal(lifecycle.normalizedStage, 'unknown');
  assert.equal(lifecycle.operatorStatus, 'needs_manual_review');
  assert.equal(lifecycle.meetingLifecycle, 'needs_manual_review');
  assert.equal(lifecycle.isActiveQueueItem, true);
  assert.equal(lifecycle.shouldArchiveFromWorkingViews, false);
  assert.match(lifecycle.reason, /manual review/i);
});

test('raw crm stage stays separate from derived operator status', () => {
  const lifecycle = resolveSalesLifecycle('Meeting Set');
  assert.equal(lifecycle.rawCrmStage, 'Meeting Set');
  assert.notEqual(lifecycle.rawCrmStage, lifecycle.operatorStatus);
});
