export const APPOINTMENT_TITLE_PREFIXES = ['(ACF)', '(CF)', '(RSP)', '(CAN)', '(ACF*2)'] as const;

export type AppointmentTitlePrefix = (typeof APPOINTMENT_TITLE_PREFIXES)[number];
export type AppointmentTitleOutcome =
  | 'active'
  | 'soft_archive_follow_up'
  | 'soft_archive_canceled'
  | 'soft_archive_no_show'
  | 'reschedule_pending'
  | 'terminal_enrollment'
  | 'terminal_close_lost';

export type AppointmentTitleParseResult = {
  originalTitle: string;
  cleanTitle: string;
  outcome: AppointmentTitleOutcome;
  revenueCents: number | null;
  prefix: string | null;
};

const ENROLLMENT_PREFIX_PATTERN = /^\s*\(ENR(?:\s+\$?([0-9]+(?:\.[0-9]{1,2})?))?[^)]*\)\s*/i;
const RESCHEDULE_PENDING_PREFIX_PATTERN = /^\s*\(RSP\)(?:\*\d+)?\s*/i;
const PARENT_DID_NOT_QUALIFY_PREFIX_PATTERN = /^\s*\(PAR\s*-\s*DNQ\)(?:\*\d+)?\s*/i;
const CLOSE_LOST_PREFIX_PATTERN = /^\s*\(CL\)(?:\*\d+)?\s*/i;
const FOLLOW_UP_PREFIX_PATTERN = /^\s*\(FU\)(?:\*\d+)?\s*/i;
const CANCELED_PREFIX_PATTERN = /^\s*\(CAN\)(?:\*\d+)?\s*/i;
const NO_SHOW_PREFIX_PATTERN = /^\s*\(NS\)(?:\*\d+)?\s*/i;
const MALFORMED_DOUBLE_PREFIX_PATTERN = /^\s*\((?:ACF|CF|RSP|CAN|FU|CL|NS)\)\*\d+\s*/i;

const KNOWN_PREFIX_PATTERN = new RegExp(
  `^\\s*(?:${APPOINTMENT_TITLE_PREFIXES.map((prefix) =>
    prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|')})\\s*`,
);

function parseRevenueCents(value?: string | null): number | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export function parseAppointmentTitleOutcome(title?: string | null): AppointmentTitleParseResult {
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) {
    return {
      originalTitle: '',
      cleanTitle: '',
      outcome: 'active',
      revenueCents: null,
      prefix: null,
    };
  }

  const enrollmentMatch = trimmedTitle.match(ENROLLMENT_PREFIX_PATTERN);
  if (enrollmentMatch) {
    return {
      originalTitle: trimmedTitle,
      cleanTitle: trimmedTitle.replace(ENROLLMENT_PREFIX_PATTERN, '').trim(),
      outcome: 'terminal_enrollment',
      revenueCents: parseRevenueCents(enrollmentMatch[1]),
      prefix: enrollmentMatch[0].trim(),
    };
  }
  if (RESCHEDULE_PENDING_PREFIX_PATTERN.test(trimmedTitle)) {
    return {
      originalTitle: trimmedTitle,
      cleanTitle: trimmedTitle.replace(RESCHEDULE_PENDING_PREFIX_PATTERN, '').trim(),
      outcome: 'reschedule_pending',
      revenueCents: null,
      prefix: trimmedTitle.match(RESCHEDULE_PENDING_PREFIX_PATTERN)?.[0].trim() || '(RSP)',
    };
  }
  if (PARENT_DID_NOT_QUALIFY_PREFIX_PATTERN.test(trimmedTitle)) {
    return {
      originalTitle: trimmedTitle,
      cleanTitle: trimmedTitle.replace(PARENT_DID_NOT_QUALIFY_PREFIX_PATTERN, '').trim(),
      outcome: 'terminal_close_lost',
      revenueCents: null,
      prefix: trimmedTitle.match(PARENT_DID_NOT_QUALIFY_PREFIX_PATTERN)?.[0].trim() || '(PAR - DNQ)',
    };
  }
  if (CLOSE_LOST_PREFIX_PATTERN.test(trimmedTitle)) {
    return {
      originalTitle: trimmedTitle,
      cleanTitle: trimmedTitle.replace(CLOSE_LOST_PREFIX_PATTERN, '').trim(),
      outcome: 'terminal_close_lost',
      revenueCents: null,
      prefix: trimmedTitle.match(CLOSE_LOST_PREFIX_PATTERN)?.[0].trim() || '(CL)',
    };
  }
  if (FOLLOW_UP_PREFIX_PATTERN.test(trimmedTitle)) {
    return {
      originalTitle: trimmedTitle,
      cleanTitle: trimmedTitle.replace(FOLLOW_UP_PREFIX_PATTERN, '').trim(),
      outcome: 'soft_archive_follow_up',
      revenueCents: null,
      prefix: trimmedTitle.match(FOLLOW_UP_PREFIX_PATTERN)?.[0].trim() || '(FU)',
    };
  }
  if (CANCELED_PREFIX_PATTERN.test(trimmedTitle)) {
    return {
      originalTitle: trimmedTitle,
      cleanTitle: trimmedTitle.replace(CANCELED_PREFIX_PATTERN, '').trim(),
      outcome: 'soft_archive_canceled',
      revenueCents: null,
      prefix: trimmedTitle.match(CANCELED_PREFIX_PATTERN)?.[0].trim() || '(CAN)',
    };
  }
  if (NO_SHOW_PREFIX_PATTERN.test(trimmedTitle)) {
    return {
      originalTitle: trimmedTitle,
      cleanTitle: trimmedTitle.replace(NO_SHOW_PREFIX_PATTERN, '').trim(),
      outcome: 'soft_archive_no_show',
      revenueCents: null,
      prefix: trimmedTitle.match(NO_SHOW_PREFIX_PATTERN)?.[0].trim() || '(NS)',
    };
  }
  return {
    originalTitle: trimmedTitle,
    cleanTitle: trimmedTitle,
    outcome: 'active',
    revenueCents: null,
    prefix: null,
  };
}

export function resolveAppointmentTitleOutcome(title?: string | null): AppointmentTitleOutcome {
  return parseAppointmentTitleOutcome(title).outcome;
}

export function applyAppointmentTitlePrefix(title: string, prefix: AppointmentTitlePrefix): string {
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) {
    return prefix;
  }

  if (trimmedTitle.startsWith(`${prefix} `) || trimmedTitle === prefix) {
    return trimmedTitle;
  }

  if (MALFORMED_DOUBLE_PREFIX_PATTERN.test(trimmedTitle)) {
    return trimmedTitle.replace(MALFORMED_DOUBLE_PREFIX_PATTERN, `${prefix} `).trim();
  }

  if (KNOWN_PREFIX_PATTERN.test(trimmedTitle)) {
    return trimmedTitle.replace(KNOWN_PREFIX_PATTERN, `${prefix} `).trim();
  }

  return `${prefix} ${trimmedTitle}`.trim();
}
