export type OwnerRole =
  | 'call_tracker_operator'
  | 'appointment_setter'
  | 'scouting_coordinator'
  | 'head_scout'
  | 'calendar_owner'
  | 'task_owner';

export type OwnerKey =
  | 'jerami_singleton'
  | 'tim_risner'
  | 'jeffrey_stein'
  | 'luther_winfield'
  | 'ryan_lietz'
  | 'james_holcomb'
  | 'logan_lord';

export type OwnerProfile = {
  ownerKey: OwnerKey;
  personName: string;
  aliases: readonly string[];
  legacyUserId?: string;
  calendarOwnerId?: string;
  meetingForLegacyUserId?: string;
  dashboardTrackingEligible: boolean;
  roles: readonly OwnerRole[];
  city?: string;
  state?: string;
};

export type OwnerDirectoryEntry = OwnerProfile;

export type ActiveOperatorContext = {
  operatorKey: OwnerKey;
  personName: string;
  legacyUserId: string;
  taskAssignedOwnerName: string;
  dashboardTrackingEnabled: boolean;
  senderName: string;
};

export type HeadScoutDirectoryEntry = {
  scout_name: string;
  city: string;
  state: string;
  calendar_owner_id: string;
  meeting_for: string;
};

function normalizeToken(value?: string | number | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export const OWNER_DIRECTORY: readonly OwnerProfile[] = [
  {
    ownerKey: 'jerami_singleton',
    personName: 'Jerami Singleton',
    aliases: ['Jerami', 'Jerami Singleton'],
    legacyUserId: '1408164',
    dashboardTrackingEligible: true,
    roles: ['call_tracker_operator', 'appointment_setter', 'scouting_coordinator', 'task_owner'],
  },
  {
    ownerKey: 'tim_risner',
    personName: 'Tim Risner',
    aliases: ['Tim Risner', 'Tim', 'Coach Risner'],
    dashboardTrackingEligible: false,
    roles: ['appointment_setter', 'scouting_coordinator', 'task_owner'],
  },
  {
    ownerKey: 'jeffrey_stein',
    personName: 'Jeffrey Stein',
    aliases: ['Jeffrey Stein', 'Jeffrey'],
    legacyUserId: '1418529',
    calendarOwnerId: 'OrJsV8nhBouEzKY',
    meetingForLegacyUserId: '1418529',
    dashboardTrackingEligible: false,
    roles: ['head_scout', 'calendar_owner', 'appointment_setter'],
    city: 'Wexford',
    state: 'PA',
  },
  {
    ownerKey: 'luther_winfield',
    personName: 'Luther Winfield',
    aliases: ['Luther Winfield', 'Luther'],
    legacyUserId: '370959',
    calendarOwnerId: 'bMBrA26OElRUwPs',
    meetingForLegacyUserId: '370959',
    dashboardTrackingEligible: false,
    roles: ['head_scout', 'calendar_owner', 'appointment_setter'],
    city: 'Columbia',
    state: 'SC',
  },
  {
    ownerKey: 'ryan_lietz',
    personName: 'Ryan Lietz',
    aliases: ['Ryan Lietz', 'Ryan'],
    legacyUserId: '1354049',
    calendarOwnerId: 'nhVvYOz8bAaL57c',
    meetingForLegacyUserId: '1354049',
    dashboardTrackingEligible: false,
    roles: ['head_scout', 'calendar_owner', 'appointment_setter'],
    city: 'Gilbert',
    state: 'AZ',
  },
  {
    ownerKey: 'james_holcomb',
    personName: 'James Holcomb',
    aliases: ['James Holcomb', 'James'],
    legacyUserId: '56',
    calendarOwnerId: '56',
    meetingForLegacyUserId: '56',
    dashboardTrackingEligible: false,
    roles: ['head_scout', 'calendar_owner', 'appointment_setter'],
    city: 'Phoenix',
    state: 'AZ',
  },
  {
    ownerKey: 'logan_lord',
    personName: 'Logan Lord',
    aliases: ['Logan Lord', 'Logan'],
    dashboardTrackingEligible: false,
    roles: ['task_owner', 'appointment_setter'],
  },
] as const;

export const HEAD_SCOUT_ORDER = OWNER_DIRECTORY.filter((owner) =>
  owner.roles.includes('head_scout'),
).map((owner) => ({
  scout_name: owner.personName,
  city: owner.city || '',
  state: owner.state || '',
  calendar_owner_id: owner.calendarOwnerId || '',
  meeting_for: owner.meetingForLegacyUserId || '',
})) as HeadScoutDirectoryEntry[];

export function normalizeOwnerName(value?: string | null): string {
  return normalizeToken(value);
}

export function ownerHasRole(owner: OwnerDirectoryEntry | null | undefined, role: OwnerRole): boolean {
  return Boolean(owner?.roles.includes(role));
}

export function resolveOwnerByName(value?: string | null): OwnerDirectoryEntry | null {
  const normalized = normalizeOwnerName(value);
  if (!normalized) return null;
  return (
    OWNER_DIRECTORY.find((owner) =>
      [owner.personName, ...owner.aliases].some((alias) => normalizeOwnerName(alias) === normalized),
    ) || null
  );
}

export function resolveOwnerByKey(value?: string | null): OwnerDirectoryEntry | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return OWNER_DIRECTORY.find((owner) => owner.ownerKey === normalized) || null;
}

export function resolveOwnerByLegacyUserId(value?: string | number | null): OwnerDirectoryEntry | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return OWNER_DIRECTORY.find((owner) => owner.legacyUserId === normalized) || null;
}

export function resolveOwnerByCalendarOwnerId(value?: string | number | null): OwnerDirectoryEntry | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return OWNER_DIRECTORY.find((owner) => owner.calendarOwnerId === normalized) || null;
}

export function resolveOwnerByMeetingForId(value?: string | number | null): OwnerDirectoryEntry | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return OWNER_DIRECTORY.find((owner) => owner.meetingForLegacyUserId === normalized) || null;
}

export function resolveOwnerByAnyId(value?: string | number | null): OwnerDirectoryEntry | null {
  return (
    resolveOwnerByLegacyUserId(value) ||
    resolveOwnerByCalendarOwnerId(value) ||
    resolveOwnerByMeetingForId(value)
  );
}

export function getActiveOperator(): ActiveOperatorContext {
  const envOwner = resolveOwnerByKey(process.env.ACTIVE_OPERATOR_KEY) || resolveOwnerByName(process.env.CALL_TRACKER_OWNER);
  if (envOwner?.dashboardTrackingEligible) {
    return {
      operatorKey: envOwner.ownerKey,
      personName: envOwner.personName,
      legacyUserId: envOwner.legacyUserId || '',
      taskAssignedOwnerName: envOwner.personName,
      dashboardTrackingEnabled: true,
      senderName: envOwner.personName,
    };
  }
  const owner = OWNER_DIRECTORY.find((entry) => entry.ownerKey === 'jerami_singleton') || OWNER_DIRECTORY[0];
  return {
    operatorKey: owner.ownerKey,
    personName: owner.personName,
    legacyUserId: owner.legacyUserId || '',
    taskAssignedOwnerName: owner.personName,
    dashboardTrackingEnabled: true,
    senderName: owner.personName,
  };
}

export function getDefaultCallTrackerOperator(): OwnerDirectoryEntry {
  return resolveOwnerByKey(getActiveOperator().operatorKey) || OWNER_DIRECTORY[0];
}

export function isDashboardTrackedOwner(value?: string | null): boolean {
  const activeOperator = getActiveOperator();
  return normalizeOwnerName(value) === normalizeOwnerName(activeOperator.taskAssignedOwnerName);
}

export function isActiveOperatorTaskAssignedOwner(value?: string | null): boolean {
  const activeOperator = getActiveOperator();
  return normalizeOwnerName(value) === normalizeOwnerName(activeOperator.taskAssignedOwnerName);
}

export function getLegacyAssignedToFallback(): string {
  return getActiveOperator().legacyUserId;
}
