import ownerConfig from '../../config/prospect-id-owners.json';

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
  | 'logan_lord'
  | 'kenton_manis';

export type OwnerProfile = {
  ownerKey: OwnerKey;
  personName: string;
  aliases: readonly string[];
  assignedToLegacyUserId?: string | null;
  legacyUserId?: string;
  calendarOwnerId?: string | null;
  meetingForLegacyUserId?: string | null;
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

type OwnerConfig = {
  activeOperatorKey: OwnerKey;
  headScoutCalendarAccessUserId: string;
  owners: Array<
    Omit<OwnerProfile, 'legacyUserId' | 'roles'> & {
      ownerKey: OwnerKey;
      roles: OwnerRole[];
    }
  >;
};

export const PROSPECT_ID_OWNER_CONFIG = ownerConfig as OwnerConfig;

export const OWNER_DIRECTORY: readonly OwnerProfile[] = PROSPECT_ID_OWNER_CONFIG.owners.map((owner) => ({
  ...owner,
  legacyUserId: owner.assignedToLegacyUserId || undefined,
})) as readonly OwnerProfile[];

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
  const configuredOwner = resolveOwnerByKey(PROSPECT_ID_OWNER_CONFIG.activeOperatorKey);
  const owner = configuredOwner?.dashboardTrackingEligible
    ? configuredOwner
    : OWNER_DIRECTORY.find((entry) => entry.ownerKey === 'jerami_singleton') || OWNER_DIRECTORY[0];
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
