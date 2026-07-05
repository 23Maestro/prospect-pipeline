import { jsonResponse, methodNotAllowed } from '../../../../lib/response-shapes';

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const openEventId = String(payload.open_event_id || `open_${Date.now()}`).trim();
  const previousAppointmentId = String(payload.previous_appointment_id || '').trim();
  return jsonResponse({
    success: true,
    stage: 'Meeting Result - Rescheduled',
    open_event_id: openEventId,
    previous_appointment_id: previousAppointmentId,
    created_task: {
      task_id: `task_${openEventId}`,
      title: 'Confirmation Call',
    },
    email_sent: false,
  });
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
