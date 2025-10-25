// Webhook endpoint called by Supabase trigger when task status changes to "Done"
// This sends the "Editing Done" email via Python NPID client

import { NextRequest, NextResponse } from 'next/server';
import { getTaskById } from '@/lib/mcp/queries';
import { getEmailTemplateForStatus } from '@/types/database';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Get task with athlete info
    const { id } = await params;
    const task = await getTaskById(id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Get email template for this status
    const templateName = getEmailTemplateForStatus(task.status);
    if (!templateName) {
      return NextResponse.json({
        message: 'No email template for this status',
      });
    }

    // Get athlete name
    const athleteName = task.athlete?.name;
    if (!athleteName) {
      return NextResponse.json(
        { error: 'No athlete associated with task' },
        { status: 400 }
      );
    }

    // Call Python server to send email via NPID
    const pythonServerUrl = process.env.PYTHON_SERVER_URL || 'http://localhost:5000';
    const response = await fetch(`${pythonServerUrl}/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete_name: athleteName,
        template_name: templateName,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Python server error:', error);
      return NextResponse.json(
        { error: 'Failed to send email' },
        { status: 500 }
      );
    }

    const result = await response.json();

    return NextResponse.json({
      success: true,
      message: `Email "${templateName}" sent to ${athleteName}`,
      result,
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
