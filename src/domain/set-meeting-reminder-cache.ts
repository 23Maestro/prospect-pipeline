export type BuildSetMeetingReminderCacheRowsInput = {
  appointmentId: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  recipientName: string;
  recipientPhone: string;
  headScoutName: string;
  meetingStartsAt: string | null;
  meetingTimezone: string;
  confirmation1Message: string;
  confirmation2Message: string;
  adminUrl: string;
  taskUrl: string;
  generatedAt: string;
  source: string;
};

type ReminderKind = 'confirmation_1' | 'confirmation_2';

function buildRow(input: BuildSetMeetingReminderCacheRowsInput, kind: ReminderKind, messageBody: string) {
  if (!String(messageBody || '').trim()) {
    throw new Error(`message_body is required for ${kind}`);
  }
  const dedupeKey = `set_meeting_reminder:${input.appointmentId}:${kind}:${input.recipientPhone}`;
  return {
    id: dedupeKey,
    appointment_id: input.appointmentId,
    kind,
    send_at: input.meetingStartsAt || null,
    sent_at: null,
    status: 'cached',
    dedupe_key: dedupeKey,
    athlete_key: `${input.athleteId}:${input.athleteMainId}`,
    athlete_id: input.athleteId,
    athlete_main_id: input.athleteMainId,
    athlete_name: input.athleteName,
    recipient_name: input.recipientName,
    recipient_phone: input.recipientPhone,
    head_scout_name: input.headScoutName,
    meeting_starts_at: input.meetingStartsAt || null,
    meeting_timezone: input.meetingTimezone,
    message_body: messageBody,
    admin_url: input.adminUrl,
    task_url: input.taskUrl,
    source: 'set_meetings_confirmation',
    generated_at: input.generatedAt,
    payload_json: {
      appointment_id: input.appointmentId,
      athlete_id: input.athleteId,
      athlete_main_id: input.athleteMainId,
      athlete_name: input.athleteName,
      recipient_name: input.recipientName,
      recipient_phone: input.recipientPhone,
      head_scout_name: input.headScoutName,
      meeting_starts_at: input.meetingStartsAt || null,
      meeting_timezone: input.meetingTimezone,
      message_body: messageBody,
      admin_url: input.adminUrl,
      task_url: input.taskUrl,
      source: input.source,
      generated_at: input.generatedAt,
      reminder_kind: kind,
    },
    created_at: input.generatedAt,
    updated_at: input.generatedAt,
  };
}

export function buildSetMeetingReminderCacheRows(input: BuildSetMeetingReminderCacheRowsInput) {
  return [
    buildRow(input, 'confirmation_1', input.confirmation1Message),
    buildRow(input, 'confirmation_2', input.confirmation2Message),
  ];
}
