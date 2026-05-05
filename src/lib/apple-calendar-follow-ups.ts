import { runAppleScript } from '@raycast/utils';
import { buildReminderAdminUrl } from './reminders';

const DEFAULT_EVENT_LENGTH_MINUTES = 15;
const DEFAULT_ALERT_MINUTES_BEFORE = 10;
const PREFERRED_CALENDAR_NAME = 'Appts.';

export type AppleCalendarFollowUpInput = {
  start: Date;
  contactName: string;
  phone: string;
  athleteName: string;
  contactId?: string | null;
  athleteMainId?: string | null;
  durationMinutes?: number | null;
};

export type AppleCalendarFollowUpEventDraft = {
  title: string;
  notes: string;
  url: string;
  start: Date;
  end: Date;
  alertMinutesBefore: number;
};

function clean(value?: string | null): string {
  return String(value || '').trim();
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function normalizeDurationMinutes(value?: number | null): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.round(Number(value))
    : DEFAULT_EVENT_LENGTH_MINUTES;
}

function appleScriptDateAssignment(variableName: string, date: Date): string {
  return `
    set ${variableName} to (current date)
    set year of ${variableName} to ${date.getFullYear()}
    set month of ${variableName} to ${date.getMonth() + 1}
    set day of ${variableName} to ${date.getDate()}
    set hours of ${variableName} to ${date.getHours()}
    set minutes of ${variableName} to ${date.getMinutes()}
    set seconds of ${variableName} to 0
  `;
}

export function buildAppleCalendarFollowUpEventDraft(
  input: AppleCalendarFollowUpInput,
): AppleCalendarFollowUpEventDraft {
  const contactName = clean(input.contactName) || 'Client';
  const athleteName = clean(input.athleteName);
  const phone = clean(input.phone);
  const contactId = clean(input.contactId);
  const athleteMainId = clean(input.athleteMainId);
  const durationMinutes = normalizeDurationMinutes(input.durationMinutes);
  const url = contactId ? buildReminderAdminUrl(contactId, athleteMainId) : '';
  const notes = [`SA:${athleteName} - ${phone}`, url].filter(Boolean).join('\n');

  return {
    title: `Follow Up: ${contactName}`,
    notes,
    url,
    start: input.start,
    end: addMinutes(input.start, durationMinutes),
    alertMinutesBefore: DEFAULT_ALERT_MINUTES_BEFORE,
  };
}

export async function createAppleCalendarFollowUpEvent(
  input: AppleCalendarFollowUpInput,
): Promise<string> {
  const event = buildAppleCalendarFollowUpEventDraft(input);
  const script = `
    set preferredCalendarName to "${escapeAppleScript(PREFERRED_CALENDAR_NAME)}"
    set eventTitle to "${escapeAppleScript(event.title)}"
    set eventNotes to "${escapeAppleScript(event.notes)}"
    set eventUrl to "${escapeAppleScript(event.url)}"
    set alertOffset to -${event.alertMinutesBefore}
    ${appleScriptDateAssignment('eventStart', event.start)}
    ${appleScriptDateAssignment('eventEnd', event.end)}

    tell application "Calendar"
      set targetCalendar to missing value
      repeat with candidateCalendar in calendars
        try
          if (name of candidateCalendar as text) is preferredCalendarName and (writable of candidateCalendar as boolean) then
            set targetCalendar to candidateCalendar
            exit repeat
          end if
        end try
      end repeat

      if targetCalendar is missing value then
        repeat with candidateCalendar in calendars
          try
            if (writable of candidateCalendar as boolean) then
              set targetCalendar to candidateCalendar
              exit repeat
            end if
          end try
        end repeat
      end if

      if targetCalendar is missing value then error "No writable Calendar was found."

      set createdEvent to make new event at end of events of targetCalendar with properties {summary:eventTitle, start date:eventStart, end date:eventEnd}
      if eventNotes is not "" then set description of createdEvent to eventNotes
      if eventUrl is not "" then
        try
          set url of createdEvent to eventUrl
        end try
      end if
      tell createdEvent to make new display alarm at end of display alarms with properties {trigger interval:alertOffset}
      return uid of createdEvent
    end tell
  `;

  return runAppleScript(script);
}
