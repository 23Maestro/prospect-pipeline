export const APPOINTMENT_TITLE_PREFIXES = ['(ACF)', '(CF)', '(RSP)', '(CAN)', '(ACF*2)'] as const;

export type AppointmentTitlePrefix = typeof APPOINTMENT_TITLE_PREFIXES[number];

const KNOWN_PREFIX_PATTERN = new RegExp(
  `^\\s*(?:${APPOINTMENT_TITLE_PREFIXES.map((prefix) =>
    prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|')})\\s*`,
);

export function applyAppointmentTitlePrefix(
  title: string,
  prefix: AppointmentTitlePrefix,
): string {
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) {
    return prefix;
  }

  if (trimmedTitle.startsWith(`${prefix} `) || trimmedTitle === prefix) {
    return trimmedTitle;
  }

  if (KNOWN_PREFIX_PATTERN.test(trimmedTitle)) {
    return trimmedTitle.replace(KNOWN_PREFIX_PATTERN, `${prefix} `).trim();
  }

  return `${prefix} ${trimmedTitle}`.trim();
}
