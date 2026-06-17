import type { MeetingSetSubmitResponse, ScoutPrepContext } from '../features/scout-prep/types';
import {
  buildConfirmationMessage,
  type ConfirmationFollowUpVariant,
} from './scout-follow-up-templates';
import {
  getMeetingReminderRecipient,
  getProspectContactShortcutCandidates,
  normalizePhoneForMessages,
} from '../domain/scout-contact-selection';
import { getGreetingForLocalTime } from '../domain/outreach-time-wording';
import { buildSetMeetingConfirmationCacheRows } from '../domain/set-meeting-confirmation-cache';
import {
  deleteRows,
  readRows,
  upsertSetMeetingConfirmationCacheRows,
  type SupabasePersistenceConfig,
} from '../domain/supabase-persistence';
import { getSupabasePersistenceConfig } from './supabase-lifecycle';

export type MeetingSetConfirmationCacheInput = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  context: ScoutPrepContext;
  meetingSet: {
    openEventId?: string | null;
    startsAt?: string | null;
    startTime?: string | null;
    meetingTimezone?: string | null;
    meetingLength?: string | null;
    bookedMeetingAssignedOwner?: string | null;
    headScout?: string | null;
  };
  meetingSetResult?: Partial<MeetingSetSubmitResponse> | null;
  manualAdditionalContacts?: Array<{
    name: string;
    relationshipLabel: string;
    phone: string;
  }>;
  generatedAt?: string;
};

type ManualConfirmationContact = {
  name: string;
  relationshipLabel: string;
  phone: string;
};

export type SetMeetingConfirmationCacheSupportRow = {
  id?: string | null;
  appointment_id?: string | null;
  kind?: string | null;
  send_at?: string | null;
  sent_at?: string | null;
  status?: string | null;
  dedupe_key?: string | null;
  athlete_key?: string | null;
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  athlete_name?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  head_scout_name?: string | null;
  meeting_starts_at?: string | null;
  meeting_duration_minutes?: number | null;
  meeting_ends_at?: string | null;
  meeting_timezone?: string | null;
  message_body?: string | null;
  admin_url?: string | null;
  task_url?: string | null;
  source?: string | null;
  generated_at?: string | null;
  payload_json?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const LEGACY_TIMEZONE_TO_IANA: Record<string, string> = {
  EST: 'America/New_York',
  CST: 'America/Chicago',
  MST: 'America/Denver',
  PST: 'America/Los_Angeles',
  AKST: 'America/Anchorage',
  HST: 'Pacific/Honolulu',
  AST: 'America/Puerto_Rico',
  ET: 'America/New_York',
  EASTERN: 'America/New_York',
  CT: 'America/Chicago',
  CENTRAL: 'America/Chicago',
  MT: 'America/Denver',
  MOUNTAIN: 'America/Denver',
  PT: 'America/Los_Angeles',
  PACIFIC: 'America/Los_Angeles',
  ARIZONA: 'America/Phoenix',
};

function clean(value?: string | null): string {
  return String(value || '').trim();
}

function buildAthleteAdminUrl(athleteId: string, athleteMainId?: string | null): string {
  const params = new URLSearchParams({
    contactid: clean(athleteId),
  });
  const normalizedAthleteMainId = clean(athleteMainId);
  if (normalizedAthleteMainId) {
    params.set('athlete_main_id', normalizedAthleteMainId);
  }
  return `https://dashboard.nationalpid.com/admin/athletes?${params.toString()}`;
}

export function getSetMeetingConfirmationSupabaseConfig(): SupabasePersistenceConfig | null {
  return getSupabasePersistenceConfig();
}

function parseMeetingDate(value?: string | null): Date | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveRequiredIanaTimeZone(timezone?: string | null): string {
  const trimmed = clean(timezone);
  if (!trimmed) {
    throw new Error('Missing required Meeting Set confirmation cache fields: meetingTimezone');
  }
  const legacy = LEGACY_TIMEZONE_TO_IANA[trimmed.toUpperCase()];
  if (legacy) return legacy;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    throw new Error(`Invalid Meeting Set confirmation cache timezone: ${trimmed}`);
  }
}

function getWallParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '';
  const hour = Number.parseInt(value('hour'), 10);
  return {
    year: Number.parseInt(value('year'), 10),
    month: Number.parseInt(value('month'), 10),
    day: Number.parseInt(value('day'), 10),
    weekday: value('weekday'),
    hour: hour === 24 ? 0 : hour,
    minute: Number.parseInt(value('minute'), 10) || 0,
    second: Number.parseInt(value('second'), 10) || 0,
  };
}

function zonedWallTimeToUtcDate(args: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
  timeZone: string;
}): Date {
  const expectedWallUtc = Date.UTC(
    args.year,
    args.month - 1,
    args.day,
    args.hour,
    args.minute,
    args.second || 0,
  );
  const initial = new Date(expectedWallUtc);
  const actualWall = getWallParts(initial, args.timeZone);
  const actualWallUtc = Date.UTC(
    actualWall.year,
    actualWall.month - 1,
    actualWall.day,
    actualWall.hour,
    actualWall.minute,
    actualWall.second,
  );
  return new Date(initial.getTime() - (actualWallUtc - expectedWallUtc));
}

function parseMeetingDateInTimezone(value: string, timeZone: string): Date | null {
  const trimmed = clean(value);
  const hasExplicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  if (hasExplicitZone) return parseMeetingDate(trimmed);

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return parseMeetingDate(trimmed);

  const [, year, month, day, hour, minute, second] = match;
  return zonedWallTimeToUtcDate({
    year: Number.parseInt(year, 10),
    month: Number.parseInt(month, 10),
    day: Number.parseInt(day, 10),
    hour: Number.parseInt(hour, 10),
    minute: Number.parseInt(minute, 10),
    second: Number.parseInt(second || '0', 10),
    timeZone,
  });
}

export function buildMeetingSetConfirmationIntendedSendDate(args: {
  meetingDate: Date;
  meetingTimezone: string;
}): Date {
  const timeZone = resolveRequiredIanaTimeZone(args.meetingTimezone);
  const meetingDate = args.meetingDate;
  const meetingParts = getWallParts(meetingDate, timeZone);
  const meetingLocalNoon = new Date(
    Date.UTC(meetingParts.year, meetingParts.month - 1, meetingParts.day, 12, 0, 0),
  );
  const sendLocalNoon = new Date(meetingLocalNoon);
  if (meetingParts.weekday === 'Sat' || meetingParts.weekday === 'Sun') {
    sendLocalNoon.setUTCDate(sendLocalNoon.getUTCDate() - 1);
  }

  return zonedWallTimeToUtcDate({
    year: sendLocalNoon.getUTCFullYear(),
    month: sendLocalNoon.getUTCMonth() + 1,
    day: sendLocalNoon.getUTCDate(),
    hour: 9,
    minute: 0,
    timeZone,
  });
}

function parseRequiredMeetingLengthMinutes(value?: string | null): number {
  const trimmed = clean(value);
  if (!trimmed) {
    throw new Error('Missing required Meeting Set confirmation cache fields: meetingLength');
  }
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid Meeting Set confirmation cache meeting length: ${trimmed}`);
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const total = hours * 60 + minutes;
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(`Invalid Meeting Set confirmation cache meeting length: ${trimmed}`);
  }
  return total;
}

function normalizeRecipientContacts(
  existing: unknown,
): Array<{ label: string; name: string; phone: string }> {
  if (!Array.isArray(existing)) return [];
  return existing
    .map((contact) => {
      const item = contact && typeof contact === 'object' ? (contact as Record<string, unknown>) : {};
      return {
        label: clean(String(item.label || item.relationship || '')),
        name: clean(String(item.name || '')),
        phone: clean(String(item.phone || '')),
      };
    })
    .filter((contact) => contact.name && normalizePhoneForMessages(contact.phone));
}

function mergeManualConfirmationContactOptions(
  row: SetMeetingConfirmationCacheSupportRow,
  contact: ManualConfirmationContact,
  normalizedPhone: string,
) {
  const contacts = normalizeRecipientContacts(row.payload_json?.recipient_contacts);
  const existingIndex = contacts.findIndex(
    (candidate) => normalizePhoneForMessages(candidate.phone) === normalizedPhone,
  );
  const manualContact = {
    label: 'Parent 2',
    name: clean(contact.name),
    phone: normalizedPhone,
  };
  if (existingIndex >= 0) {
    contacts[existingIndex] = manualContact;
  } else {
    contacts.push(manualContact);
  }
  return contacts;
}

export function buildManualContactConfirmationCacheReplacementRows(
  rows: SetMeetingConfirmationCacheSupportRow[],
  contact: ManualConfirmationContact,
  generatedAt = new Date().toISOString(),
): SetMeetingConfirmationCacheSupportRow[] {
  const recipientName = clean(contact.name);
  const recipientPhone = normalizePhoneForMessages(contact.phone);
  if (!recipientName || !recipientPhone) {
    return [];
  }

  return rows
    .map((row) => {
      const appointmentId = clean(row.appointment_id);
      const kind = clean(row.kind);
      if (!appointmentId || !kind) return null;
      const dedupeKey = `set_meeting_confirmation:${appointmentId}:${kind}:${recipientPhone}`;
      return {
        ...row,
        id: dedupeKey,
        dedupe_key: dedupeKey,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        payload_json: {
          ...(row.payload_json || {}),
          recipient_name: recipientName,
          recipient_phone: recipientPhone,
          recipient_contacts: mergeManualConfirmationContactOptions(row, contact, recipientPhone),
          updated_from_contact_cache: true,
        },
        updated_at: generatedAt,
      };
    })
    .filter((row): row is SetMeetingConfirmationCacheSupportRow => Boolean(row));
}

export function buildMeetingSetConfirmationCacheRowsFromScoutPrep(
  args: MeetingSetConfirmationCacheInput,
) {
  const appointmentId =
    clean(args.meetingSetResult?.open_event_id) || clean(args.meetingSet.openEventId);
  const meetingTimezone = clean(args.meetingSet.meetingTimezone);
  const ianaTimeZone = resolveRequiredIanaTimeZone(meetingTimezone);
  const meetingStartsAt =
    clean(args.meetingSet.startsAt) ||
    clean(args.meetingSet.startTime) ||
    clean(args.meetingSetResult?.created_task?.due_date);
  const meetingDate = meetingStartsAt
    ? parseMeetingDateInTimezone(meetingStartsAt, ianaTimeZone)
    : null;
  const manualConfirmationContact = args.context.contactInfo.parent2
    ? null
    : args.manualAdditionalContacts?.[0] || null;
  const manualConfirmationPhone = normalizePhoneForMessages(manualConfirmationContact?.phone);
  const reminderRecipient =
    manualConfirmationContact && manualConfirmationPhone
      ? {
          phones: [manualConfirmationPhone],
          recipientNames: [manualConfirmationContact.name].filter((value): value is string =>
            Boolean(clean(value)),
          ),
        }
      : getMeetingReminderRecipient(args.context);
  const recipientPhone = reminderRecipient?.phones[0] || '';
  const recipientName = reminderRecipient?.recipientNames[0] || '';
  const recipientContacts = getProspectContactShortcutCandidates(args.context).map((contact) => ({
    label: contact.label,
    name: contact.name,
    phone: contact.phone,
  }));
  if (
    manualConfirmationContact &&
    manualConfirmationPhone &&
    !recipientContacts.some(
      (contact) => normalizePhoneForMessages(contact.phone) === manualConfirmationPhone,
    )
  ) {
    recipientContacts.push({
      label: 'Parent 2',
      name: manualConfirmationContact.name,
      phone: manualConfirmationPhone,
    });
  }
  const headScoutName =
    clean(args.meetingSet.headScout) ||
    clean(args.meetingSet.bookedMeetingAssignedOwner) ||
    clean(args.context.resolved.head_scout);
  const missing = [
    !appointmentId ? 'appointmentId' : null,
    !clean(args.athleteId) ? 'athleteId' : null,
    !clean(args.athleteMainId) ? 'athleteMainId' : null,
    !clean(args.athleteName) ? 'athleteName' : null,
    !meetingStartsAt ? 'meetingStartsAt' : null,
    !meetingDate ? 'parseableMeetingStartsAt' : null,
    !meetingTimezone ? 'meetingTimezone' : null,
    !headScoutName ? 'headScoutName' : null,
    !reminderRecipient ? 'reminderRecipient' : null,
    !recipientName ? 'recipientName' : null,
    !recipientPhone ? 'recipientPhone' : null,
    !clean(args.context.task.athlete_task_url) ? 'taskUrl' : null,
  ].filter((value): value is string => Boolean(value));
  if (missing.length) {
    throw new Error(
      `Missing required Meeting Set confirmation cache fields: ${missing.join(', ')}`,
    );
  }

  const generatedAt = args.generatedAt || new Date().toISOString();
  const intendedSendAt = buildMeetingSetConfirmationIntendedSendDate({
    meetingDate,
    meetingTimezone,
  });
  const meetingDurationMinutes = parseRequiredMeetingLengthMinutes(args.meetingSet.meetingLength);
  const confirmation = (variant: ConfirmationFollowUpVariant) =>
    buildConfirmationMessage({
      variant,
      headScoutName,
      dueAt: meetingDate,
      meetingTimezone,
      recipientNames: reminderRecipient.recipientNames,
      greetingOverride: getGreetingForLocalTime({ now: intendedSendAt, meetingTimezone }),
      now: intendedSendAt,
    });

  const rows = buildSetMeetingConfirmationCacheRows({
    appointmentId,
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName,
    recipientName,
    recipientPhone,
    recipientContacts,
    headScoutName,
    meetingStartsAt: meetingDate.toISOString(),
    meetingTimezone,
    meetingDurationMinutes,
    confirmation1Message: confirmation('confirmation_1'),
    confirmation2Message: confirmation('confirmation_2'),
    adminUrl: buildAthleteAdminUrl(args.athleteId, args.athleteMainId),
    taskUrl: clean(args.context.task.athlete_task_url),
    generatedAt,
    source: 'set_meetings_confirmation',
  });
  if (rows.length !== 2) {
    throw new Error(`Meeting Set confirmation cache expected 2 rows, built ${rows.length}`);
  }
  return rows;
}

export async function syncMeetingSetConfirmationCacheFromScoutPrep(
  args: MeetingSetConfirmationCacheInput,
  config: SupabasePersistenceConfig | null = getSetMeetingConfirmationSupabaseConfig(),
): Promise<{ enabled: boolean; count: number }> {
  if (!config) {
    throw new Error('Missing Supabase config for Meeting Set confirmation cache write');
  }
  const rows = buildMeetingSetConfirmationCacheRowsFromScoutPrep(args);
  if (rows.length !== 2) {
    throw new Error(`Meeting Set confirmation cache expected 2 rows, built ${rows.length}`);
  }
  await deleteRows(
    config,
    'set_meeting_confirmation_cache',
    'appointment_id',
    rows[0].appointment_id,
  );
  await upsertSetMeetingConfirmationCacheRows(config, rows);
  return { enabled: true, count: rows.length };
}

export async function syncManualAdditionalContactToSetMeetingConfirmationCache(
  args: {
    context: ScoutPrepContext;
    contact: ManualConfirmationContact;
    generatedAt?: string;
  },
  config: SupabasePersistenceConfig | null = getSetMeetingConfirmationSupabaseConfig(),
): Promise<{ enabled: boolean; count: number }> {
  if (!config) {
    return { enabled: false, count: 0 };
  }

  const athleteId = clean(args.context.resolved.athlete_id || args.context.task.contact_id);
  const athleteMainId = clean(
    args.context.resolved.athlete_main_id || args.context.task.athlete_main_id,
  );
  if (!athleteId || !athleteMainId) {
    return { enabled: true, count: 0 };
  }

  const athleteKey = `${athleteId}:${athleteMainId}`;
  const rows = await readRows<SetMeetingConfirmationCacheSupportRow>(
    config,
    'set_meeting_confirmation_cache',
    [
      'select=id,appointment_id,kind,send_at,sent_at,status,dedupe_key,athlete_key,athlete_id,athlete_main_id,athlete_name,recipient_name,recipient_phone,head_scout_name,meeting_starts_at,meeting_duration_minutes,meeting_ends_at,meeting_timezone,message_body,admin_url,task_url,source,generated_at,payload_json,created_at,updated_at',
      `athlete_key=eq.${encodeURIComponent(athleteKey)}`,
      'status=eq.cached',
      'source=eq.set_meetings_confirmation',
      'kind=in.(confirmation_1,confirmation_2)',
    ].join('&'),
  );
  if (!rows.length) {
    return { enabled: true, count: 0 };
  }

  const replacementRows = buildManualContactConfirmationCacheReplacementRows(
    rows,
    args.contact,
    args.generatedAt,
  );
  if (!replacementRows.length) {
    return { enabled: true, count: 0 };
  }

  const appointmentIds = Array.from(
    new Set(replacementRows.map((row) => clean(row.appointment_id)).filter(Boolean)),
  );
  for (const appointmentId of appointmentIds) {
    await deleteRows(config, 'set_meeting_confirmation_cache', 'appointment_id', appointmentId);
  }
  await upsertSetMeetingConfirmationCacheRows(config, replacementRows);
  return { enabled: true, count: replacementRows.length };
}
