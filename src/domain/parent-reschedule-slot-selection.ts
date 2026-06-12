export type ParentRescheduleSlotCandidate = {
  id: string;
  scoutName: string;
  messageLabel: string;
  weekLabel: string;
  weekOffset: number;
  start: string;
  end: string;
  openEventId: string;
  isPreviousScout: boolean;
};

export type ParentRescheduleSlotSelectionInput = {
  slots: ParentRescheduleSlotCandidate[];
  previousHeadScoutName?: string | null;
  now?: Date;
  maxOptions?: number;
};

function normalizeNameKey(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function easternWeekPressure(now = new Date()): 'early_week' | 'late_week' {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
  const hour = Number.parseInt(parts.find((part) => part.type === 'hour')?.value || '0', 10);
  const weekdayIndex: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const day = weekdayIndex[weekday] ?? 0;
  if (day > 3 || day === 0 || day === 6) return 'late_week';
  if (day === 3 && hour >= 19) return 'late_week';
  return 'early_week';
}

function byStart(left: ParentRescheduleSlotCandidate, right: ParentRescheduleSlotCandidate): number {
  return left.start.localeCompare(right.start);
}

export function selectParentRescheduleSlots({
  slots,
  previousHeadScoutName,
  now = new Date(),
  maxOptions = 3,
}: ParentRescheduleSlotSelectionInput): ParentRescheduleSlotCandidate[] {
  const limit = Math.max(0, maxOptions);
  if (!limit) return [];

  const previousScout = normalizeNameKey(previousHeadScoutName);
  const ranked = [...slots];
  const selected: ParentRescheduleSlotCandidate[] = [];
  const selectedIds = new Set<string>();

  function add(candidate?: ParentRescheduleSlotCandidate) {
    if (!candidate || selected.length >= limit || selectedIds.has(candidate.id)) return;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }

  function isPreviousScout(candidate: ParentRescheduleSlotCandidate): boolean {
    return Boolean(
      candidate.isPreviousScout ||
        (previousScout && normalizeNameKey(candidate.scoutName) === previousScout),
    );
  }

  const currentWeek = ranked.filter((candidate) => candidate.weekOffset === 0).sort(byStart);
  const previousScoutRanked = ranked.filter(isPreviousScout);
  const nextWeekPreviousScout = previousScoutRanked.filter((candidate) => candidate.weekOffset > 0);

  if (easternWeekPressure(now) === 'late_week') {
    add(nextWeekPreviousScout[0]);
    add(nextWeekPreviousScout[1]);
    add(previousScoutRanked[0]);
  } else {
    add(currentWeek[0]);
    add(previousScoutRanked[0]);
    add(currentWeek.find((candidate) => !isPreviousScout(candidate)));
  }

  for (const candidate of ranked) {
    add(candidate);
  }

  return selected;
}
