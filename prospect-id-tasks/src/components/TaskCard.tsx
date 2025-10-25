'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskWithAthlete } from '@/types/database';
import { format } from 'date-fns';

interface TaskCardProps {
  task: TaskWithAthlete;
}

export function TaskCard({ task }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isOverdue = task.due_date && new Date(task.due_date) < new Date();

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`
        cursor-pointer rounded-lg bg-neutral-800 p-4 shadow-sm
        transition-all hover:shadow-md hover:bg-neutral-750
        ${isDragging ? 'opacity-50' : 'opacity-100'}
      `}
    >
      {/* Athlete Name */}
      <div className="mb-2 flex items-start justify-between">
        <h3 className="font-medium text-neutral-100 line-clamp-1">
          {task.athlete?.name || 'Unknown Athlete'}
        </h3>
        {task.source && (
          <span className="ml-2 flex-shrink-0 rounded-full bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
            {task.source}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="mb-3 text-sm text-neutral-400 line-clamp-2">
        {task.title}
      </p>

      {/* Metadata */}
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div className="flex items-center gap-3">
          {task.sport && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              {task.sport}
            </span>
          )}
          {task.season && (
            <span>{task.season}</span>
          )}
        </div>

        {task.due_date && (
          <span className={isOverdue ? 'text-red-400 font-medium' : ''}>
            {format(new Date(task.due_date), 'MMM d')}
          </span>
        )}
      </div>

      {/* Positions */}
      {task.positions && task.positions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.positions.slice(0, 3).map((pos, i) => (
            <span
              key={i}
              className="rounded bg-neutral-700 px-1.5 py-0.5 text-xs text-neutral-300"
            >
              {pos}
            </span>
          ))}
          {task.positions.length > 3 && (
            <span className="text-xs text-neutral-500">
              +{task.positions.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
