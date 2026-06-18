export const MISSED_CLIENT_REPLY_FLAGS = ['reschedule_request', 'outreach_callback'] as const;

export type ClientMessageTheme = (typeof MISSED_CLIENT_REPLY_FLAGS)[number];
export type ClientMessageTemplateContext = 'confirmation' | 'outreach_attempt';

export type ClientReplyThemeReviewChatInput = {
  guid: string;
  displayName: string;
  lastMessageDate?: string | null;
  athleteName?: string | null;
  contactId?: string | null;
  athleteMainId?: string | null;
  timezone?: string | null;
  timezoneLabel?: string | null;
  taskTitle?: string | null;
  matchedPhones?: string[];
};

export type ClientReplyThemeReviewMessageInput = {
  guid: string;
  body?: string | null;
  date?: string | null;
  senderName?: string | null;
  sender?: string | null;
  isFromMe?: boolean;
};

export type PendingClientThemeBucket =
  | 'RSP'
  | 'No Show'
  | 'Cancel'
  | 'Call Attempt'
  | 'Opt Out'
  | 'Unclassified';

export type ClientReplyMessageEvidence = {
  guid: string;
  body: string;
  date: string | null;
  senderName: string | null;
  isFromMe: boolean;
};

export type ClientReplyEvidence = {
  themeBucket: PendingClientThemeBucket;
  lastMeaningfulInbound: ClientReplyMessageEvidence | null;
  lastMeaningfulOutbound: ClientReplyMessageEvidence | null;
  lastOperatorRescheduleOffer?: ClientReplyMessageEvidence | null;
  operatorRepliedAfterInbound: boolean;
  operatorReplyProposedTimes: boolean;
  clientRepliedAfterOperatorTimes?: boolean;
  clientOptedOut: boolean;
};

export type ClientReplyThemeReviewRow = {
  id: string;
  chatGuid: string;
  messageGuid: string;
  theme: ClientMessageTheme;
  templateContext: ClientMessageTemplateContext;
  messageBody: string;
  messageDate: string | null;
  senderName: string | null;
  sender: string | null;
  displayName: string;
  athleteName: string | null;
  contactId: string | null;
  athleteMainId: string | null;
  timezone: string | null;
  timezoneLabel: string | null;
  taskTitle: string | null;
  matchedPhones: string[];
  operatorRepliedAfter: boolean;
  operatorRescheduleOfferAfter: boolean;
  replyEvidence?: ClientReplyEvidence;
  followUpEvidence?: string[];
};

export type ClientReplyThemeNearMissReason = 'no_template_context' | 'wrong_template_context';
export type ClientReplyThemeReviewBucketKey = 'rows' | 'nearMisses' | 'ignoredHandled';
export type ClientReplyThemeReviewReason =
  | ClientReplyThemeNearMissReason
  | 'reschedule_pending'
  | 'no_operator_reply'
  | 'replied_after'
  | 'follow_up_evidence';
export type ClientReplyThemeReviewToneColor = 'red' | 'blue' | 'secondary';

export type ClientReplyThemeNearMissRow = ClientReplyThemeReviewRow & {
  reason: ClientReplyThemeNearMissReason;
};

export type ClientReplyThemeReviewSnapshot = {
  version: 1;
  generatedAt: string;
  totalChatsReviewed: number;
  totalMessagesReviewed: number;
  rows: ClientReplyThemeReviewRow[];
  nearMisses: ClientReplyThemeNearMissRow[];
  ignoredHandled: ClientReplyThemeReviewRow[];
};

export type ClientReplyThemeReviewStorage = {
  getItem: (key: string) => Promise<string | undefined | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export type ClientReplyThreadDiagnostics = {
  version: 1;
  observationIds: ClientReplyEvidenceObservationId[];
  totalMessages: number;
  inboundCount: number;
  outboundCount: number;
  emptyBodyCount: number;
  latestDirection: 'client' | 'operator' | 'none';
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  clientRepliedAfterLastOutbound: boolean;
  outboundTemplateContexts: ClientMessageTemplateContext[];
  inboundThemes: ClientMessageTheme[];
  outboundRescheduleOfferCount: number;
  taskSuggestsPostMeetingRecovery: boolean;
  latestClientReplySignals: ClientReplyLatestClientSignal[];
  nonSubstantiveMessageCount: number;
  reactionOnlyCount: number;
};

export type ClientReplyEvidenceObservationId =
  | 'messages_present'
  | 'empty_body_present'
  | 'latest_message_from_client'
  | 'latest_message_from_operator'
  | 'client_replied_after_last_outbound'
  | 'known_inbound_theme_detected'
  | 'no_known_inbound_theme'
  | 'outbound_template_context_detected'
  | 'no_outbound_template_context'
  | 'operator_reschedule_offer_detected'
  | 'post_meeting_recovery_context'
  | 'non_substantive_message_present'
  | 'client_reaction_only_present';

export type ClientReplyLatestClientSignal =
  | 'short_reply'
  | 'contains_question'
  | 'contains_numeric_choice'
  | 'contains_affirmation'
  | 'contains_negative'
  | 'contains_thanks'
  | 'contains_call_word'
  | 'contains_schedule_word'
  | 'contains_time_word'
  | 'contains_day_word';

export type ClientReplyEvidenceObservationDefinition = {
  id: ClientReplyEvidenceObservationId;
  label: string;
  proves: string;
  doesNotProve: string;
  parserImpact: string;
};

export type ClientReplyLatestClientSignalDefinition = {
  id: ClientReplyLatestClientSignal;
  label: string;
  means: string;
  parserImpact: string;
};

export type ClientReplyThreadDiagnosticMeaning = {
  state:
    | 'operator_latest_no_open_client_reply'
    | 'client_latest_unparsed_reply'
    | 'client_latest_unparsed_scheduling_reply'
    | 'client_latest_unparsed_weak_reply'
    | 'theme_present_but_operator_latest'
    | 'theme_present_missing_template_context'
    | 'insufficient_message_evidence';
  interpretation: string;
  nextHardeningTarget:
    | 'none/read_only'
    | 'expand_reply_theme_patterns'
    | 'expand_outbound_template_context'
    | 'inspect_message_decoding'
    | 'manual_source_review';
};

export type ClientReplyThemeRunReceiptMutationResult =
  | 'none/read_only'
  | 'proposed'
  | 'approved'
  | 'failed';

export type ClientReplyThemeRunReceiptOperatorAction =
  | 'needs_first_contact_reply'
  | 'needs_reschedule_times'
  | 'awaiting_client_reschedule_choice'
  | 'review_reschedule_reply'
  | 'review_opt_out'
  | 'needs_review';

export type ClientReplyThemeEvidenceMeaning = {
  operatorAction: ClientReplyThemeRunReceiptOperatorAction;
  interpretation: string;
  requiredEvidence: string[];
};

export type ClientReplyThemeRunReceipt = {
  version: 1;
  flow: '10x_communications';
  step: string;
  generatedAt: string;
  mutationResult: ClientReplyThemeRunReceiptMutationResult;
  sourceSurfaces: string[];
  ids: {
    chatGuid: string;
    messageGuid: string;
    contactId: string | null;
    athleteMainId: string | null;
    matchedPhonesCount: number;
  };
  direction: {
    lastInboundGuid: string | null;
    lastOutboundGuid: string | null;
    operatorRepliedAfterInbound: boolean;
    operatorReplyProposedTimes: boolean;
  };
  classifier: {
    theme: ClientMessageTheme;
    templateContext: ClientMessageTemplateContext;
    themeBucket: PendingClientThemeBucket;
    clientOptedOut: boolean;
  };
  operatorAction: ClientReplyThemeRunReceiptOperatorAction;
  evidenceMeaning: ClientReplyThemeEvidenceMeaning;
};

export const CLIENT_REPLY_THEME_REVIEW_CACHE_KEY = 'client-message:reply-theme-review:v1';

export const CLIENT_REPLY_EVIDENCE_OBSERVATION_DEFINITIONS: Record<
  ClientReplyEvidenceObservationId,
  ClientReplyEvidenceObservationDefinition
> = {
  messages_present: {
    id: 'messages_present',
    label: 'Messages decoded',
    proves: 'At least one message row was available for this admitted thread.',
    doesNotProve: 'It does not prove the latest message is actionable.',
    parserImpact: 'Allows direction, theme, and template diagnostics to run.',
  },
  empty_body_present: {
    id: 'empty_body_present',
    label: 'Undecoded or empty message present',
    proves: 'At least one message row had no decoded body after SQL extraction.',
    doesNotProve: 'It does not prove the thread is missing actionable context.',
    parserImpact: 'Use as a decoding-audit clue, not as action evidence.',
  },
  latest_message_from_client: {
    id: 'latest_message_from_client',
    label: 'Client sent latest meaningful message',
    proves: 'The newest decoded non-empty message in the thread is inbound.',
    doesNotProve: 'It does not prove the client reply matches a known workflow.',
    parserImpact: 'If no known theme is detected, route to reply-pattern hardening.',
  },
  latest_message_from_operator: {
    id: 'latest_message_from_operator',
    label: 'Operator sent latest meaningful message',
    proves: 'The newest decoded non-empty message in the thread is outbound.',
    doesNotProve: 'It does not prove the task is resolved in Supabase or Laravel.',
    parserImpact: 'Usually read-only unless a prior client theme lacks outbound context.',
  },
  client_replied_after_last_outbound: {
    id: 'client_replied_after_last_outbound',
    label: 'Client replied after operator',
    proves: 'The latest inbound message timestamp is newer than the latest outbound timestamp.',
    doesNotProve: 'It does not prove the reply accepts a time or needs a reschedule.',
    parserImpact: 'Raises priority for classification or human review.',
  },
  non_substantive_message_present: {
    id: 'non_substantive_message_present',
    label: 'Non-substantive message row present',
    proves: 'At least one decoded message row was an attachment/contact-card placeholder or reaction-only row.',
    doesNotProve: 'It does not prove the client sent a reply that needs action.',
    parserImpact: 'Exclude from latest-direction and theme decisions while keeping it visible for SQL diagnostics.',
  },
  client_reaction_only_present: {
    id: 'client_reaction_only_present',
    label: 'Client reaction-only row present',
    proves: 'A client row appears to be a Messages tapback/reaction to a prior message.',
    doesNotProve: 'It does not prove acceptance, rejection, or reschedule intent.',
    parserImpact: 'Do not classify as a client reply or manual review target by itself.',
  },
  known_inbound_theme_detected: {
    id: 'known_inbound_theme_detected',
    label: 'Known inbound theme detected',
    proves: 'A client message matched a deterministic reply theme such as reschedule_request or outreach_callback.',
    doesNotProve: 'It does not prove the message belongs to the current task without outbound template context.',
    parserImpact: 'Eligible for action proposal when paired with the correct template context.',
  },
  no_known_inbound_theme: {
    id: 'no_known_inbound_theme',
    label: 'No known inbound theme',
    proves: 'Decoded inbound text did not match the current deterministic reply-theme patterns.',
    doesNotProve: 'It does not prove the client reply is irrelevant.',
    parserImpact: 'Use latestClientReplySignals to decide whether to expand reply patterns.',
  },
  outbound_template_context_detected: {
    id: 'outbound_template_context_detected',
    label: 'Outbound template context detected',
    proves: 'An operator message matched a known outbound workflow template family.',
    doesNotProve: 'It does not prove the client responded to that exact template.',
    parserImpact: 'Provides the workflow lane for a known inbound theme.',
  },
  no_outbound_template_context: {
    id: 'no_outbound_template_context',
    label: 'No outbound template context',
    proves: 'No decoded operator message matched the known outbound workflow template families.',
    doesNotProve: 'It does not prove no operator message was sent.',
    parserImpact: 'Route known client themes here to outbound-template hardening.',
  },
  operator_reschedule_offer_detected: {
    id: 'operator_reschedule_offer_detected',
    label: 'Operator proposed reschedule options',
    proves: 'A decoded operator message matched reschedule-option language.',
    doesNotProve: 'It does not prove a calendar event or reminder was created.',
    parserImpact: 'Separates waiting-for-client from needing-to-send-times.',
  },
  post_meeting_recovery_context: {
    id: 'post_meeting_recovery_context',
    label: 'Post-meeting recovery task context',
    proves: 'The task title indicates no-show, cancel, or reschedule-pending recovery.',
    doesNotProve: 'It does not prove the durable appointment outcome by itself.',
    parserImpact: 'Lets reschedule evidence map to Pending Clients review rather than first-contact outreach.',
  },
};

export const CLIENT_REPLY_LATEST_CLIENT_SIGNAL_DEFINITIONS: Record<
  ClientReplyLatestClientSignal,
  ClientReplyLatestClientSignalDefinition
> = {
  short_reply: {
    id: 'short_reply',
    label: 'Short reply',
    means: 'The latest client message has five words or fewer.',
    parserImpact: 'Useful for numeric choices, acknowledgements, and terse scheduling replies.',
  },
  contains_question: {
    id: 'contains_question',
    label: 'Question mark',
    means: 'The latest client message contains a question mark.',
    parserImpact: 'Prioritize human review when no deterministic theme matches.',
  },
  contains_numeric_choice: {
    id: 'contains_numeric_choice',
    label: 'Numeric choice',
    means: 'The latest client message begins with 1, 2, 3, one, two, or three.',
    parserImpact: 'Candidate for reschedule/follow-up option parsing when template context exists.',
  },
  contains_affirmation: {
    id: 'contains_affirmation',
    label: 'Affirmation',
    means: 'The latest client message includes yes/ok/works/sounds-good style language.',
    parserImpact: 'Candidate for schedule acceptance parsing, not enough alone.',
  },
  contains_negative: {
    id: 'contains_negative',
    label: 'Negative or conflict language',
    means: 'The latest client message includes no/not/busy/unavailable style language.',
    parserImpact: 'Candidate for reschedule conflict or opt-out review depending on stronger theme evidence.',
  },
  contains_thanks: {
    id: 'contains_thanks',
    label: 'Thanks language',
    means: 'The latest client message includes thanks or appreciation language.',
    parserImpact: 'Usually weak evidence unless paired with schedule or call language.',
  },
  contains_call_word: {
    id: 'contains_call_word',
    label: 'Call word',
    means: 'The latest client message includes call, phone, talk, or ring.',
    parserImpact: 'Candidate for first-contact callback pattern expansion.',
  },
  contains_schedule_word: {
    id: 'contains_schedule_word',
    label: 'Schedule word',
    means: 'The latest client message includes schedule, meeting, appointment, slot, time, or works language.',
    parserImpact: 'Candidate for reschedule or first-contact time parsing.',
  },
  contains_time_word: {
    id: 'contains_time_word',
    label: 'Time word',
    means: 'The latest client message includes am/pm, daypart, later, before/after, or a clock-like number.',
    parserImpact: 'Candidate for scheduling parser expansion when paired with call or schedule words.',
  },
  contains_day_word: {
    id: 'contains_day_word',
    label: 'Day word',
    means: 'The latest client message includes today, tomorrow, or a weekday.',
    parserImpact: 'Candidate for first-contact or reschedule time parsing.',
  },
};

export function clientReplyThemeReviewBucketLabel(
  bucket: ClientReplyThemeReviewBucketKey,
): 'Urgent' | 'Misses' | 'Triple-Check' {
  if (bucket === 'nearMisses') return 'Misses';
  if (bucket === 'ignoredHandled') return 'Triple-Check';
  return 'Urgent';
}

export function clientReplyThemeReviewToneLabel(
  bucket: ClientReplyThemeReviewBucketKey,
): 'Urgent' | 'Miss' | 'Triple-Check' {
  if (bucket === 'nearMisses') return 'Miss';
  if (bucket === 'ignoredHandled') return 'Triple-Check';
  return 'Urgent';
}

export function clientReplyThemeReviewReasonLabel(
  reason: ClientReplyThemeReviewReason,
): 'Needs Action' | 'Triple-Check' {
  if (reason === 'replied_after' || reason === 'follow_up_evidence') return 'Triple-Check';
  return 'Needs Action';
}

export function clientReplyThemeReviewToneTagColor(
  bucket: ClientReplyThemeReviewBucketKey,
): ClientReplyThemeReviewToneColor {
  if (bucket === 'nearMisses') return 'blue';
  if (bucket === 'ignoredHandled') return 'secondary';
  return 'red';
}

export function clientReplyThemeReviewReasonTagLabel(
  bucket: ClientReplyThemeReviewBucketKey,
  reason: ClientReplyThemeReviewReason,
): 'Needs Action' | 'Triple-Check' | null {
  const label = clientReplyThemeReviewReasonLabel(reason);
  return label === clientReplyThemeReviewToneLabel(bucket) ? null : label;
}

function looksLikePhone(value?: string | null): boolean {
  return /^\+?\d[\d\s().-]{6,}$/.test(String(value || '').trim());
}

export function clientReplyThemeReviewDisplayName(row: {
  displayName?: string | null;
  athleteName?: string | null;
  senderName?: string | null;
  sender?: string | null;
}): string {
  const displayName = normalizeText(row.displayName);
  const athleteName = normalizeText(row.athleteName);
  const senderName = normalizeText(row.senderName);
  const sender = normalizeText(row.sender);
  if (displayName && !looksLikePhone(displayName)) return displayName;
  if (senderName && senderName !== 'Me' && !looksLikePhone(senderName)) return senderName;
  if (athleteName) return athleteName;
  return displayName || sender || 'Client';
}

function normalizeMatchText(value?: string | null): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type PendingClientReplyThemeMatchInput = {
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  athlete_name?: string | null;
  event_title?: string | null;
};

export type PendingClientReplyThemeState = {
  status: 'needs_reply' | 'awaiting_reschedule' | 'client_replied_after_times';
  row: ClientReplyThemeReviewRow;
};

function clientReplyThemeRowMatchesPendingClient(
  row: ClientReplyThemeReviewRow,
  pendingClient: PendingClientReplyThemeMatchInput,
): boolean {
  const pendingAthleteMainId = normalizeText(pendingClient.athlete_main_id);
  if (pendingAthleteMainId && normalizeText(row.athleteMainId) === pendingAthleteMainId) {
    return true;
  }

  const pendingAthleteId = normalizeText(pendingClient.athlete_id);
  if (pendingAthleteId && normalizeText(row.contactId) === pendingAthleteId) {
    return true;
  }

  const pendingName = normalizeMatchText(pendingClient.athlete_name || pendingClient.event_title);
  if (!pendingName) return false;

  return [row.athleteName, row.displayName, row.senderName]
    .map(normalizeMatchText)
    .filter(Boolean)
    .some(
      (candidateName) =>
        candidateName === pendingName ||
        candidateName.includes(pendingName) ||
        pendingName.includes(candidateName),
    );
}

export function findPendingClientReplyThemeState(
  pendingClient: PendingClientReplyThemeMatchInput,
  snapshot?: ClientReplyThemeReviewSnapshot | null,
): PendingClientReplyThemeState | null {
  const rows = snapshot?.rows || [];
  const match = rows.find(
    (row) =>
      (row.theme === 'reschedule_request' || row.theme === 'outreach_callback') &&
      clientReplyThemeRowMatchesPendingClient(row, pendingClient),
  );
  if (!match) return null;
  if (match.replyEvidence?.clientRepliedAfterOperatorTimes) {
    return {
      status: 'client_replied_after_times',
      row: match,
    };
  }
  return {
    status: match.operatorRescheduleOfferAfter ? 'awaiting_reschedule' : 'needs_reply',
    row: match,
  };
}

function operatorActionForReplyThemeRow(
  row: ClientReplyThemeReviewRow,
): ClientReplyThemeRunReceiptOperatorAction {
  const evidence = row.replyEvidence;
  if (evidence?.clientOptedOut) return 'review_opt_out';
  if (evidence?.clientRepliedAfterOperatorTimes) return 'review_reschedule_reply';
  if (row.operatorRescheduleOfferAfter || evidence?.operatorReplyProposedTimes) {
    return 'awaiting_client_reschedule_choice';
  }
  if (evidence?.themeBucket === 'Call Attempt') return 'needs_first_contact_reply';
  if (evidence && ['RSP', 'No Show', 'Cancel'].includes(evidence.themeBucket)) {
    return 'needs_reschedule_times';
  }
  return 'needs_review';
}

function evidenceMeaningForOperatorAction(
  operatorAction: ClientReplyThemeRunReceiptOperatorAction,
): ClientReplyThemeEvidenceMeaning {
  if (operatorAction === 'review_opt_out') {
    return {
      operatorAction,
      interpretation: 'Client wording indicates opt-out or no-interest language; operator must review before any follow-up.',
      requiredEvidence: ['clientOptedOut=true', 'actionable inbound client message'],
    };
  }
  if (operatorAction === 'review_reschedule_reply') {
    return {
      operatorAction,
      interpretation: 'Operator proposed reschedule times, then the client replied after those proposed times.',
      requiredEvidence: [
        'operatorReplyProposedTimes=true',
        'clientRepliedAfterOperatorTimes=true',
        'post-meeting recovery or reschedule context',
      ],
    };
  }
  if (operatorAction === 'awaiting_client_reschedule_choice') {
    return {
      operatorAction,
      interpretation: 'Operator already sent reschedule options and no later client reply was detected.',
      requiredEvidence: [
        'operatorReplyProposedTimes=true',
        'clientRepliedAfterOperatorTimes=false',
      ],
    };
  }
  if (operatorAction === 'needs_first_contact_reply') {
    return {
      operatorAction,
      interpretation: 'Client replied with callback/timing language after an outreach-attempt template.',
      requiredEvidence: [
        'theme=outreach_callback',
        'templateContext=outreach_attempt',
        'themeBucket=Call Attempt',
      ],
    };
  }
  if (operatorAction === 'needs_reschedule_times') {
    return {
      operatorAction,
      interpretation: 'Client reply indicates post-meeting recovery or reschedule intent and no reschedule times have been sent after that reply.',
      requiredEvidence: [
        'theme=reschedule_request',
        'themeBucket=RSP|No Show|Cancel',
        'operatorReplyProposedTimes=false',
      ],
    };
  }
  return {
    operatorAction,
    interpretation: 'Evidence is insufficient for a deterministic next action; human review is required.',
    requiredEvidence: ['unclassified or ambiguous reply evidence'],
  };
}

export function buildClientReplyThemeRunReceipt(
  row: ClientReplyThemeReviewRow,
  options: {
    generatedAt?: string;
    step?: string;
    mutationResult?: ClientReplyThemeRunReceiptMutationResult;
    sourceSurfaces?: string[];
  } = {},
): ClientReplyThemeRunReceipt {
  const evidence = row.replyEvidence;
  const operatorAction = operatorActionForReplyThemeRow(row);
  return {
    version: 1,
    flow: '10x_communications',
    step: options.step || 'classify-client-reply',
    generatedAt: options.generatedAt || new Date().toISOString(),
    mutationResult: options.mutationResult || 'none/read_only',
    sourceSurfaces: options.sourceSurfaces || [
      'local_messages_sql',
      'athlete_contact_cache',
      'client-message-reply-themes',
    ],
    ids: {
      chatGuid: row.chatGuid,
      messageGuid: row.messageGuid,
      contactId: row.contactId,
      athleteMainId: row.athleteMainId,
      matchedPhonesCount: row.matchedPhones.length,
    },
    direction: {
      lastInboundGuid: evidence?.lastMeaningfulInbound?.guid || null,
      lastOutboundGuid: evidence?.lastMeaningfulOutbound?.guid || null,
      operatorRepliedAfterInbound: Boolean(evidence?.operatorRepliedAfterInbound),
      operatorReplyProposedTimes: Boolean(evidence?.operatorReplyProposedTimes),
    },
    classifier: {
      theme: row.theme,
      templateContext: row.templateContext,
      themeBucket: evidence?.themeBucket || 'Unclassified',
      clientOptedOut: Boolean(evidence?.clientOptedOut),
    },
    operatorAction,
    evidenceMeaning: evidenceMeaningForOperatorAction(operatorAction),
  };
}

function markdownEscape(value?: string | null): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .trim();
}

function compactTimezoneLabel(value?: string | null): string {
  const raw = String(value || '').trim();
  if (raw === 'Eastern' || raw === 'EST' || raw === 'EDT') return 'ET';
  if (raw === 'Central' || raw === 'CST' || raw === 'CDT') return 'CT';
  if (raw === 'Mountain' || raw === 'MST' || raw === 'MDT') return 'MT';
  if (raw === 'Pacific' || raw === 'PST' || raw === 'PDT') return 'PT';
  return raw;
}

function compactClockLabel(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value || '';
  const minute = parts.find((part) => part.type === 'minute')?.value || '00';
  const dayPeriod = parts.find((part) => part.type === 'dayPeriod')?.value?.toUpperCase() || '';
  return minute === '00' ? `${hour}${dayPeriod}` : `${hour}:${minute}${dayPeriod}`;
}

export function formatClientReplyThemeMessageDate(
  value?: string | null,
  timeZone?: string | null,
  timezoneLabel?: string | null,
): string {
  const raw = normalizeText(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const renderTimeZone = String(timeZone || '').trim() || 'America/New_York';
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: renderTimeZone,
  }).format(date);
  const zoneLabel =
    compactTimezoneLabel(timezoneLabel) ||
    compactTimezoneLabel(
      new Intl.DateTimeFormat('en-US', {
        timeZone: renderTimeZone,
        timeZoneName: 'short',
      })
        .formatToParts(date)
        .find((part) => part.type === 'timeZoneName')?.value,
    );
  return `${dateLabel} at ${compactClockLabel(date, renderTimeZone)}${zoneLabel ? ` ${zoneLabel}` : ''}`;
}

export function buildClientReplyThemeThreadMarkdown(args: {
  clientName: string;
  timeZone?: string | null;
  timezoneLabel?: string | null;
  messages: Array<
    Pick<ClientReplyThemeReviewMessageInput, 'body' | 'date' | 'senderName' | 'isFromMe'>
  >;
}): string {
  const lines = [`# ${markdownEscape(args.clientName) || 'Client Thread'}`];
  const messages = [...args.messages].sort((left, right) =>
    compareMessageDates(left.date, right.date),
  );
  for (const message of messages) {
    const body = normalizeText(message.body);
    if (!body) continue;
    const sender = message.isFromMe ? 'Me' : normalizeText(message.senderName) || args.clientName;
    const date = formatClientReplyThemeMessageDate(message.date, args.timeZone, args.timezoneLabel);
    lines.push('');
    lines.push(`### ${markdownEscape(sender)}`);
    if (date) lines.push(`_${markdownEscape(date)}_`);
    lines.push('');
    for (const part of body.split(/\r?\n/)) {
      const text = markdownEscape(part);
      if (text) lines.push(text);
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

const FLAG_PATTERNS: Record<ClientMessageTheme, RegExp> = {
  reschedule_request:
    /(?:\b(reschedule|re-schedule|move\s+(the\s+)?meeting|different\s+time|still\s+interested|need\s+to\s+reschedule|bad\s+timing|timing\s+is\s+bad|no\s+longer\s+interested|not\s+interested|cancel(?:ed|led)?|opt\s*out)\b|^\s*(?:1|one|2|two|3|three)\s*$)/i,
  outreach_callback:
    /\b(tomorrow|tmrw|later\s+today|available\s+today|free\s+today|working|at\s+work|work\s+meeting|call\s+me|call\s+back|after\s+work)\b/i,
};

const TEMPLATE_PATTERNS: Record<ClientMessageTemplateContext, RegExp> = {
  confirmation:
    /\b(prospect\s+id\s+zoom\s+meeting|please\s+reply\s+yes|reply\s+with\s+the\s+best\s+fit|still\s+interested,\s*need\s+to\s+reschedule|no\s+longer\s+interested|still\s+has\s+you\s+down\s+for|has\s+.+\s+down\s+for\s+the\s+meeting|coach\s+.+\s+meeting|meeting\s+(today|tomorrow|tonight)|zoom\s+meeting|confirm)\b/i,
  outreach_attempt:
    /\b(profile\s+came\s+through|college\s+.+\s+goals|would\s+later\s+today\s+or\s+tomorrow\s+work|last\s+follow-up|any\s+updates\s+or\s+questions|quick\s+(10\s+minute|ten\s+minute)?\s*call|wanted\s+to\s+connect|prospect\s+id.+call|call\s+about)\b/i,
};

const RESCHEDULE_OFFER_PATTERNS: readonly RegExp[] = [
  /\b(?:here\s+are|got|have|found|checking|send(?:ing)?|offer(?:ing)?)\s+(?:you\s+)?(?:a\s+)?(?:couple|few|two|2|some)?\s*(?:new\s+)?(?:options?|times?|slots?|openings?)\b/i,
  /\b(?:would|does|do)\s+(?:any\s+of\s+)?(?:these|those|this|that)\s+(?:times?|slots?|options?|openings?)\s+work\b/i,
  /\b(?:choose|pick|reply|text)\s+(?:1|one|2|two|which|what)\b[\s\S]*\b(?:reschedule|work|works|slot|time|option)\b/i,
  /\bcoach\s+.+\bchecking\s+what\s+works\s+best\s+to\s+reschedule\b/i,
  /\b\d\s*[-.)]\s*[^.\n]*(?:am|pm|et|ct|mt|pt|eastern|central|mountain|pacific)\b/i,
];

function normalizeText(value?: string | null): string {
  return String(value || '').trim();
}

function messageDateMs(value?: string | null): number {
  const parsed = Date.parse(normalizeText(value));
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function compareMessageDates(left?: string | null, right?: string | null): number {
  const leftMs = messageDateMs(left);
  const rightMs = messageDateMs(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) return leftMs - rightMs;
  return normalizeText(left).localeCompare(normalizeText(right));
}

function messageDateIsAfter(left?: string | null, right?: string | null): boolean {
  return compareMessageDates(left, right) > 0;
}

function messageDateIsBefore(left?: string | null, right?: string | null): boolean {
  return compareMessageDates(left, right) < 0;
}

function isReactionOnlyMessage(text?: string | null): boolean {
  return /^(?:Loved|Liked|Disliked|Laughed at|Emphasized|Questioned)\s+[“"][\s\S]+[”"]$/i.test(
    normalizeText(text),
  );
}

function isAttachmentOnlyPlaceholder(text?: string | null): boolean {
  return /^[\uFFFC\s]+$/.test(String(text || ''));
}

function isSubstantiveMessageBody(text?: string | null): boolean {
  const normalized = normalizeText(text);
  return Boolean(
    normalized && !isAttachmentOnlyPlaceholder(normalized) && !isReactionOnlyMessage(normalized),
  );
}

function isPostMeetingRecoveryContext(value?: string | null): boolean {
  return /\breschedule\s+pending\b|\bpending\s+reschedule\b|\bres\.\s*pending\b|\brsp\b|\bno\s*show\b|\bcancel(?:ed|led|ation)?\b/i.test(
    normalizeText(value),
  );
}

function isClientOptOut(text?: string | null): boolean {
  return /\b(no\s+longer\s+interested|not\s+interested|no\s+interest|do\s+not\s+contact|don't\s+contact|stop|unsubscribe|opt\s*out)\b/i.test(
    normalizeText(text),
  );
}

function isCallAttemptTiming(text?: string | null): boolean {
  return /\b(later\s+today|tomorrow|tmrw|tonight|after\s+work|at\s+work|working|call\s+me|call\s+back|available\s+(?:today|tomorrow)|free\s+(?:today|tomorrow)|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(
    normalizeText(text),
  );
}

export function classifyPendingClientThemeBucket(
  text?: string | null,
  theme?: ClientMessageTheme | null,
  taskTitle?: string | null,
): PendingClientThemeBucket {
  const body = normalizeText(text);
  const task = normalizeText(taskTitle);
  const combined = `${task}\n${body}`;
  if (isClientOptOut(body)) return 'Opt Out';
  if (/\bno\s*show\b/i.test(task)) return 'No Show';
  if (/\breschedule\s+pending\b|\bres\.\s*pending\b|\bpending\s+reschedule\b/i.test(task)) {
    return 'RSP';
  }
  if (/\bcancel(?:ed|led|ation)?\b/i.test(combined)) return 'Cancel';
  if (isCallAttemptTiming(body) || /\bcall\s+attempt\b/i.test(task)) return 'Call Attempt';
  if (theme === 'outreach_callback') return 'Call Attempt';
  if (
    theme === 'reschedule_request' ||
    /\breschedule|different\s+time|move\s+(?:the\s+)?meeting\b/i.test(body)
  ) {
    return 'RSP';
  }
  return 'Unclassified';
}

export function classifyClientMessageThemes(text?: string | null): ClientMessageTheme[] {
  const normalized = normalizeText(text);
  if (!normalized || !isSubstantiveMessageBody(normalized)) return [];
  return MISSED_CLIENT_REPLY_FLAGS.filter((theme) => FLAG_PATTERNS[theme].test(normalized));
}

export function classifyClientMessageTheme(text?: string | null): ClientMessageTheme | null {
  return classifyClientMessageThemes(text)[0] || null;
}

function sortMessagesOldestFirst(
  messages: ClientReplyThemeReviewMessageInput[],
): ClientReplyThemeReviewMessageInput[] {
  return [...messages].sort((left, right) => compareMessageDates(left.date, right.date));
}

function toMessageEvidence(
  message: ClientReplyThemeReviewMessageInput,
): ClientReplyMessageEvidence {
  return {
    guid: normalizeText(message.guid),
    body: normalizeText(message.body),
    date: normalizeText(message.date) || null,
    senderName: normalizeText(message.senderName) || null,
    isFromMe: Boolean(message.isFromMe),
  };
}

function templateContextForOutbound(text?: string | null): ClientMessageTemplateContext | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (TEMPLATE_PATTERNS.confirmation.test(normalized)) return 'confirmation';
  if (TEMPLATE_PATTERNS.outreach_attempt.test(normalized)) return 'outreach_attempt';
  return null;
}

export function isOperatorRescheduleOffer(text?: string | null): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (
    !/\b(reschedule|new\s+time|different\s+time|slots?|options?|openings?|times?)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  return RESCHEDULE_OFFER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function latestClientReplySignals(text?: string | null): ClientReplyLatestClientSignal[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const signals: ClientReplyLatestClientSignal[] = [];
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 5) signals.push('short_reply');
  if (/\?/.test(normalized)) signals.push('contains_question');
  if (/^\s*(?:1|2|3|one|two|three)\b/i.test(normalized)) {
    signals.push('contains_numeric_choice');
  }
  if (/\b(?:yes|yeah|yep|ok|okay|works?|that works|sounds good|perfect|great)\b/i.test(normalized)) {
    signals.push('contains_affirmation');
  }
  if (/\b(?:no|not|can't|cannot|wont|won't|busy|unavailable)\b/i.test(normalized)) {
    signals.push('contains_negative');
  }
  if (/\b(?:thanks|thank you|appreciate)\b/i.test(normalized)) {
    signals.push('contains_thanks');
  }
  if (/\b(?:call|phone|talk|ring)\b/i.test(normalized)) {
    signals.push('contains_call_word');
  }
  if (/\b(?:schedule|scheduled|reschedule|meeting|appointment|slot|time|works?)\b/i.test(normalized)) {
    signals.push('contains_schedule_word');
  }
  if (/\b(?:am|pm|morning|afternoon|evening|tonight|later|after|before|\d{1,2}(?::\d{2})?)\b/i.test(normalized)) {
    signals.push('contains_time_word');
  }
  if (/\b(?:today|tomorrow|tmrw|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i.test(normalized)) {
    signals.push('contains_day_word');
  }
  return Array.from(new Set(signals));
}

function buildObservationIds(args: {
  totalMessages: number;
  emptyBodyCount: number;
  latestDirection: ClientReplyThreadDiagnostics['latestDirection'];
  clientRepliedAfterLastOutbound: boolean;
  inboundThemes: ClientMessageTheme[];
  outboundTemplateContexts: ClientMessageTemplateContext[];
  outboundRescheduleOfferCount: number;
  taskSuggestsPostMeetingRecovery: boolean;
  nonSubstantiveMessageCount: number;
  reactionOnlyCount: number;
}): ClientReplyEvidenceObservationId[] {
  const observations: ClientReplyEvidenceObservationId[] = [];
  if (args.totalMessages > 0) observations.push('messages_present');
  if (args.emptyBodyCount > 0) observations.push('empty_body_present');
  if (args.nonSubstantiveMessageCount > 0) {
    observations.push('non_substantive_message_present');
  }
  if (args.reactionOnlyCount > 0) {
    observations.push('client_reaction_only_present');
  }
  if (args.latestDirection === 'client') observations.push('latest_message_from_client');
  if (args.latestDirection === 'operator') observations.push('latest_message_from_operator');
  if (args.clientRepliedAfterLastOutbound) {
    observations.push('client_replied_after_last_outbound');
  }
  observations.push(
    args.inboundThemes.length ? 'known_inbound_theme_detected' : 'no_known_inbound_theme',
  );
  observations.push(
    args.outboundTemplateContexts.length
      ? 'outbound_template_context_detected'
      : 'no_outbound_template_context',
  );
  if (args.outboundRescheduleOfferCount > 0) {
    observations.push('operator_reschedule_offer_detected');
  }
  if (args.taskSuggestsPostMeetingRecovery) {
    observations.push('post_meeting_recovery_context');
  }
  return observations;
}

export function buildClientReplyThreadDiagnostics(args: {
  messages: ClientReplyThemeReviewMessageInput[];
  taskTitle?: string | null;
}): ClientReplyThreadDiagnostics {
  const messages = sortMessagesOldestFirst(args.messages || []);
  const messagesWithDecodedBody = messages.filter((message) => normalizeText(message.body));
  const reactionOnlyCount = messagesWithDecodedBody.filter((message) =>
    isReactionOnlyMessage(message.body),
  ).length;
  const nonSubstantiveMessageCount = messagesWithDecodedBody.filter(
    (message) => !isSubstantiveMessageBody(message.body),
  ).length;
  const messagesWithBody = messages.filter((message) => isSubstantiveMessageBody(message.body));
  const inboundMessages = messagesWithBody.filter((message) => !message.isFromMe);
  const outboundMessages = messagesWithBody.filter((message) => message.isFromMe);
  const lastMessage = messagesWithBody[messagesWithBody.length - 1] || null;
  const lastInbound = inboundMessages[inboundMessages.length - 1] || null;
  const lastOutbound = outboundMessages[outboundMessages.length - 1] || null;
  const outboundTemplateContexts = Array.from(
    new Set(
      outboundMessages
        .map((message) => templateContextForOutbound(message.body))
        .filter((context): context is ClientMessageTemplateContext => Boolean(context)),
    ),
  );
  const inboundThemes = Array.from(
    new Set(inboundMessages.flatMap((message) => classifyClientMessageThemes(message.body))),
  );
  const latestDirection = lastMessage ? (lastMessage.isFromMe ? 'operator' : 'client') : 'none';
  const emptyBodyCount = messages.filter((message) => !normalizeText(message.body)).length;
  const clientRepliedAfterLastOutbound =
    Boolean(normalizeText(lastInbound?.date)) &&
    (!normalizeText(lastOutbound?.date) ||
      messageDateIsAfter(lastInbound?.date, lastOutbound?.date));
  const outboundRescheduleOfferCount = outboundMessages.filter((message) =>
    isOperatorRescheduleOffer(message.body),
  ).length;
  const taskSuggestsPostMeetingRecovery = isPostMeetingRecoveryContext(args.taskTitle);

  return {
    version: 1,
    observationIds: buildObservationIds({
      totalMessages: messages.length,
      emptyBodyCount,
      latestDirection,
      clientRepliedAfterLastOutbound,
      inboundThemes,
      outboundTemplateContexts,
      outboundRescheduleOfferCount,
      taskSuggestsPostMeetingRecovery,
      nonSubstantiveMessageCount,
      reactionOnlyCount,
    }),
    totalMessages: messages.length,
    inboundCount: inboundMessages.length,
    outboundCount: outboundMessages.length,
    emptyBodyCount,
    latestDirection,
    lastInboundAt: normalizeText(lastInbound?.date) || null,
    lastOutboundAt: normalizeText(lastOutbound?.date) || null,
    clientRepliedAfterLastOutbound,
    outboundTemplateContexts,
    inboundThemes,
    outboundRescheduleOfferCount,
    taskSuggestsPostMeetingRecovery,
    latestClientReplySignals:
      latestDirection === 'client' ? latestClientReplySignals(lastMessage?.body) : [],
    nonSubstantiveMessageCount,
    reactionOnlyCount,
  };
}

export function interpretClientReplyThreadDiagnostics(
  diagnostics: ClientReplyThreadDiagnostics,
): ClientReplyThreadDiagnosticMeaning {
  if (!diagnostics.totalMessages || (!diagnostics.inboundCount && !diagnostics.outboundCount)) {
    return {
      state: 'insufficient_message_evidence',
      interpretation: 'No decoded inbound/outbound message evidence was available for this thread.',
      nextHardeningTarget: 'inspect_message_decoding',
    };
  }
  if (diagnostics.latestDirection === 'client' && !diagnostics.inboundThemes.length) {
    const signals = new Set(diagnostics.latestClientReplySignals);
    const hasSchedulingSignal =
      signals.has('contains_schedule_word') ||
      signals.has('contains_time_word') ||
      signals.has('contains_day_word') ||
      signals.has('contains_numeric_choice');
    const hasCallSchedulingSignal = signals.has('contains_call_word') && hasSchedulingSignal;
    if (
      diagnostics.taskSuggestsPostMeetingRecovery &&
      diagnostics.outboundTemplateContexts.length &&
      (hasCallSchedulingSignal ||
        (signals.has('contains_schedule_word') && signals.has('contains_time_word')))
    ) {
      return {
        state: 'client_latest_unparsed_scheduling_reply',
        interpretation:
          'Client sent the latest message with scheduling-like signals in a post-meeting recovery thread, but no deterministic reply theme matched.',
        nextHardeningTarget: 'manual_source_review',
      };
    }
    if (!diagnostics.outboundTemplateContexts.length && !hasSchedulingSignal) {
      return {
        state: 'client_latest_unparsed_weak_reply',
        interpretation:
          'Client sent the latest message, but only weak or context-free signals were detected; this is not enough to expand automation patterns.',
        nextHardeningTarget: 'none/read_only',
      };
    }
    return {
      state: 'client_latest_unparsed_reply',
      interpretation:
        'Client sent the latest meaningful message, but deterministic reply-theme parsing found no known actionable theme.',
      nextHardeningTarget: 'expand_reply_theme_patterns',
    };
  }
  if (diagnostics.inboundThemes.length && !diagnostics.outboundTemplateContexts.length) {
    return {
      state: 'theme_present_missing_template_context',
      interpretation:
        'Client wording matched a known theme, but no prior outbound template context explains what workflow it belongs to.',
      nextHardeningTarget: 'expand_outbound_template_context',
    };
  }
  if (diagnostics.latestDirection === 'operator') {
    if (diagnostics.inboundThemes.length) {
      return {
        state: 'theme_present_but_operator_latest',
        interpretation:
          'A known client theme exists in the thread, but the operator sent the latest meaningful message afterward.',
        nextHardeningTarget: 'none/read_only',
      };
    }
    return {
      state: 'operator_latest_no_open_client_reply',
      interpretation:
        'Operator sent the latest meaningful message and no unhandled actionable client theme is visible.',
      nextHardeningTarget: 'none/read_only',
    };
  }
  return {
    state: 'insufficient_message_evidence',
    interpretation:
      'Thread has message evidence, but it does not meet a deterministic actionable state.',
    nextHardeningTarget: 'inspect_message_decoding',
  };
}

function buildClientReplyEvidence(args: {
  messages: ClientReplyThemeReviewMessageInput[];
  inbound: ClientReplyThemeReviewMessageInput;
  theme: ClientMessageTheme;
  taskTitle?: string | null;
}): ClientReplyEvidence {
  const inboundDate = normalizeText(args.inbound.date);
  const meaningful = args.messages.filter((message) => isSubstantiveMessageBody(message.body));
  const inboundMessages = meaningful.filter((message) => !message.isFromMe);
  const outboundMessages = meaningful.filter((message) => message.isFromMe);
  const outboundAfterInbound = outboundMessages.filter(
    (message) => messageDateIsAfter(message.date, inboundDate),
  );
  const rescheduleOffersAfterInbound = outboundAfterInbound.filter((message) =>
    isOperatorRescheduleOffer(message.body),
  );
  const lastRescheduleOffer =
    rescheduleOffersAfterInbound[rescheduleOffersAfterInbound.length - 1] || null;
  const lastRescheduleOfferDate = normalizeText(lastRescheduleOffer?.date);
  const clientRepliedAfterOperatorTimes =
    Boolean(lastRescheduleOfferDate) &&
    inboundMessages.some((message) => messageDateIsAfter(message.date, lastRescheduleOfferDate));
  const lastInbound = inboundMessages[inboundMessages.length - 1] || args.inbound;
  const lastOutbound = outboundMessages[outboundMessages.length - 1] || null;

  return {
    themeBucket: classifyPendingClientThemeBucket(args.inbound.body, args.theme, args.taskTitle),
    lastMeaningfulInbound: lastInbound ? toMessageEvidence(lastInbound) : null,
    lastMeaningfulOutbound: lastOutbound ? toMessageEvidence(lastOutbound) : null,
    lastOperatorRescheduleOffer: lastRescheduleOffer
      ? toMessageEvidence(lastRescheduleOffer)
      : null,
    operatorRepliedAfterInbound: outboundAfterInbound.length > 0,
    operatorReplyProposedTimes: rescheduleOffersAfterInbound.length > 0,
    clientRepliedAfterOperatorTimes,
    clientOptedOut: isClientOptOut(args.inbound.body),
  };
}

function buildOutboundRescheduleOfferEvidence(args: {
  messages: ClientReplyThemeReviewMessageInput[];
  offer: ClientReplyThemeReviewMessageInput;
  taskTitle?: string | null;
}): ClientReplyEvidence {
  const meaningful = args.messages.filter((message) => isSubstantiveMessageBody(message.body));
  const inboundMessages = meaningful.filter((message) => !message.isFromMe);
  const outboundMessages = meaningful.filter((message) => message.isFromMe);
  const offerDate = normalizeText(args.offer.date);
  return {
    themeBucket: classifyPendingClientThemeBucket(
      args.offer.body,
      'reschedule_request',
      args.taskTitle,
    ),
    lastMeaningfulInbound: inboundMessages.length
      ? toMessageEvidence(inboundMessages[inboundMessages.length - 1])
      : null,
    lastMeaningfulOutbound: outboundMessages.length
      ? toMessageEvidence(outboundMessages[outboundMessages.length - 1])
      : toMessageEvidence(args.offer),
    lastOperatorRescheduleOffer: toMessageEvidence(args.offer),
    operatorRepliedAfterInbound: Boolean(
      inboundMessages.some((message) => messageDateIsBefore(message.date, offerDate)),
    ),
    operatorReplyProposedTimes: true,
    clientRepliedAfterOperatorTimes: Boolean(
      offerDate && inboundMessages.some((message) => messageDateIsAfter(message.date, offerDate)),
    ),
    clientOptedOut: false,
  };
}

function flagMatchesTemplateContext(
  theme: ClientMessageTheme,
  templateContext: ClientMessageTemplateContext | null,
): templateContext is ClientMessageTemplateContext {
  if (theme === 'reschedule_request') return templateContext === 'confirmation';
  if (theme === 'outreach_callback') return templateContext === 'outreach_attempt';
  return false;
}

function contextForTheme(theme: ClientMessageTheme): ClientMessageTemplateContext {
  return theme === 'reschedule_request' ? 'confirmation' : 'outreach_attempt';
}

export function buildClientReplyThemeReviewSnapshot(args: {
  generatedAt?: string;
  chats: ClientReplyThemeReviewChatInput[];
  messagesByChatGuid: Record<string, ClientReplyThemeReviewMessageInput[] | undefined>;
}): ClientReplyThemeReviewSnapshot {
  const rows: ClientReplyThemeReviewRow[] = [];
  const nearMisses: ClientReplyThemeNearMissRow[] = [];
  const ignoredHandled: ClientReplyThemeReviewRow[] = [];
  let totalMessagesReviewed = 0;

  for (const chat of args.chats) {
    const messages = sortMessagesOldestFirst(args.messagesByChatGuid[chat.guid] || []);
    totalMessagesReviewed += messages.length;
    let latestTemplateContext: ClientMessageTemplateContext | null = null;
    for (const message of messages) {
      if (message.isFromMe) {
        const nextTemplateContext = templateContextForOutbound(message.body);
        if (nextTemplateContext) {
          latestTemplateContext = nextTemplateContext;
        }
        continue;
      }

      const body = normalizeText(message.body);
      const themes = classifyClientMessageThemes(body);
      if (!body || !themes.length) continue;
      const theme = themes.find((candidate) =>
        flagMatchesTemplateContext(candidate, latestTemplateContext),
      );
      const candidateTheme = theme || themes[0];

      const messageDate = normalizeText(message.date);
      const operatorRepliedAfter = messages.some(
        (candidate) =>
          candidate.isFromMe &&
          messageDateIsAfter(candidate.date, messageDate) &&
          isSubstantiveMessageBody(candidate.body),
      );
      const operatorRescheduleOfferAfter = messages.some(
        (candidate) =>
          candidate.isFromMe &&
          messageDateIsAfter(candidate.date, messageDate) &&
          isOperatorRescheduleOffer(candidate.body),
      );
      const keepPendingRescheduleVisible =
        candidateTheme === 'reschedule_request' && isPostMeetingRecoveryContext(chat.taskTitle);

      const baseRow: ClientReplyThemeReviewRow = {
        id: `${chat.guid}:${message.guid}:${candidateTheme}`,
        chatGuid: chat.guid,
        messageGuid: message.guid,
        theme: candidateTheme,
        templateContext: latestTemplateContext || contextForTheme(candidateTheme),
        messageBody: body,
        messageDate: messageDate || null,
        senderName: normalizeText(message.senderName) || null,
        sender: normalizeText(message.sender) || null,
        displayName: normalizeText(chat.displayName),
        athleteName: normalizeText(chat.athleteName) || null,
        contactId: normalizeText(chat.contactId) || null,
        athleteMainId: normalizeText(chat.athleteMainId) || null,
        timezone: normalizeText(chat.timezone) || null,
        timezoneLabel: normalizeText(chat.timezoneLabel) || null,
        taskTitle: normalizeText(chat.taskTitle) || null,
        matchedPhones: chat.matchedPhones || [],
        operatorRepliedAfter,
        operatorRescheduleOfferAfter,
        replyEvidence: buildClientReplyEvidence({
          messages,
          inbound: message,
          theme: candidateTheme,
          taskTitle: chat.taskTitle,
        }),
      };

      if (theme && latestTemplateContext) {
        if (operatorRepliedAfter && !keepPendingRescheduleVisible) {
          ignoredHandled.push(baseRow);
        } else {
          rows.push(baseRow);
        }
        continue;
      }

      if (!operatorRepliedAfter) {
        nearMisses.push({
          ...baseRow,
          reason: latestTemplateContext ? 'wrong_template_context' : 'no_template_context',
        });
      }
    }

    const outboundRescheduleOffers = messages.filter(
      (message) => message.isFromMe && isOperatorRescheduleOffer(message.body),
    );
    const latestOutboundRescheduleOffer =
      outboundRescheduleOffers[outboundRescheduleOffers.length - 1] || null;
    const latestOfferDate = normalizeText(latestOutboundRescheduleOffer?.date);
    const clientRepliedAfterLatestOffer = Boolean(
      latestOfferDate &&
        messages.some(
          (message) => !message.isFromMe && messageDateIsAfter(message.date, latestOfferDate),
        ),
    );
    const alreadyHasOfferRow = rows.some(
      (row) => row.chatGuid === chat.guid && row.replyEvidence?.operatorReplyProposedTimes,
    );
    if (
      latestOutboundRescheduleOffer &&
      isPostMeetingRecoveryContext(chat.taskTitle) &&
      !clientRepliedAfterLatestOffer &&
      !alreadyHasOfferRow
    ) {
      rows.push({
        id: `${chat.guid}:${latestOutboundRescheduleOffer.guid}:outbound_reschedule_offer`,
        chatGuid: chat.guid,
        messageGuid: latestOutboundRescheduleOffer.guid,
        theme: 'reschedule_request',
        templateContext: 'confirmation',
        messageBody: normalizeText(latestOutboundRescheduleOffer.body),
        messageDate: latestOfferDate || null,
        senderName: normalizeText(latestOutboundRescheduleOffer.senderName) || null,
        sender: normalizeText(latestOutboundRescheduleOffer.sender) || null,
        displayName: normalizeText(chat.displayName),
        athleteName: normalizeText(chat.athleteName) || null,
        contactId: normalizeText(chat.contactId) || null,
        athleteMainId: normalizeText(chat.athleteMainId) || null,
        timezone: normalizeText(chat.timezone) || null,
        timezoneLabel: normalizeText(chat.timezoneLabel) || null,
        taskTitle: normalizeText(chat.taskTitle) || null,
        matchedPhones: chat.matchedPhones || [],
        operatorRepliedAfter: true,
        operatorRescheduleOfferAfter: true,
        replyEvidence: buildOutboundRescheduleOfferEvidence({
          messages,
          offer: latestOutboundRescheduleOffer,
          taskTitle: chat.taskTitle,
        }),
      });
    }
  }

  return {
    version: 1,
    generatedAt: args.generatedAt || new Date().toISOString(),
    totalChatsReviewed: args.chats.length,
    totalMessagesReviewed,
    rows,
    nearMisses,
    ignoredHandled,
  };
}

function isClientReplyThemeReviewSnapshot(
  value: Partial<ClientReplyThemeReviewSnapshot>,
): value is ClientReplyThemeReviewSnapshot {
  return value.version === 1 && typeof value.generatedAt === 'string' && Array.isArray(value.rows);
}

export async function readCachedClientReplyThemeReviewSnapshot(
  storage: ClientReplyThemeReviewStorage,
): Promise<ClientReplyThemeReviewSnapshot | null> {
  const raw = await storage.getItem(CLIENT_REPLY_THEME_REVIEW_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ClientReplyThemeReviewSnapshot>;
    return isClientReplyThemeReviewSnapshot(parsed)
      ? {
          ...parsed,
          nearMisses: parsed.nearMisses || [],
          ignoredHandled: parsed.ignoredHandled || [],
        }
      : null;
  } catch {
    return null;
  }
}

export async function writeCachedClientReplyThemeReviewSnapshot(
  storage: ClientReplyThemeReviewStorage,
  snapshot: ClientReplyThemeReviewSnapshot,
): Promise<void> {
  await storage.setItem(CLIENT_REPLY_THEME_REVIEW_CACHE_KEY, JSON.stringify(snapshot));
}
