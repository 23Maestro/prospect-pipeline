import {
  getActiveOperator,
  resolveOwnerByName,
  type ActiveOperatorContext,
  type OwnerKey,
} from './owners';
import { resolveSalesLifecycle } from '../lib/sales-lifecycle';

export const PENDING_CLIENT_WATCH_WINDOW_DAYS = 14;
export const PENDING_CLIENT_LIST_LIMIT = 20;

export type PendingClientAIVerdict = 'pending_client';
export type PendingClientWatchlistStatus = 'watching' | 'resolved' | 'expired';
export type PendingClientActionTag =
  | 'Operator Input'
  | 'Scout Update'
  | 'Payment Watch'
  | 'Missing Notes';

export type PendingClientEventInput = {
  event_id?: string | number | null;
  title?: string | null;
  assigned_owner?: string | null;
  start?: string | null;
  end?: string | null;
  date_time_label?: string | null;
  description?: string | null;
};

export type PendingClientNoteInput = {
  title?: string | null;
  description?: string | null;
  metadata?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

export type SetMeetingConfirmationCacheRowInput = {
  appointment_id?: string | null;
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  athlete_name?: string | null;
  head_scout_name?: string | null;
  meeting_starts_at?: string | null;
  meeting_ends_at?: string | null;
  meeting_duration_minutes?: number | null;
  source?: string | null;
  kind?: string | null;
  status?: string | null;
  message_body?: string | null;
  payload_json?: Record<string, unknown> | null;
};

export type ReadySetMeetingConfirmationGroup = {
  appointmentId: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  headScoutName: string | null;
  meetingStartsAt: string;
  meetingEndsAt: string;
  rows: SetMeetingConfirmationCacheRowInput[];
};

export type PendingClientLifecycleDecision = {
  eligible: boolean;
  normalizedStage: string;
  operatorStatus: string;
  lifecycleReason: string;
  reason: string;
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
  action_tag: PendingClientActionTag;
  ai_verdict: PendingClientAIVerdict;
  status: PendingClientWatchlistStatus;
  first_seen_at: string;
  last_seen_at: string;
  expires_at: string;
  resolved_at?: string | null;
};

export type PendingClientOperatorQueueLabel =
  | 'Needs Times'
  | 'Awaiting RSP'
  | 'Review Reply'
  | 'Needs Reply'
  | 'Timing Bad'
  | 'Timing Issue'
  | 'No Interest'
  | 'Call Back'
  | 'Operator Input'
  | 'Follow Up'
  | 'Payment'
  | 'No Note';

export type PendingClientOperatorQueueReplyEvidence = {
  themeBucket?: string | null;
  lastMeaningfulInbound?: { body?: string | null } | null;
  operatorRepliedAfterInbound?: boolean | null;
  operatorReplyProposedTimes?: boolean | null;
  clientRepliedAfterOperatorTimes?: boolean | null;
  clientOptedOut?: boolean | null;
};

export type PendingClientOperatorQueueClassification = {
  label: PendingClientOperatorQueueLabel;
  priority: number;
};

export type PendingClientCentralFilter = 'reschedule' | 'no_show' | 'payments' | 'review_follow_ups';

export type PendingClientCentralQueueClassification = {
  filter: PendingClientCentralFilter;
  label: 'RSP' | 'No Show' | 'Payments' | 'Review Follow Ups';
  actionLabel:
    | 'Offer Slots'
    | 'Awaiting Client'
    | 'Review Reply'
    | 'Needs Reply'
    | 'Review'
    | 'Bad Timing'
    | 'Payments';
  priority: number;
};

function sourceEventAppointmentId(value?: string | null): string | null {
  const source = normalizeText(value);
  if (!source) return null;
  if (source.startsWith('appointment:')) return normalizeText(source.slice('appointment:'.length)) || null;
  const tail = source.split(':').pop() || '';
  return /^\d+$/.test(tail) ? tail : null;
}

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
  { label: 'elite', pattern: /\belite\b/i },
  { label: 'icon', pattern: /\bicon\b/i },
  { label: 'premium', pattern: /\bpremium\b/i },
  { label: 'legend', pattern: /\blegend\b/i },
];

const SPORT_BOUNDARY_PATTERN =
  /\b(?:football|baseball|softball|men'?s basketball|women'?s basketball|basketball|women'?s soccer|men'?s soccer|soccer|volleyball|lacrosse|track|wrestling|golf|tennis)\b/i;

function normalizeText(value?: string | number | null): string {
  return String(value || '').trim();
}

function normalizeComparableText(value?: string | number | null): string {
  return normalizeText(value).replace(/\s+/g, ' ');
}

export function isPendingClientAthleteKeyText(value?: string | number | null): boolean {
  return /^\d+:\d+$/.test(normalizeText(value));
}

export function realPendingClientAthleteName(value?: string | number | null): string | null {
  const text = normalizeText(value);
  if (!text || isPendingClientAthleteKeyText(text)) return null;
  return text;
}

function parseDateMs(value?: string | null): number {
  const parsed = Date.parse(normalizeText(value));
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function getPayloadOperatorKey(row: SetMeetingConfirmationCacheRowInput): string {
  return normalizeText(
    String(
      row.payload_json?.active_operator_key || row.payload_json?.detected_by_operator_key || '',
    ),
  );
}

function samePendingClientAthlete(
  row: PendingClientWatchlistRow,
  confirmation: SetMeetingConfirmationCacheRowInput,
): boolean {
  const athleteId = normalizeText(row.athlete_id);
  const confirmationAthleteId = normalizeText(confirmation.athlete_id);
  const athleteMainId = normalizeText(row.athlete_main_id);
  const confirmationAthleteMainId = normalizeText(confirmation.athlete_main_id);
  if (athleteId && confirmationAthleteId && athleteId !== confirmationAthleteId) return false;
  if (athleteMainId && confirmationAthleteMainId && athleteMainId !== confirmationAthleteMainId) {
    return false;
  }
  if ((athleteId && confirmationAthleteId) || (athleteMainId && confirmationAthleteMainId)) {
    return true;
  }
  return (
    normalizeComparableText(row.athlete_name).toLowerCase() ===
    normalizeComparableText(confirmation.athlete_name).toLowerCase()
  );
}

function isMeetingRecoveryWatchRow(row: PendingClientWatchlistRow): boolean {
  const title = normalizeText(row.event_title);
  const description = normalizeText(row.description);
  return (
    /^\((?:RSP|CAN|NS)\)(?:\*\d+)?\s+/i.test(title) ||
    /\bLifecycle:\s*(?:reschedule_pending|canceled|no_show)\b/i.test(description) ||
    /\b(?:reschedule pending|rescheduled pending|canceled|no show)\b/i.test(title)
  );
}

export function isPendingClientResolvedByFutureConfirmation(
  row: PendingClientWatchlistRow,
  confirmationRows: SetMeetingConfirmationCacheRowInput[],
  now = new Date(),
): boolean {
  if (!isMeetingRecoveryWatchRow(row)) return false;

  const pendingAppointmentId = sourceEventAppointmentId(row.source_event_id);
  const pendingEventEndMs = parseDateMs(row.event_end) || parseDateMs(row.event_start);
  const nowMs = now.getTime();
  const groups = new Map<string, SetMeetingConfirmationCacheRowInput[]>();

  for (const confirmation of Array.isArray(confirmationRows) ? confirmationRows : []) {
    if (normalizeText(confirmation.source) !== 'set_meetings_confirmation') continue;
    if (normalizeText(confirmation.status) !== 'cached') continue;
    const appointmentId = normalizeText(confirmation.appointment_id);
    if (!appointmentId || appointmentId === pendingAppointmentId) continue;
    if (!samePendingClientAthlete(row, confirmation)) continue;
    groups.set(appointmentId, [...(groups.get(appointmentId) || []), confirmation]);
  }

  for (const group of groups.values()) {
    const kinds = new Set(group.map((confirmation) => normalizeText(confirmation.kind)));
    if (!kinds.has('confirmation_1') || !kinds.has('confirmation_2')) continue;
    const startsAtMs = Math.min(
      ...group.map((confirmation) => parseDateMs(confirmation.meeting_starts_at)).filter(Number.isFinite),
    );
    const endsAtMs = Math.max(
      ...group.map((confirmation) => parseDateMs(confirmation.meeting_ends_at)).filter(Number.isFinite),
    );
    if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs)) continue;
    if (Number.isFinite(pendingEventEndMs) && startsAtMs <= pendingEventEndMs) continue;
    if (endsAtMs <= nowMs) continue;
    return true;
  }

  return false;
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
  const legacyLocalMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/,
  );
  if (legacyLocalMatch) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0'] =
      legacyLocalMatch;
    const utcGuess = new Date(
      Date.UTC(
        Number.parseInt(yearText, 10),
        Number.parseInt(monthText, 10) - 1,
        Number.parseInt(dayText, 10),
        Number.parseInt(hourText, 10),
        Number.parseInt(minuteText, 10),
        Number.parseInt(secondText, 10),
      ),
    );
    const easternParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'shortOffset',
    }).formatToParts(utcGuess);
    const offsetPart = easternParts.find((part) => part.type === 'timeZoneName')?.value || '';
    const offsetMatch = offsetPart.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
    if (offsetMatch) {
      const [, sign, hoursText, minutesText = '0'] = offsetMatch;
      const offsetMinutes =
        (sign === '-' ? -1 : 1) *
        (Number.parseInt(hoursText, 10) * 60 + Number.parseInt(minutesText, 10));
      return new Date(utcGuess.getTime() - offsetMinutes * 60_000).toISOString();
    }
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function isPendingClientFollowUpTitle(title?: string | null): boolean {
  const trimmed = normalizeText(title);
  return /^Follow Up -/i.test(trimmed) || /^\(FU\)(?:\*\d+)?\s*/i.test(trimmed);
}

export function isPendingClientReviewEventTitle(title?: string | null): boolean {
  const trimmed = normalizeText(title);
  return isPendingClientFollowUpTitle(trimmed) || /\bfollow\s*up\b/i.test(trimmed);
}

export function hasStrictNoShowEvidence(args: {
  crmStage?: string | null;
  bookedEventTitle?: string | null;
}): boolean {
  if (/^\(NS\)(?:\*\d+)?\s+/i.test(normalizeText(args.bookedEventTitle))) {
    return true;
  }
  const lifecycle = resolveSalesLifecycle(args.crmStage);
  return lifecycle.normalizedStage === 'no_show';
}

export function shouldResolvePendingClientForLifecycle(args: {
  crmStage?: string | null;
  bookedEventTitle?: string | null;
}): boolean {
  const lifecycle = resolveSalesLifecycle(args.crmStage);
  return (
    hasStrictNoShowEvidence(args) ||
    lifecycle.normalizedStage === 'closed_won' ||
    lifecycle.normalizedStage === 'closed_lost' ||
    lifecycle.normalizedStage === 'inactive'
  );
}

export function classifyPendingClientLifecycle(args: {
  crmStage?: string | null;
  reviewEventTitle?: string | null;
  reviewDescription?: string | null;
}): PendingClientLifecycleDecision {
  const lifecycle = resolveSalesLifecycle(args.crmStage);
  if (
    lifecycle.normalizedStage !== 'meeting_follow_up' &&
    lifecycle.normalizedStage !== 'reschedule_pending' &&
    lifecycle.normalizedStage !== 'canceled'
  ) {
    return {
      eligible: false,
      normalizedStage: lifecycle.normalizedStage,
      operatorStatus: lifecycle.operatorStatus,
      lifecycleReason: lifecycle.reason,
      reason: `CRM lifecycle is ${lifecycle.normalizedStage}, not pending-client follow-up or reschedule.`,
    };
  }
  return {
    eligible: true,
    normalizedStage: lifecycle.normalizedStage,
    operatorStatus: lifecycle.operatorStatus,
    lifecycleReason: lifecycle.reason,
    reason:
      isPendingClientReviewEventTitle(args.reviewEventTitle) &&
      hasPendingClientWatchNote(args.reviewDescription)
        ? 'CRM lifecycle and post-meeting (FU) note identify a pending client.'
        : lifecycle.normalizedStage === 'reschedule_pending'
          ? 'CRM lifecycle identifies a reschedule-pending client; event-list note is not populated yet.'
          : 'CRM lifecycle identifies a pending client; event-list note is not populated yet.',
  };
}

export function filterReadySetMeetingConfirmationGroups(
  rows: SetMeetingConfirmationCacheRowInput[],
  args: { now?: Date; activeOperatorKey: OwnerKey | string },
): ReadySetMeetingConfirmationGroup[] {
  const nowMs = (args.now || new Date()).getTime();
  const activeOperatorKey = normalizeText(args.activeOperatorKey);
  const grouped = new Map<string, SetMeetingConfirmationCacheRowInput[]>();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (normalizeText(row.source) !== 'set_meetings_confirmation') continue;
    if (normalizeText(row.status) !== 'cached') continue;
    if (!['confirmation_1', 'confirmation_2'].includes(normalizeText(row.kind))) continue;
    const payloadOperatorKey = getPayloadOperatorKey(row);
    if (!payloadOperatorKey || payloadOperatorKey !== activeOperatorKey) continue;
    const appointmentId = normalizeText(row.appointment_id);
    if (!appointmentId) continue;
    grouped.set(appointmentId, [...(grouped.get(appointmentId) || []), row]);
  }

  return Array.from(grouped.entries()).flatMap(([appointmentId, groupRows]) => {
    const base = groupRows[0];
    const athleteId = normalizeText(base.athlete_id);
    const athleteMainId = normalizeText(base.athlete_main_id);
    const meetingStartsAt = normalizeText(base.meeting_starts_at);
    const meetingEndsAt =
      normalizeText(base.meeting_ends_at) ||
      (Number.isNaN(parseDateMs(meetingStartsAt))
        ? ''
        : new Date(parseDateMs(meetingStartsAt) + 60 * 60_000).toISOString());
    if (!athleteId || !athleteMainId || !meetingStartsAt || !meetingEndsAt) return [];
    if (parseDateMs(meetingEndsAt) > nowMs) return [];
    return [
      {
        appointmentId,
        athleteId,
        athleteMainId,
        athleteName: normalizeText(base.athlete_name),
        headScoutName: normalizeText(base.head_scout_name) || null,
        meetingStartsAt,
        meetingEndsAt,
        rows: groupRows,
      },
    ];
  });
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

function isPendingClientMeetingDescription(description?: string | null): boolean {
  const text = normalizeComparableText(description);
  return (
    /https?:\/\/(?:www\.)?maxpreps\.com/i.test(text) ||
    /\bMain Number:/i.test(text) ||
    /\bBackup Number:/i.test(text) ||
    /\bSpoke To:/i.test(text) ||
    /\bAbout The Athlete:/i.test(text) ||
    /\bOther Parent:/i.test(text)
  );
}

export function hasPendingClientWatchNote(description?: string | null): boolean {
  const text = normalizeComparableText(description);
  return (
    Boolean(text) &&
    text !== 'Date Created By Title Description' &&
    !isPendingClientMeetingDescription(text) &&
    !/^Payment Watch:\s*pending payment evidence remains active/i.test(text)
  );
}

function noteTimeValue(note: PendingClientNoteInput): number {
  const direct = parseDateMs(note.created_at);
  if (!Number.isNaN(direct)) return direct;
  const title = normalizeText(note.title);
  const match = title.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 0;
  const month = Number.parseInt(match[1], 10) - 1;
  const day = Number.parseInt(match[2], 10);
  const rawYear = Number.parseInt(match[3], 10);
  const year = match[3].length === 2 ? 2000 + rawYear : rawYear;
  let hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const meridiem = match[6].toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  const parsed = new Date(year, month, day, hour, minute).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function selectLatestPendingClientNote<T extends PendingClientNoteInput>(
  notes: T[],
): T | null {
  return (
    (Array.isArray(notes) ? notes : [])
      .filter((note) => hasPendingClientWatchNote(note.description))
      .sort((left, right) => noteTimeValue(right) - noteTimeValue(left))[0] || null
  );
}

export function selectLatestPendingClientReviewEvent<T extends PendingClientEventInput>(
  meeting: PendingClientEventInput,
  athleteEvents: T[],
): T | null {
  const meetingEnd = normalizeText(meeting.end) || normalizeText(meeting.start);
  if (!meetingEnd) return null;

  const meetingEventId = normalizeText(meeting.event_id);
  const meetingOwner = normalizeText(meeting.assigned_owner).toLowerCase();

  return (
    (Array.isArray(athleteEvents) ? athleteEvents : [])
      .filter((event) => {
        const eventId = normalizeText(event.event_id);
        const title = normalizeText(event.title);
        const owner = normalizeText(event.assigned_owner).toLowerCase();
        const start = normalizeText(event.start);
        return (
          eventId !== meetingEventId &&
          isPendingClientReviewEventTitle(title) &&
          hasPendingClientWatchNote(event.description) &&
          start > meetingEnd &&
          (!meetingOwner || owner === meetingOwner)
        );
      })
      .sort((left, right) =>
        normalizeText(right.start).localeCompare(normalizeText(left.start)),
      )[0] || null
  );
}

export function buildPendingClientEvidenceDescription(args: {
  notesTabEntry?: PendingClientNoteInput | null;
  reviewEvent?: PendingClientEventInput | null;
  missingMessage?: string;
}): string {
  const parts = [
    args.reviewEvent?.description && hasPendingClientWatchNote(args.reviewEvent.description)
      ? `Event List: ${normalizeText(args.reviewEvent.description)}`
      : null,
    args.notesTabEntry?.description && hasPendingClientWatchNote(args.notesTabEntry.description)
      ? `Notes Tab: ${normalizeText(args.notesTabEntry.description)}`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join('\n\n') : args.missingMessage || 'Missing usable notes.';
}

export function classifyPendingClientActionTag(args: {
  normalizedStage?: string | null;
  description?: string | null;
  matchedSignals?: string[] | null;
  hasEvidence?: boolean;
}): PendingClientActionTag {
  const hasEvidence = args.hasEvidence ?? hasPendingClientWatchNote(args.description);
  const normalizedStage = normalizeText(args.normalizedStage);
  if (normalizedStage === 'reschedule_pending' || normalizedStage === 'canceled') {
    return 'Operator Input';
  }
  if (!hasEvidence) {
    return 'Missing Notes';
  }
  if (normalizedStage === 'meeting_follow_up' && (args.matchedSignals || []).length > 0) {
    return 'Payment Watch';
  }
  return 'Scout Update';
}

function pendingClientReplyBody(
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null,
): string {
  return normalizeText(replyEvidence?.lastMeaningfulInbound?.body).toLowerCase();
}

function isNoInterestReply(
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null,
): boolean {
  const body = pendingClientReplyBody(replyEvidence);
  return (
    Boolean(replyEvidence?.clientOptedOut) ||
    normalizeText(replyEvidence?.themeBucket) === 'Opt Out' ||
    /^(?:3|three)$/.test(body) ||
    /\b(no\s+longer\s+interested|not\s+interested|no\s+interest|do\s+not\s+contact|don't\s+contact|stop|unsubscribe|opt\s*out)\b/i.test(
      body,
    )
  );
}

function isTimingBadReply(
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null,
): boolean {
  const body = pendingClientReplyBody(replyEvidence);
  return /^(?:2|two)$/.test(body) || /\b(bad\s+timing|timing\s+is\s+bad|not\s+(?:a\s+)?good\s+time)\b/i.test(body);
}

export function classifyPendingClientOperatorQueue(args: {
  row: PendingClientWatchlistRow;
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
}): PendingClientOperatorQueueClassification {
  const bucket = normalizeText(args.replyEvidence?.themeBucket);
  const proposedTimes = Boolean(args.replyEvidence?.operatorReplyProposedTimes);
  const clientRepliedAfterTimes = Boolean(args.replyEvidence?.clientRepliedAfterOperatorTimes);

  if (isNoInterestReply(args.replyEvidence)) {
    return { label: 'No Interest', priority: 10 };
  }

  if (
    proposedTimes &&
    clientRepliedAfterTimes &&
    (bucket === 'RSP' || bucket === 'No Show' || bucket === 'Cancel')
  ) {
    return { label: 'Review Reply', priority: 15 };
  }

  if (bucket === 'RSP') {
    return proposedTimes
      ? { label: 'Awaiting RSP', priority: 30 }
      : { label: 'Needs Times', priority: 20 };
  }

  if (bucket === 'No Show') {
    if (isTimingBadReply(args.replyEvidence)) return { label: 'Timing Bad', priority: 25 };
    return proposedTimes
      ? { label: 'Awaiting RSP', priority: 30 }
      : { label: 'Needs Times', priority: 20 };
  }

  if (bucket === 'Cancel') {
    return { label: 'Timing Issue', priority: 35 };
  }

  if (bucket === 'Call Attempt') {
    return { label: 'Call Back', priority: 40 };
  }

  switch (args.row.action_tag) {
    case 'Payment Watch':
      return { label: 'Payment', priority: 70 };
    case 'Operator Input':
      return { label: 'Operator Input', priority: 60 };
    case 'Scout Update':
      return { label: 'Follow Up', priority: 80 };
    default:
      return { label: 'No Note', priority: 90 };
  }
}

function pendingClientRowText(row: PendingClientWatchlistRow): string {
  return [
    row.action_tag,
    row.event_title,
    row.description,
    row.matched_signals?.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function classifyPendingClientCentralQueue(args: {
  row: PendingClientWatchlistRow;
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
}): PendingClientCentralQueueClassification {
  const rowText = pendingClientRowText(args.row);
  const themeBucket = normalizeText(args.replyEvidence?.themeBucket);
  const proposedTimes = Boolean(args.replyEvidence?.operatorReplyProposedTimes);
  const clientRepliedAfterTimes = Boolean(args.replyEvidence?.clientRepliedAfterOperatorTimes);
  const needsReply = !args.replyEvidence?.operatorRepliedAfterInbound || clientRepliedAfterTimes;

  if (
    args.row.action_tag === 'Payment Watch' ||
    themeBucket === 'Payment' ||
    /\b(pay|payment|invoice|package|elite|icon|premium|legend|coming aboard|\$\s*\d+)/i.test(rowText)
  ) {
    return {
      filter: 'payments',
      label: 'Payments',
      actionLabel: 'Payments',
      priority: 40,
    };
  }

  if (
    themeBucket === 'No Show' ||
    /\bno show\b/i.test(rowText)
  ) {
    if (isTimingBadReply(args.replyEvidence)) {
      return {
        filter: 'no_show',
        label: 'No Show',
        actionLabel: 'Bad Timing',
        priority: 15,
      };
    }

    return {
      filter: 'no_show',
      label: 'No Show',
      actionLabel: proposedTimes ? 'Awaiting Client' : 'Offer Slots',
      priority: proposedTimes ? 20 : 10,
    };
  }

  if (themeBucket === 'Call Attempt') {
    return {
      filter: 'review_follow_ups',
      label: 'Review Follow Ups',
      actionLabel: needsReply ? 'Needs Reply' : 'Review',
      priority: 30,
    };
  }

  if (
    themeBucket === 'RSP' ||
    /\b(?:reschedule|rsp|cancel|canceled|cancelled)\b|\((?:rsp|can)\)/i.test(rowText)
  ) {
    return {
      filter: 'reschedule',
      label: 'RSP',
      actionLabel: clientRepliedAfterTimes
        ? 'Review Reply'
        : proposedTimes
          ? 'Awaiting Client'
          : 'Offer Slots',
      priority: proposedTimes ? 20 : 10,
    };
  }

  return {
    filter: 'review_follow_ups',
    label: 'Review Follow Ups',
    actionLabel: needsReply ? 'Needs Reply' : 'Review',
    priority: 30,
  };
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
    .replace(/^\([^)]+\)(?:\*\d+)?\s*/i, '')
    .trim();
  if (isPendingClientAthleteKeyText(cleaned)) return '';
  const sportMatch = cleaned.match(SPORT_BOUNDARY_PATTERN);
  return (
    realPendingClientAthleteName(sportMatch ? cleaned.slice(0, sportMatch.index).trim() : cleaned) ||
    ''
  ).replace(/\s+/g, ' ');
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
  actionTag: PendingClientActionTag;
  aiVerdict: PendingClientAIVerdict;
  athleteId?: string | null;
  athleteMainId?: string | null;
  athleteName?: string | null;
  now?: Date;
  activeOperator?: ActiveOperatorContext;
}): PendingClientWatchlistRow {
  const eventId = normalizeText(args.event.event_id);
  const eventTitle = normalizeText(args.event.title);
  const eventStart = utcFromLegacyLocal(normalizeText(args.event.start));
  const eventEndRaw = normalizeText(args.event.end);
  const nowIso = (args.now || new Date()).toISOString();

  return {
    source_event_id: eventId,
    athlete_id: normalizeText(args.athleteId) || null,
    athlete_main_id: normalizeText(args.athleteMainId) || null,
    athlete_name:
      realPendingClientAthleteName(args.athleteName) ||
      cleanPendingClientAthleteName(eventTitle) ||
      null,
    ...buildPendingClientOwnerSnapshot({
      assignedOwner: args.event.assigned_owner,
      activeOperator: args.activeOperator,
    }),
    event_title: eventTitle,
    event_start: eventStart,
    event_end: eventEndRaw ? utcFromLegacyLocal(eventEndRaw) : null,
    description: args.description,
    matched_signals: args.matchedSignals,
    action_tag: args.actionTag,
    ai_verdict: args.aiVerdict,
    status: 'watching',
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    expires_at: pendingClientExpiresAt(eventStart),
    resolved_at: null,
  };
}
