export const APPOINTMENT_TITLE_PREFIXES = ['(ACF)', '(CF)', '(RSP)', '(CAN)', '(ACF*2)'] as const;

export type AppointmentTitlePrefix = (typeof APPOINTMENT_TITLE_PREFIXES)[number];
export type AppointmentTitleOutcome =
  | 'active'
  | 'soft_archive_follow_up'
  | 'soft_archive_no_show'
  | 'terminal_enrollment'
  | 'terminal_close_lost';

const ENROLLMENT_PREFIX_PATTERN = /^\s*\(ENR(?:\s+[^)]*)?\)\s*/i;
const CLOSE_LOST_PREFIX_PATTERN = /^\s*\(CL\)\s*/i;
const FOLLOW_UP_PREFIX_PATTERN = /^\s*\(FU\)\s*/i;
const NO_SHOW_PREFIX_PATTERN = /^\s*(?:\(NS\)\*2|\(NS\))\s*/i;
const LEADING_OUTCOME_PREFIX_PATTERN = /^\s*\((?:[A-Z][A-Z0-9*$]*(?:\s+[^)]*)?)\)\s*/i;

const KNOWN_PREFIX_PATTERN = new RegExp(
  `^\\s*(?:${APPOINTMENT_TITLE_PREFIXES.map((prefix) =>
    prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|')})\\s*`,
);

export function resolveAppointmentTitleOutcome(title?: string | null): AppointmentTitleOutcome {
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) {
    return 'active';
  }
  if (ENROLLMENT_PREFIX_PATTERN.test(trimmedTitle)) {
    return 'terminal_enrollment';
  }
  if (CLOSE_LOST_PREFIX_PATTERN.test(trimmedTitle)) {
    return 'terminal_close_lost';
  }
  if (FOLLOW_UP_PREFIX_PATTERN.test(trimmedTitle)) {
    return 'soft_archive_follow_up';
  }
  if (NO_SHOW_PREFIX_PATTERN.test(trimmedTitle)) {
    return 'soft_archive_no_show';
  }
  return 'active';
}

export function applyAppointmentTitlePrefix(title: string, prefix: AppointmentTitlePrefix): string {
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) {
    return prefix;
  }

  if (trimmedTitle.startsWith(`${prefix} `) || trimmedTitle === prefix) {
    return trimmedTitle;
  }

  if (LEADING_OUTCOME_PREFIX_PATTERN.test(trimmedTitle)) {
    return trimmedTitle.replace(LEADING_OUTCOME_PREFIX_PATTERN, `${prefix} `).trim();
  }

  if (KNOWN_PREFIX_PATTERN.test(trimmedTitle)) {
    return trimmedTitle.replace(KNOWN_PREFIX_PATTERN, `${prefix} `).trim();
  }

  return `${prefix} ${trimmedTitle}`.trim();
}
