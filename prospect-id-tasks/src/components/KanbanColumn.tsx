'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TaskCard } from './TaskCard';
import type { KanbanColumn as KanbanColumnType, TaskWithAthlete } from '@/types/database';

interface KanbanColumnProps {
  column: KanbanColumnType;
  tasks: TaskWithAthlete[];
  onTaskClick: (task: TaskWithAthlete) => void;
}

export function KanbanColumn({ column, tasks, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({
    id: column.id,
  });

  return (
    <div className="flex w-80 flex-shrink-0 flex-col">
      {/* Column Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-3 w-3 rounded-full ${column.color}`} />
          <h2 className="font-semibold text-neutral-100">{column.title}</h2>
        </div>
        <span className="text-sm text-neutral-500">{tasks.length}</span>
      </div>

      {/* Droppable Area */}
      <div
        ref={setNodeRef}
        className="flex-1 rounded-lg bg-neutral-900 p-3 min-h-[500px]"
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3">
            {tasks.map((task) => (
              <div key={task.id} onClick={() => onTaskClick(task)}>
                <TaskCard task={task} />
              </div>
            ))}
          </div>
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex h-full items-center justify-center text-neutral-600">
            <p className="text-sm">No tasks</p>
          </div>
        )}
      </div>
    </div>
  );
}
