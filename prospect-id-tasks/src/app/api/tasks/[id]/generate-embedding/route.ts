// API endpoint to generate embeddings for tasks
// Can be called manually or via cron job to backfill embeddings

import { NextRequest, NextResponse } from 'next/server';
import { getTaskById } from '@/lib/mcp/queries';
import { buildTaskEmbeddingText, generateTaskEmbedding } from '@/lib/embeddings';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = await getTaskById(id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const text = buildTaskEmbeddingText(task);
    const success = await generateTaskEmbedding(task.id, text);

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to generate embedding' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Embedding generated successfully',
    });
  } catch (error) {
    console.error('Error generating embedding:', error);
    return NextResponse.json(
      { error: 'Failed to generate embedding' },
      { status: 500 }
    );
  }
}
