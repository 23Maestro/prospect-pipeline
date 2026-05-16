import type { MeetingSetSubmitResponse, ScoutPrepContext } from '../features/scout-prep/types';
import {
  buildConfirmationMessage,
  type ConfirmationFollowUpVariant,
} from './scout-follow-up-templates';
import { getMeetingReminderRecipient } from '../domain/scout-contact-selection';
import { getGreetingForLocalTime } from '../domain/outreach-time-wording';
import { buildSetMeetingConfirmationCacheRows } from '../domain/set-meeting-confirmation-cache';
import {
  upsertSetMeetingConfirmationCacheRows,
  type SupabasePersistenceConfig,
} from '../domain/supabase-persistence';

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
  generatedAt?: string;
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
  const url = String(process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const key = String(
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  ).trim();
  const schema = String(process.env.SUPABASE_SCHEMA || 'public').trim() || 'public';
  return url && key ? { url, key, schema } : null;
}

function parseMeetingDate(value?: string | null): Date | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseMeetingLengthMinutes(value?: string | null): number {
  const trimmed = clean(value);
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 60;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const total = hours * 60 + minutes;
  return Number.isFinite(total) && total > 0 ? total : 60;
}

export function buildMeetingSetConfirmationCacheRowsFromScoutPrep(
  args: MeetingSetConfirmationCacheInput,
) {
  const appointmentId =
    clean(args.meetingSetResult?.open_event_id) || clean(args.meetingSet.openEventId);
  const meetingStartsAt =
    clean(args.meetingSetResult?.created_task?.due_date) ||
    clean(args.meetingSet.startsAt) ||
    clean(args.meetingSet.startTime);
  const meetingDate = parseMeetingDate(meetingStartsAt);
  const reminderRecipient = getMeetingReminderRecipient(args.context);
  const recipientPhone = reminderRecipient?.phones[0] || '';
  if (!appointmentId || !meetingDate || !reminderRecipient || !recipientPhone) {
    return [];
  }

  const meetingTimezone = clean(args.meetingSet.meetingTimezone) || 'America/New_York';
  const headScoutName =
    clean(args.meetingSet.headScout) ||
    clean(args.meetingSet.bookedMeetingAssignedOwner) ||
    clean(args.context.resolved.head_scout) ||
    '';
  const generatedAt = args.generatedAt || new Date().toISOString();
  const confirmation = (variant: ConfirmationFollowUpVariant) =>
    buildConfirmationMessage({
      variant,
      headScoutName,
      dueAt: meetingDate,
      meetingTimezone,
      recipientNames: reminderRecipient.recipientNames,
      greetingOverride: getGreetingForLocalTime({ now: new Date(generatedAt), meetingTimezone }),
    });

  return buildSetMeetingConfirmationCacheRows({
    appointmentId,
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName,
    recipientName: reminderRecipient.recipientNames[0] || '',
    recipientPhone,
    headScoutName,
    meetingStartsAt,
    meetingTimezone,
    meetingDurationMinutes: parseMeetingLengthMinutes(args.meetingSet.meetingLength),
    confirmation1Message: confirmation('confirmation_1'),
    confirmation2Message: confirmation('confirmation_2'),
    adminUrl: buildAthleteAdminUrl(args.athleteId, args.athleteMainId),
    taskUrl: clean(args.context.task.athlete_task_url),
    generatedAt,
    source: 'set_meetings_confirmation',
  });
}

export async function syncMeetingSetConfirmationCacheFromScoutPrep(
  args: MeetingSetConfirmationCacheInput,
  config: SupabasePersistenceConfig | null = getSetMeetingConfirmationSupabaseConfig(),
): Promise<{ enabled: boolean; count: number }> {
  if (!config) {
    return { enabled: false, count: 0 };
  }
  const rows = buildMeetingSetConfirmationCacheRowsFromScoutPrep(args);
  if (!rows.length) {
    return { enabled: true, count: 0 };
  }
  await upsertSetMeetingConfirmationCacheRows(config, rows);
  return { enabled: true, count: rows.length };
}
