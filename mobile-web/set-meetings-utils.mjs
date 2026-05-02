const TERMINAL_MEETING_PREFIX_PATTERN = /^\((?:rsp|can|fu|cl|ns|\*)\)/i;
const DISPLAY_PREFIX_PATTERN = /^\((?:acf\*?2?|cf|rsp|can|fu|cl|ns|\*)\)\s*/i;

export function cleanMeetingTitle(title) {
  return String(title || '').replace(DISPLAY_PREFIX_PATTERN, '').trim();
}

export function isActualSetMeetingEvent(event) {
  const title = String(event?.title || '').trim();
  if (!title) return false;
  if (title.toLowerCase().startsWith('follow up -')) return false;
  return !TERMINAL_MEETING_PREFIX_PATTERN.test(title);
}
