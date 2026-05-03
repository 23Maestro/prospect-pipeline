const DISPLAY_PREFIX_PATTERN = /^\((?:acf\*?2?|cf|rsp|can|fu|cl|ns|\*)\)\s*/i;

export function cleanMeetingTitle(title) {
  return String(title || '').replace(DISPLAY_PREFIX_PATTERN, '').trim();
}
