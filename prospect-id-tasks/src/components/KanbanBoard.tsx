'use client';

import { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { TaskDetail } from './TaskDetail';
import { fetchTasksWithAthletes, updateTask } from '@/lib/mcp/queries';
import type { TaskWithAthlete, TaskStatus } from '@/types/database';
import { KANBAN_COLUMNS } from '@/types/database';

export function KanbanBoard() {
  const [tasks, setTasks] = useState<TaskWithAthlete[]>([]);
  const [activeTask, setActiveTask] = useState<TaskWithAthlete | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskWithAthlete | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to activate drag
      },
    })
  );

  // Load tasks on mount
  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    setIsLoading(true);
    try {
      const data = await fetchTasksWithAthletes();
      setTasks(data);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setIsLoading(false);
    }
  }

  // Group tasks by status
  const tasksByStatus = KANBAN_COLUMNS.reduce((acc, column) => {
    acc[column.id] = tasks.filter((task) => task.status === column.id);
    return acc;
  }, {} as Record<TaskStatus, TaskWithAthlete[]>);

  // Handle drag start
  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    const task = tasks.find((t) => t.id === active.id);
    setActiveTask(task || null);
  }

  // Handle drag end (status change)
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    setActiveTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as TaskStatus;

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    );

    // Update in database via MCP
    try {
      const updated = await updateTask(taskId, { status: newStatus });
      if (!updated) {
        // Revert on failure
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t))
        );
        console.error('Failed to update task status');
      }
    } catch (error) {
      console.error('Error updating task:', error);
      // Revert optimistic update
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t))
      );
    }
  }

  // Handle task click
  function handleTaskClick(task: TaskWithAthlete) {
    setSelectedTask(task);
  }

  // Close detail drawer
  function handleCloseDetail() {
    setSelectedTask(null);
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950">
        <div className="text-neutral-400">Loading tasks...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-neutral-950 p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-100">Video Pipeline</h1>
        <p className="text-sm text-neutral-400">
          {tasks.length} total tasks
        </p>
      </header>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-6">
          {KANBAN_COLUMNS.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              tasks={tasksByStatus[column.id]}
              onTaskClick={handleTaskClick}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <div className="rotate-3 opacity-75">
              <TaskCard task={activeTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          onClose={handleCloseDetail}
          onUpdate={loadTasks}
        />
      )}
    </div>
  );
}
