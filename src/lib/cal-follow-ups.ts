import { getPreferenceValues } from '@raycast/api';
import { buildReminderAdminUrl } from './reminders';

const CAL_API_BASE_URL = 'https://api.cal.com/v2';
const CAL_API_VERSION = '2026-02-25';

type CalPreferences = {
  calApiKey?: string;
  calFollowUpEventTypeId?: string;
};

export type CalFollowUpBookingInput = {
  start: Date;
  contactName: string;
  phone: string;
  athleteName: string;
  contactId?: string | null;
  athleteMainId?: string | null;
  timeZone?: string | null;
};

export type CalFollowUpBookingResult = {
  uid: string | null;
  title: string | null;
  start: string | null;
  end: string | null;
};

type CalBookingPayload = {
  start: string;
  attendee: {
    name: string;
    email: string;
    timeZone: string;
    phoneNumber?: string;
    language: 'en';
  };
  eventTypeId: number;
  metadata: Record<string, string>;
  allowConflicts: true;
  allowBookingOutOfBounds: true;
};

function clean(value?: string | null): string {
  return String(value || '').trim();
}

function parsePositiveInteger(value?: string | null): number | null {
  const parsed = Number.parseInt(clean(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
}

export function normalizePhoneToE164(phone?: string | null): string | null {
  const digits = clean(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (clean(phone).startsWith('+') && digits.length >= 8) return `+${digits}`;
  return null;
}

export function buildCalFallbackEmail(args: {
  phone?: string | null;
  contactName?: string | null;
}): string {
  const digits = clean(args.phone).replace(/\D/g, '');
  if (digits) {
    return `followup+${digits}@example.com`;
  }

  const slug =
    clean(args.contactName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'client';
  return `followup+${slug}@example.com`;
}

function requireCalPreferences(): Required<Pick<CalPreferences, 'calApiKey'>> & CalPreferences {
  const prefs = getPreferenceValues<CalPreferences>();
  const calApiKey = clean(prefs.calApiKey);
  if (!calApiKey) {
    throw new Error('Set Cal API Key in Raycast preferences.');
  }
  return { ...prefs, calApiKey };
}

export function buildCalFollowUpBookingPayload(
  input: CalFollowUpBookingInput,
  prefs: CalPreferences,
): CalBookingPayload {
  const eventTypeId = parsePositiveInteger(prefs.calFollowUpEventTypeId);
  if (!eventTypeId) {
    throw new Error('Set Cal Follow Up Event Type ID in Raycast preferences.');
  }

  const contactName = clean(input.contactName) || 'Client';
  const phoneNumber = normalizePhoneToE164(input.phone);
  const contactId = clean(input.contactId);
  const athleteMainId = clean(input.athleteMainId);
  const dashboardUrl = contactId ? buildReminderAdminUrl(contactId, athleteMainId) : '';

  return {
    start: input.start.toISOString(),
    attendee: {
      name: contactName,
      email: buildCalFallbackEmail({
        phone: input.phone,
        contactName,
      }),
      timeZone: clean(input.timeZone) || getLocalTimeZone(),
      ...(phoneNumber ? { phoneNumber } : {}),
      language: 'en',
    },
    eventTypeId,
    metadata: {
      source: 'prospect-pipeline',
      workflow: 'client_messages_follow_up',
      athleteName: clean(input.athleteName),
      contactName,
      contactId,
      athleteMainId,
      dashboardUrl,
    },
    allowConflicts: true,
    allowBookingOutOfBounds: true,
  };
}

export async function createCalFollowUpBooking(
  input: CalFollowUpBookingInput,
): Promise<CalFollowUpBookingResult> {
  const prefs = requireCalPreferences();
  const payload = buildCalFollowUpBookingPayload(input, prefs);
  const response = await fetch(`${CAL_API_BASE_URL}/bookings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${prefs.calApiKey}`,
      'Content-Type': 'application/json',
      'cal-api-version': CAL_API_VERSION,
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  let body: any = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = {};
  }

  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.message ||
      body?.error_description ||
      bodyText.slice(0, 300) ||
      `Cal booking failed: ${response.status}`;
    throw new Error(message);
  }

  const data = body?.data || {};
  return {
    uid: data.uid ? String(data.uid) : null,
    title: data.title ? String(data.title) : null,
    start: data.start ? String(data.start) : null,
    end: data.end ? String(data.end) : null,
  };
}
