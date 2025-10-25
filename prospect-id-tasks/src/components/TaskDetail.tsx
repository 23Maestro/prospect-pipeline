'use client';

import { useState, useEffect } from 'react';
import type { TaskWithAthlete } from '@/types/database';
import { getSimilarTasks } from '@/lib/mcp/queries';
import { TaskCard } from './TaskCard';

interface TaskDetailProps {
  task: TaskWithAthlete;
  onClose: () => void;
  onUpdate?: () => void;
}

export function TaskDetail({ task, onClose }: TaskDetailProps) {
  const [relatedTasks, setRelatedTasks] = useState<TaskWithAthlete[]>([]);

  useEffect(() => {
    async function loadRelatedTasks() {
      const related = await getSimilarTasks(task.id);
      setRelatedTasks(related);
    }
    loadRelatedTasks();
  }, [task.id]);

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-[600px] bg-neutral-900 shadow-2xl z-50 overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold text-neutral-100 mb-1">
                {task.athlete?.name || 'Unknown Athlete'}
              </h2>
              <p className="text-neutral-400">{task.title}</p>
            </div>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-100"
            >
              ✕
            </button>
          </div>

          {/* Athlete Info */}
          <div className="mb-6 rounded-lg bg-neutral-800 p-4">
            <h3 className="mb-3 text-sm font-semibold text-neutral-100">Athlete Info</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {task.athlete?.grad_year && (
                <div>
                  <span className="text-neutral-500">Grad Year:</span>
                  <span className="ml-2 text-neutral-100">{task.athlete.grad_year}</span>
                </div>
              )}
              {task.athlete?.sport && (
                <div>
                  <span className="text-neutral-500">Sport:</span>
                  <span className="ml-2 text-neutral-100">{task.athlete.sport}</span>
                </div>
              )}
              {task.athlete?.high_school && (
                <div>
                  <span className="text-neutral-500">School:</span>
                  <span className="ml-2 text-neutral-100">{task.athlete.high_school}</span>
                </div>
              )}
              {task.athlete?.city && task.athlete?.state && (
                <div>
                  <span className="text-neutral-500">Location:</span>
                  <span className="ml-2 text-neutral-100">
                    {task.athlete.city}, {task.athlete.state}
                  </span>
                </div>
              )}
              {task.athlete?.email && (
                <div className="col-span-2">
                  <span className="text-neutral-500">Email:</span>
                  <span className="ml-2 text-neutral-100">{task.athlete.email}</span>
                </div>
              )}
            </div>
          </div>

          {/* Task Details */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-neutral-100">Task Details</h3>
            <div className="space-y-3">
              <div>
                <span className="text-sm text-neutral-500">Status:</span>
                <span className="ml-2 rounded-full bg-neutral-700 px-3 py-1 text-sm text-neutral-100">
                  {task.status}
                </span>
              </div>
              <div>
                <span className="text-sm text-neutral-500">Source:</span>
                <span className="ml-2 text-sm text-neutral-100">{task.source}</span>
              </div>
              {task.due_date && (
                <div>
                  <span className="text-sm text-neutral-500">Due Date:</span>
                  <span className="ml-2 text-sm text-neutral-100">
                    {new Date(task.due_date).toLocaleDateString()}
                  </span>
                </div>
              )}
              {task.season && (
                <div>
                  <span className="text-sm text-neutral-500">Season:</span>
                  <span className="ml-2 text-sm text-neutral-100">{task.season}</span>
                </div>
              )}
              {task.video_type && (
                <div>
                  <span className="text-sm text-neutral-500">Video Type:</span>
                  <span className="ml-2 text-sm text-neutral-100">{task.video_type}</span>
                </div>
              )}
            </div>
          </div>

          {/* Body/Notes */}
          {task.body && (
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-neutral-100">Notes</h3>
              <p className="text-sm text-neutral-400 whitespace-pre-wrap">{task.body}</p>
            </div>
          )}

          {/* YouTube Link */}
          {task.youtube_link && (
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-neutral-100">YouTube Link</h3>
              <a
                href={task.youtube_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-400 hover:text-blue-300 underline"
              >
                {task.youtube_link}
              </a>
            </div>
          )}

          {/* Related Tasks */}
          {relatedTasks.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-neutral-100">
                Related Tasks ({relatedTasks.length})
              </h3>
              <div className="space-y-2">
                {relatedTasks.map((relatedTask) => (
                  <TaskCard key={relatedTask.id} task={relatedTask} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
