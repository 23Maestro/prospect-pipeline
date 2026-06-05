const DISPLAY_PREFIX_PATTERN = /^\((?:acf\*?2?|cf|rsp|can|fu|cl|ns|\*)\)\s*/i;

export function cleanMeetingTitle(title) {
  return String(title || '').replace(DISPLAY_PREFIX_PATTERN, '').trim();
}

export function parseCachedMeetingInstant(value) {
  const parsed = new Date(String(value || '').trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function getCurrentCachedMeetingClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute)));
}

export function isCurrentCachedMeeting(value, week = 'this', now = new Date(), endValue = null) {
  if (week !== 'this') return true;
  const meetingDate = parseCachedMeetingInstant(value);
  if (!meetingDate) return false;
  const meetingEnd = parseCachedMeetingInstant(endValue);
  const endTime = meetingEnd?.getTime() || meetingDate.getTime() + 60 * 60_000;
  return endTime > now.getTime();
}

const ACTIVE_SET_MEETING_APPOINTMENT_STATUSES = new Set([
  'scheduled',
  'confirmation_queued',
  'confirmation_sent',
  'rescheduled',
]);

export function isActiveSetMeetingAppointmentStatus(status) {
  return ACTIVE_SET_MEETING_APPOINTMENT_STATUSES.has(String(status || '').trim().toLowerCase());
}

export function filterActiveSetMeetingEvents(events, appointmentsById = {}) {
  return (Array.isArray(events) ? events : []).filter((event) => {
    const appointmentId = String(event?.appointment_id || event?.key || '').trim();
    if (!appointmentId) return false;
    const appointment = appointmentsById instanceof Map
      ? appointmentsById.get(appointmentId)
      : appointmentsById[appointmentId];
    return (
      isActiveSetMeetingAppointmentStatus(appointment?.status) &&
      !String(appointment?.post_meeting_result || appointment?.postMeetingResult || '').trim()
    );
  });
}
