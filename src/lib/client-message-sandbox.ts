import { homedir } from 'os';
import { resolve } from 'path';

import { Color, Icon, Image } from '@raycast/api';
import { executeSQL, runAppleScript, usePromise, useSQL } from '@raycast/utils';

import {
  resolveStudentAthleteMessagesForPhones,
  type StudentAthleteMessageAssociatedContact,
  type StudentAthleteMessageResolution,
} from './student-athlete-message-resolver';
import {
  buildClientReplyThemeReviewSnapshot,
  type ClientReplyThemeReviewMessageInput,
  type ClientReplyThemeReviewSnapshot,
} from './client-message-reply-themes';

const DB_PATH = resolve(homedir(), 'Library/Messages/chat.db');

export type ClientSegment = 'client' | 'pending';

export type ClientDirectoryAssociatedContact = StudentAthleteMessageAssociatedContact;

export type ClientDirectoryMatch = {
  normalizedPhone: string;
  displayName: string;
  athleteName?: string | null;
  segment: ClientSegment;
  crmStage?: string | null;
  taskStatus?: string | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  contactId?: string | null;
  athleteMainId?: string | null;
  timezone?: string | null;
  timezoneLabel?: string | null;
  associatedClients?: ClientDirectoryAssociatedContact[];
  ambiguity?: 'none' | 'multiple_athletes';
  source: 'contact_cache' | 'merged';
};

export type ClientInboxChat = {
  guid: string;
  chat_identifier: string;
  participant_identifier: string;
  service_name: 'iMessage' | 'SMS';
  display_name: string | null;
  group_name: string | null;
  group_participants: string | null;
  is_group: boolean;
  participant_count: number;
  last_message_date: string;
  displayName: string;
  matchedPhones: string[];
  avatar?: Image.ImageLike;
  clientMatch: ClientDirectoryMatch;
};

type SQLChat = {
  guid: string;
  chat_identifier: string;
  participant_identifier: string | null;
  display_name: string | null;
  service_name: 'iMessage' | 'SMS';
  group_name: string | null;
  group_participants: string | null;
  is_group: boolean;
  participant_count: number;
  last_message_date: string;
};

const CLIENT_INBOX_CHATS_SQL = `
      SELECT
        chat.guid,
        chat.chat_identifier,
        MAX(handle.id) as participant_identifier,
        chat.display_name,
        chat.service_name,
        CASE
          WHEN chat.chat_identifier LIKE '%chat%' AND chat.display_name IS NOT NULL AND chat.display_name != ''
          THEN chat.display_name
          ELSE NULL
        END as group_name,
        CASE WHEN COUNT(DISTINCT handle.id) > 1 THEN 1 ELSE 0 END as is_group,
        COUNT(DISTINCT handle.id) as participant_count,
        strftime('%Y-%m-%dT%H:%M:%fZ', datetime(
          MAX(message.date) / 1000000000 + strftime('%s', '2001-01-01'),
          'unixepoch'
        )) AS last_message_date,
        CASE
          WHEN COUNT(DISTINCT handle.id) > 1 THEN GROUP_CONCAT(DISTINCT handle.id)
          ELSE handle.id
        END as group_participants
      FROM chat
      JOIN chat_message_join ON chat."ROWID" = chat_message_join.chat_id
      JOIN message ON chat_message_join.message_id = message."ROWID"
      LEFT JOIN chat_handle_join ON chat."ROWID" = chat_handle_join.chat_id
      LEFT JOIN handle ON chat_handle_join.handle_id = handle."ROWID"
      WHERE handle.id IS NOT NULL
      GROUP BY chat.guid
      ORDER BY last_message_date DESC
      LIMIT 1000;
    `;

type SQLMessage = {
  guid: string;
  date: string;
  date_read: string | null;
  body: string;
  service: 'iMessage' | 'SMS';
  is_audio_message: boolean;
  is_from_me: boolean;
  is_sent: boolean;
  is_read: boolean;
  chat_identifier: string;
  display_name: string | null;
  group_name: string | null;
  is_group: boolean;
  group_participants: string | null;
  attachment_filename: string | null;
  attachment_name: string | null;
  attachment_mime_type: string | null;
};

type RecentOutgoingMessageRow = {
  rowid: number;
  address: string | null;
  body: string | null;
  text: string | null;
  error: number | null;
  service: 'iMessage' | 'SMS' | null;
};

export type ClientMessageSendVerification = {
  ok: boolean;
  rowId?: number;
  error?: string;
  messageError?: number | null;
};

export type ClientThreadMessage = SQLMessage & {
  sender: string;
  senderName: string;
};

export function normalizePhoneForClientMatch(raw?: string | null): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

export function toClientDisplayName(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part
        .split('-')
        .map((piece) => (piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece))
        .join('-'),
    )
    .join(' ');
}

function buildChatDisplayName(chat: SQLChat): string {
  return (
    toClientDisplayName(chat.display_name) ||
    String(chat.participant_identifier || chat.chat_identifier).trim()
  );
}

function getChatParticipantPhones(
  chat: Pick<
    SQLChat,
    'is_group' | 'group_participants' | 'participant_identifier' | 'chat_identifier'
  >,
) {
  const rawParticipants = chat.is_group
    ? String(chat.group_participants || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : [String(chat.participant_identifier || chat.chat_identifier || '').trim()].filter(Boolean);

  return rawParticipants
    .map((value) => normalizePhoneForClientMatch(value))
    .filter((value): value is string => Boolean(value));
}

function resolveMatchedPhones(
  chat: Pick<
    SQLChat,
    'is_group' | 'group_participants' | 'participant_identifier' | 'chat_identifier'
  >,
  matchesByPhone?: Map<string, ClientDirectoryMatch>,
) {
  const matchedPhones = getChatParticipantPhones(chat).filter((phone) =>
    matchesByPhone?.has(phone),
  );
  return Array.from(new Set(matchedPhones));
}

function resolveClientMatchForChat(
  chat: SQLChat,
  matchesByPhone?: Map<string, ClientDirectoryMatch>,
) {
  const matchedPhones = resolveMatchedPhones(chat, matchesByPhone);
  if (!matchedPhones.length || !matchesByPhone) {
    return null;
  }

  const clientMatch = matchedPhones
    .map((phone) => matchesByPhone.get(phone))
    .filter((match): match is ClientDirectoryMatch => Boolean(match))
    .reduce<ClientDirectoryMatch | null>(
      (merged, match) => mergeMatch(merged || undefined, match),
      null,
    );

  if (!clientMatch) {
    return null;
  }

  return {
    clientMatch,
    matchedPhones,
  };
}

function resolveInboxDisplayName(chat: SQLChat, clientMatch: ClientDirectoryMatch): string {
  if (chat.is_group) {
    return String(chat.group_name || chat.display_name || '').trim() || buildChatDisplayName(chat);
  }

  return clientMatch.displayName || buildChatDisplayName(chat);
}

function fuzzySearch(text: string, searchTerms: string[]): boolean {
  const lowerText = text.toLowerCase();
  let textIndex = 0;
  let termIndex = 0;

  while (textIndex < lowerText.length && termIndex < searchTerms.length) {
    if (lowerText[textIndex] === searchTerms[termIndex][0]) {
      let matchLength = 1;
      while (
        matchLength < searchTerms[termIndex].length &&
        textIndex + matchLength < lowerText.length &&
        lowerText[textIndex + matchLength] === searchTerms[termIndex][matchLength]
      ) {
        matchLength++;
      }
      if (matchLength === searchTerms[termIndex].length) {
        termIndex++;
      }
    }
    textIndex++;
  }

  return termIndex === searchTerms.length;
}

function mergeMatch(
  existing: ClientDirectoryMatch | undefined,
  incoming: ClientDirectoryMatch,
): ClientDirectoryMatch {
  if (!existing) {
    return incoming;
  }

  return {
    ...existing,
    ...incoming,
    displayName: existing.displayName || incoming.displayName,
    athleteName: existing.athleteName || incoming.athleteName,
    crmStage: existing.crmStage || incoming.crmStage,
    taskStatus: existing.taskStatus || incoming.taskStatus,
    currentTaskId: existing.currentTaskId || incoming.currentTaskId,
    currentTaskTitle: existing.currentTaskTitle || incoming.currentTaskTitle,
    contactId: existing.contactId || incoming.contactId,
    athleteMainId: existing.athleteMainId || incoming.athleteMainId,
    timezone: existing.timezone || incoming.timezone,
    timezoneLabel: existing.timezoneLabel || incoming.timezoneLabel,
    associatedClients: mergeAssociatedContacts(
      existing.associatedClients,
      incoming.associatedClients,
    ),
    ambiguity:
      existing.ambiguity === 'multiple_athletes' || incoming.ambiguity === 'multiple_athletes'
        ? 'multiple_athletes'
        : existing.ambiguity || incoming.ambiguity,
    segment: existing.segment === 'client' || incoming.segment === 'client' ? 'client' : 'pending',
    source: existing.source === incoming.source ? existing.source : 'merged',
  };
}

function mergeAssociatedContacts(
  existing?: ClientDirectoryAssociatedContact[],
  incoming?: ClientDirectoryAssociatedContact[],
): ClientDirectoryAssociatedContact[] | undefined {
  const merged = [...(existing || []), ...(incoming || [])].filter(
    (contact) => contact.normalizedPhoneNumber,
  );
  if (!merged.length) return undefined;
  return Array.from(
    new Map(
      merged.map((contact) => [`${contact.role}:${contact.normalizedPhoneNumber}`, contact]),
    ).values(),
  );
}

function mergeContactCacheMatches(
  matchesByPhone: Map<string, ClientDirectoryMatch>,
  resolutions: StudentAthleteMessageResolution[],
) {
  for (const resolution of resolutions) {
    matchesByPhone.set(
      resolution.normalizedPhone,
      mergeMatch(matchesByPhone.get(resolution.normalizedPhone), {
        normalizedPhone: resolution.normalizedPhone,
        displayName: resolution.displayName,
        athleteName: resolution.athleteName,
        segment: 'client',
        crmStage: resolution.crmStage,
        taskStatus: resolution.taskStatus,
        currentTaskId: resolution.currentTaskId,
        currentTaskTitle: resolution.currentTaskTitle,
        contactId: resolution.contactId,
        athleteMainId: resolution.athleteMainId,
        timezone: resolution.timezone,
        timezoneLabel: resolution.timezoneLabel,
        associatedClients: resolution.associatedContacts,
        ambiguity: resolution.ambiguity,
        source: 'contact_cache',
      }),
    );
  }
}

export async function loadClientDirectory(chats: SQLChat[] = []) {
  const matchesByPhone = new Map<string, ClientDirectoryMatch>();
  const chatPhones = Array.from(new Set(chats.flatMap((chat) => getChatParticipantPhones(chat))));
  const contactCacheResolutions = await resolveStudentAthleteMessagesForPhones(chatPhones);

  mergeContactCacheMatches(matchesByPhone, contactCacheResolutions);

  return {
    matchesByPhone,
    generatedAt: null,
    exportPath: null,
  };
}

function buildClientInboxChatsFromDirectory(
  rawData: SQLChat[],
  matchesByPhone?: Map<string, ClientDirectoryMatch>,
  searchText = '',
  limit = 50,
): ClientInboxChat[] {
  return (
    rawData
      .map((chat) => {
        const participantIdentifier = String(chat.participant_identifier || '').trim();
        const resolvedMatch = resolveClientMatchForChat(chat, matchesByPhone);
        if (!resolvedMatch) return null;
        return {
          ...chat,
          participant_identifier: participantIdentifier,
          displayName: resolveInboxDisplayName(chat, resolvedMatch.clientMatch),
          matchedPhones: resolvedMatch.matchedPhones,
          avatar: { source: Icon.PersonCircle, tintColor: Color.SecondaryText } as Image.ImageLike,
          clientMatch: resolvedMatch.clientMatch,
        } satisfies ClientInboxChat;
      })
      .filter(Boolean) as ClientInboxChat[]
  )
    .filter((chat) => {
      const terms = searchText.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return true;
      return fuzzySearch(
        [
          chat.displayName,
          chat.clientMatch.athleteName,
          chat.clientMatch.currentTaskTitle,
          chat.clientMatch.taskStatus,
          chat.clientMatch.crmStage,
          chat.participant_identifier,
          chat.group_participants,
          ...chat.matchedPhones,
        ]
          .filter(Boolean)
          .join(' '),
        terms,
      );
    })
    .slice(0, limit);
}

export async function loadClientInboxChats(searchText = '', limit = 50): Promise<ClientInboxChat[]> {
  const rawData = await executeSQL<SQLChat>(DB_PATH, CLIENT_INBOX_CHATS_SQL);
  const clientDirectory = await loadClientDirectory(rawData || []);
  return buildClientInboxChatsFromDirectory(
    rawData || [],
    clientDirectory.matchesByPhone,
    searchText,
    limit,
  );
}

export async function buildClientReplyThemeReviewSnapshotForChats(
  chats: ClientInboxChat[],
): Promise<ClientReplyThemeReviewSnapshot> {
  const messagesByChatGuidEntries = await Promise.all(
    chats.map(async (chat) => {
      const messages = await getClientThreadMessages(chat.guid, chat.displayName).catch(
        () => [] as ClientThreadMessage[],
      );
      return [
        chat.guid,
        messages.map(
          (message): ClientReplyThemeReviewMessageInput => ({
            guid: message.guid,
            body: message.body,
            date: message.date,
            senderName: message.senderName,
            sender: message.sender,
            isFromMe: message.is_from_me,
          }),
        ),
      ] as const;
    }),
  );

  return buildClientReplyThemeReviewSnapshot({
    chats: chats.map((chat) => ({
      guid: chat.guid,
      displayName: chat.displayName,
      lastMessageDate: chat.last_message_date,
      athleteName: chat.clientMatch.athleteName,
      contactId: chat.clientMatch.contactId,
      athleteMainId: chat.clientMatch.athleteMainId,
      timezone: chat.clientMatch.timezone,
      timezoneLabel: chat.clientMatch.timezoneLabel,
      taskTitle: chat.clientMatch.currentTaskTitle || chat.clientMatch.taskStatus,
      matchedPhones: chat.matchedPhones,
    })),
    messagesByChatGuid: Object.fromEntries(messagesByChatGuidEntries),
  });
}

export function useClientInboxChats(searchText = '') {
  const {
    data: rawData,
    isLoading: isLoadingChats,
    permissionView,
    ...rest
  } = useSQL<SQLChat>(
    DB_PATH,
    CLIENT_INBOX_CHATS_SQL,
    {
      permissionPriming: 'This is required to read your Messages chats.',
    },
  );

  const {
    data: clientDirectory,
    isLoading: isLoadingDirectory,
    error: directoryError,
    revalidate: revalidateDirectory,
  } = usePromise(loadClientDirectory, [rawData || []]);

  const chats = buildClientInboxChatsFromDirectory(
    rawData || [],
    clientDirectory?.matchesByPhone,
    searchText,
  );

  return {
    data: chats,
    isLoading: isLoadingChats || isLoadingDirectory,
    permissionView,
    revalidateDirectory,
    directory: clientDirectory,
    directoryError,
    ...rest,
  };
}

export function decodeHexString(hexString: string): string {
  const START_PATTERN: number[] = [0x01, 0x2b];
  const END_PATTERN: number[] = [0x86, 0x84];
  const bytes = hexString.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [];

  let startIndex = -1;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === START_PATTERN[0] && bytes[i + 1] === START_PATTERN[1]) {
      startIndex = i + 2;
      break;
    }
  }
  if (startIndex === -1) return '';

  let endIndex = -1;
  for (let i = startIndex; i < bytes.length - 1; i++) {
    if (bytes[i] === END_PATTERN[0] && bytes[i + 1] === END_PATTERN[1]) {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) return '';

  const relevantBytes = bytes.slice(startIndex, endIndex);
  let result: string;
  try {
    result = new TextDecoder().decode(new Uint8Array(relevantBytes));
  } catch {
    result = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(relevantBytes));
  }

  return result.charCodeAt(0) < 128 ? result.slice(1) : result.slice(3);
}

export async function getClientThreadMessages(
  chatGuid: string,
  senderName: string,
  searchText?: string,
): Promise<ClientThreadMessage[]> {
  const rawData = await executeSQL<SQLMessage>(
    DB_PATH,
    `
    SELECT
      message.guid,
      strftime('%Y-%m-%dT%H:%M:%fZ', datetime(
        message.date / 1000000000 + strftime('%s', '2001-01-01'),
        'unixepoch'
      )) AS date,
      strftime('%Y-%m-%dT%H:%M:%fZ', datetime(
        message.date_read / 1000000000 + strftime('%s', '2001-01-01'),
        'unixepoch'
      )) AS date_read,
      message.is_from_me,
      message.is_audio_message,
      message.is_sent,
      message.is_read,
      chat.chat_identifier,
      chat.display_name,
      CASE
        WHEN chat.chat_identifier LIKE '%chat%' AND chat.display_name IS NOT NULL AND chat.display_name != ''
        THEN chat.display_name
        ELSE NULL
      END as group_name,
      message.service,
      hex(message.attributedBody) as body,
      CASE WHEN COUNT(DISTINCT handle.id) > 1 THEN 1 ELSE 0 END as is_group,
      CASE
        WHEN COUNT(DISTINCT handle.id) > 1 THEN GROUP_CONCAT(DISTINCT handle.id)
        ELSE handle.id
      END as group_participants,
      attachment.filename as attachment_filename,
      attachment.transfer_name as attachment_name,
      attachment.mime_type as attachment_mime_type
    FROM message
      JOIN chat_message_join ON message."ROWID" = chat_message_join.message_id
      JOIN chat ON chat_message_join.chat_id = chat."ROWID"
      LEFT JOIN chat_handle_join ON chat."ROWID" = chat_handle_join.chat_id
      LEFT JOIN handle ON chat_handle_join.handle_id = handle."ROWID"
      LEFT JOIN message_attachment_join ON message."ROWID" = message_attachment_join.message_id
      LEFT JOIN attachment ON message_attachment_join.attachment_id = attachment."ROWID"
    WHERE message.attributedBody IS NOT NULL
      AND chat.guid = '${chatGuid.replace(/'/g, "''")}'
    GROUP BY message.guid
    ORDER BY date DESC
    LIMIT 100
    `,
  );

  const messages = (rawData || []).map((message) => ({
    ...message,
    body: decodeHexString(message.body),
    sender: message.chat_identifier,
    senderName: message.is_from_me ? 'Me' : senderName,
    is_from_me: Boolean(message.is_from_me),
    is_audio_message: Boolean(message.is_audio_message),
    is_sent: Boolean(message.is_sent),
    is_read: message.is_sent ? true : Boolean(message.is_read),
  }));

  const terms = String(searchText || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return messages;

  return messages.filter((message) =>
    fuzzySearch([message.body, message.senderName, message.sender].join(' ').toLowerCase(), terms),
  );
}

async function isMessagesAppRunning() {
  const result = await runAppleScript(`
    tell application "System Events"
      return (count of (every process whose name is "Messages")) > 0
    end tell
  `);
  return result === 'true';
}

async function quitMessagesApp() {
  try {
    await runAppleScript(`
      tell application "Messages"
        quit
      end tell
    `);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/User\s+canceled/i.test(message) || /\(-128\)/.test(message)) {
      return;
    }
    throw error;
  }
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeMessageBodyForSendVerification(value?: string | null): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function formatAppleMessageDateThreshold(sentAfterMs: number): number {
  const appleEpochOffsetSeconds = 978307200;
  return Math.floor((sentAfterMs / 1000 - appleEpochOffsetSeconds) * 1000000000);
}

export async function verifyRecentClientMessageSend(args: {
  address: string;
  text: string;
  sentAfterMs: number;
  serviceName?: 'iMessage' | 'SMS';
}): Promise<ClientMessageSendVerification> {
  const expectedPhone = normalizePhoneForClientMatch(args.address);
  const expectedBody = normalizeMessageBodyForSendVerification(args.text);
  if (!expectedPhone) {
    return { ok: false, error: 'Could not verify send: missing recipient phone.' };
  }
  if (!expectedBody) {
    return { ok: false, error: 'Could not verify send: missing message body.' };
  }

  const threshold = formatAppleMessageDateThreshold(args.sentAfterMs - 3000);
  const rows = await executeSQL<RecentOutgoingMessageRow>(
    DB_PATH,
    `
    SELECT
      message.ROWID as rowid,
      handle.id as address,
      hex(message.attributedBody) as body,
      message.text as text,
      message.error as error,
      message.service as service
    FROM message
      LEFT JOIN handle ON message.handle_id = handle.ROWID
    WHERE message.is_from_me = 1
      AND message.date >= ${threshold}
    ORDER BY message.date DESC
    LIMIT 20
    `,
  );

  const matchingRows = (rows || []).filter(
    (row) => normalizePhoneForClientMatch(row.address) === expectedPhone,
  );
  if (!matchingRows.length) {
    return { ok: false, error: 'Could not verify send: no recent outgoing Messages row.' };
  }

  const matchingBodyRow = matchingRows.find((row) => {
    const decodedBody = normalizeMessageBodyForSendVerification(
      row.text || decodeHexString(row.body || ''),
    );
    return decodedBody === expectedBody;
  });
  if (!matchingBodyRow) {
    return {
      ok: false,
      rowId: matchingRows[0]?.rowid,
      error: 'Could not verify send: recent outgoing Messages row body did not match.',
      messageError: matchingRows[0]?.error ?? null,
    };
  }

  const messageError = matchingBodyRow.error ?? 0;
  if (messageError !== 0) {
    return {
      ok: false,
      rowId: matchingBodyRow.rowid,
      error: `Messages reported delivery error ${messageError}.`,
      messageError,
    };
  }

  return { ok: true, rowId: matchingBodyRow.rowid, messageError };
}

export async function sendClientMessage(args: {
  address: string;
  text: string;
  serviceName: 'iMessage' | 'SMS';
}): Promise<string> {
  const wasMessagesRunning = await isMessagesAppRunning();
  const script = `
    tell application "Messages"
      try
        set targetService to (service 1 whose service type = ${args.serviceName === 'iMessage' ? 'iMessage' : 'SMS'})
        set targetBuddy to participant "${escapeAppleScriptString(args.address)}" of targetService
        send "${escapeAppleScriptString(args.text)}" to targetBuddy
        return "Success"
      on error errMsg
        return "Error: " & errMsg
      end try
    end tell
  `;

  try {
    return await runAppleScript(script);
  } finally {
    if (!wasMessagesRunning) {
      await quitMessagesApp();
    }
  }
}

export async function sendVerifiedClientMessage(args: {
  address: string;
  text: string;
  serviceName: 'iMessage' | 'SMS';
}): Promise<ClientMessageSendVerification> {
  const sentAfterMs = Date.now();
  const result = await sendClientMessage(args);
  if (result !== 'Success') {
    throw new Error(result);
  }

  const verification = await verifyRecentClientMessageSend({
    address: args.address,
    text: args.text,
    sentAfterMs,
    serviceName: args.serviceName,
  });
  if (!verification.ok) {
    throw new Error(verification.error || 'Messages send verification failed.');
  }
  return verification;
}
