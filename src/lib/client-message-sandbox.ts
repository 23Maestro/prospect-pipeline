import { homedir } from 'os';
import { resolve } from 'path';

import { Color, Icon, Image, LocalStorage } from '@raycast/api';
import { executeSQL, runAppleScript, usePromise, useSQL } from '@raycast/utils';
import { fetchContactsInGroup } from 'swift:../../swift/contacts';

import { apiFetch } from './fastapi-client';
import { fetchContactInfo, type ContactInfo } from './npid-mcp-adapter';

const DB_PATH = resolve(homedir(), 'Library/Messages/chat.db');
const CLIENT_CONTACT_GROUP_CANDIDATES = ['ID Clients', 'ID Contacts'];
const CLIENT_IDENTITY_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const CLIENT_IDENTITY_CACHE_PREFIX = 'client-chat-identity';

type Contact = {
  id: string;
  givenName: string;
  familyName: string;
  phoneNumbers: { number: string; countryCode: string | null }[];
  imageData: string | null;
};

export type ClientSegment = 'client' | 'pending';

type ContactSearchResult = {
  contactId?: string | null;
  athleteMainId?: string | null;
  name?: string | null;
};

export type ClientDirectoryMatch = {
  normalizedPhone: string;
  displayName: string;
  athleteName?: string | null;
  segment: ClientSegment;
  crmStage?: string | null;
  taskStatus?: string | null;
  currentTaskTitle?: string | null;
  contactId?: string | null;
  athleteMainId?: string | null;
  source: 'contacts' | 'backend' | 'merged';
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

function contactDisplayName(contact: Pick<Contact, 'givenName' | 'familyName'>): string {
  return toClientDisplayName(`${contact.givenName} ${contact.familyName}`) || 'Unknown Contact';
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
    currentTaskTitle: existing.currentTaskTitle || incoming.currentTaskTitle,
    contactId: existing.contactId || incoming.contactId,
    athleteMainId: existing.athleteMainId || incoming.athleteMainId,
    segment: existing.segment === 'client' || incoming.segment === 'client' ? 'client' : 'pending',
    source: existing.source === incoming.source ? existing.source : 'merged',
  };
}

type CachedClientIdentity = {
  normalizedPhone: string;
  contactName: string;
  athleteName: string;
  contactId: string;
  athleteMainId: string;
  cachedAt: number;
};

function clientIdentityCacheKey(normalizedPhone: string, contactName: string): string {
  return `${CLIENT_IDENTITY_CACHE_PREFIX}:${normalizedPhone}:${contactName.toLowerCase()}`;
}

async function getCachedClientIdentity(
  normalizedPhone: string,
  contactName: string,
): Promise<ClientDirectoryMatch | null> {
  const raw = await LocalStorage.getItem<string>(
    clientIdentityCacheKey(normalizedPhone, contactName),
  ).catch(() => null);
  if (!raw) {
    return null;
  }

  let cached: Partial<CachedClientIdentity>;
  try {
    cached = JSON.parse(raw) as Partial<CachedClientIdentity>;
  } catch {
    return null;
  }
  if (!cached.cachedAt || Date.now() - cached.cachedAt > CLIENT_IDENTITY_CACHE_TTL_MS) {
    return null;
  }

  const athleteName = toClientDisplayName(cached.athleteName);
  const contactId = String(cached.contactId || '').trim();
  const athleteMainId = String(cached.athleteMainId || '').trim();
  if (!athleteName || !contactId || !athleteMainId) {
    return null;
  }

  return {
    normalizedPhone,
    displayName: toClientDisplayName(cached.contactName) || toClientDisplayName(contactName),
    athleteName,
    segment: 'pending',
    contactId,
    athleteMainId,
    source: 'backend',
  };
}

async function setCachedClientIdentity(match: ClientDirectoryMatch): Promise<void> {
  const athleteName = String(match.athleteName || '').trim();
  const contactId = String(match.contactId || '').trim();
  const athleteMainId = String(match.athleteMainId || '').trim();
  if (!athleteName || !contactId || !athleteMainId) {
    return;
  }

  await LocalStorage.setItem(
    clientIdentityCacheKey(match.normalizedPhone, match.displayName),
    JSON.stringify({
      normalizedPhone: match.normalizedPhone,
      contactName: match.displayName,
      athleteName,
      contactId,
      athleteMainId,
      cachedAt: Date.now(),
    } satisfies CachedClientIdentity),
  ).catch(() => undefined);
}

async function searchParentContactsByName(query: string): Promise<ContactSearchResult[]> {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    return [];
  }

  const response = await apiFetch('/inbox/contacts/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: normalizedQuery, search_type: 'parent' }),
  }).catch(() => null);

  if (!response?.ok) {
    return [];
  }

  const payload = (await response.json().catch(() => ({}))) as { contacts?: ContactSearchResult[] };
  return Array.isArray(payload.contacts) ? payload.contacts : [];
}

function contactInfoHasPhone(contactInfo: ContactInfo, normalizedPhone: string): boolean {
  return [
    contactInfo.studentAthlete.phone,
    contactInfo.parent1?.phone,
    contactInfo.parent2?.phone,
  ].some((phone) => normalizePhoneForClientMatch(phone) === normalizedPhone);
}

async function resolveBackendMatchForContact(args: {
  contactName: string;
  normalizedPhone: string;
}): Promise<ClientDirectoryMatch | null> {
  const cached = await getCachedClientIdentity(args.normalizedPhone, args.contactName);
  if (cached) {
    return cached;
  }

  const candidates = await searchParentContactsByName(args.contactName);
  for (const candidate of candidates.slice(0, 3)) {
    const contactId = String(candidate.contactId || '').trim();
    const athleteMainId = String(candidate.athleteMainId || '').trim();
    if (!contactId || !athleteMainId) {
      continue;
    }

    const contactInfo = await fetchContactInfo(contactId, athleteMainId).catch(() => null);
    if (!contactInfo) {
      continue;
    }

    if (!contactInfoHasPhone(contactInfo, args.normalizedPhone)) {
      continue;
    }

    const match = {
      normalizedPhone: args.normalizedPhone,
      displayName: toClientDisplayName(args.contactName),
      athleteName:
        toClientDisplayName(contactInfo.studentAthlete.name) || toClientDisplayName(candidate.name),
      segment: 'pending',
      contactId,
      athleteMainId,
      source: 'backend',
    };
    await setCachedClientIdentity(match);
    return match;
  }

  return null;
}

export async function loadClientDirectory(chats: SQLChat[] = []) {
  const groupContacts = await (async () => {
    for (const groupName of CLIENT_CONTACT_GROUP_CANDIDATES) {
      const contacts = await fetchContactsInGroup(groupName, false).catch(() => [] as Contact[]);
      if (contacts.length) {
        return contacts;
      }
    }
    return [] as Contact[];
  })();

  const matchesByPhone = new Map<string, ClientDirectoryMatch>();
  const contactsByPhone = new Map<string, Contact>();

  for (const contact of groupContacts) {
    for (const phone of contact.phoneNumbers) {
      const normalizedPhone = normalizePhoneForClientMatch(phone.number);
      if (!normalizedPhone) continue;
      contactsByPhone.set(normalizedPhone, contact);

      matchesByPhone.set(
        normalizedPhone,
        mergeMatch(matchesByPhone.get(normalizedPhone), {
          normalizedPhone,
          displayName: contactDisplayName(contact),
          segment: 'client',
          source: 'contacts',
        }),
      );
    }
  }

  const chatPhonesToResolve = Array.from(
    new Set(
      chats
        .flatMap((chat) => getChatParticipantPhones(chat))
        .filter((phone) => contactsByPhone.has(phone)),
    ),
  );

  await Promise.all(
    chatPhonesToResolve.slice(0, 25).map(async (phone) => {
      const existingMatch = matchesByPhone.get(phone);
      if (existingMatch?.athleteName) {
        return;
      }

      const contact = contactsByPhone.get(phone);
      if (!contact) {
        return;
      }

      const backendMatch = await resolveBackendMatchForContact({
        contactName: contactDisplayName(contact),
        normalizedPhone: phone,
      });
      if (!backendMatch) {
        return;
      }

      matchesByPhone.set(phone, mergeMatch(matchesByPhone.get(phone), backendMatch));
    }),
  );

  return {
    matchesByPhone,
    generatedAt: null,
    exportPath: null,
  };
}

export function useClientInboxChats(searchText = '') {
  const {
    data: rawData,
    isLoading: isLoadingChats,
    permissionView,
    ...rest
  } = useSQL<SQLChat>(
    DB_PATH,
    `
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
    `,
    {
      permissionPriming: 'This is required to read your Messages chats.',
    },
  );

  const {
    data: clientDirectory,
    isLoading: isLoadingDirectory,
    revalidate: revalidateDirectory,
  } = usePromise(loadClientDirectory, [rawData || []]);

  const chats = (
    (rawData || [])
      .map((chat) => {
        const participantIdentifier = String(chat.participant_identifier || '').trim();
        const resolvedMatch = resolveClientMatchForChat(chat, clientDirectory?.matchesByPhone);
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
    .slice(0, 50);

  return {
    data: chats,
    isLoading: isLoadingChats || isLoadingDirectory,
    permissionView,
    revalidateDirectory,
    directory: clientDirectory,
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
        set targetBuddy to participant "${args.address.replace(/"/g, '\\"')}" of targetService
        send "${args.text.replace(/"/g, '\\"')}" to targetBuddy
        return "Success"
      on error errMsg
        return "Error: " & errMsg
      end try
    end tell
  `;

  const result = await runAppleScript(script);
  if (result === 'Success' && !wasMessagesRunning) {
    await quitMessagesApp();
  }
  return result;
}
