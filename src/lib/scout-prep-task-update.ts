import { apiFetch } from './fastapi-client';
import { lifecycleSalesStage } from './supabase-lifecycle';

export type UpdateScoutPrepTaskArgs = {
  taskId: string;
  contactTask: string;
  athleteMainId: string;
  athleteName?: string | null;
  taskTitle?: string | null;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  assignedOwner?: string | null;
};

export async function updateScoutPrepTask(
  args: UpdateScoutPrepTaskArgs,
): Promise<{ success?: boolean; task_id?: string | null; message?: string | null }> {
  const response = await apiFetch('/tasks/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_id: args.taskId,
      contact_task: args.contactTask,
      athlete_main_id: args.athleteMainId,
      task_title: args.taskTitle ?? null,
      description: args.description ?? null,
      due_date: args.dueDate ?? null,
      due_time: args.dueTime ?? null,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText.slice(0, 200) || `Task update HTTP ${response.status}`);
  }

  const result = (await response.json()) as {
    success?: boolean;
    task_id?: string | null;
    message?: string | null;
  };
  await lifecycleSalesStage({
    sourcePost: '/tasks/update',
    athleteId: args.contactTask,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName || '',
    taskId: result.task_id || args.taskId,
    taskTitle: args.taskTitle || null,
    taskDescription: args.description || null,
    taskAssignedOwner: args.assignedOwner || null,
    dueDate: args.dueDate,
    dueTime: args.dueTime,
    activitySubtype: 'needs_manual_review',
  });
  return result;
}
