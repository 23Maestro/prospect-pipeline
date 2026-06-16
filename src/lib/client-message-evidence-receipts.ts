export type ClientMessageEvidenceAdmissionSource = 'contact_cache' | 'merged';
export type ClientMessageEvidenceSegment = 'client' | 'pending';
export type ClientMessageEvidenceAmbiguity = 'none' | 'multiple_athletes';
export type ClientMessageEvidenceBodySource = 'attributedBody' | 'text' | 'empty';

export type ClientMessageThreadEvidenceChat = {
  guid: string;
  serviceName: 'iMessage' | 'SMS';
  isGroup: boolean;
  participantCount: number;
  matchedPhones: string[];
  clientMatch: {
    source: ClientMessageEvidenceAdmissionSource;
    segment: ClientMessageEvidenceSegment;
    contactId?: string | null;
    athleteMainId?: string | null;
    currentTaskId?: string | null;
    currentTaskTitle?: string | null;
    crmStage?: string | null;
    taskStatus?: string | null;
    ambiguity?: ClientMessageEvidenceAmbiguity | null;
    associatedClientsCount?: number | null;
  };
};

export type ClientMessageThreadEvidenceMessage = {
  guid: string;
  date?: string | null;
  isFromMe: boolean;
  body?: string | null;
  bodySource: ClientMessageEvidenceBodySource;
};

export type ClientMessageThreadEvidenceReceipt = {
  version: 1;
  flow: '10x_communications';
  step: 'read-message-thread-evidence';
  generatedAt: string;
  sourceSurfaces: ['local_messages_sql', 'athlete_contact_cache'];
  admission: {
    admittedBy: ClientMessageEvidenceAdmissionSource;
    segment: ClientMessageEvidenceSegment;
    ambiguity: ClientMessageEvidenceAmbiguity;
    matchedPhonesCount: number;
    associatedClientsCount: number;
  };
  ids: {
    chatGuid: string;
    contactId: string | null;
    athleteMainId: string | null;
    currentTaskId: string | null;
  };
  thread: {
    serviceName: 'iMessage' | 'SMS';
    isGroup: boolean;
    participantCount: number;
    totalMessages: number;
    inboundCount: number;
    outboundCount: number;
    decodedAttributedBodyCount: number;
    plainTextBodyCount: number;
    emptyBodyCount: number;
    firstMessageAt: string | null;
    lastMessageAt: string | null;
  };
  direction: {
    lastInboundGuid: string | null;
    lastOutboundGuid: string | null;
    operatorSentLatestMessage: boolean;
    clientSentLatestMessage: boolean;
  };
  context: {
    crmStage: string | null;
    taskStatus: string | null;
    currentTaskTitle: string | null;
  };
};

function normalizedText(value?: string | null): string {
  return String(value || '').trim();
}

function sortedByDate(
  messages: ClientMessageThreadEvidenceMessage[],
): ClientMessageThreadEvidenceMessage[] {
  return [...messages].sort((left, right) => {
    const leftDate = normalizedText(left.date);
    const rightDate = normalizedText(right.date);
    if (!leftDate && !rightDate) return 0;
    if (!leftDate) return -1;
    if (!rightDate) return 1;
    return leftDate.localeCompare(rightDate);
  });
}

function lastMessageGuid(
  messages: ClientMessageThreadEvidenceMessage[],
  isFromMe: boolean,
): string | null {
  const match = [...messages].reverse().find((message) => message.isFromMe === isFromMe);
  return match?.guid || null;
}

export function buildClientMessageThreadEvidenceReceipt(args: {
  generatedAt?: string;
  chat: ClientMessageThreadEvidenceChat;
  messages: ClientMessageThreadEvidenceMessage[];
}): ClientMessageThreadEvidenceReceipt {
  const messages = sortedByDate(args.messages);
  const latestMessage = messages[messages.length - 1] || null;
  const inboundCount = messages.filter((message) => !message.isFromMe).length;
  const outboundCount = messages.filter((message) => message.isFromMe).length;

  return {
    version: 1,
    flow: '10x_communications',
    step: 'read-message-thread-evidence',
    generatedAt: args.generatedAt || new Date().toISOString(),
    sourceSurfaces: ['local_messages_sql', 'athlete_contact_cache'],
    admission: {
      admittedBy: args.chat.clientMatch.source,
      segment: args.chat.clientMatch.segment,
      ambiguity: args.chat.clientMatch.ambiguity || 'none',
      matchedPhonesCount: args.chat.matchedPhones.length,
      associatedClientsCount: args.chat.clientMatch.associatedClientsCount || 0,
    },
    ids: {
      chatGuid: args.chat.guid,
      contactId: normalizedText(args.chat.clientMatch.contactId) || null,
      athleteMainId: normalizedText(args.chat.clientMatch.athleteMainId) || null,
      currentTaskId: normalizedText(args.chat.clientMatch.currentTaskId) || null,
    },
    thread: {
      serviceName: args.chat.serviceName,
      isGroup: args.chat.isGroup,
      participantCount: args.chat.participantCount,
      totalMessages: messages.length,
      inboundCount,
      outboundCount,
      decodedAttributedBodyCount: messages.filter(
        (message) => message.bodySource === 'attributedBody',
      ).length,
      plainTextBodyCount: messages.filter((message) => message.bodySource === 'text').length,
      emptyBodyCount: messages.filter(
        (message) => message.bodySource === 'empty' || !normalizedText(message.body),
      ).length,
      firstMessageAt: normalizedText(messages[0]?.date) || null,
      lastMessageAt: normalizedText(latestMessage?.date) || null,
    },
    direction: {
      lastInboundGuid: lastMessageGuid(messages, false),
      lastOutboundGuid: lastMessageGuid(messages, true),
      operatorSentLatestMessage: latestMessage?.isFromMe === true,
      clientSentLatestMessage: latestMessage ? latestMessage.isFromMe === false : false,
    },
    context: {
      crmStage: normalizedText(args.chat.clientMatch.crmStage) || null,
      taskStatus: normalizedText(args.chat.clientMatch.taskStatus) || null,
      currentTaskTitle: normalizedText(args.chat.clientMatch.currentTaskTitle) || null,
    },
  };
}
