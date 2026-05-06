import {
  getActiveOperator,
  resolveOwnerByName,
  type ActiveOperatorContext,
  type OwnerKey,
} from './owners';

export const PENDING_CLIENT_WATCH_WINDOW_DAYS = 14;
export const PENDING_CLIENT_LIST_LIMIT = 5;

export type PendingClientAIVerdict = 'pending_client';
export type PendingClientWatchlistStatus = 'watching' | 'resolved' | 'expired';

export type PendingClientEventInput = {
  event_id?: string | number | null;
  title?: string | null;
  assigned_owner?: string | null;
  start?: string | null;
  end?: string | null;
  date_time_label?: string | null;
};

export type PendingClientOwnerSnapshot = {
  head_scout: string | null;
  head_scout_key: OwnerKey | null;
  calendar_owner_id: string | null;
  detected_by_operator: string;
  detected_by_operator_key: OwnerKey;
  owner_context: {
    active_operator_name: string;
    active_operator_key: OwnerKey;
    head_scout_name: string | null;
    head_scout_key: OwnerKey | null;
    calendar_owner_id: string | null;
  };
};

export type PendingClientResolvedPatch = {
  status: 'resolved';
  resolved_by_operator: string;
  resolved_by_operator_key: OwnerKey;
  resolved_at: string;
};

export type PendingClientWatchlistRow = PendingClientOwnerSnapshot & {
  source_event_id: string;
  athlete_id: string | null;
  athlete_main_id: string | null;
  athlete_name: string | null;
  resolved_by_operator?: string | null;
  resolved_by_operator_key?: OwnerKey | null;
  event_title: string;
  event_start: string;
  event_end: string | null;
  description: string;
  matched_signals: string[];
  ai_verdict: PendingClientAIVerdict;
  status: PendingClientWatchlistStatus;
  first_seen_at: string;
  last_seen_at: string;
  expires_at: string;
  resolved_at?: string | null;
};

const SIGNALS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'coming aboard', pattern: /\bcoming\s+aboard\b/i },
  { label: 'full payment', pattern: /\bfull\s+payment\b/i },
  { label: 'upgrade', pattern: /\bupgrade\b/i },
  { label: 'discount', pattern: /\bdiscount\b/i },
  { label: 'pay', pattern: /\bpay(?:ing)?\b/i },
  { label: 'payment', pattern: /\bpayments?\b/i },
  { label: 'enroll', pattern: /\benroll(?:ing|ment|ed)?\b/i },
  { label: '$', pattern: /\$\s*\d+/ },
  { label: 'package', pattern: /\bpackages?\b/i },
  { label: 'invoice', pattern: /\binvoices?\b/i },
  { label: 'post date', pattern: /\bpost\s+date\b/i },
];

const SPORT_BOUNDARY_PATTERN =
  /\b(?:football|baseball|softball|men'?s basketball|women'?s basketball|basketball|women'?s soccer|men'?s soccer|soccer|volleyball|lacrosse|track|wrestling|golf|tennis)\b/i;

function normalizeText(value?: string | number | null): string {
  return String(value || '').trim();
}

function localStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function utcFromLegacyLocal(value: string): string {
  const trimmed = normalizeText(value);
  if (!trimmed) return new Date().toISOString();
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed}:00.000Z`
    : trimmed;
  const parsed = new Date(withSeconds);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function isPendingClientFollowUpTitle(title?: string | null): boolean {
  const trimmed = normalizeText(title);
  return /^Follow Up -/i.test(trimmed) || /^\(FU\)(?:\*\d+)?\s*/i.test(trimmed);
}

export function filterPendingClientCandidateEvents<T extends PendingClientEventInput>(
  events: T[],
  now = new Date(),
): T[] {
  const start = new Date(now);
  start.setDate(start.getDate() - PENDING_CLIENT_WATCH_WINDOW_DAYS);
  start.setHours(0, 0, 0, 0);
  const minStamp = localStamp(start);
  const maxStamp = localStamp(now);

  return (Array.isArray(events) ? events : [])
    .filter((event) => {
      const startValue = normalizeText(event.start);
      return (
        isPendingClientFollowUpTitle(event.title) &&
        Boolean(normalizeText(event.event_id)) &&
        startValue >= minStamp &&
        startValue <= maxStamp
      );
    })
    .sort((left, right) => normalizeText(right.start).localeCompare(normalizeText(left.start)));
}

export function buildPendingClientScanWindow(now = new Date()): { start: string; end: string } {
  const start = new Date(now);
  start.setDate(start.getDate() - PENDING_CLIENT_WATCH_WINDOW_DAYS);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setDate(end.getDate() + 1);
  end.setHours(0, 0, 0, 0);

  return {
    start: localStamp(start).slice(0, 10),
    end: localStamp(end).slice(0, 10),
  };
}

export function findPendingClientSignals(description?: string | null): string[] {
  const text = normalizeText(description);
  if (!text) return [];
  return SIGNALS.filter((signal) => signal.pattern.test(text)).map((signal) => signal.label);
}

export function normalizePendingClientAIVerdict(
  value?: string | null,
): PendingClientAIVerdict | null {
  return normalizeText(value).toLowerCase() === 'pending_client' ? 'pending_client' : null;
}

export function cleanPendingClientAthleteName(title?: string | null): string {
  const cleaned = normalizeText(title)
    .replace(/^Follow Up -\s*/i, '')
    .replace(/^\(FU\)(?:\*\d+)?\s*/i, '')
    .trim();
  const sportMatch = cleaned.match(SPORT_BOUNDARY_PATTERN);
  return (sportMatch ? cleaned.slice(0, sportMatch.index).trim() : cleaned).replace(/\s+/g, ' ');
}

export function pendingClientExpiresAt(eventStart?: string | null): string {
  const base = new Date(utcFromLegacyLocal(normalizeText(eventStart)));
  base.setUTCDate(base.getUTCDate() + PENDING_CLIENT_WATCH_WINDOW_DAYS);
  return base.toISOString();
}

export function buildPendingClientOwnerSnapshot(args: {
  assignedOwner?: string | null;
  activeOperator?: ActiveOperatorContext;
}): PendingClientOwnerSnapshot {
  const activeOperator = args.activeOperator || getActiveOperator();
  const headScout = resolveOwnerByName(args.assignedOwner);
  const headScoutName = normalizeText(args.assignedOwner) || headScout?.personName || null;

  return {
    head_scout: headScoutName,
    head_scout_key: headScout?.ownerKey || null,
    calendar_owner_id: headScout?.calendarOwnerId || null,
    detected_by_operator: activeOperator.personName,
    detected_by_operator_key: activeOperator.operatorKey,
    owner_context: {
      active_operator_name: activeOperator.personName,
      active_operator_key: activeOperator.operatorKey,
      head_scout_name: headScoutName,
      head_scout_key: headScout?.ownerKey || null,
      calendar_owner_id: headScout?.calendarOwnerId || null,
    },
  };
}

export function buildPendingClientResolvedPatch(
  activeOperator: ActiveOperatorContext = getActiveOperator(),
  now = new Date(),
): PendingClientResolvedPatch {
  return {
    status: 'resolved',
    resolved_by_operator: activeOperator.personName,
    resolved_by_operator_key: activeOperator.operatorKey,
    resolved_at: now.toISOString(),
  };
}

export function buildPendingClientWatchlistRow(args: {
  event: PendingClientEventInput;
  description: string;
  matchedSignals: string[];
  aiVerdict: PendingClientAIVerdict;
  athleteId?: string | null;
  athleteMainId?: string | null;
  athleteName?: string | null;
  now?: Date;
  activeOperator?: ActiveOperatorContext;
}): PendingClientWatchlistRow {
  const eventId = normalizeText(args.event.event_id);
  const eventTitle = normalizeText(args.event.title);
  const eventStart = normalizeText(args.event.start);
  const nowIso = (args.now || new Date()).toISOString();

  return {
    source_event_id: eventId,
    athlete_id: normalizeText(args.athleteId) || null,
    athlete_main_id: normalizeText(args.athleteMainId) || null,
    athlete_name:
      normalizeText(args.athleteName) || cleanPendingClientAthleteName(eventTitle) || null,
    ...buildPendingClientOwnerSnapshot({
      assignedOwner: args.event.assigned_owner,
      activeOperator: args.activeOperator,
    }),
    event_title: eventTitle,
    event_start: eventStart,
    event_end: normalizeText(args.event.end) || null,
    description: args.description,
    matched_signals: args.matchedSignals,
    ai_verdict: args.aiVerdict,
    status: 'watching',
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    expires_at: pendingClientExpiresAt(eventStart),
    resolved_at: null,
  };
}
