/**
 * Craft Tasks API Client
 * Type-safe wrappers for the FastAPI Craft endpoints.
 * All functions return success: false on error, never throw.
 */

import { apiFetch } from "./python-server-client";

export type CraftTaskType = "in_queue" | "email_follow_up" | "dropbox_folders";

export interface CreateCraftTaskParams {
  athleteName: string;
  taskType: CraftTaskType;
  dueDate?: string; // YYYY-MM-DD format
  notes?: string;
}

export interface CreateCraftTaskResponse {
  success: boolean;
  task_id?: string;
  message: string;
}

export interface DeleteCraftTaskParams {
  athleteName: string;
  taskType: CraftTaskType;
}

export interface DeleteCraftTaskResponse {
  success: boolean;
  deleted_count: number;
  message: string;
}

export interface SearchCraftTasksParams {
  athleteName: string;
  taskTypes?: CraftTaskType[];
}

export interface CraftTask {
  id: string;
  content: string;
  task_type: CraftTaskType;
  state: string;
  schedule_date?: string;
}

export interface SearchCraftTasksResponse {
  success: boolean;
  tasks: CraftTask[];
  count: number;
}

/**
 * Create a task in Craft. Never throws - returns success: false on error.
 */
export async function createCraftTask(
  params: CreateCraftTaskParams
): Promise<CreateCraftTaskResponse> {
  try {
    const response = await apiFetch("/craft/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        athlete_name: params.athleteName,
        task_type: params.taskType,
        due_date: params.dueDate,
        notes: params.notes,
      }),
    });

    if (!response.ok) {
      return { success: false, message: `HTTP ${response.status}` };
    }

    return (await response.json()) as CreateCraftTaskResponse;
  } catch (error) {
    console.error("Craft task creation error:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Delete task(s) by athlete name. Never throws - returns success: false on error.
 */
export async function deleteCraftTask(
  params: DeleteCraftTaskParams
): Promise<DeleteCraftTaskResponse> {
  try {
    const response = await apiFetch("/craft/complete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        athlete_name: params.athleteName,
        task_type: params.taskType,
      }),
    });

    if (!response.ok) {
      return { success: false, deleted_count: 0, message: `HTTP ${response.status}` };
    }

    return (await response.json()) as DeleteCraftTaskResponse;
  } catch (error) {
    console.error("Craft task deletion error:", error);
    return {
      success: false,
      deleted_count: 0,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Search for tasks by athlete name. Never throws - returns empty on error.
 */
export async function searchCraftTasks(
  params: SearchCraftTasksParams
): Promise<SearchCraftTasksResponse> {
  try {
    const response = await apiFetch("/craft/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        athlete_name: params.athleteName,
        task_types: params.taskTypes,
      }),
    });

    if (!response.ok) {
      return { success: false, tasks: [], count: 0 };
    }

    return (await response.json()) as SearchCraftTasksResponse;
  } catch (error) {
    console.error("Craft task search error:", error);
    return { success: false, tasks: [], count: 0 };
  }
}

/**
 * Check if task already exists (duplicate prevention).
 */
export async function taskExists(
  athleteName: string,
  taskType: CraftTaskType
): Promise<boolean> {
  const result = await searchCraftTasks({
    athleteName,
    taskTypes: [taskType],
  });
  return result.count > 0;
}

/**
 * Calculate due date string (YYYY-MM-DD) for N days from now.
 */
export function getDueDateString(daysFromNow: number = 7): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split("T")[0];
}
