const DISPLAY_PREFIX_PATTERN = /^\((?:acf\*?2?|cf|rsp|can|fu|cl|ns|\*)\)\s*/i;

export function cleanMeetingTitle(title) {
  return String(title || '').replace(DISPLAY_PREFIX_PATTERN, '').trim();
}

export function parseCachedEasternInstant(value) {
  const parsed = new Date(String(value || '').trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() - 5 * 60 * 60 * 1000);
}

export function getCurrentCachedEasternClock(now = new Date()) {
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

export function isCurrentCachedMeeting(value, week = 'this', now = new Date()) {
  if (week !== 'this') return true;
  const meetingDate = parseCachedEasternInstant(value);
  if (!meetingDate) return false;
  return meetingDate.getTime() >= getCurrentCachedEasternClock(now).getTime();
}
