import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enqueuePendingScheduledFollowUpUpdate,
  findPendingSpokeToFollowUpTask,
  isSpokeToNeedFollowUpStage,
  listPendingScheduledFollowUpUpdates,
  reconcilePendingScheduledFollowUpUpdates,
} from './scheduled-follow-up-reconciler';

class MemoryStorage {
  values = new Map<string, string>();

  async getItem<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

test('spoke-to follow-up stage is the only stage eligible for pending scheduled follow-up', () => {
  assert.equal(isSpokeToNeedFollowUpStage('Spoke To - I Need To Follow Up'), true);
  assert.equal(isSpokeToNeedFollowUpStage('Meeting Set'), false);
  assert.equal(isSpokeToNeedFollowUpStage('Never Spoke To'), false);
});

test('finds newest incomplete spoke-to follow-up task and ignores completed tasks', () => {
  const task = findPendingSpokeToFollowUpTask([
    { task_id: '100', title: 'Call Attempt 2', completion_date: '' },
    {
      task_id: '101',
      title: '(SC Move This Task) Spoke to - Need to Follow Up',
      completion_date: '06/01/2026',
    },
    {
      task_id: '103',
      title: '(SC Move This Task) Spoke to - Need to Follow Up',
      completion_date: '',
    },
    { task_id: '102', title: 'Spoke to - I Need To Follow Up', completion_date: '-' },
  ]);

  assert.equal(task?.task_id, '103');
});

test('reconciler applies cached note and due date through task update helper', async () => {
  const storage = new MemoryStorage();
  await enqueuePendingScheduledFollowUpUpdate(
    {
      athleteId: '123',
      athleteMainId: '456',
      athleteName: 'Taylor Athlete',
      sourceTaskId: '50',
      stageLabel: 'Spoke To - I Need To Follow Up',
      note: 'Spoke to mom. She was working and asked for Friday follow-up.',
      dueDate: '06/19/2026',
      dueTime: '09:00',
      now: new Date('2026-06-11T12:00:00Z'),
    },
    storage,
  );

  const updates: unknown[] = [];
  const results = await reconcilePendingScheduledFollowUpUpdates({
    storage,
    now: new Date('2026-06-11T12:05:00Z'),
    fetchTasks: async () => [
      {
        task_id: '900',
        title: '(SC Move This Task) Spoke to - Need to Follow Up',
        assigned_owner: 'Jerami Singleton',
        completion_date: '',
        description: 'Move this task to the day you remember to follow up.',
      },
    ],
    updateTask: async (args) => {
      updates.push(args);
      return { success: true, task_id: args.taskId };
    },
  });

  assert.deepEqual(results, [
    {
      id: 'scheduled-follow-up:123:456',
      athleteName: 'Taylor Athlete',
      status: 'applied',
      taskId: '900',
    },
  ]);
  assert.deepEqual(updates, [
    {
      taskId: '900',
      contactTask: '123',
      athleteMainId: '456',
      athleteName: 'Taylor Athlete',
      taskTitle: 'SCHEDULED FOLLOW-UP',
      description: 'Spoke to mom. She was working and asked for Friday follow-up.',
      dueDate: '06/19/2026',
      dueTime: '09:00',
      assignedOwner: 'Jerami Singleton',
    },
  ]);

  const pending = await listPendingScheduledFollowUpUpdates(storage);
  assert.equal(pending[0]?.status, 'applied');
  assert.equal(pending[0]?.matchedTaskId, '900');
});

test('reconciler leaves pending item waiting when Laravel has not created task yet', async () => {
  const storage = new MemoryStorage();
  await enqueuePendingScheduledFollowUpUpdate(
    {
      athleteId: '123',
      athleteMainId: '456',
      athleteName: 'Taylor Athlete',
      stageLabel: 'Spoke To - I Need To Follow Up',
      note: 'Call mom next week.',
      dueDate: '06/19/2026',
      dueTime: '09:00',
      now: new Date('2026-06-11T12:00:00Z'),
    },
    storage,
  );

  const results = await reconcilePendingScheduledFollowUpUpdates({
    storage,
    now: new Date('2026-06-11T12:05:00Z'),
    fetchTasks: async () => [{ task_id: '100', title: 'Call Attempt 2', completion_date: '' }],
    updateTask: async () => {
      throw new Error('should not update without matching task');
    },
  });

  assert.deepEqual(results, [
    {
      id: 'scheduled-follow-up:123:456',
      athleteName: 'Taylor Athlete',
      status: 'waiting',
    },
  ]);
  const pending = await listPendingScheduledFollowUpUpdates(storage);
  assert.equal(pending[0]?.status, 'pending');
  assert.equal(pending[0]?.attempts, 1);
});
