// API route for task CRUD operations
import { NextRequest, NextResponse } from 'next/server';
import { fetchTasksWithAthletes, createTask } from '@/lib/mcp/queries';
import type { CreateTaskInput } from '@/types/database';

// GET /api/tasks - Fetch all tasks
export async function GET() {
  try {
    const tasks = await fetchTasksWithAthletes();
    return NextResponse.json({ tasks });
  } catch (error) {
    console.error('API Error fetching tasks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

// POST /api/tasks - Create new task
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input: CreateTaskInput = body;

    const task = await createTask(input);
    if (!task) {
      return NextResponse.json(
        { error: 'Failed to create task' },
        { status: 500 }
      );
    }

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error('API Error creating task:', error);
    return NextResponse.json(
      { error: 'Failed to create task' },
      { status: 500 }
    );
  }
}
