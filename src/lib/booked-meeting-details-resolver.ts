import {
  fetchAthleteBookedMeetings,
  fetchBookedMeetingDetails,
  easternLocalIsoToDate,
  type AthleteBookedMeetingsResponse,
  type BookedMeetingDetailsResponse,
  type BookedMeetingEvent,
} from './head-scout-schedules';

export type ResolvedBookedMeetingDetails = {
  bookedMeeting: BookedMeetingEvent;
  title: string;
  description: string | null;
  eventDate: string | null;
  formData: Record<string, string>;
  meetingName: string | null;
  meetingTimezone: string | null;
  assignedTo: string | null;
  openEventId: string | null;
  startTime: string | null;
  meetingLength: string | null;
};

type ResolverDependencies = {
  fetchAthleteBookedMeetings?: typeof fetchAthleteBookedMeetings;
  fetchBookedMeetingDetails?: typeof fetchBookedMeetingDetails;
  getCachedMeetingDescription?: (args: {
    athleteId: string;
    athleteMainId: string;
    eventId: string;
  }) => Promise<string | null>;
};

export function getBookedMeetingEventDate(meeting?: BookedMeetingEvent | null): string | null {
  return String(meeting?.start || '').split('T')[0] || null;
}

export function selectCurrentBookedMeeting(
  events: BookedMeetingEvent[],
  now = new Date(),
): BookedMeetingEvent | null {
  const sorted = [...events]
    .filter((event) =>
      Boolean(
        String(event.start || '').trim() ||
        String(event.date_time_label || '').trim() ||
        String(event.event_id || '').trim(),
      ),
    )
    .sort((left, right) =>
      String(left.start || left.date_time_label || left.event_id || '').localeCompare(
        String(right.start || right.date_time_label || right.event_id || ''),
      ),
    );
  if (!sorted.length) return null;

  return (
    sorted.find((event) => {
      const meetingDate = easternLocalIsoToDate(String(event.start || ''));
      return Boolean(meetingDate && meetingDate.getTime() >= now.getTime());
    }) ||
    sorted[sorted.length - 1] ||
    null
  );
}

function normalizeFormData(
  formData?: BookedMeetingDetailsResponse['form_data'],
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(formData || {})) {
    output[key] = String(value ?? '').trim();
  }
  return output;
}

function firstValue(formData: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = String(formData[key] || '').trim();
    if (value) return value;
  }
  return null;
}

function buildResolvedMeetingDetails(args: {
  bookedMeeting: BookedMeetingEvent;
  eventDate: string | null;
  title: string;
  description: string | null;
  formData?: BookedMeetingDetailsResponse['form_data'];
}): ResolvedBookedMeetingDetails {
  const formData = normalizeFormData(args.formData);
  const formDescription = firstValue(formData, ['taskdescription', 'task_description']);
  return {
    bookedMeeting: args.bookedMeeting,
    title: args.title,
    description: args.description || formDescription,
    eventDate: args.eventDate,
    formData,
    meetingName: firstValue(formData, ['tasktitle']) || args.title || null,
    meetingTimezone: firstValue(formData, ['meetingtimezone', 'recruittimezone']),
    assignedTo: firstValue(formData, ['assignedto', 'assigned_to', 'meetingfor']),
    openEventId:
      firstValue(formData, ['openeventid', 'open_event_id', 'existingtask']) ||
      String(args.bookedMeeting.event_id || '').trim() ||
      null,
    startTime: firstValue(formData, ['starttime', 'start_time']),
    meetingLength: firstValue(formData, ['meetinglength', 'meeting_length']),
  };
}

export async function resolveBookedMeetingDetailsForForm(
  args: {
    athleteId?: string | null;
    athleteMainId?: string | null;
    initialBookedMeeting?: BookedMeetingEvent | null;
    fallbackEvents?: BookedMeetingEvent[];
  },
  dependencies: ResolverDependencies = {},
): Promise<ResolvedBookedMeetingDetails | null> {
  const athleteId = String(args.athleteId || '').trim();
  const athleteMainId = String(args.athleteMainId || '').trim();
  const fetchMeetings = dependencies.fetchAthleteBookedMeetings || fetchAthleteBookedMeetings;
  const fetchDetails = dependencies.fetchBookedMeetingDetails || fetchBookedMeetingDetails;

  let bookedMeeting =
    args.initialBookedMeeting ||
    selectCurrentBookedMeeting(Array.isArray(args.fallbackEvents) ? args.fallbackEvents : []);

  if (!bookedMeeting && athleteId && athleteMainId) {
    try {
      const response: AthleteBookedMeetingsResponse = await fetchMeetings({
        athleteId,
        athleteMainId,
      });
      bookedMeeting = selectCurrentBookedMeeting(response.events || []);
    } catch {
      bookedMeeting = null;
    }
  }

  if (!bookedMeeting) {
    return null;
  }

  const eventDate = getBookedMeetingEventDate(bookedMeeting);
  const fallbackDescription = String(bookedMeeting.description || '').trim() || null;
  const getCachedDescription = async () => {
    if (!dependencies.getCachedMeetingDescription || !bookedMeeting.event_id) return null;
    return (
      String(
        (await dependencies.getCachedMeetingDescription({
          athleteId,
          athleteMainId,
          eventId: bookedMeeting.event_id,
        })) || '',
      ).trim() || null
    );
  };

  if (!bookedMeeting.event_id || !eventDate) {
    return buildResolvedMeetingDetails({
      bookedMeeting,
      title: String(bookedMeeting.title || '').trim(),
      description: fallbackDescription || (await getCachedDescription()),
      eventDate,
    });
  }

  try {
    const details: BookedMeetingDetailsResponse = await fetchDetails({
      eventId: bookedMeeting.event_id,
      eventDate,
    });
    return buildResolvedMeetingDetails({
      bookedMeeting,
      title: String(details.title || bookedMeeting.title || '').trim(),
      description:
        String(details.description || '').trim() ||
        fallbackDescription ||
        (await getCachedDescription()),
      eventDate,
      formData: details.form_data,
    });
  } catch {
    return buildResolvedMeetingDetails({
      bookedMeeting,
      title: String(bookedMeeting.title || '').trim(),
      description: fallbackDescription || (await getCachedDescription()),
      eventDate,
    });
  }
}
