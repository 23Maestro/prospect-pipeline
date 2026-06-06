import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Detail,
  Form,
  Grid,
  Icon,
  type KeyEquivalent,
  LocalStorage,
  List,
  open,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from '@raycast/api';
import fs from 'fs';
import path from 'path';
import { setTimeout } from 'timers/promises';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmationReminderMessageForm } from './components/follow-up-message-forms';
import {
  enrichHeadScoutFollowUpCandidate,
  loadHeadScoutFollowUpCandidates,
  loadHeadScoutWeeklyMeetingCandidates,
  type HeadScoutFollowUpCandidate,
} from './lib/head-scout-follow-ups';
import {
  buildHeadScoutWeekWindow,
  buildHeadScoutScriptMarkdown,
  fetchAthleteBookedMeetings,
  fetchHeadScoutBookedMeetings,
  fetchBookedMeetingDetails,
  fetchHeadScoutSlots,
  filterVisibleHeadScoutSlots,
  formatHeadScoutSlotDate,
  formatHeadScoutSlotForTimezone,
  formatHeadScoutWeekLabel,
  resolveAthleteTimezone,
  updateBookedMeetingDescription,
  updateBookedMeetingTitlePrefix,
  type BookedMeetingEvent,
  type HeadScoutSchedule,
  type HeadScoutSlot,
  type HeadScoutSlotsResponse,
} from './lib/head-scout-schedules';
import {
  loadPendingClientWatchlist,
  markPendingClientResolved,
  type PendingClientWatchlistLoadResult,
} from './lib/pending-client-watchlist';
import { addAthleteNote } from './lib/npid-mcp-adapter';
import {
  APPOINTMENT_TITLE_PREFIXES,
  type AppointmentTitlePrefix,
} from './lib/head-scout-event-prefix';
import { PostCallUpdateForm, VoicemailFollowUpRecipientForm } from './scout-prep';
import {
  buildSetMeetingCandidateIdentityKey,
  buildMeetingDayLabel,
  buildSetMeetingCandidatesFromAppointments,
  buildSetMeetingCandidatesFromBookedMeetings,
  filterWeeklySetMeetingCandidates,
} from './domain/set-meetings-candidate';
import { buildSetMeetingsCommandContext } from './domain/scout-prep-command-pipeline';
import { getActiveOperator } from './domain/owners';
import { copyHeadScoutContactCardToClipboard } from './lib/head-scout-contact-cards';
import { syncCallScriptToggleToNotion } from './lib/notion-call-scripts';
import {
  resolveConfirmationFollowUpVariant,
  type ConfirmationFollowUpVariant,
} from './lib/scout-follow-up-templates';
import { buildMessagesComposeUrlForRecipients } from './lib/scout-prep-contact';
import {
  fetchScoutPortalTasks,
  loadScoutPrepContext,
} from './lib/scout-prep';
import {
  resolveIanaTimeZoneFromLegacyLabel,
  resolveLegacyTimezoneLabelFromIana,
} from './domain/outreach-time-wording';
import {
  readRows,
  type SupabasePersistenceConfig,
} from './domain/supabase-persistence';
import type { ScoutPortalTask, ScoutPrepContext } from './features/scout-prep/types';
import {
  getCachedSetMeetings,
  setCachedSetMeetings,
  shouldRenderCachedSetMeetingsSnapshot,
} from './lib/set-meetings-cache';
import {
  findPendingClientReplyThemeState,
  readCachedClientReplyThemeReviewSnapshot,
  type ClientReplyThemeReviewSnapshot,
  type PendingClientReplyThemeState,
} from './lib/client-message-reply-themes';
import { getWeeklyScheduledAppointmentRows } from './lib/supabase-lifecycle';

const REPO_ROOT_FALLBACK = '/Users/singleton23/Raycast/prospect-pipeline';

function readEnvFile(filePath: string): Record<string, string> {
  try {
    const values: Record<string, string> = {};
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key) values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function findProjectRoot(): string {
  const starts = [process.cwd(), path.resolve(__dirname, '..'), REPO_ROOT_FALLBACK];
  const seen = new Set<string>();
  for (const start of starts) {
    let current = path.resolve(start);
    while (!seen.has(current)) {
      seen.add(current);
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(current, 'package.json'), 'utf8')) as {
          name?: string;
        };
        if (pkg.name === 'prospect-pipeline') return current;
      } catch {
        // keep walking
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return REPO_ROOT_FALLBACK;
}

function readRepoEnv(): Record<string, string> {
  const roots = [findProjectRoot(), REPO_ROOT_FALLBACK]
    .map((value) => path.resolve(value))
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);

  return roots.reduce<Record<string, string>>(
    (acc, root) => ({
      ...acc,
      ...readEnvFile(path.join(root, 'npid-api-layer/.env')),
      ...readEnvFile(path.join(root, '.env')),
      ...readEnvFile(path.join(root, '.overmind.env')),
    }),
    {},
  );
}

function getConfirmationCacheSupabaseConfig(): SupabasePersistenceConfig | null {
  const repoEnv = readRepoEnv();
  const url = String(
    process.env.SUPABASE_URL ||
      repoEnv.SUPABASE_URL ||
      process.env.SUPABASE_PROJECT_URL ||
      repoEnv.SUPABASE_PROJECT_URL ||
      '',
  )
    .trim()
    .replace(/\/+$/, '');
  const key = String(
    process.env.SUPABASE_SECRET_KEY ||
      repoEnv.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      repoEnv.SUPABASE_SERVICE_ROLE_KEY ||
      '',
  ).trim();
  const schema =
    String(process.env.SUPABASE_SCHEMA || repoEnv.SUPABASE_SCHEMA || 'public').trim() || 'public';
  return url && key ? { url, key, schema } : null;
}

type CachedSetMeetingConfirmationRow = {
  kind?: string | null;
  message_body?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  head_scout_name?: string | null;
  meeting_starts_at?: string | null;
  meeting_timezone?: string | null;
};

type CachedSetMeetingConfirmation = {
  message: string;
  recipientNames: string[];
  phones: string[];
  headScoutName: string;
};

async function readCachedSetMeetingConfirmation(args: {
  appointmentId?: string | null;
  variant: ConfirmationFollowUpVariant;
}): Promise<CachedSetMeetingConfirmation | null> {
  const appointmentId = String(args.appointmentId || '').trim();
  const supabaseConfig = getConfirmationCacheSupabaseConfig();
  if (!appointmentId || !supabaseConfig) return null;

  const rows = await readRows<CachedSetMeetingConfirmationRow>(
    supabaseConfig,
    'set_meeting_confirmation_cache',
    [
      'select=kind,message_body,recipient_name,recipient_phone,head_scout_name,meeting_starts_at,meeting_timezone',
      `appointment_id=eq.${encodeURIComponent(appointmentId)}`,
      `kind=eq.${args.variant}`,
      'limit=1',
    ].join('&'),
  ).catch(() => []);
  const row = rows[0];
  const message = String(row?.message_body || '').trim();
  const phone = String(row?.recipient_phone || '').trim();
  if (!message || !phone) return null;

  return {
    message,
    recipientNames: [String(row?.recipient_name || '').trim()].filter(Boolean),
    phones: [phone],
    headScoutName: String(row?.head_scout_name || '').trim(),
  };
}
type HeadScoutSchedulesRootProps = {
  initialWeekOffset?: number;
  syncContext?: {
    task: ScoutPortalTask;
    context: ScoutPrepContext;
    markdown: string;
  };
};

type PendingClientWatchlistRow = PendingClientWatchlistLoadResult['rows'][number];

const clientReplyThemeReviewStorage = {
  getItem: (key: string) => LocalStorage.getItem<string>(key),
  setItem: (key: string, value: string) => LocalStorage.setItem(key, value),
};

type HeadScoutScheduleListProps = {
  scout: HeadScoutSchedule;
  weekStart: string;
  weekEnd: string;
  timezoneLabel: string;
  weekOffset: number;
  syncContext?: HeadScoutSchedulesRootProps['syncContext'];
};

export type HeadScoutBookingsListProps = {
  scoutName?: string;
  weekOffset?: number;
  weeklyMeetingsOnly?: boolean;
};

const APPOINTMENT_SHORTCUT_KEYS: readonly KeyEquivalent[] = ['y', 'u', 'h', 'j', 'n'];
const SCOUT_GRID_SHORTCUT_KEYS: readonly KeyEquivalent[] = ['1', '2', '3', '4', '5', '6'];
const VIEW_SET_MEETINGS_CONTACT_CARD_ACTIONS = [
  { title: 'Copy James Card', scoutName: 'James Holcomb' },
  { title: 'Copy Jeffrey Card', scoutName: 'Jeffrey Stein' },
  { title: 'Copy Logan Card', scoutName: 'Logan Lord' },
  { title: 'Copy Ryan Card', scoutName: 'Ryan Lietz' },
  { title: 'Copy Luther Card', scoutName: 'Luther Winfield' },
  { title: 'Copy Jerami Card', scoutName: 'Jerami Singleton' },
] as const;

async function showLoadingToast(title: string, message?: string) {
  return showToast({
    style: Toast.Style.Animated,
    title: String(title || '')
      .trim()
      .slice(0, 24),
    message:
      String(message || '')
        .trim()
        .slice(0, 28) || undefined,
  });
}

function getHeadScoutCountColor(scoutName: string): string | Color {
  switch (scoutName) {
    case 'David Foley':
      return '#4B08A1';
    case 'Jeffrey Stein':
      return '#6E2242';
    case 'Luther Winfield':
      return '#C76E00';
    case 'Ryan Lietz':
      return '#1F9FA7';
    case 'James Holcomb':
      return '#070708';
    case 'Logan Lord':
      return '#600';
    case 'Kenton Manis':
      return '#05A915';
    case 'Nasir Adderley':
      return '#0080C6';
    default:
      return Color.SecondaryText;
  }
}

function getHeadScoutInitials(scoutName: string): string {
  return scoutName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('')
    .slice(0, 2);
}

function buildHeadScoutInitialsBadge(scoutName: string): string {
  const color = getHeadScoutCountColor(scoutName);
  const backgroundColor = typeof color === 'string' ? color : '#6B7280';
  const initials = getHeadScoutInitials(scoutName);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 213"><rect width="320" height="213" rx="18" fill="${backgroundColor}"/><text x="160" y="122" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="-apple-system,BlinkMacSystemFont,'SF Pro Display',Arial,sans-serif" font-size="82" font-weight="800">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildCandidateTask(candidate: HeadScoutFollowUpCandidate): ScoutPortalTask {
  return {
    contact_id: candidate.athleteId,
    athlete_id: candidate.athleteId,
    athlete_main_id: candidate.athleteMainId,
    athlete_name: candidate.athleteName,
    due_date: candidate.dueDate || null,
    task_id: candidate.taskId,
    title: candidate.currentTask,
    description: candidate.currentTask,
    athlete_admin_url: candidate.adminUrl,
    athlete_task_url: candidate.taskUrl,
  };
}

function buildPendingClientTask(row: PendingClientWatchlistRow): ScoutPortalTask {
  const athleteId = String(row.athlete_id || '').trim();
  const athleteMainId = String(row.athlete_main_id || '').trim();
  const athleteName =
    row.athlete_name || cleanPendingClientTitle(row.event_title) || 'Pending Client';

  return {
    contact_id: athleteId,
    athlete_id: athleteId,
    athlete_main_id: athleteMainId,
    athlete_name: athleteName,
    due_date: row.event_start || null,
    task_id: row.source_event_id,
    title: 'Reschedule Pending',
    description: row.description || row.event_title,
  };
}

function shouldShowPendingClientRescheduleAction(row: PendingClientWatchlistRow): boolean {
  const haystack = `${row.action_tag || ''} ${row.event_title || ''} ${row.description || ''}`;
  return (
    row.action_tag === 'Operator Input' ||
    /(?:\breschedule\b|\brsp\b|\bcancel\b|\bcanceled\b|\bcancelled\b|\(can\)|\(rsp\))/i.test(
      haystack,
    )
  );
}

function getBookedMeetingEventDate(meeting?: BookedMeetingEvent | null): string {
  return String(meeting?.start || '').split('T')[0] || '';
}

const SET_MEETING_TIME_TAG_COLORS = [
  Color.Yellow,
  Color.Purple,
  Color.Blue,
  Color.Green,
  Color.Orange,
  Color.Magenta,
  Color.Red,
];

function setMeetingTimeTagColorFor(value?: string | null): Color {
  const normalized = String(value || '').trim().toUpperCase();
  const hourMatch = normalized.match(/\b(\d{1,2})(?::\d{2})?\s*(AM|PM)\b/);
  if (!hourMatch) return Color.SecondaryText;
  const hour = Number.parseInt(hourMatch[1], 10);
  const period = hourMatch[2];
  const hour24 = period === 'PM' && hour < 12 ? hour + 12 : period === 'AM' && hour === 12 ? 0 : hour;
  return SET_MEETING_TIME_TAG_COLORS[hour24 % SET_MEETING_TIME_TAG_COLORS.length];
}

function formatSetMeetingAccessoryParts(candidate: HeadScoutFollowUpCandidate): {
  dateLabel: string;
  timeLabel: string;
} | null {
  const rawStart = String(candidate.bookedMeeting?.start || '').trim();
  const parsedStart = rawStart ? new Date(rawStart) : null;
  if (parsedStart && !Number.isNaN(parsedStart.getTime())) {
    return {
      dateLabel: new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: '2-digit',
        day: '2-digit',
        year: '2-digit',
        timeZone: 'America/New_York',
      }).format(parsedStart),
      timeLabel: new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/New_York',
      }).format(parsedStart),
    };
  }

  const label = String(candidate.currentMeetingLabel || candidate.bookedMeeting?.date_time_label || '')
    .replace(/^Current:\s*/, '')
    .trim();
  const match = label.match(/^([A-Za-z]{3},?\s+\d{1,2}\/\d{1,2}\/\d{2})\s+(.+?)(?:\s+-\s+.+)?$/);
  if (!match) return null;

  return {
    dateLabel: match[1].replace(/^([A-Za-z]{3})(?!,)/, '$1,'),
    timeLabel: match[2].trim(),
  };
}

function getConfirmationAppointmentPrefix(
  variant: ConfirmationFollowUpVariant,
): AppointmentTitlePrefix {
  return variant === 'confirmation_2' ? '(ACF*2)' : '(ACF)';
}

function MeetingDetailsForm({
  candidate,
  onSaved,
}: {
  candidate: HeadScoutFollowUpCandidate;
  onSaved: () => void;
}) {
  const { pop } = useNavigation();
  const meeting = candidate.bookedMeeting;
  const eventDate = getBookedMeetingEventDate(meeting);
  const [isLoading, setIsLoading] = useState(true);
  const [title, setTitle] = useState(meeting?.title || candidate.athleteName);
  const [description, setDescription] = useState('');
  const [currentDescription, setCurrentDescription] = useState('');

  useEffect(() => {
    let isActive = true;

    async function loadDetails() {
      if (!meeting?.event_id || !eventDate) {
        setIsLoading(false);
        return;
      }

      try {
        const details = await fetchBookedMeetingDetails({
          eventId: meeting.event_id,
          eventDate,
        });
        if (!isActive) return;
        setTitle(details.title);
        setDescription(details.description);
        setCurrentDescription(details.description);
      } catch (error) {
        if (!isActive) return;
        await showToast({
          style: Toast.Style.Failure,
          title: 'Details failed',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    void loadDetails();
    return () => {
      isActive = false;
    };
  }, [eventDate, meeting?.event_id]);

  async function handleSubmit() {
    if (!meeting?.event_id || !eventDate) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No meeting',
        message: 'Missing event id.',
      });
      return;
    }

    const toast = await showLoadingToast('Saving', 'Meeting Details');
    try {
      await updateBookedMeetingDescription({
        eventId: meeting.event_id,
        eventDate,
        description,
      });
      toast.style = Toast.Style.Success;
      toast.title = 'Saved';
      toast.message = 'Meeting Details';
      onSaved();
      pop();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Save failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      navigationTitle="Meeting Details"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Meeting Details"
            icon={Icon.Pencil}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Meeting" text={title} />
      <Form.TextArea
        id="description"
        title="Meeting Details"
        value={description}
        placeholder="Add meeting details"
        onChange={setDescription}
      />
      {currentDescription ? <Form.Description title="Current" text={currentDescription} /> : null}
    </Form>
  );
}

async function loadWeeklyOperatorMeetingCandidates(
  weekOffset: number,
): Promise<HeadScoutFollowUpCandidate[]> {
  const weekWindow = buildHeadScoutWeekWindow(weekOffset);
  const operatorName = getActiveOperator().taskAssignedOwnerName;
  const [weeklyAppointments, weekly, operatorTasks] = await Promise.all([
    getWeeklyScheduledAppointmentRows({
      weekStart: weekWindow.start,
      weekEnd: weekWindow.end,
      operatorOwnerKey: getActiveOperator().operatorKey,
    }).catch(() => []),
    fetchHeadScoutBookedMeetings(weekOffset).catch(() => null),
    fetchScoutPortalTasks(weekOffset > 0 ? 'nextWeek' : 'thisWeek'),
  ]);
  const baseCandidates = weeklyAppointments.length
    ? buildSetMeetingCandidatesFromAppointments({
        appointments: weeklyAppointments,
        tasks: operatorTasks || [],
        operatorName,
      })
    : buildSetMeetingCandidatesFromBookedMeetings({
        bookedMeetings: weekly?.events || [],
        tasks: operatorTasks || [],
        operatorName,
      });
  const weeklyCandidates = await hydrateWeeklyCandidatesFromAthleteMeetings(
    baseCandidates,
    weekly?.week_start || weekWindow.start,
    weekly?.week_end || weekWindow.end,
  );

  return buildSetMeetingsCommandContext({
    candidates: weeklyCandidates,
  }).candidates;
}

function normalizeMeetingMatchText(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getMeetingEventStartValue(event: BookedMeetingEvent): number {
  const parsed = Date.parse(String(event.start || '').trim());
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function getMeetingEventIdValue(event: BookedMeetingEvent): number {
  const parsed = Number.parseInt(String(event.event_id || '').trim(), 10);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function pickNewestMeetingEvent(events: BookedMeetingEvent[]): BookedMeetingEvent | null {
  if (!events.length) return null;
  return [...events].sort((left, right) => {
    const startDiff = getMeetingEventStartValue(right) - getMeetingEventStartValue(left);
    if (startDiff !== 0) return startDiff;
    return getMeetingEventIdValue(right) - getMeetingEventIdValue(left);
  })[0];
}

async function hydrateWeeklyCandidatesFromAthleteMeetings(
  candidates: HeadScoutFollowUpCandidate[],
  weekStart: string,
  weekEnd: string,
): Promise<HeadScoutFollowUpCandidate[]> {
  return Promise.all(
    candidates.map(async (candidate) => {
      if (!candidate.athleteId || !candidate.athleteMainId || !candidate.bookedMeeting?.title) {
        return candidate;
      }
      const result = await fetchAthleteBookedMeetings({
        athleteId: candidate.athleteId,
        athleteMainId: candidate.athleteMainId,
      }).catch(() => null);
      const athleteNameKey = normalizeMeetingMatchText(candidate.athleteName);
      const preferred = pickNewestMeetingEvent(
        (result?.events || []).filter((event) => {
          const meetingDay = String(event.start || '').slice(0, 10);
          const eventTitleKey = normalizeMeetingMatchText(event.title);
          return (
            meetingDay >= weekStart &&
            meetingDay < weekEnd &&
            eventTitleKey.includes(athleteNameKey)
          );
        }),
      );
      if (!preferred || preferred.event_id === candidate.bookedMeeting.event_id) {
        return candidate;
      }
      return {
        ...candidate,
        headScoutName: preferred.assigned_owner || candidate.headScoutName,
        bookedMeetingTitle: preferred.title,
        bookedMeeting: preferred,
        currentMeetingLabel: preferred.date_time_label || candidate.currentMeetingLabel,
      };
    }),
  );
}

function formatPendingClientMeetingDate(
  value?: string | null,
  timeZone?: string | null,
  timezoneLabel?: string | null,
): string {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown Date';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return 'Unknown Date';
  const resolvedTimeZone = resolveIanaTimeZoneFromLegacyLabel(
    String(timeZone || timezoneLabel || 'America/New_York').trim(),
  );
  const resolvedLabel =
    resolveLegacyTimezoneLabelFromIana(timezoneLabel) ||
    resolveLegacyTimezoneLabelFromIana(resolvedTimeZone) ||
    String(timezoneLabel || '').trim();
  let formatted = '';
  try {
    formatted = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: resolvedTimeZone,
      timeZoneName: 'short',
    }).format(parsed);
  } catch {
    formatted = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
      timeZoneName: 'short',
    }).format(parsed);
  }

  return resolvedLabel
    ? formatted.replace(/\b(?:EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b$/, resolvedLabel)
    : formatted;
}

function getPendingClientMeetingStart(
  row: PendingClientWatchlistLoadResult['rows'][number],
): string | null {
  const appointmentStart = String(row.appointment_starts_at || '').trim();
  if (appointmentStart) return appointmentStart;
  if (row.action_tag === 'Payment Watch') return null;
  return String(row.event_start || '').trim() || null;
}

function getPendingClientMeetingLabel(
  row: PendingClientWatchlistLoadResult['rows'][number],
): string {
  const start = getPendingClientMeetingStart(row);
  if (!start) return row.action_tag === 'Payment Watch' ? 'No previous meeting' : 'Unknown Date';
  return formatPendingClientMeetingDate(start, row.meeting_timezone, row.meeting_timezone_label);
}

function formatPendingClientActionNote(
  row: PendingClientWatchlistLoadResult['rows'][number],
): string {
  if (isPendingClientCanceled(row)) return 'Canceled meeting.';
  if (row.action_tag === 'Payment Watch') return 'Scout note needed.';
  if (row.action_tag === 'Operator Input') return 'Operator note needed.';
  if (row.action_tag === 'Missing Notes') return 'Note needed.';
  return 'Scout update.';
}

function isPendingClientCanceled(row: PendingClientWatchlistLoadResult['rows'][number]): boolean {
  const haystack = `${row.event_title || ''}\n${row.description || ''}`;
  return /\bMeeting Result - Canceled\b|\bcancel(?:ed|led)?\b|\(CAN\)/i.test(haystack);
}

function hasPendingClientCancelTitleEvidence(
  row: PendingClientWatchlistLoadResult['rows'][number],
): boolean {
  return /\(CAN\)/i.test(`${row.event_title || ''}\n${row.description || ''}`);
}

function buildPendingClientNextSteps(
  row: PendingClientWatchlistLoadResult['rows'][number],
  hasNote: boolean,
): string {
  if (row.action_tag === 'Payment Watch') return '- [ ] Review payment/joining note';
  if (isPendingClientCanceled(row)) {
    const steps = [];
    if (hasPendingClientCancelTitleEvidence(row) && !extractPendingClientSalesStage(row)) {
      steps.push('- [ ] Update sales stage');
    }
    if (!hasNote) {
      steps.push('- [ ] Add operator note');
    }
    steps.push('- [ ] Send follow-up');
    return steps.join('\n');
  }
  if (row.action_tag === 'Operator Input') {
    if (hasNote) return '- [ ] Reach out to reschedule';
    return '- [ ] Add operator note\n- [ ] Reach out to reschedule';
  }
  if (row.action_tag === 'Missing Notes') {
    return '- [ ] Add operator note\n- [ ] Reach out with next step';
  }
  return '- [ ] Reach out with next step';
}

function normalizePendingClientNoteFallback(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^No usable Notes tab or post-meeting event-list entry found/i.test(trimmed)) return null;
  if (/^CRM lifecycle identifies .+ event-list note is not populated yet\./i.test(trimmed)) {
    return null;
  }
  if (/^CRM lifecycle and post-meeting .* identify a pending client\./i.test(trimmed)) {
    return null;
  }
  if (/^Title evidence:\s*\(CAN\)/i.test(trimmed)) return null;
  if (/^Title evidence:\s*\(RSP\)/i.test(trimmed))
    return null;
  if (/^Title evidence:\s*\(FU\)/i.test(trimmed)) return 'Marked follow-up by event prefix.';
  return trimmed;
}

function buildPendingClientAdminUrl(
  row: PendingClientWatchlistLoadResult['rows'][number],
): string | null {
  const athleteId = String(row.athlete_id || '').trim();
  const athleteMainId = String(row.athlete_main_id || '').trim();
  if (!athleteId) return null;
  const url = new URL('https://dashboard.nationalpid.com/admin/athletes');
  url.searchParams.set('contactid', athleteId);
  if (athleteMainId) url.searchParams.set('athlete_main_id', athleteMainId);
  return url.toString();
}

function buildPendingClientTaskUrl(
  row: PendingClientWatchlistLoadResult['rows'][number],
): string | null {
  const adminUrl = buildPendingClientAdminUrl(row);
  if (!adminUrl) return null;
  const url = new URL(adminUrl);
  url.searchParams.set('tasktab', '1');
  return url.toString();
}

function buildPendingClientAthleteProfileUrl(
  row: PendingClientWatchlistLoadResult['rows'][number],
): string | null {
  const athleteId = String(row.athlete_id || '').trim();
  return athleteId
    ? `https://dashboard.nationalpid.com/athlete/profile/${encodeURIComponent(athleteId)}`
    : null;
}

function getPendingClientDisplayTag(
  row: PendingClientWatchlistLoadResult['rows'][number],
  replyState?: PendingClientReplyThemeState | null,
): {
  label: string;
  color: Color;
} {
  if (replyState?.status === 'needs_reply') {
    return { label: 'Needs Reply', color: Color.Red };
  }
  if (replyState?.status === 'awaiting_reschedule') {
    return { label: 'Awaiting RSP', color: Color.Yellow };
  }
  if (isPendingClientCanceled(row)) {
    return { label: 'OP Input', color: Color.Red };
  }

  switch (row.action_tag) {
    case 'Payment Watch':
      return { label: 'Payment', color: Color.Green };
    case 'Operator Input':
      return { label: 'OP Input', color: Color.Red };
    case 'Scout Update':
      return { label: 'Follow Up', color: Color.Blue };
    default:
      return { label: 'No Note', color: Color.Orange };
  }
}

function getPendingClientIcon(row: PendingClientWatchlistLoadResult['rows'][number]): string {
  if (isPendingClientCanceled(row)) return '🚩';
  switch (row.action_tag) {
    case 'Payment Watch':
      return '💰';
    case 'Operator Input':
      return '🚩';
    case 'Scout Update':
      return '↪️';
    default:
      return '📝';
  }
}

function isPendingClientGeneratedHeading(value: string): boolean {
  return (
    /^Sales Stage:/i.test(value) ||
    /^Lifecycle:/i.test(value) ||
    /^Pending Tag:/i.test(value) ||
    /^Notes Tab:\s*missing$/i.test(value) ||
    /^Notes Tab:\s*\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(value) ||
    /^Scout Note:/i.test(value)
  );
}

function isPendingClientEventTitle(value: string): boolean {
  return (
    /^Event List:\s*(?:Follow Up\s+-|\(FU\)|\(RSP\)|\(CAN\)|Booked Meeting)/i.test(value) ||
    /^Event List:\s*[^.?!]{1,90}\s+\d{4}\s+[A-Z]{2}$/i.test(value)
  );
}

function isPendingClientMeetingDescription(value: string): boolean {
  return (
    /https?:\/\/(?:www\.)?maxpreps\.com/i.test(value) ||
    /\bMain Number:/i.test(value) ||
    /\bBackup Number:/i.test(value) ||
    /\bSpoke To:/i.test(value) ||
    /\bAbout The Athlete:/i.test(value) ||
    /\bOther Parent:/i.test(value)
  );
}

function cleanPendingClientNoteBody(value: string): string | null {
  const trimmed = value.trim();
  if (
    !trimmed ||
    isPendingClientGeneratedHeading(trimmed) ||
    isPendingClientMeetingDescription(trimmed) ||
    /^Payment Watch:\s*pending payment evidence remains active/i.test(trimmed)
  ) {
    return null;
  }
  return normalizePendingClientNoteFallback(trimmed);
}

function extractPendingClientScoutNote(
  row: PendingClientWatchlistLoadResult['rows'][number],
): string | null {
  const lines = String(row.description || '')
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (/^Notes Tab:/i.test(trimmed)) {
        return cleanPendingClientNoteBody(trimmed.replace(/^Notes Tab:\s*/i, ''));
      }
      if (/^Event List:/i.test(trimmed)) {
        if (isPendingClientEventTitle(trimmed)) return null;
        return cleanPendingClientNoteBody(trimmed.replace(/^Event List:\s*/i, ''));
      }
      return null;
    })
    .filter(Boolean) as string[];
  return lines.join('\n\n') || null;
}

function extractPendingClientSalesStage(
  row: PendingClientWatchlistLoadResult['rows'][number],
): string | null {
  const match = String(row.description || '').match(/^Sales Stage:\s*(.+)$/im);
  return match?.[1]?.trim() || null;
}

function extractPendingClientNote(row: PendingClientWatchlistLoadResult['rows'][number]): string {
  const scoutNote = extractPendingClientScoutNote(row);
  const body = scoutNote || formatPendingClientActionNote(row);
  return [body, '', buildPendingClientNextSteps(row, Boolean(scoutNote))].join('\n');
}

function buildPendingClientDetailMarkdown(
  row: PendingClientWatchlistLoadResult['rows'][number],
): string {
  const salesStage = extractPendingClientSalesStage(row);
  const scout = row.head_scout || 'Unresolved';
  const meeting = getPendingClientMeetingLabel(row);
  return [
    '# Note',
    '',
    `### ${scout}`,
    '',
    `**Meeting:** ${meeting}`,
    '',
    salesStage ? `**Sales Stage:** ${salesStage}` : null,
    '',
    extractPendingClientNote(row),
  ]
    .filter((line) => line !== null)
    .join('\n');
}

function buildPendingClientDetailMetadata(row: PendingClientWatchlistLoadResult['rows'][number]) {
  const eventDate = getPendingClientMeetingLabel(row);
  const athleteName =
    row.athlete_name || cleanPendingClientTitle(row.event_title) || 'Pending Client';

  return (
    <List.Item.Detail.Metadata>
      <List.Item.Detail.Metadata.Label title="Athlete" text={athleteName} />
      <List.Item.Detail.Metadata.Label title="Meeting" text={eventDate} />
    </List.Item.Detail.Metadata>
  );
}

function PendingClientOperatorNoteForm({
  row,
  onSaved,
}: {
  row: PendingClientWatchlistLoadResult['rows'][number];
  onSaved: () => void;
}) {
  const { pop } = useNavigation();
  const athleteName =
    row.athlete_name || cleanPendingClientTitle(row.event_title) || 'Pending Client';

  async function handleSubmit(values: { title: string; description: string }) {
    const athleteId = String(row.athlete_id || '').trim();
    const athleteMainId = String(row.athlete_main_id || '').trim();
    const title = String(values.title || '').trim();
    const description = String(values.description || '').trim();

    if (!athleteId || !athleteMainId) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing athlete IDs',
        message: 'Cannot add a Notes tab entry without athlete_id and athlete_main_id.',
      });
      return;
    }
    if (!title || !description) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing note',
        message: 'Add both a title and description.',
      });
      return;
    }

    const toast = await showLoadingToast('Adding note', athleteName);
    try {
      await addAthleteNote({
        athleteId,
        athleteMainId,
        title,
        description,
      });
      toast.style = Toast.Style.Success;
      toast.title = 'Added';
      onSaved();
      pop();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Note failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <Form
      navigationTitle={`Add Note - ${athleteName}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Note" icon={Icon.PlusCircle} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Title"
        defaultValue={row.action_tag === 'Operator Input' ? 'Reschedule Pending Operator Note' : ''}
        placeholder="Note title"
      />
      <Form.TextArea id="description" title="Description" placeholder="What changed?" />
    </Form>
  );
}

function PendingClientRescheduleFollowUp({
  row,
  onComplete,
}: {
  row: PendingClientWatchlistRow;
  onComplete: () => void;
}) {
  const [context, setContext] = useState<ScoutPrepContext | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const task = useMemo(() => buildPendingClientTask(row), [row]);
  const athleteName = task.athlete_name || 'Pending Client';

  useEffect(() => {
    let active = true;

    async function loadContext() {
      setErrorMessage(null);
      setContext(null);
      try {
        if (!task.athlete_id || !task.athlete_main_id) {
          throw new Error('Missing athlete IDs for Pending Client reschedule follow-up.');
        }
        const loaded = await loadScoutPrepContext(task);
        if (active) {
          setContext(loaded);
        }
      } catch (error) {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void loadContext();
    return () => {
      active = false;
    };
  }, [task, reloadKey]);

  if (context) {
    return (
      <VoicemailFollowUpRecipientForm
        task={task}
        context={context}
        currentTask="Reschedule Pending"
        closeAfterCompleteViews={2}
        onComplete={onComplete}
      />
    );
  }

  return (
    <Detail
      isLoading={!errorMessage}
      navigationTitle={`Follow Up - ${athleteName}`}
      markdown={errorMessage ? `# Follow Up\n\n${errorMessage}` : '# Loading'}
      actions={
        errorMessage ? (
          <ActionPanel>
            <Action
              title="Retry"
              icon={Icon.ArrowClockwise}
              onAction={() => setReloadKey((current) => current + 1)}
            />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}

function PendingClientsWatchlist() {
  const [result, setResult] = useState<PendingClientWatchlistLoadResult | null>(null);
  const [replyThemeSnapshot, setReplyThemeSnapshot] =
    useState<ClientReplyThemeReviewSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const [loaded, reviewSnapshot] = await Promise.all([
          loadPendingClientWatchlist(),
          readCachedClientReplyThemeReviewSnapshot(clientReplyThemeReviewStorage),
        ]);
        if (!cancelled) {
          setResult(loaded);
          setReplyThemeSnapshot(reviewSnapshot);
        }
      } catch (error) {
        if (!cancelled) {
          await showToast({
            style: Toast.Style.Failure,
            title: 'Watchlist failed',
            message: error instanceof Error ? error.message : String(error),
          });
          setResult({ rows: [], scannedCount: 0, confirmedCount: 0, aiUnavailableCount: 0 });
          setReplyThemeSnapshot(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  async function handleMarkResolved(sourceEventId: string) {
    setResolvingId(sourceEventId);
    const toast = await showLoadingToast('Resolving', 'Pending Client');
    try {
      await markPendingClientResolved(sourceEventId);
      toast.style = Toast.Style.Success;
      toast.title = 'Removed';
      setRefreshTick((current) => current + 1);
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Resolve failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setResolvingId((current) => (current === sourceEventId ? null : current));
    }
  }

  const rows = result?.rows || [];

  return (
    <List
      isLoading={isLoading || Boolean(resolvingId)}
      isShowingDetail
      navigationTitle="Pending Clients"
      searchBarPlaceholder="Search pending"
    >
      {rows.length ? (
        <List.Section
          title="Pending Clients"
          subtitle={`${rows.length}${result ? `/${result.scannedCount}` : ''}`}
        >
          {rows.map((row) => {
            const signals = row.matched_signals || [];
            const actionTag = row.action_tag || 'Missing Notes';
            const replyState = findPendingClientReplyThemeState(row, replyThemeSnapshot);
            const displayTag = getPendingClientDisplayTag(row, replyState);
            const athleteProfileUrl = buildPendingClientAthleteProfileUrl(row);
            const taskUrl = buildPendingClientTaskUrl(row);
            const adminUrl = buildPendingClientAdminUrl(row);
            const athleteName =
              row.athlete_name || cleanPendingClientTitle(row.event_title) || 'Pending Client';
            return (
              <List.Item
                key={row.source_event_id}
                icon={getPendingClientIcon(row)}
                title={athleteName}
                accessories={[{ tag: { value: displayTag.label, color: displayTag.color } }]}
                keywords={[
                  athleteName,
                  row.head_scout || '',
                  row.event_title || '',
                  row.description || '',
                  actionTag,
                  ...signals,
                ]}
                detail={
                  <List.Item.Detail
                    markdown={buildPendingClientDetailMarkdown(row)}
                    metadata={buildPendingClientDetailMetadata(row)}
                  />
                }
                actions={
                  <ActionPanel>
                    <ActionPanel.Section title="Follow Up">
                      {shouldShowPendingClientRescheduleAction(row) ? (
                        <Action.Push
                          title="Send"
                          icon="💬"
                          shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
                          target={
                            <PendingClientRescheduleFollowUp
                              row={row}
                              onComplete={() => setRefreshTick((current) => current + 1)}
                            />
                          }
                        />
                      ) : null}
                      <Action.Push
                        title="Note"
                        icon="✍️"
                        shortcut={{ modifiers: ['cmd'], key: 'n' }}
                        target={
                          <PendingClientOperatorNoteForm
                            row={row}
                            onSaved={() => setRefreshTick((current) => current + 1)}
                          />
                        }
                      />
                      <Action
                        title={resolvingId === row.source_event_id ? 'Removing…' : 'Remove'}
                        icon="✅"
                        onAction={() => void handleMarkResolved(row.source_event_id)}
                      />
                    </ActionPanel.Section>
                    {athleteProfileUrl || taskUrl || adminUrl ? (
                      <ActionPanel.Section title="Athlete">
                        {athleteProfileUrl ? (
                          <Action.OpenInBrowser
                            title="Open Student-Athlete Page"
                            icon={Icon.Person}
                            shortcut={{ modifiers: ['cmd'], key: 'o' }}
                            url={athleteProfileUrl}
                          />
                        ) : null}
                        {taskUrl ? (
                          <Action.OpenInBrowser
                            title="Open Task List"
                            icon={Icon.List}
                            shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
                            url={taskUrl}
                          />
                        ) : null}
                        {adminUrl ? (
                          <Action.OpenInBrowser
                            title="Open Event List"
                            icon={Icon.Calendar}
                            shortcut={{ modifiers: ['cmd', 'shift'], key: 'e' }}
                            url={adminUrl}
                          />
                        ) : null}
                      </ActionPanel.Section>
                    ) : null}
                    <ActionPanel.Section>
                      <Action
                        title="Refresh"
                        icon="🔄"
                        shortcut={{ modifiers: ['cmd'], key: 'r' }}
                        onAction={() => setRefreshTick((current) => current + 1)}
                      />
                    </ActionPanel.Section>
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ) : (
        <List.EmptyView
          title="Clear"
          description={result?.aiUnavailableCount ? 'No confirmed matches.' : 'No pending clients.'}
          actions={
            <ActionPanel>
              <Action
                title="Refresh"
                icon={Icon.ArrowClockwise}
                onAction={() => setRefreshTick((current) => current + 1)}
              />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}

function cleanPendingClientTitle(title: string): string {
  return title
    .replace(/^Follow Up -\s*/i, '')
    .replace(/^\(FU\)(?:\*\d+)?\s*/i, '')
    .trim();
}

export function HeadScoutBookingsList({
  scoutName,
  weekOffset = 0,
  weeklyMeetingsOnly = false,
}: HeadScoutBookingsListProps) {
  const { push } = useNavigation();
  const [candidates, setCandidates] = useState<HeadScoutFollowUpCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sendingTextKey, setSendingTextKey] = useState<string | null>(null);
  const [updatingMeetingKey, setUpdatingMeetingKey] = useState<string | null>(null);
  const [refreshRequest, setRefreshRequest] = useState({ tick: 0, forceLive: false });
  const weekWindow = useMemo(() => buildHeadScoutWeekWindow(weekOffset), [weekOffset]);
  const weekLabel = useMemo(
    () => formatHeadScoutWeekLabel(weekWindow.start, weekWindow.end),
    [weekWindow.end, weekWindow.start],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadLive() {
      const enriched = weeklyMeetingsOnly
        ? await loadWeeklyOperatorMeetingCandidates(weekOffset)
        : await Promise.all(
            Array.from(
              new Map(
                [
                  ...(await loadHeadScoutWeeklyMeetingCandidates({
                    weekStart: weekWindow.start,
                    weekEnd: weekWindow.end,
                  })),
                  ...(await loadHeadScoutFollowUpCandidates()),
                ].map((candidate) => [buildSetMeetingCandidateIdentityKey(candidate), candidate]),
              ).values(),
            ).map((candidate) => enrichHeadScoutFollowUpCandidate(candidate)),
          );
      const filteredCandidates = filterWeeklySetMeetingCandidates({
        candidates: enriched,
        scoutName,
        weeklyMeetingsOnly,
        weekStart: weekWindow.start,
        weekEnd: weekWindow.end,
      });

      return buildSetMeetingsCommandContext({
        candidates: filteredCandidates,
        weekWindow,
        weekLabel,
        selectedScout: scoutName || null,
      }).candidates;
    }

    async function load() {
      const shouldUseCache = weeklyMeetingsOnly;
      let renderedCachedCandidates = false;
      setIsLoading(true);
      try {
        if (shouldUseCache && !refreshRequest.forceLive) {
          const cached = await getCachedSetMeetings<HeadScoutFollowUpCandidate>({
            weekStart: weekWindow.start,
            weekEnd: weekWindow.end,
            scoutName,
          });
          if (cancelled) return;
          if (shouldRenderCachedSetMeetingsSnapshot(cached)) {
            const cachedCandidates = filterWeeklySetMeetingCandidates({
              candidates: cached.snapshot.candidates,
              scoutName,
              weeklyMeetingsOnly,
              weekStart: weekWindow.start,
              weekEnd: weekWindow.end,
            });
            setCandidates(cachedCandidates);
            renderedCachedCandidates = true;
            if (!cached.isDueForHourlyRefresh) {
              setIsLoading(false);
              return;
            }
          }
        }

        setIsLoading(true);
        const liveCandidates = await loadLive();
        if (cancelled) return;
        setCandidates(liveCandidates);
        if (shouldUseCache) {
          await setCachedSetMeetings({
            weekStart: weekWindow.start,
            weekEnd: weekWindow.end,
            scoutName,
            candidates: liveCandidates,
          });
        }
      } catch (error) {
        if (!cancelled) {
          await showToast({
            style: Toast.Style.Failure,
            title: renderedCachedCandidates ? 'Refresh failed' : 'Failed to load bookings',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    refreshRequest,
    scoutName,
    weekLabel,
    weekOffset,
    weekWindow,
    weekWindow.end,
    weekWindow.start,
    weeklyMeetingsOnly,
  ]);

  async function markConfirmationAppointmentPrefix(
    candidate: HeadScoutFollowUpCandidate,
    variant: ConfirmationFollowUpVariant,
  ) {
    const eventDate = getBookedMeetingEventDate(candidate.bookedMeeting);
    if (!candidate.bookedMeeting?.event_id || !eventDate) return;
    await updateBookedMeetingTitlePrefix({
      eventId: candidate.bookedMeeting.event_id,
      eventDate,
      prefix: getConfirmationAppointmentPrefix(variant),
    });
  }

  async function sendConfirmationText(
    candidate: HeadScoutFollowUpCandidate,
    variant: ConfirmationFollowUpVariant,
    options?: {
      openContactCard?: boolean;
      copyOnly?: boolean;
    },
  ) {
    const candidateIdentityKey = buildSetMeetingCandidateIdentityKey(candidate);
    setSendingTextKey(candidateIdentityKey);
    const toast = await showLoadingToast(
      options?.copyOnly ? 'Copying' : 'Opening',
      candidate.athleteName,
    );
    try {
      const cached = await readCachedSetMeetingConfirmation({
        appointmentId: candidate.bookedMeeting?.event_id,
        variant,
      });
      if (!cached) {
        throw new Error('Missing cached confirmation message. Run confirmation cache repair.');
      }

      if (options?.copyOnly) {
        await Clipboard.copy(cached.message);
        toast.style = Toast.Style.Success;
        toast.title = 'Copied';
        toast.message = variant === 'confirmation_2' ? 'Confirmation 2' : 'Confirmation 1';
        return;
      }

      void markConfirmationAppointmentPrefix(candidate, variant).catch((error) => {
        void showToast({
          style: Toast.Style.Failure,
          title: 'Prefix update failed',
          message: error instanceof Error ? error.message : String(error),
        });
      });

      let composeMode: 'draft' | 'clipboard-fallback' = 'draft';
      try {
        await open(buildMessagesComposeUrlForRecipients(cached.phones, cached.message));
      } catch {
        await Clipboard.copy(cached.message);
        await open(`sms:${cached.phones[0]}`);
        composeMode = 'clipboard-fallback';
      }

      let contactCardCopied = false;
      if (options?.openContactCard && composeMode === 'draft') {
        await setTimeout(1200);
        await copyHeadScoutContactCardToClipboard(
          cached.headScoutName || candidate.headScoutName || null,
        );
        contactCardCopied = true;
        await showHUD('Contact card copied');
      }
      toast.style = Toast.Style.Success;
      toast.title = 'Ready';
      toast.message =
        composeMode === 'clipboard-fallback'
          ? 'Template copied'
          : contactCardCopied
            ? 'Draft + copied card'
            : 'Draft open';
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = options?.copyOnly ? 'Copy failed' : 'Open failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setSendingTextKey((current) => (current === candidateIdentityKey ? null : current));
    }
  }

  function buildConfirmationTextForm(candidate: HeadScoutFollowUpCandidate) {
    const defaultVariant = resolveConfirmationFollowUpVariant({
      crmStage: candidate.crmSalesStage,
      currentTask: candidate.currentTask,
      lifecycleState: candidate.lifecycleState,
    });

    return (
      <ConfirmationReminderMessageForm
        navigationTitle={`Confirmation Text • ${candidate.athleteName}`}
        defaultVariant={defaultVariant}
        onSubmit={(values, mode) =>
          sendConfirmationText(candidate, values.variant, {
            openContactCard: mode === 'messages_and_contact' && values.variant !== 'confirmation_2',
            copyOnly: mode === 'copy_message',
          })
        }
      />
    );
  }

  async function handleCopyNamedContactCard(scoutName: string) {
    const toast = await showLoadingToast('Copying', scoutName);
    try {
      const result = await copyHeadScoutContactCardToClipboard(scoutName);
      toast.style = Toast.Style.Success;
      toast.title = 'Copied';
      toast.message = result.copiedFile ? result.card.fullName : 'Path copied';
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Copy failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  async function handleMarkMeeting(
    candidate: HeadScoutFollowUpCandidate,
    prefix: AppointmentTitlePrefix,
  ) {
    const meeting = candidate.bookedMeeting;
    const eventDate = getBookedMeetingEventDate(meeting);
    if (!meeting?.event_id || !eventDate) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No meeting',
        message: 'Missing event id.',
      });
      return;
    }

    const candidateIdentityKey = buildSetMeetingCandidateIdentityKey(candidate);
    setUpdatingMeetingKey(candidateIdentityKey);
    const toast = await showLoadingToast('Saving', prefix);
    try {
      const result = await updateBookedMeetingTitlePrefix({
        eventId: meeting.event_id,
        eventDate,
        prefix,
      });
      toast.style = Toast.Style.Success;
      toast.title = 'Saved';
      toast.message = result.updated_title;
      setRefreshRequest((current) => ({ tick: current.tick + 1, forceLive: true }));
      const followUpStage =
        prefix === '(RSP)'
          ? 'Meeting Result - Res. Pending'
          : prefix === '(CAN)'
            ? 'Meeting Result - Canceled'
            : null;
      if (followUpStage && candidate.athleteId) {
        push(
          <PostCallUpdateForm
            task={buildCandidateTask(candidate)}
            initialStageLabel={followUpStage}
            initialBookedMeeting={{
              ...meeting,
              title: result.updated_title || meeting.title,
            }}
            onSaved={refreshLive}
          />,
        );
      }
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Save failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setUpdatingMeetingKey((current) => (current === candidateIdentityKey ? null : current));
    }
  }

  function refreshLive() {
    setRefreshRequest((current) => ({ tick: current.tick + 1, forceLive: true }));
  }

  return (
    <List
      isLoading={isLoading || Boolean(sendingTextKey) || Boolean(updatingMeetingKey)}
      navigationTitle={
        weeklyMeetingsOnly
          ? `${scoutName ? `${scoutName} ` : ''}Set Meetings • ${weekLabel}`
          : scoutName
            ? `${scoutName} Set Meetings`
            : 'Set Meetings'
      }
      searchBarPlaceholder="Search athlete, parents, stage, or scout"
    >
      {candidates.length ? (
        <List.Section
          title={weeklyMeetingsOnly ? `Set Meetings • ${weekLabel}` : 'Set Meetings'}
          subtitle={String(candidates.length)}
        >
          {candidates.map((candidate) =>
            (() => {
              const candidateIdentityKey = buildSetMeetingCandidateIdentityKey(candidate);
              const meetingLabel =
                candidate.currentMeetingLabel?.replace(/^Current:\s*/, '') || null;
              const meetingAccessory = formatSetMeetingAccessoryParts(candidate);
              const headScoutLabel = candidate.headScoutName || 'Scout not resolved';
              return (
                <List.Item
                  key={candidateIdentityKey}
                  icon={
                    candidate.needsManualReview
                      ? Icon.ExclamationMark
                      : candidate.bookedMeeting
                        ? Icon.CheckCircle
                        : Icon.Circle
                  }
                  title={candidate.athleteName}
                  subtitle={
                    weeklyMeetingsOnly && !scoutName
                      ? headScoutLabel
                      : meetingLabel ||
                        (candidate.needsManualReview
                          ? 'Rescheduled stage, no current booked meeting found.'
                          : buildMeetingDayLabel(candidate))
                  }
                  keywords={[
                    candidate.athleteName,
                    candidate.parent1Name || '',
                    candidate.parent2Name || '',
                    candidate.headScoutName || '',
                  ]}
                  accessories={[
                    ...(weeklyMeetingsOnly
                      ? meetingAccessory
                        ? [
                            { text: meetingAccessory.dateLabel },
                            {
                              tag: {
                                value: meetingAccessory.timeLabel,
                                color: setMeetingTimeTagColorFor(meetingAccessory.timeLabel),
                              },
                            },
                          ]
                        : []
                      : scoutName
                        ? []
                        : [{ text: headScoutLabel }]),
                    ...(weeklyMeetingsOnly
                      ? []
                      : candidate.badges
                          .filter((badge) => badge.label !== candidate.currentMeetingLabel)
                          .map((badge) => ({ tag: badge.label }))),
                  ]}
                  actions={
                    <ActionPanel>
                      <ActionPanel.Section title="Confirmation">
                        {candidate.athleteId && candidate.athleteMainId ? (
                          <Action.Push
                            title={
                              sendingTextKey === candidateIdentityKey
                                ? 'Opening…'
                                : 'Send Confirmation'
                            }
                            icon={Icon.Message}
                            shortcut={{ modifiers: ['cmd'], key: 'm' }}
                            target={buildConfirmationTextForm(candidate)}
                          />
                        ) : null}
                      </ActionPanel.Section>
                      {candidate.bookedMeeting?.event_id ? (
                        <ActionPanel.Section title="Meeting Prefix">
                          {APPOINTMENT_TITLE_PREFIXES.map((prefix, index) => (
                            <Action
                              key={prefix}
                              title={
                                updatingMeetingKey === candidateIdentityKey
                                  ? 'Saving…'
                                  : `Mark ${prefix}`
                              }
                              icon={Icon.Pencil}
                              shortcut={
                                index < APPOINTMENT_SHORTCUT_KEYS.length
                                  ? { modifiers: ['cmd'], key: APPOINTMENT_SHORTCUT_KEYS[index] }
                                  : undefined
                              }
                              onAction={() => void handleMarkMeeting(candidate, prefix)}
                            />
                          ))}
                          {weeklyMeetingsOnly ? (
                            <Action.Push
                              title="Meeting Details"
                              icon={Icon.Pencil}
                              shortcut={{ modifiers: ['cmd'], key: 'e' }}
                              target={
                                <MeetingDetailsForm candidate={candidate} onSaved={refreshLive} />
                              }
                            />
                          ) : null}
                        </ActionPanel.Section>
                      ) : null}
                      {candidate.athleteId ? (
                        <ActionPanel.Section title="Post-Call Update">
                          <Action.Push
                            title="Reschedule Pending"
                            icon={Icon.Clock}
                            shortcut={{ modifiers: ['cmd', 'opt'], key: 'r' }}
                            target={
                              <PostCallUpdateForm
                                task={buildCandidateTask(candidate)}
                                initialStageLabel="Meeting Result - Res. Pending"
                                initialBookedMeeting={candidate.bookedMeeting}
                                onSaved={refreshLive}
                              />
                            }
                          />
                          <Action.Push
                            title="Meeting Set - Rescheduled"
                            icon={Icon.Calendar}
                            shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
                            target={
                              <PostCallUpdateForm
                                task={buildCandidateTask(candidate)}
                                initialStageLabel="Meeting Result - Rescheduled"
                                initialBookedMeeting={candidate.bookedMeeting}
                                onSaved={refreshLive}
                              />
                            }
                          />
                        </ActionPanel.Section>
                      ) : null}
                      {weeklyMeetingsOnly ? (
                        <ActionPanel.Section title="Navigation">
                          <Action.Push
                            title="Pending Clients"
                            icon={Icon.Eye}
                            shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
                            target={<PendingClientsWatchlist />}
                          />
                          <Action
                            title="Refresh Live"
                            icon={Icon.ArrowClockwise}
                            shortcut={{ modifiers: ['cmd'], key: 'r' }}
                            onAction={refreshLive}
                          />
                          <Action.Push
                            title="Next Week"
                            icon={Icon.ArrowRight}
                            shortcut={{ modifiers: ['cmd', 'shift'], key: 'enter' }}
                            target={
                              <HeadScoutBookingsList
                                scoutName={scoutName}
                                weekOffset={weekOffset + 1}
                                weeklyMeetingsOnly
                              />
                            }
                          />
                        </ActionPanel.Section>
                      ) : null}
                      <ActionPanel.Section title="Athlete">
                        {candidate.adminUrl ? (
                          <Action.OpenInBrowser
                            title="Open Athlete Admin"
                            shortcut={{ modifiers: ['cmd'], key: 'o' }}
                            url={candidate.adminUrl}
                          />
                        ) : null}
                        {candidate.taskUrl ? (
                          <Action.OpenInBrowser
                            title="Open Athlete Task Tab"
                            shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
                            url={candidate.taskUrl}
                          />
                        ) : null}
                        {candidate.bookedMeeting ? (
                          <Action.CopyToClipboard
                            title="Copy Booked Meeting"
                            shortcut={{ modifiers: ['cmd'], key: 'c' }}
                            content={`${candidate.athleteName} • ${candidate.bookedMeeting.date_time_label}`}
                          />
                        ) : null}
                      </ActionPanel.Section>
                      <ActionPanel.Section title="Contact Cards">
                        {VIEW_SET_MEETINGS_CONTACT_CARD_ACTIONS.map((action) => (
                          <Action
                            key={action.scoutName}
                            title={action.title}
                            icon={Icon.Clipboard}
                            onAction={() => void handleCopyNamedContactCard(action.scoutName)}
                          />
                        ))}
                      </ActionPanel.Section>
                    </ActionPanel>
                  }
                />
              );
            })(),
          )}
        </List.Section>
      ) : (
        <List.EmptyView
          title="No Set Meetings"
          description={
            weeklyMeetingsOnly
              ? scoutName
                ? `No actual booked meetings matched ${scoutName} for ${weekLabel}.`
                : `No actual booked meetings found for ${weekLabel}.`
              : scoutName
                ? `No set meetings or confirmation athletes matched ${scoutName}.`
                : 'No set meetings or confirmation athletes were found.'
          }
          actions={
            weeklyMeetingsOnly ? (
              <ActionPanel>
                <Action.Push
                  title="Pending Clients"
                  icon={Icon.Eye}
                  shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
                  target={<PendingClientsWatchlist />}
                />
                <Action
                  title="Refresh Live"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ['cmd'], key: 'r' }}
                  onAction={refreshLive}
                />
                <Action.Push
                  title="Next Week"
                  icon={Icon.ArrowRight}
                  target={
                    <HeadScoutBookingsList
                      scoutName={scoutName}
                      weekOffset={weekOffset + 1}
                      weeklyMeetingsOnly
                    />
                  }
                />
              </ActionPanel>
            ) : undefined
          }
        />
      )}
    </List>
  );
}

function HeadScoutScheduleList({
  scout,
  weekStart,
  weekEnd,
  timezoneLabel,
  weekOffset,
  syncContext,
}: HeadScoutScheduleListProps) {
  const visibleSlots = useMemo(
    () => filterVisibleHeadScoutSlots(scout.slots, weekOffset),
    [scout.slots, weekOffset],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSyncingSlots, setIsSyncingSlots] = useState(false);
  const athleteTimezone = syncContext
    ? resolveAthleteTimezone(syncContext.context.resolved.city, syncContext.context.resolved.state)
    : null;

  function toggleSlotSelection(slot: HeadScoutSlot) {
    setSelectedIds((current) => {
      if (current.includes(slot.id)) {
        return current.filter((id) => id !== slot.id);
      }
      if (current.length >= 2) {
        void showToast({
          style: Toast.Style.Failure,
          title: 'Only two slots allowed',
          message: 'Remove one selected slot first.',
        });
        return current;
      }
      return [...current, slot.id];
    });
  }

  async function handleSyncSelectedSlotsToNotion() {
    if (!syncContext) {
      return;
    }
    const selectedSlots = visibleSlots
      .filter((slot) => selectedIds.includes(slot.id))
      .sort((left, right) => left.start.localeCompare(right.start));
    if (selectedSlots.length !== 2) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Select exactly two slots',
      });
      return;
    }

    const slotLabels = selectedSlots.map((slot) => {
      const display = formatHeadScoutSlotForTimezone(slot.start, slot.end, athleteTimezone);
      return `${display.dateLabel} ${display.timeRangeLabel}`;
    });

    const notionMarkdown = buildHeadScoutScriptMarkdown({
      baseMarkdown: syncContext.markdown,
      scoutName: scout.scout_name,
      slotLabels,
    });

    setIsSyncingSlots(true);
    const toast = await showLoadingToast('Syncing', scout.scout_name);
    try {
      const result = await syncCallScriptToggleToNotion({
        target: 'script',
        markdown: notionMarkdown,
      });
      toast.style = Toast.Style.Success;
      toast.title = 'Synced';
      toast.message = result.toggleTitle;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Sync failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setIsSyncingSlots(false);
    }
  }

  return (
    <List
      navigationTitle={`${scout.scout_name} • ${formatHeadScoutWeekLabel(weekStart, weekEnd)}`}
      searchBarPlaceholder="Filter open slots"
      isShowingDetail={false}
      isLoading={isSyncingSlots}
    >
      {visibleSlots.map((slot) =>
        (() => {
          const display = formatHeadScoutSlotForTimezone(slot.start, slot.end, athleteTimezone);
          const isSelected = selectedIds.includes(slot.id);
          return (
            <List.Item
              key={slot.id}
              icon={isSelected ? Icon.CheckCircle : Icon.Calendar}
              title={display.dateLabel}
              subtitle={display.timeRangeLabel}
              accessories={[
                { text: `${scout.city}, ${scout.state}` },
                { text: athleteTimezone ? display.zoneLabel : timezoneLabel },
              ]}
              actions={
                <ActionPanel>
                  {syncContext ? (
                    <>
                      <Action
                        title={isSelected ? 'Remove Slot' : 'Select Slot'}
                        icon={isSelected ? Icon.MinusCircle : Icon.PlusCircle}
                        onAction={() => toggleSlotSelection(slot)}
                      />
                      <Action
                        title={isSyncingSlots ? 'Syncing…' : 'Sync to Notion'}
                        icon={Icon.Upload}
                        onAction={() => void handleSyncSelectedSlotsToNotion()}
                      />
                    </>
                  ) : (
                    <Action.CopyToClipboard
                      title="Copy Slot"
                      content={`${scout.scout_name} • ${display.dateLabel} • ${display.timeRangeLabel}`}
                    />
                  )}
                  <Action.Push
                    title="Next Week"
                    icon={Icon.ArrowRight}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'enter' }}
                    target={
                      <HeadScoutSchedulesRoot
                        initialWeekOffset={weekOffset + 1}
                        syncContext={syncContext}
                      />
                    }
                  />
                </ActionPanel>
              }
            />
          );
        })(),
      )}
      {!visibleSlots.length ? (
        <List.EmptyView
          title="No open slots"
          description={`${scout.scout_name} has no open slots for ${formatHeadScoutWeekLabel(weekStart, weekEnd)}.`}
          actions={
            <ActionPanel>
              <Action.Push
                title="Next Week"
                icon={Icon.ArrowRight}
                target={
                  <HeadScoutSchedulesRoot
                    initialWeekOffset={weekOffset + 1}
                    syncContext={syncContext}
                  />
                }
              />
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}

export function HeadScoutSchedulesRoot({
  initialWeekOffset = 0,
  syncContext,
}: HeadScoutSchedulesRootProps) {
  const { push } = useNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [payload, setPayload] = useState<HeadScoutSlotsResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetchHeadScoutSlots(initialWeekOffset);
        if (cancelled) {
          return;
        }
        setPayload(response);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          setErrorMessage(message);
          await showToast({
            style: Toast.Style.Failure,
            title: 'Failed to load head scout schedules',
            message,
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [initialWeekOffset]);

  const weekLabel = payload
    ? formatHeadScoutWeekLabel(payload.week_start, payload.week_end)
    : initialWeekOffset === 0
      ? 'This Week'
      : `Week +${initialWeekOffset}`;

  function buildScoutScheduleTarget(scout: HeadScoutSchedule) {
    return (
      <HeadScoutScheduleList
        scout={scout}
        weekStart={payload?.week_start || ''}
        weekEnd={payload?.week_end || ''}
        timezoneLabel={payload?.timezone_label || ''}
        weekOffset={initialWeekOffset}
        syncContext={syncContext}
      />
    );
  }

  function handleSearchTextChange(value: string) {
    setSearchText(value);
    const shortcutIndex = SCOUT_GRID_SHORTCUT_KEYS.indexOf(value.trim() as KeyEquivalent);
    const scout = shortcutIndex >= 0 ? payload?.scouts?.[shortcutIndex] : null;
    if (scout) {
      setSearchText('');
      push(buildScoutScheduleTarget(scout));
    }
  }

  return (
    <Grid
      navigationTitle={`Scout Openings • ${weekLabel}`}
      isLoading={isLoading}
      searchBarPlaceholder="Filter head scouts"
      searchText={searchText}
      onSearchTextChange={handleSearchTextChange}
      columns={4}
      aspectRatio="3/2"
      fit={Grid.Fit.Fill}
      inset={Grid.Inset.Medium}
    >
      <Grid.Section title="Open Schedules">
        {payload?.scouts?.map((scout, index) => {
          const visibleSlots = filterVisibleHeadScoutSlots(scout.slots, initialWeekOffset);
          const shortcutKey = SCOUT_GRID_SHORTCUT_KEYS[index];
          return (
            <Grid.Item
              key={scout.scout_name}
              content={{
                value: buildHeadScoutInitialsBadge(scout.scout_name),
                tooltip: scout.scout_name,
              }}
              title={`${index + 1}. ${scout.scout_name}`}
              subtitle={`${scout.city}, ${scout.state} • ${visibleSlots.length} open${
                syncContext ? ' • Scout Prep' : ''
              }`}
              keywords={[scout.city, scout.state, `${visibleSlots.length} open`]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="View Open Slots"
                    icon={Icon.Calendar}
                    shortcut={shortcutKey ? { modifiers: [], key: shortcutKey } : undefined}
                    target={buildScoutScheduleTarget(scout)}
                  />
                  <Action.Push
                    title="Next Week"
                    icon={Icon.ArrowRight}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'enter' }}
                    target={
                      <HeadScoutSchedulesRoot
                        initialWeekOffset={initialWeekOffset + 1}
                        syncContext={syncContext}
                      />
                    }
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </Grid.Section>
      {!isLoading && !payload?.scouts?.length ? (
        <Grid.EmptyView
          title="No head scouts found"
          description={errorMessage || 'No schedules returned for this week.'}
          actions={
            <ActionPanel>
              <Action.Push
                title="Next Week"
                icon={Icon.ArrowRight}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'enter' }}
                target={
                  <HeadScoutSchedulesRoot
                    initialWeekOffset={initialWeekOffset + 1}
                    syncContext={syncContext}
                  />
                }
              />
            </ActionPanel>
          }
        />
      ) : null}
    </Grid>
  );
}

export default function Command() {
  return <HeadScoutSchedulesRoot />;
}
