import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyCallPlan, buildPlainTextPlan, buildSchedule } from './daily-call-blocks';

test('daily call blocks: 42 Touch 1s and 90 tasks produce visible count-driven labels', () => {
  const start = new Date(2026, 4, 21, 9, 0, 0);
  const counts = { touch1Count: 42, remainingTaskCount: 90 };
  const plan = buildDailyCallPlan(counts);
  const blocks = buildSchedule(start, counts);
  const plainText = buildPlainTextPlan(blocks, start, counts);

  assert.equal(plan.touch1DialTarget, 25);
  assert.equal(plan.firstTouch1Target, 12);
  assert.equal(plan.callbackTouch1Target, 8);
  assert.equal(plan.primeTouch1Target, 5);
  assert.match(blocks.map((block) => block.title).join('\n'), /SC: Touch 1 Calls \(12 of 42\)/);
  assert.match(
    blocks.map((block) => block.title).join('\n'),
    /SC: Touch 1 \+ Callbacks \(8 Touch 1s\)/,
  );
  assert.match(blocks.map((block) => block.title).join('\n'), /SC: Parent Window \(5 Touch 1s\)/);
  assert.match(plainText, /Goal: 6-7 sets/);
  assert.match(plainText, /Active Queue: 42 Touch 1s \/ 90 tasks/);
  assert.match(plainText, /Touch 1 Dial Target: 25/);
});
