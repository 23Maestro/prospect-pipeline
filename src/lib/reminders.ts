import { runAppleScript } from '@raycast/utils';

const REMINDER_LIST_NAME = 'Prospect ID';
const DASHBOARD_BASE_URL = 'https://dashboard.nationalpid.com';

export type ReminderMode = 'call' | 'text';

export type ReminderContactOption = {
  id: string;
  label: string;
  name: string;
  phone: string;
};

export type ReminderDraftInput = {
  mode: ReminderMode;
  athleteName: string;
  contactName: string;
  phone: string;
  contactId: string;
  athleteMainId: string;
  remindAt?: Date;
};

export type ReminderDraft = {
  title: string;
  body: string;
  url: string;
  listName: string;
  remindAt?: Date;
};

type ReminderAssociatedContact = {
  role: string;
  name: string | null;
  relationshipLabel: string;
  normalizedPhoneNumber: string;
};

type ReminderFallbackContact = {
  id?: string | null;
  label?: string | null;
  name?: string | null;
  phone?: string | null;
};

const REMINDER_CONTACT_ORDER = ['parent1', 'studentAthlete', 'parent2'];

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildReminderTitle(
  input: Pick<ReminderDraftInput, 'mode' | 'contactName'>,
): string {
  return `${input.mode === 'call' ? 'Call' : 'Text'} ${input.contactName}`.trim();
}

export function buildReminderBody(
  input: Pick<ReminderDraftInput, 'athleteName' | 'phone'>,
): string {
  return `SA:${input.athleteName} - ${input.phone}`;
}

export function buildReminderAdminUrl(contactId: string, athleteMainId?: string | null): string {
  const params = new URLSearchParams({
    contactid: String(contactId || '').trim(),
  });
  const normalizedAthleteMainId = String(athleteMainId || '').trim();
  if (normalizedAthleteMainId) {
    params.set('athlete_main_id', normalizedAthleteMainId);
  }
  return `${DASHBOARD_BASE_URL}/admin/athletes?${params.toString()}`;
}

export function buildReminderDraft(input: ReminderDraftInput): ReminderDraft {
  return {
    title: buildReminderTitle(input),
    body: buildReminderBody(input),
    url: buildReminderAdminUrl(input.contactId, input.athleteMainId),
    listName: REMINDER_LIST_NAME,
    remindAt: input.remindAt,
  };
}

export function buildDefaultReminderDate(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setSeconds(0, 0);
  const minutes = next.getMinutes();
  if (minutes === 0 || minutes === 30) {
    next.setMinutes(minutes + 30);
    return next;
  }
  if (minutes < 30) {
    next.setMinutes(30);
    return next;
  }
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return next;
}

export function mapAssociatedContactsToReminderOptions(
  contacts: Array<
    | ReminderAssociatedContact
    | {
        id: string;
        label: string;
        name: string;
        phone: string;
      }
  >,
): ReminderContactOption[] {
  const mapped = contacts.flatMap((contact) => {
    if ('phone' in contact) {
      const name = String(contact.name || '').trim();
      const phone = String(contact.phone || '').trim();
      if (!name || !phone) return [];
      return [
        {
          id: String(contact.id || '').trim(),
          label: String(contact.label || '').trim() || name,
          name,
          phone,
        } satisfies ReminderContactOption,
      ];
    }

    const name = String(contact.name || '').trim();
    const phone = String(contact.normalizedPhoneNumber || '').trim();
    if (!name || !phone) return [];
    return [
      {
        id: String(contact.role || '').trim(),
        label: String(contact.relationshipLabel || '').trim() || name,
        name,
        phone,
      } satisfies ReminderContactOption,
    ];
  });

  return Array.from(
    new Map(mapped.map((option) => [`${option.id}:${option.phone}`, option])).values(),
  ).sort((left, right) => {
    const leftIndex = REMINDER_CONTACT_ORDER.indexOf(left.id);
    const rightIndex = REMINDER_CONTACT_ORDER.indexOf(right.id);
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight || left.name.localeCompare(right.name);
  });
}

export function resolveClientReminderTarget(args: {
  isGroup: boolean;
  matchedPhones: string[];
  associatedClients: ReminderAssociatedContact[];
  fallbackContact?: ReminderFallbackContact | null;
}): {
  options: ReminderContactOption[];
  immediateOption: ReminderContactOption | null;
} {
  const associatedOptions = mapAssociatedContactsToReminderOptions(args.associatedClients);
  const fallbackName = String(args.fallbackContact?.name || '').trim();
  const fallbackPhone = String(args.fallbackContact?.phone || args.matchedPhones[0] || '')
    .replace(/\D/g, '')
    .trim();
  const fallbackOptions =
    fallbackName && fallbackPhone
      ? mapAssociatedContactsToReminderOptions([
          {
            id: String(args.fallbackContact?.id || 'matchedContact').trim(),
            label: String(args.fallbackContact?.label || 'Contact').trim(),
            name: fallbackName,
            phone: fallbackPhone,
          },
        ])
      : [];
  const optionMap = new Map(
    [...associatedOptions, ...fallbackOptions].map((option) => [
      `${option.id}:${option.phone}`,
      option,
    ]),
  );
  const options = Array.from(optionMap.values());
  const matchedPhoneSet = new Set(
    args.matchedPhones.map((phone) => String(phone || '').replace(/\D/g, '')).filter(Boolean),
  );
  const matchedOptions = options.filter((option) =>
    matchedPhoneSet.has(String(option.phone || '').replace(/\D/g, '')),
  );

  if (!args.isGroup) {
    if (matchedOptions.length === 1) {
      return { options, immediateOption: matchedOptions[0] };
    }
    if (!matchedOptions.length && options.length === 1) {
      return { options, immediateOption: options[0] };
    }
  }

  return {
    options,
    immediateOption: null,
  };
}

export async function createReminder(reminder: ReminderDraft): Promise<void> {
  const remindAt = reminder.remindAt || null;
  const script = `
    on findListByName(listName)
      tell application "Reminders"
        repeat with candidateList in every list
          if (name of candidateList as text) is listName then return candidateList
        end repeat
      end tell
      return missing value
    end findListByName

    set listName to "${escapeAppleScript(reminder.listName)}"
    set reminderTitle to "${escapeAppleScript(reminder.title)}"
    set reminderBody to "${escapeAppleScript(reminder.body)}"
    set reminderUrl to "${escapeAppleScript(reminder.url)}"
    ${
      remindAt
        ? `
    set remindYear to ${remindAt.getFullYear()}
    set remindMonth to ${remindAt.getMonth() + 1}
    set remindDay to ${remindAt.getDate()}
    set remindHour to ${remindAt.getHours()}
    set remindMinute to ${remindAt.getMinutes()}
    set remindDate to (current date)
    set year of remindDate to remindYear
    set month of remindDate to remindMonth
    set day of remindDate to remindDay
    set hours of remindDate to remindHour
    set minutes of remindDate to remindMinute
    set seconds of remindDate to 0
    `
        : `
    set remindDate to missing value
    `
    }

    tell application "Reminders"
      set targetList to my findListByName(listName)
      if targetList is missing value then error "Reminders list '" & listName & "' was not found."

      set createdReminder to make new reminder at end of reminders of targetList with properties {name:reminderTitle}
      if reminderBody is not "" then
        try
          set body of createdReminder to reminderBody
        end try
      end if
      if remindDate is not missing value then
        try
          set remind me date of createdReminder to remindDate
        end try
        try
          set due date of createdReminder to remindDate
        end try
      end if
      if reminderUrl is not "" then
        try
          set URL of createdReminder to reminderUrl
        end try
      end if

      activate
      try
        show createdReminder
      on error
        try
          show targetList
        end try
      end try
    end tell
  `;

  await runAppleScript(script);
}
