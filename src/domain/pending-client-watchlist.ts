import {
  getActiveOperator,
  resolveOwnerByName,
  type ActiveOperatorContext,
  type OwnerKey,
} from './owners';
import { resolveSalesLifecycle } from '../lib/sales-lifecycle';

export const PENDING_CLIENT_WATCH_WINDOW_DAYS = 14;
export const PENDING_CLIENT_LIST_LIMIT = 100;

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
  lastMeaningfulInbound?: { body?: string | null; date?: string | null } | null;
  operatorRepliedAfterInbound?: boolean | null;
  operatorReplyProposedTimes?: boolean | null;
  clientRepliedAfterOperatorTimes?: boolean | null;
  clientOptedOut?: boolean | null;
  lastMeaningfulOutbound?: { body?: string | null; date?: string | null } | null;
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
    | 'Try Again'
    | 'Needs Reply'
    | 'Review'
    | 'Bad Timing'
    | 'Payments';
  priority: number;
};

export type PendingClientLaneState = {
  queue: PendingClientCentralQueueClassification;
  activeFollowUp: PendingClientActiveFollowUpState;
  messageEvidenceApplies: boolean;
  paymentLocked: boolean;
  visible: boolean;
};

export type PendingClientAppointmentHistoryOutcome =
  | 'scheduled'
  | 'reschedule_pending'
  | 'rescheduled'
  | 'no_show'
  | 'canceled'
  | 'follow_up'
  | 'closed_won'
  | 'closed_lost'
  | 'unknown';

export type PendingClientAppointmentHistoryEntry = {
  appointmentId?: string | number | null;
  startsAt?: string | null;
  updatedAt?: string | null;
  status?: string | null;
  postMeetingResult?: string | null;
};

export type PendingClientAppointmentHistorySummary = {
  scheduledCount: number;
  rescheduleCount: number;
  noShowCount: number;
  canceledCount: number;
  recoveryCycleCount: number;
  originalMeetingAt: string | null;
  latestMeetingAt: string | null;
  latestOutcomeAt: string | null;
  latestOutcome: PendingClientAppointmentHistoryOutcome;
};

export type PendingClientMessageThreadSummary = {
  operatorReachedOutAfterLatestOutcome: boolean;
  clientRepliedAfterLatestOperator: boolean;
  dormantDaysSinceOperatorMessage: number | null;
  lastOperatorMessageAt: string | null;
  lastClientMessageAt: string | null;
  state:
    | 'needs_operator_outreach'
    | 'awaiting_client'
    | 'client_replied'
    | 'client_opted_out'
    | 'unknown';
};

export type PendingClientCommunicationAction =
  | 'offer_slots'
  | 'await_client'
  | 'try_again'
  | 'review_reply'
  | 'needs_reply'
  | 'collect_payment'
  | 'review'
  | 'purge_terminal';

export type PendingClientTemplateTone =
  | 'simple_recovery'
  | 'direct_intent_check'
  | 'final_time_check'
  | 'payment_clarity'
  | 'review_context';

export type PendingClientCommunicationPlan = {
  lane: PendingClientCentralFilter;
  action: PendingClientCommunicationAction;
  stageLabel: 'Stage 1' | 'Stage 2' | 'Final check' | 'Terminal';
  templateTone: PendingClientTemplateTone;
  templateKey: string;
  evidenceFacts: string[];
  nextSteps: string[];
  resolutionRule: string;
};

export type PendingClientActiveFollowUpState = {
  filter: PendingClientCentralFilter;
  actionLabel: PendingClientCentralQueueClassification['actionLabel'];
  checklistAction:
    | 'add_note'
    | 'offer_slots'
    | 'await_client'
    | 'try_again'
    | 'review_reply'
    | 'review_payment'
    | 'review_context';
  deadlineLabel: string | null;
};

export type PendingClientChecklistInput = {
  row: PendingClientWatchlistRow;
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
  centralQueue?: PendingClientCentralQueueClassification | null;
  now?: Date;
  dormantFollowUpDays?: number;
  retryAfterHours?: number;
};

export type PendingClientSourceLifecycleInput = {
  crmStage?: string | null;
  taskTitle?: string | null;
  taskStatus?: string | null;
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

function normalizeAppointmentHistoryOutcome(
  value?: string | number | null,
): PendingClientAppointmentHistoryOutcome {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'scheduled' || normalized === 'confirmation_queued' || normalized === 'confirmation_sent') {
    return 'scheduled';
  }
  if (normalized === 'reschedule_pending') return 'reschedule_pending';
  if (normalized === 'rescheduled') return 'rescheduled';
  if (normalized === 'no_show') return 'no_show';
  if (normalized === 'canceled' || normalized === 'cancelled') return 'canceled';
  if (normalized === 'follow_up') return 'follow_up';
  if (normalized === 'closed_won') return 'closed_won';
  if (normalized === 'closed_lost') return 'closed_lost';
  return 'unknown';
}

function appointmentHistoryOutcome(
  row: PendingClientAppointmentHistoryEntry,
): PendingClientAppointmentHistoryOutcome {
  const postMeetingResult = normalizeAppointmentHistoryOutcome(row.postMeetingResult);
  if (postMeetingResult !== 'unknown') return postMeetingResult;
  return normalizeAppointmentHistoryOutcome(row.status);
}

function isoOrNull(value?: string | null): string | null {
  const parsed = parseDateMs(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function daysBetween(laterMs: number, earlierMs: number): number {
  return Math.max(0, Math.floor((laterMs - earlierMs) / (24 * 60 * 60 * 1000)));
}

const PENDING_CLIENT_REPLY_RETRY_AFTER_HOURS = 48;

function pendingClientOutboundMs(
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null,
): number {
  return parseDateMs(replyEvidence?.lastMeaningfulOutbound?.date);
}

function pendingClientReplyDeadlineMs(
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null,
  retryAfterHours = PENDING_CLIENT_REPLY_RETRY_AFTER_HOURS,
): number {
  const outboundMs = pendingClientOutboundMs(replyEvidence);
  return Number.isFinite(outboundMs)
    ? outboundMs + retryAfterHours * 60 * 60 * 1000
    : Number.NaN;
}

export function pendingClientReplyDeadlineLabel(args: {
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
  retryAfterHours?: number;
}): string {
  return formatPendingClientNaturalTimestamp(
    pendingClientReplyDeadlineMs(args.replyEvidence, args.retryAfterHours),
  );
}

export function isPendingClientReplyRetryDue(args: {
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
  now?: Date;
  retryAfterHours?: number;
}): boolean {
  if (!args.replyEvidence?.operatorReplyProposedTimes) return false;
  if (args.replyEvidence.clientRepliedAfterOperatorTimes) return false;
  const deadlineMs = pendingClientReplyDeadlineMs(args.replyEvidence, args.retryAfterHours);
  return Number.isFinite(deadlineMs) && (args.now || new Date()).getTime() >= deadlineMs;
}

function pendingClientRecoveryActionLabel(args: {
  filter: PendingClientCentralFilter;
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
  now?: Date;
  retryAfterHours?: number;
}): PendingClientCentralQueueClassification['actionLabel'] {
  if (args.replyEvidence?.clientRepliedAfterOperatorTimes) return 'Review Reply';
  if (
    isPendingClientReplyRetryDue({
      replyEvidence: args.replyEvidence,
      now: args.now,
      retryAfterHours: args.retryAfterHours,
    })
  ) {
    return 'Try Again';
  }
  if (args.replyEvidence?.operatorReplyProposedTimes) return 'Awaiting Client';
  return args.filter === 'reschedule' || args.filter === 'no_show' ? 'Offer Slots' : 'Needs Reply';
}

export function derivePendingClientActiveFollowUpState(args: {
  row: PendingClientWatchlistRow;
  filter: PendingClientCentralFilter;
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
  now?: Date;
  retryAfterHours?: number;
}): PendingClientActiveFollowUpState {
  const filter = args.filter;
  const deadlineLabel =
    pendingClientReplyDeadlineLabel({
      replyEvidence: args.replyEvidence,
      retryAfterHours: args.retryAfterHours,
    }) || null;

  if (filter === 'payments') {
    return {
      filter,
      actionLabel: 'Payments',
      checklistAction: 'review_payment',
      deadlineLabel: null,
    };
  }
  if (filter === 'review_follow_ups') {
    return {
      filter,
      actionLabel: 'Review',
      checklistAction: 'review_context',
      deadlineLabel: null,
    };
  }

  const actionLabel = pendingClientRecoveryActionLabel({
    filter,
    replyEvidence: args.replyEvidence,
    now: args.now,
    retryAfterHours: args.retryAfterHours,
  });
  if (actionLabel === 'Review Reply') {
    return { filter, actionLabel, checklistAction: 'review_reply', deadlineLabel };
  }
  if (actionLabel === 'Try Again') {
    return { filter, actionLabel, checklistAction: 'try_again', deadlineLabel };
  }
  if (actionLabel === 'Awaiting Client') {
    return { filter, actionLabel, checklistAction: 'await_client', deadlineLabel };
  }
  return {
    filter,
    actionLabel,
    checklistAction: 'offer_slots',
    deadlineLabel: null,
  };
}

export function summarizePendingClientAppointmentHistory(
  rows: PendingClientAppointmentHistoryEntry[],
): PendingClientAppointmentHistorySummary {
  const datedStarts = rows
    .map((row) => ({ row, startsAt: parseDateMs(row.startsAt) }))
    .filter((entry) => Number.isFinite(entry.startsAt))
    .sort((left, right) => left.startsAt - right.startsAt);
  const datedOutcomes = rows
    .map((row) => ({ row, updatedAt: parseDateMs(row.updatedAt || row.startsAt) }))
    .filter((entry) => Number.isFinite(entry.updatedAt))
    .sort((left, right) => left.updatedAt - right.updatedAt);

  let rescheduleCount = 0;
  let noShowCount = 0;
  let canceledCount = 0;

  for (const row of rows) {
    const outcome = appointmentHistoryOutcome(row);
    if (outcome === 'reschedule_pending' || outcome === 'rescheduled') rescheduleCount += 1;
    if (outcome === 'no_show') noShowCount += 1;
    if (outcome === 'canceled') canceledCount += 1;
  }

  const latestOutcomeRow = datedOutcomes[datedOutcomes.length - 1]?.row || null;

  return {
    scheduledCount: datedStarts.length,
    rescheduleCount,
    noShowCount,
    canceledCount,
    recoveryCycleCount: rescheduleCount + noShowCount + canceledCount,
    originalMeetingAt: isoOrNull(datedStarts[0]?.row.startsAt),
    latestMeetingAt: isoOrNull(datedStarts[datedStarts.length - 1]?.row.startsAt),
    latestOutcomeAt: isoOrNull(latestOutcomeRow?.updatedAt || latestOutcomeRow?.startsAt),
    latestOutcome: latestOutcomeRow ? appointmentHistoryOutcome(latestOutcomeRow) : 'unknown',
  };
}

export function summarizePendingClientMessageThread(
  args: {
    replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
    latestOutcomeAt?: string | null;
    now?: Date;
  },
): PendingClientMessageThreadSummary {
  const evidence = args.replyEvidence;
  const nowMs = (args.now || new Date()).getTime();
  const latestOutcomeMs = parseDateMs(args.latestOutcomeAt);
  const lastOutboundAt = isoOrNull(evidence?.lastMeaningfulOutbound?.date);
  const lastInboundAt = isoOrNull(evidence?.lastMeaningfulInbound?.date);
  const lastOutboundMs = parseDateMs(lastOutboundAt);
  const lastInboundMs = parseDateMs(lastInboundAt);
  const operatorReachedOutAfterLatestOutcome =
    Number.isFinite(latestOutcomeMs) &&
    Number.isFinite(lastOutboundMs) &&
    lastOutboundMs >= latestOutcomeMs;
  const clientRepliedAfterLatestOperator =
    Number.isFinite(lastInboundMs) &&
    Number.isFinite(lastOutboundMs) &&
    lastInboundMs > lastOutboundMs;
  const dormantDaysSinceOperatorMessage =
    Number.isFinite(lastOutboundMs) && !clientRepliedAfterLatestOperator
      ? daysBetween(nowMs, lastOutboundMs)
      : null;

  let state: PendingClientMessageThreadSummary['state'] = 'unknown';
  if (isNoInterestReply(evidence)) {
    state = 'client_opted_out';
  } else if (clientRepliedAfterLatestOperator || Boolean(evidence?.clientRepliedAfterOperatorTimes)) {
    state = 'client_replied';
  } else if (operatorReachedOutAfterLatestOutcome || Boolean(evidence?.operatorReplyProposedTimes)) {
    state = 'awaiting_client';
  } else if (Number.isFinite(latestOutcomeMs)) {
    state = 'needs_operator_outreach';
  }

  return {
    operatorReachedOutAfterLatestOutcome,
    clientRepliedAfterLatestOperator,
    dormantDaysSinceOperatorMessage,
    lastOperatorMessageAt: lastOutboundAt,
    lastClientMessageAt: lastInboundAt,
    state,
  };
}

function pendingClientCycleBand(recoveryCycleCount: number): 'first' | 'repeat' | 'final' {
  if (recoveryCycleCount >= 3) return 'final';
  if (recoveryCycleCount === 2) return 'repeat';
  return 'first';
}

function pendingClientCycleStageLabel(
  band: ReturnType<typeof pendingClientCycleBand>,
): PendingClientCommunicationPlan['stageLabel'] {
  if (band === 'final') return 'Final check';
  if (band === 'repeat') return 'Stage 2';
  return 'Stage 1';
}

function actionForCentralQueue(
  queue: PendingClientCentralQueueClassification,
): PendingClientCommunicationAction {
  if (queue.actionLabel === 'Offer Slots') return 'offer_slots';
  if (queue.actionLabel === 'Awaiting Client') return 'await_client';
  if (queue.actionLabel === 'Try Again') return 'try_again';
  if (queue.actionLabel === 'Review Reply') return 'review_reply';
  if (queue.actionLabel === 'Needs Reply') return 'needs_reply';
  if (queue.actionLabel === 'Payments') return 'collect_payment';
  return 'review';
}

function toneForPlan(args: {
  queue: PendingClientCentralQueueClassification;
  appointmentHistory: PendingClientAppointmentHistorySummary;
}): PendingClientTemplateTone {
  if (args.queue.filter === 'payments') return 'payment_clarity';
  if (args.queue.filter === 'review_follow_ups') return 'review_context';
  const band = pendingClientCycleBand(args.appointmentHistory.recoveryCycleCount);
  if (band === 'final') return 'final_time_check';
  if (band === 'repeat') return 'direct_intent_check';
  return 'simple_recovery';
}

function templateKeyForPlan(args: {
  queue: PendingClientCentralQueueClassification;
  action: PendingClientCommunicationAction;
  appointmentHistory: PendingClientAppointmentHistorySummary;
  messageThread: PendingClientMessageThreadSummary;
}): string {
  const lane = args.queue.filter;
  const band = pendingClientCycleBand(args.appointmentHistory.recoveryCycleCount);
  return [lane, band, args.messageThread.state, args.action].join('.');
}

export function buildPendingClientCommunicationPlan(args: {
  queue: PendingClientCentralQueueClassification;
  appointmentHistory: PendingClientAppointmentHistorySummary;
  messageThread: PendingClientMessageThreadSummary;
  salesStage?: string | null;
}): PendingClientCommunicationPlan {
  const lifecycle = resolveSalesLifecycle(args.salesStage);
  const band = pendingClientCycleBand(args.appointmentHistory.recoveryCycleCount);
  if (lifecycle.shouldArchiveFromWorkingViews) {
    return {
      lane: args.queue.filter,
      action: 'purge_terminal',
      stageLabel: 'Terminal',
      templateTone: 'review_context',
      templateKey: `${args.queue.filter}.terminal.purge`,
      evidenceFacts: [
        `Sales stage: ${lifecycle.normalizedStage}`,
        `Latest outcome: ${args.appointmentHistory.latestOutcome}`,
      ],
      nextSteps: ['Remove from active Pending Clients and Client Messages tracking.'],
      resolutionRule: 'Terminal sales stage wins unless a later source-system stage reopens the client.',
    };
  }

  const action = actionForCentralQueue(args.queue);
  const templateTone = toneForPlan({
    queue: args.queue,
    appointmentHistory: args.appointmentHistory,
  });
  const facts = [
    `Scheduled: ${args.appointmentHistory.scheduledCount}`,
    `Reschedules: ${args.appointmentHistory.rescheduleCount}`,
    `No-shows: ${args.appointmentHistory.noShowCount}`,
    `Cancels: ${args.appointmentHistory.canceledCount}`,
    `Message state: ${args.messageThread.state}`,
  ];
  const nextSteps: string[] = [];
  if (action === 'offer_slots') {
    nextSteps.push('Send a concise value reminder and offer ranked slots near the prior meeting time.');
  } else if (action === 'await_client') {
    nextSteps.push('Wait for the client response unless dormant threshold is exceeded.');
  } else if (action === 'try_again') {
    nextSteps.push('Send the direct retry check: I sent times over, are we good to pick one or are we done?');
  } else if (action === 'review_reply') {
    nextSteps.push('Use the client reply to confirm a slot or close the loop.');
  } else if (action === 'collect_payment') {
    nextSteps.push('Confirm package/payment intent and route payment evidence without changing meeting truth.');
  } else {
    nextSteps.push('Review the latest scout note/event and choose the next operator action.');
  }
  if (templateTone === 'direct_intent_check') {
    nextSteps.push('Ask for a direct yes/no intent check with new slots.');
  }
  if (templateTone === 'final_time_check') {
    nextSteps.push('Make the final time-protection check before any resolve/purge action that needs operator approval.');
  }

  return {
    lane: args.queue.filter,
    action,
    stageLabel: pendingClientCycleStageLabel(band),
    templateTone,
    templateKey: templateKeyForPlan({
      queue: args.queue,
      action,
      appointmentHistory: args.appointmentHistory,
      messageThread: args.messageThread,
    }),
    evidenceFacts: facts,
    nextSteps,
    resolutionRule:
      'Cycle count selects the reply valve; removal is not automatic. Resolve when a new confirmed appointment, terminal sales stage, payment resolution, explicit client opt-out, or operator-approved close-out changes the source truth.',
  };
}

function prefixedPendingClientEvidenceBodies(
  description: string | null | undefined,
  prefix: 'Notes Tab' | 'Event List',
): string[] {
  const seen = new Set<string>();
  const bodies: string[] = [];
  for (const block of normalizeText(description).split(/\n{2,}/)) {
    const trimmed = block.trim();
    const match = trimmed.match(/^([^:]+):\s*([\s\S]+)$/i);
    if (!match) continue;
    if (normalizeComparableText(match[1]).toLowerCase() !== prefix.toLowerCase()) continue;
    const body = normalizeComparableText(match[2]);
    if (!body || !hasPendingClientWatchNote(body) || seen.has(body.toLowerCase())) continue;
    seen.add(body.toLowerCase());
    bodies.push(body);
  }
  return bodies;
}

export function extractPendingClientEvidenceNote(description?: string | null): string | null {
  const notesTabBodies = prefixedPendingClientEvidenceBodies(description, 'Notes Tab');
  if (notesTabBodies.length) return notesTabBodies.join('\n\n');
  return prefixedPendingClientEvidenceBodies(description, 'Event List').join('\n\n') || null;
}

function hasPendingClientOperatorNoteEvidence(row: PendingClientWatchlistRow): boolean {
  if (extractPendingClientEvidenceNote(row.description)) return true;
  if (row.action_tag === 'Operator Input' || row.action_tag === 'Missing Notes') return false;
  return hasPendingClientWatchNote(row.description);
}

function ordinalDay(day: number): string {
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? 'th'
      : day % 10 === 1
        ? 'st'
        : day % 10 === 2
          ? 'nd'
          : day % 10 === 3
            ? 'rd'
            : 'th';
  return `${day}${suffix}`;
}

function formatPendingClientNaturalTimestamp(valueMs: number): string {
  if (!Number.isFinite(valueMs)) return '';
  const date = new Date(valueMs);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date);
  const hour = date.getHours();
  const hour12 = hour % 12 || 12;
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  return `${weekday}, ${monthName} ${ordinalDay(date.getDate())} at ${hour12}:${String(
    date.getMinutes(),
  ).padStart(2, '0')} ${meridiem}`;
}

function formatPendingClientNoteTimestamp(match: RegExpMatchArray): string {
  const month = Number.parseInt(match[1] || '', 10);
  const day = Number.parseInt(match[2] || '', 10);
  const rawYear = Number.parseInt(match[3] || '', 10);
  const hour = Number.parseInt(match[4] || '', 10);
  const minute = Number.parseInt(match[5] || '', 10);
  const meridiem = String(match[6] || '').toUpperCase();
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return '';
  }
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date);
  return `${weekday}, ${monthName} ${ordinalDay(day)} at ${hour}:${String(minute).padStart(
    2,
    '0',
  )} ${meridiem}`;
}

export function parsePendingClientEvidenceNote(note?: string | null): {
  timestampLabel: string | null;
  description: string;
} | null {
  const text = normalizeComparableText(note);
  if (!text) return null;
  const timestampMatch = text.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([AP]M)\b/i,
  );
  if (!timestampMatch || timestampMatch.index === undefined) {
    return { timestampLabel: null, description: text };
  }
  const description = normalizeComparableText(
    text.slice(timestampMatch.index + timestampMatch[0].length),
  );
  return {
    timestampLabel: formatPendingClientNoteTimestamp(timestampMatch) || null,
    description: description || text,
  };
}

function fencedNoteBlock(value: string): string {
  return value.replace(/```/g, "'''");
}

export function buildPendingClientChecklistMarkdown({
  row,
  replyEvidence,
  centralQueue,
  now,
  dormantFollowUpDays = 2,
  retryAfterHours = PENDING_CLIENT_REPLY_RETRY_AFTER_HOURS,
}: PendingClientChecklistInput): string {
  const hasNote = hasPendingClientOperatorNoteEvidence(row);
  const note = parsePendingClientEvidenceNote(extractPendingClientEvidenceNote(row.description));
  const messageThread = summarizePendingClientMessageThread({
    replyEvidence,
    latestOutcomeAt: row.last_seen_at || row.event_end || row.event_start,
    now,
  });
  const textSent =
    messageThread.operatorReachedOutAfterLatestOutcome ||
    Boolean(replyEvidence?.operatorReplyProposedTimes);
  const laneState = derivePendingClientLaneState({
    row,
    replyEvidence,
    now,
    retryAfterHours,
  });
  const activeState =
    centralQueue && centralQueue.filter !== laneState.queue.filter
      ? derivePendingClientActiveFollowUpState({
          row,
          filter: centralQueue.filter,
          replyEvidence,
          now,
          retryAfterHours,
        })
      : laneState.activeFollowUp;

  if (activeState.filter === 'payments') {
    const lines: string[] = [];
    if (note?.description) {
      lines.push(
        '### Note',
        '',
        ...(note.timestampLabel ? [note.timestampLabel, ''] : []),
        '```',
        fencedNoteBlock(note.description),
        '```',
      );
    }
    return lines.join('\n');
  }

  const actionLines = [`- [${hasNote ? 'x' : ' '}] Add note`];

  if (textSent) {
    actionLines.push('- [x] Offer slots');
    if (
      activeState.checklistAction === 'review_reply' ||
      messageThread.state === 'client_replied' ||
      messageThread.state === 'client_opted_out'
    ) {
      actionLines.push('- [ ] Review reply');
    } else if (activeState.checklistAction === 'try_again') {
      actionLines.push(
        activeState.deadlineLabel
          ? `- [ ] Try again - waited until ${activeState.deadlineLabel}`
          : '- [ ] Try again',
      );
    } else if ((messageThread.dormantDaysSinceOperatorMessage || 0) >= dormantFollowUpDays) {
      actionLines.push(
        activeState.deadlineLabel
          ? `- [ ] Try again - waited until ${activeState.deadlineLabel}`
          : '- [ ] Try again',
      );
    } else {
      actionLines.push(
        activeState.deadlineLabel
          ? `- [ ] Wait for reply until ${activeState.deadlineLabel}`
          : '- [ ] Wait for reply',
      );
    }
  } else {
    actionLines.push('- [ ] Offer slots');
  }

  const lines = [
    '### Next Action',
    '',
    ...actionLines,
  ];

  if (note?.description) {
    lines.push(
      '',
      '### Note',
      '',
      ...(note.timestampLabel ? [note.timestampLabel, ''] : []),
      '```',
      fencedNoteBlock(note.description),
      '```',
    );
  }

  return lines.join('\n');
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
  if (
    (normalizedStage === 'meeting_follow_up' || normalizedStage === 'follow_up') &&
    (args.matchedSignals || []).length > 0
  ) {
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

function pendingClientSourceLane(row: PendingClientWatchlistRow): PendingClientCentralFilter | null {
  const rowText = pendingClientRowText(row);
  if (row.action_tag === 'Payment Watch') return 'payments';
  if (/\bno show\b|\(ns\)/i.test(rowText)) return 'no_show';
  if (/\b(?:reschedule|rsp|cancel|canceled|cancelled)\b|\((?:rsp|can)\)/i.test(rowText)) {
    return 'reschedule';
  }
  if (row.action_tag === 'Operator Input') return 'reschedule';
  if (/\b(pay|payment|invoice|package|elite|icon|premium|legend|coming aboard|\$\s*\d+)/i.test(rowText)) {
    return 'payments';
  }
  if (row.action_tag === 'Scout Update') return 'review_follow_ups';
  return null;
}

function pendingClientReviewQueue(): PendingClientCentralQueueClassification {
  return {
    filter: 'review_follow_ups',
    label: 'Review Follow Ups',
    actionLabel: 'Review',
    priority: 30,
  };
}

function normalizedSourceLifecycleText(
  sourceLifecycle?: PendingClientSourceLifecycleInput | null,
): string {
  return [
    sourceLifecycle?.crmStage,
    sourceLifecycle?.taskTitle,
    sourceLifecycle?.taskStatus,
  ]
    .map((value) =>
      normalizeComparableText(value)
        .toLowerCase()
        .replace(/\s*[-–—]\s*/g, ' ')
        .replace(/[.,:]+/g, ' '),
    )
    .filter(Boolean)
    .join(' ');
}

export function isPendingClientReviewFollowUpSourceStage(
  sourceLifecycle?: PendingClientSourceLifecycleInput | null,
): boolean {
  const text = normalizedSourceLifecycleText(sourceLifecycle);
  if (!text) return false;
  if (
    /\b(?:left voice mail 1|left voicemail 1|left voice mail 2|left voicemail 2|never spoke to|spoke to athlete not parent|athlete not parent|spoke to i need to follow up|spoke to need to follow up|spoke to follow up)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  const lifecycle = resolveSalesLifecycle(sourceLifecycle?.crmStage || sourceLifecycle?.taskStatus);
  return lifecycle.normalizedStage === 'call_attempt';
}

function isPendingClientReviewFollowUpActionable(args: {
  sourceLifecycle?: PendingClientSourceLifecycleInput | null;
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
}): boolean {
  return (
    isPendingClientReviewFollowUpSourceStage(args.sourceLifecycle) &&
    normalizeText(args.replyEvidence?.themeBucket) === 'Call Attempt' &&
    Boolean(args.replyEvidence?.lastMeaningfulInbound?.body) &&
    !args.replyEvidence?.operatorRepliedAfterInbound
  );
}

export function classifyPendingClientCentralQueue(args: {
  row: PendingClientWatchlistRow;
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
  sourceLifecycle?: PendingClientSourceLifecycleInput | null;
  now?: Date;
  retryAfterHours?: number;
}): PendingClientCentralQueueClassification {
  const sourceLane = pendingClientSourceLane(args.row);
  const themeBucket = normalizeText(args.replyEvidence?.themeBucket);

  if (sourceLane === 'payments') {
    return {
      filter: 'payments',
      label: 'Payments',
      actionLabel: 'Payments',
      priority: 40,
    };
  }

  if (sourceLane === 'no_show' || (!sourceLane && themeBucket === 'No Show')) {
    if (isTimingBadReply(args.replyEvidence)) {
      return {
        filter: 'no_show',
        label: 'No Show',
        actionLabel: 'Bad Timing',
        priority: 15,
      };
    }

    const actionLabel = pendingClientRecoveryActionLabel({
      filter: 'no_show',
      replyEvidence: args.replyEvidence,
      now: args.now,
      retryAfterHours: args.retryAfterHours,
    });
    return {
      filter: 'no_show',
      label: 'No Show',
      actionLabel,
      priority:
        actionLabel === 'Try Again'
          ? 15
          : actionLabel === 'Awaiting Client' || actionLabel === 'Review Reply'
            ? 20
            : 10,
    };
  }

  if (
    sourceLane === 'reschedule' ||
    (!sourceLane && (themeBucket === 'RSP' || themeBucket === 'Cancel'))
  ) {
    const actionLabel = pendingClientRecoveryActionLabel({
      filter: 'reschedule',
      replyEvidence: args.replyEvidence,
      now: args.now,
      retryAfterHours: args.retryAfterHours,
    });
    return {
      filter: 'reschedule',
      label: 'RSP',
      actionLabel,
      priority:
        actionLabel === 'Try Again'
          ? 15
          : actionLabel === 'Awaiting Client' || actionLabel === 'Review Reply'
            ? 20
            : 10,
    };
  }

  if (
    sourceLane === 'review_follow_ups' &&
    isPendingClientReviewFollowUpActionable({
      sourceLifecycle: args.sourceLifecycle,
      replyEvidence: args.replyEvidence,
    })
  ) {
    return {
      filter: 'review_follow_ups',
      label: 'Review Follow Ups',
      actionLabel: 'Needs Reply',
      priority: 30,
    };
  }

  return pendingClientReviewQueue();
}

export function derivePendingClientLaneState(args: {
  row: PendingClientWatchlistRow;
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
  sourceLifecycle?: PendingClientSourceLifecycleInput | null;
  now?: Date;
  retryAfterHours?: number;
}): PendingClientLaneState {
  const queue = classifyPendingClientCentralQueue(args);
  const activeFollowUp = derivePendingClientActiveFollowUpState({
    row: args.row,
    filter: queue.filter,
    replyEvidence: args.replyEvidence,
    now: args.now,
    retryAfterHours: args.retryAfterHours,
  });
  return {
    queue,
    activeFollowUp,
    messageEvidenceApplies: queue.filter === 'reschedule' || queue.filter === 'no_show',
    paymentLocked: queue.filter === 'payments',
    visible:
      queue.filter !== 'review_follow_ups' ||
      isPendingClientReviewFollowUpActionable({
        sourceLifecycle: args.sourceLifecycle,
        replyEvidence: args.replyEvidence,
      }),
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
