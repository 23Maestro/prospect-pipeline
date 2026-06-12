import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  resolveEventsTabMeetingForReschedule,
  resolveBookedMeetingDetailsForForm,
  type ResolvedBookedMeetingDetails,
} from './booked-meeting-details-resolver';
import type {
  AthleteBookedMeetingsResponse,
  BookedMeetingDetailsResponse,
  BookedMeetingEvent,
} from './head-scout-schedules';

const source = readFileSync(new URL('./booked-meeting-details-resolver.ts', import.meta.url), 'utf8');

function bookedMeeting(overrides: Partial<BookedMeetingEvent> = {}): BookedMeetingEvent {
  return {
    event_id: 'evt_1',
    title: 'Jonathan Van Roekel Football 2027 IA',
    assigned_owner: 'James Holcomb',
    start: '2026-05-22T20:00:00',
    end: '2026-05-22T21:00:00',
    date_time_label: 'Fri 05/22/26 08:00 PM',
    description: 'Eventlist fallback description',
    ...overrides,
  };
}

function details(
  overrides: Partial<BookedMeetingDetailsResponse> = {},
): BookedMeetingDetailsResponse {
  return {
    success: true,
    event_id: 'evt_1',
    title: 'Popup title',
    description: 'Popup saved Laravel description',
    form_data: {},
    ...overrides,
  };
}

function meetingsResponse(events: BookedMeetingEvent[]): AthleteBookedMeetingsResponse {
  return {
    success: true,
    athlete_id: '1489000',
    athlete_main_id: '951000',
    count: events.length,
    events,
  };
}

test('explicit booked meeting uses popup description as source of truth', async () => {
  const result = await resolveBookedMeetingDetailsForForm(
    {
      athleteId: '1489000',
      athleteMainId: '951000',
      initialBookedMeeting: bookedMeeting({ description: 'Stale eventlist description' }),
    },
    {
      fetchBookedMeetingDetails: async () => details(),
    },
  );

  assert.equal(result?.bookedMeeting.event_id, 'evt_1');
  assert.equal(result?.title, 'Popup title');
  assert.equal(result?.description, 'Popup saved Laravel description');
  assert.equal(result?.eventDate, '2026-05-22');
});

test('popup form data hydrates previous meeting-set payload fields', async () => {
  const result = await resolveBookedMeetingDetailsForForm(
    {
      initialBookedMeeting: bookedMeeting(),
    },
    {
      fetchBookedMeetingDetails: async () =>
        details({
          form_data: {
            tasktitle: 'Existing Meeting Title',
            meetingtimezone: 'CST',
            assignedto: '1418529',
            openeventid: '613999',
            starttime: '20:00',
            meetinglength: '01:30',
            taskdescription: 'Existing payload description',
          },
        }),
    },
  );

  assert.equal(result?.meetingName, 'Existing Meeting Title');
  assert.equal(result?.meetingTimezone, 'CST');
  assert.equal(result?.assignedTo, '1418529');
  assert.equal(result?.openEventId, '613999');
  assert.equal(result?.startTime, '20:00');
  assert.equal(result?.meetingLength, '01:30');
});

test('uses booked event start time when popup form start time is missing', async () => {
  const result = await resolveBookedMeetingDetailsForForm(
    {
      initialBookedMeeting: bookedMeeting({ start: '2026-05-22T20:00:00' }),
    },
    {
      fetchBookedMeetingDetails: async () =>
        details({
          form_data: {
            tasktitle: 'Existing Meeting Title',
            assignedto: '1418529',
            openeventid: '613999',
            meetinglength: '01:00',
          },
        }),
    },
  );

  assert.equal(result?.startTime, '20:00');
});

test('fetches current booked meeting when none is supplied', async () => {
  const past = bookedMeeting({
    event_id: 'evt_past',
    start: '2000-05-20T20:00:00',
    end: '2000-05-20T21:00:00',
  });
  const future = bookedMeeting({
    event_id: 'evt_future',
    start: '2099-05-23T20:00:00',
    end: '2099-05-23T21:00:00',
    description: null,
  });
  let requestedDetailsEventId = '';
  const result = await resolveBookedMeetingDetailsForForm(
    {
      athleteId: '1489000',
      athleteMainId: '951000',
    },
    {
      fetchAthleteBookedMeetings: async () => meetingsResponse([past, future]),
      fetchBookedMeetingDetails: async ({ eventId }) => {
        requestedDetailsEventId = eventId;
        return details({ event_id: eventId, description: 'Future popup description' });
      },
    },
  );

  assert.equal(result?.bookedMeeting.event_id, 'evt_future');
  assert.equal(requestedDetailsEventId, 'evt_future');
  assert.equal(result?.description, 'Future popup description');
});

test('resolves booked meeting rows that only have eventlist labels', async () => {
  const eventlistOnly = bookedMeeting({
    event_id: 'evt_label_only',
    start: '',
    end: '',
    assigned_owner: 'Ryan Lietz',
    date_time_label: 'Mon 06/01/26 06:00 PM',
    description: 'Eventlist-only description',
  });
  let requestedDetailsEventId = '';

  const result = await resolveBookedMeetingDetailsForForm(
    {
      athleteId: '1489000',
      athleteMainId: '951000',
    },
    {
      fetchAthleteBookedMeetings: async () => meetingsResponse([eventlistOnly]),
    },
  );

  assert.equal(result?.bookedMeeting.event_id, 'evt_label_only');
  assert.equal(result?.bookedMeeting.assigned_owner, 'Ryan Lietz');
  assert.equal(result?.description, 'Eventlist-only description');
});

test('reschedule can hydrate the previous Events tab meeting when Scout Prep has no prior event id', async () => {
  const visibleEventsTabMeeting = bookedMeeting({
    event_id: '628744',
    title: '(ACF*2) Joziah Zenobia Football 2030 WI',
    assigned_owner: 'David Foley',
    start: '2026-06-11T21:00:00',
    end: '2026-06-11T22:00:00',
    description: 'Main Number: (262) 420-7303',
  });

  const result = await resolveEventsTabMeetingForReschedule(
    {
      athleteId: '1499999',
      athleteMainId: '953999',
      eventId: null,
    },
    {
      fetchAthleteBookedMeetings: async () => meetingsResponse([visibleEventsTabMeeting]),
    },
  );

  assert.equal(result.event_id, '628744');
  assert.equal(result.title, '(ACF*2) Joziah Zenobia Football 2030 WI');
  assert.equal(result.description, 'Main Number: (262) 420-7303');
});

test('falls back to booked event description when popup fetch fails', async () => {
  const result = await resolveBookedMeetingDetailsForForm(
    {
      initialBookedMeeting: bookedMeeting({ description: 'Preserved event description' }),
    },
    {
      fetchBookedMeetingDetails: async () => {
        throw new Error('popup unavailable');
      },
    },
  );

  assert.equal(result?.description, 'Preserved event description');
  assert.equal(result?.title, 'Jonathan Van Roekel Football 2027 IA');
});

test('uses cached meeting description when Laravel drops popup and eventlist details', async () => {
  const result = await resolveBookedMeetingDetailsForForm(
    {
      initialBookedMeeting: bookedMeeting({ description: '' }),
    },
    {
      fetchBookedMeetingDetails: async () => details({ description: '' }),
      getCachedMeetingDescription: async () => 'Cached RSP meeting description',
    },
  );

  assert.equal(result?.description, 'Cached RSP meeting description');
});

test('returns null when no booked meeting can be resolved', async () => {
  const result: ResolvedBookedMeetingDetails | null = await resolveBookedMeetingDetailsForForm(
    {
      athleteId: '1489000',
      athleteMainId: '951000',
    },
    {
      fetchAthleteBookedMeetings: async () => meetingsResponse([]),
    },
  );

  assert.equal(result, null);
});

test('reschedule resolution reads appointment truth before Laravel booked meetings', async () => {
  let laravelBookedMeetingsCalled = false;
  const result = await resolveBookedMeetingDetailsForForm(
    {
      athleteId: '1497516',
      athleteMainId: '953605',
      source: 'appointment_truth',
    },
    {
      fetchAthleteBookedMeetings: async () => {
        laravelBookedMeetingsCalled = true;
        return meetingsResponse([
          bookedMeeting({
            event_id: 'laravel-stale',
            assigned_owner: 'Wrong Scout',
            start: '2026-05-29T20:00:00',
          }),
        ]);
      },
      fetchAppointmentTruth: async () => ({
        resolved_appointment_id: '613339',
        current_source_event_id: '613339',
        current_starts_at: '2026-05-28T21:00:00+00:00',
        current_meeting_timezone: 'America/Chicago',
        current_meeting_timezone_label: 'CST',
        current_head_scout: 'Luther Winfield',
        current_appointment_status: 'reschedule_pending',
      }),
    },
  );

  assert.equal(result?.bookedMeeting.event_id, '613339');
  assert.equal(result?.bookedMeeting.assigned_owner, 'Luther Winfield');
  assert.equal(result?.bookedMeeting.start, '2026-05-28T17:00');
  assert.equal(result?.bookedMeeting.end, '2026-05-28T18:00');
  assert.equal(result?.meetingTimezone, 'America/Chicago');
  assert.equal(result?.openEventId, '613339');
  assert.equal(laravelBookedMeetingsCalled, false);
});

test('latest appointment resolution returns terminal appointment context for outreach reschedules', async () => {
  let activeTruthCalled = false;
  const result = await resolveBookedMeetingDetailsForForm(
    {
      athleteId: '1498390',
      athleteMainId: '953647',
      source: 'latest_appointment_truth',
    },
    {
      fetchAppointmentTruth: async () => {
        activeTruthCalled = true;
        return null;
      },
      fetchLatestAppointmentTruth: async () => ({
        id: '588033',
        source_event_id: '588033',
        starts_at: '2026-05-31T16:00:00+00:00',
        meeting_timezone: 'America/New_York',
        meeting_timezone_label: 'EDT',
        head_scout: 'Ryan Lietz',
        status: 'no_show',
      }),
    },
  );

  assert.equal(result?.bookedMeeting.event_id, '588033');
  assert.equal(result?.bookedMeeting.assigned_owner, 'Ryan Lietz');
  assert.equal(result?.bookedMeeting.start, '2026-05-31T12:00');
  assert.equal(result?.meetingTimezone, 'America/New_York');
  assert.equal(activeTruthCalled, false);
});

test('appointment id resolution reads the appointments domain row directly', async () => {
  let activeTruthCalled = false;
  const result = await resolveBookedMeetingDetailsForForm(
    {
      athleteId: '1497516',
      athleteMainId: '953605',
      appointmentId: '628999',
    },
    {
      fetchAppointmentById: async (appointmentId) => ({
        id: String(appointmentId),
        source_event_id: '628999',
        athlete_name: "R'mani Wright",
        starts_at: '2026-05-27T01:00:00+00:00',
        meeting_timezone: 'America/Chicago',
        meeting_timezone_label: 'CST',
        head_scout: 'James Holcomb',
        status: 'reschedule_pending',
      }),
      fetchAppointmentTruth: async () => {
        activeTruthCalled = true;
        return null;
      },
    },
  );

  assert.equal(result?.bookedMeeting.event_id, '628999');
  assert.equal(result?.bookedMeeting.assigned_owner, 'James Holcomb');
  assert.equal(result?.bookedMeeting.start, '2026-05-26T21:00');
  assert.equal(result?.meetingTimezone, 'America/Chicago');
  assert.equal(activeTruthCalled, false);
});

test('appointment truth resolver reads canonical appointments instead of active meeting projection', () => {
  assert.match(source, /rest\/v1\/appointments/);
  assert.match(source, /ACTIVE_APPOINTMENT_STATUSES/);
  assert.doesNotMatch(source, /rest\/v1\/active_athlete_meeting_truth/);
});
