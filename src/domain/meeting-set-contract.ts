import type { MeetingSetSubmitRequest } from '../features/scout-prep/types';

export type MeetingSetLaravelPayloadInput = {
  athleteId: string;
  athleteMainId: string;
  meetingName: string;
  meetingTimezone: string;
  assignedToLegacyUserId: string;
  meetingForLegacyUserId?: string | null;
  openEventId: string;
  calendarOwnerId?: string | null;
  bookedMeetingAssignedOwner?: string | null;
  taskDescription: string;
  startTime: string;
  meetingLength?: string | null;
  dueDate?: string | null;
  existingTask?: string | null;
  contact?: string | null;
  openMeetingsListLength?: string | null;
  templateId?: string | null;
};

export type MeetingSetLaravelPayload = MeetingSetSubmitRequest & {
  meeting_for?: string;
  meetingfor?: string;
  calendar_owner_id?: string;
  booked_meeting_assigned_owner?: string;
};

function trim(value?: string | number | null): string {
  return String(value || '').trim();
}

function assignOptional<T extends Record<string, unknown>>(
  payload: T,
  key: keyof T,
  value?: string | null,
) {
  const normalized = trim(value);
  if (normalized) {
    payload[key] = normalized as T[keyof T];
  }
}

export function buildMeetingSetLaravelPayload(
  input: MeetingSetLaravelPayloadInput,
): MeetingSetLaravelPayload {
  const meetingForLegacyUserId = trim(input.meetingForLegacyUserId);
  const payload: MeetingSetLaravelPayload = {
    athlete_id: trim(input.athleteId),
    athlete_main_id: trim(input.athleteMainId),
    meeting_name: trim(input.meetingName),
    meeting_timezone: trim(input.meetingTimezone),
    assigned_to: trim(input.assignedToLegacyUserId),
    open_event_id: trim(input.openEventId),
    task_description: trim(input.taskDescription),
    start_time: trim(input.startTime),
  };

  assignOptional(payload, 'meeting_length', input.meetingLength);
  assignOptional(payload, 'due_date', input.dueDate);
  assignOptional(payload, 'existing_task', input.existingTask);
  assignOptional(payload, 'contact', input.contact);
  assignOptional(payload, 'openmeetings_list_length', input.openMeetingsListLength);
  assignOptional(payload, 'template_id', input.templateId);
  assignOptional(payload, 'meeting_for', meetingForLegacyUserId);
  assignOptional(payload, 'meetingfor', meetingForLegacyUserId);
  assignOptional(payload, 'calendar_owner_id', input.calendarOwnerId);
  assignOptional(payload, 'booked_meeting_assigned_owner', input.bookedMeetingAssignedOwner);

  return payload;
}
