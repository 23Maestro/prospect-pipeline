import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Form,
  Grid,
  Icon,
  type KeyEquivalent,
  List,
  open,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from '@raycast/api';
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
import {
  APPOINTMENT_TITLE_PREFIXES,
  type AppointmentTitlePrefix,
} from './lib/head-scout-event-prefix';
import { PostCallUpdateForm } from './scout-prep';
import {
  buildMeetingDayLabel,
  buildSetMeetingCandidatesFromBookedMeetings,
  filterWeeklySetMeetingCandidates,
} from './domain/set-meetings-candidate';
import { buildSetMeetingsCommandContext } from './domain/scout-prep-command-pipeline';
import { buildSetMeetingConfirmationCacheRows } from './domain/set-meeting-confirmation-cache';
import { getActiveOperator } from './domain/owners';
import { copyHeadScoutContactCardToClipboard } from './lib/head-scout-contact-cards';
import { syncCallScriptToggleToNotion } from './lib/notion-call-scripts';
import { prepareConfirmationFollowUp } from './lib/scout-follow-up-queue';
import {
  resolveConfirmationFollowUpVariant,
  type ConfirmationFollowUpVariant,
} from './lib/scout-follow-up-templates';
import {
  buildMessagesComposeUrlForRecipients,
  buildTimeOfDayGreeting,
  getMeetingReminderRecipient,
} from './lib/scout-prep-contact';
import { sendClientMessage } from './lib/client-message-sandbox';
import {
  completeScoutPrepTaskAfterVoicemail,
  fetchScoutPortalTasks,
  loadScoutPrepContext,
} from './lib/scout-prep';
import {
  upsertSetMeetingConfirmationCacheRows,
  type SupabasePersistenceConfig,
} from './domain/supabase-persistence';
import type { ScoutPortalTask, ScoutPrepContext } from './features/scout-prep/types';
import {
  getCachedSetMeetings,
  setCachedSetMeetings,
  shouldRenderCachedSetMeetingsSnapshot,
} from './lib/set-meetings-cache';

function getConfirmationCacheSupabaseConfig(): SupabasePersistenceConfig | null {
  const url = String(process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const key = String(
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  ).trim();
  const schema = String(process.env.SUPABASE_SCHEMA || 'public').trim() || 'public';
  return url && key ? { url, key, schema } : null;
}
type HeadScoutSchedulesRootProps = {
  initialWeekOffset?: number;
  syncContext?: {
    task: ScoutPortalTask;
    context: ScoutPrepContext;
    markdown: string;
  };
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

const APPOINTMENT_SHORTCUT_KEYS: readonly KeyEquivalent[] = ['1', '2', '3', '4', '5'];
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

function getBookedMeetingEventDate(meeting?: BookedMeetingEvent | null): string {
  return String(meeting?.start || '').split('T')[0] || '';
}

function getConfirmationAppointmentPrefix(
  variant: ConfirmationFollowUpVariant,
): AppointmentTitlePrefix {
  return variant === 'confirmation_2' ? '(ACF*2)' : '(ACF)';
}

async function completeCandidateConfirmationTask(candidate: HeadScoutFollowUpCandidate) {
  const taskId = String(candidate.taskId || '').trim();
  if (!taskId) {
    throw new Error('Missing confirmation task');
  }

  const taskTitle = String(
    candidate.followUpTask?.title || candidate.currentTask || 'Confirmation Call',
  ).trim();

  await completeScoutPrepTaskAfterVoicemail({
    athleteId: candidate.athleteId,
    athleteMainId: candidate.athleteMainId,
    athleteName: candidate.athleteName,
    contactTask: candidate.athleteId,
    taskId,
    taskTitle,
    assignedOwner: candidate.followUpTask?.assignedOwner || null,
    description: candidate.followUpTask?.description || taskTitle,
  });
}

function Confirmation2SendForm({
  candidate,
  recipientNames,
  phones,
  message,
  onComplete,
}: {
  candidate: HeadScoutFollowUpCandidate;
  recipientNames: string[];
  phones: string[];
  message: string;
  onComplete: () => void | Promise<void>;
}) {
  const { pop } = useNavigation();
  const contactOptions = phones.map((phone, index) => ({
    id: `${index}:${phone}`,
    name: recipientNames[index] || recipientNames[0] || candidate.athleteName,
    phone,
  }));
  const [contactId, setContactId] = useState(contactOptions[0]?.id || '');
  const [draftMessage, setDraftMessage] = useState(message);
  const [isSending, setIsSending] = useState(false);

  async function handleSend() {
    if (isSending) return;

    const selectedContact =
      contactOptions.find((contact) => contact.id === contactId) || contactOptions[0];
    if (!selectedContact?.phone) {
      await showToast({ style: Toast.Style.Failure, title: 'No phone' });
      return;
    }

    setIsSending(true);
    try {
      const result = await sendClientMessage({
        address: selectedContact.phone,
        text: draftMessage,
        serviceName: 'iMessage',
      });
      if (result !== 'Success') {
        throw new Error(result);
      }

      const toast = await showLoadingToast('Completing', 'Confirmation Call');
      try {
        await completeCandidateConfirmationTask(candidate);
        toast.hide();
      } catch (error) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Sent, task not completed';
        toast.message = error instanceof Error ? error.message : String(error);
        return;
      }

      await showToast({
        style: Toast.Style.Success,
        title: 'Sent',
        message: 'Task completed',
      });
      await onComplete();
      pop();
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Send failed',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Form
      navigationTitle={`Confirmation 2 • ${candidate.athleteName}`}
      isLoading={isSending}
      actions={
        <ActionPanel>
          <Action
            title={isSending ? 'Sending…' : 'Send Message'}
            onAction={() => void handleSend()}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="contactId" title="Client" value={contactId} onChange={setContactId}>
        {contactOptions.map((contact) => (
          <Form.Dropdown.Item
            key={contact.id}
            value={contact.id}
            title={`${contact.name} • ${contact.phone}`}
          />
        ))}
      </Form.Dropdown>
      <Form.TextArea id="message" title="Message" value={draftMessage} onChange={setDraftMessage} />
    </Form>
  );
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
  const [weekly, operatorTasks] = await Promise.all([
    fetchHeadScoutBookedMeetings(weekOffset),
    fetchScoutPortalTasks(weekOffset > 0 ? 'nextWeek' : 'thisWeek'),
  ]);
  const operatorName = getActiveOperator().taskAssignedOwnerName;
  const weeklyCandidates = await hydrateWeeklyCandidatesFromAthleteMeetings(
    buildSetMeetingCandidatesFromBookedMeetings({
      bookedMeetings: weekly.events || [],
      tasks: operatorTasks || [],
      operatorName,
    }),
    weekly.week_start,
    weekly.week_end,
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
      const currentTitleKey = normalizeMeetingMatchText(candidate.bookedMeeting?.title);
      const preferred = pickNewestMeetingEvent(
        (result?.events || []).filter((event) => {
          const meetingDay = String(event.start || '').slice(0, 10);
          const eventTitleKey = normalizeMeetingMatchText(event.title);
          return (
            meetingDay >= weekStart &&
            meetingDay < weekEnd &&
            eventTitleKey.includes(athleteNameKey) &&
            eventTitleKey === currentTitleKey
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

function buildPendingClientSummary(row: PendingClientWatchlistLoadResult['rows'][number]): string {
  const scout = row.head_scout || 'Scout unresolved';
  const eventDate = row.event_start ? formatHeadScoutSlotDate(row.event_start) : 'Unknown date';
  const signals = row.matched_signals?.length ? row.matched_signals.join(', ') : 'no signals';
  return [
    `${row.athlete_name || 'Unknown Athlete'} • ${scout} • ${eventDate}`,
    row.event_title,
    `Signals: ${signals}`,
    row.description,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPendingClientDetailMarkdown(
  row: PendingClientWatchlistLoadResult['rows'][number],
): string {
  const scout = row.head_scout || 'Scout unresolved';
  const eventDate = row.event_start ? formatHeadScoutSlotDate(row.event_start) : 'Unknown date';
  const signals = row.matched_signals?.length ? row.matched_signals.join(', ') : 'No payment tags';
  return [
    `# ${row.athlete_name || cleanPendingClientTitle(row.event_title) || 'Unknown Athlete'}`,
    '',
    `**Scout:** ${scout}`,
    `**Meeting:** ${eventDate}`,
    `**Tags:** ${signals}`,
    '',
    '## Event Note',
    '',
    row.description || '_No event description found._',
  ].join('\n');
}

function PendingClientsWatchlist() {
  const [result, setResult] = useState<PendingClientWatchlistLoadResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const loaded = await loadPendingClientWatchlist();
        if (!cancelled) {
          setResult(loaded);
        }
      } catch (error) {
        if (!cancelled) {
          await showToast({
            style: Toast.Style.Failure,
            title: 'Watchlist failed',
            message: error instanceof Error ? error.message : String(error),
          });
          setResult({ rows: [], scannedCount: 0, confirmedCount: 0, aiUnavailableCount: 0 });
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
      toast.title = 'Resolved';
      toast.message = 'Hidden from watchlist';
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
      searchBarPlaceholder="Search athlete, scout, signal, or note"
    >
      {rows.length ? (
        <List.Section
          title="Pending Clients"
          subtitle={`${rows.length}${result ? ` • ${result.scannedCount} scanned` : ''}`}
        >
          {rows.map((row) => {
            const eventDate = row.event_start ? formatHeadScoutSlotDate(row.event_start) : null;
            const signals = row.matched_signals || [];
            return (
              <List.Item
                key={row.source_event_id}
                icon={Icon.Eye}
                title={row.athlete_name || cleanPendingClientTitle(row.event_title)}
                subtitle={row.head_scout || 'Scout unresolved'}
                keywords={[
                  row.athlete_name || '',
                  row.head_scout || '',
                  row.event_title || '',
                  row.description || '',
                  ...signals,
                ]}
                accessories={[
                  ...(signals[0] ? [{ tag: signals[0] }] : []),
                  ...(eventDate ? [{ text: eventDate }] : []),
                ]}
                detail={<List.Item.Detail markdown={buildPendingClientDetailMarkdown(row)} />}
                actions={
                  <ActionPanel>
                    <Action
                      title={resolvingId === row.source_event_id ? 'Resolving…' : 'Mark Resolved'}
                      icon={Icon.CheckCircle}
                      onAction={() => void handleMarkResolved(row.source_event_id)}
                    />
                    <Action.CopyToClipboard
                      title="Copy Watchlist Summary"
                      icon={Icon.Clipboard}
                      shortcut={{ modifiers: ['cmd'], key: 'c' }}
                      content={buildPendingClientSummary(row)}
                    />
                    <Action.CopyToClipboard title="Copy Note" content={row.description} />
                    <Action
                      title="Refresh"
                      icon={Icon.ArrowClockwise}
                      shortcut={{ modifiers: ['cmd'], key: 'r' }}
                      onAction={() => setRefreshTick((current) => current + 1)}
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ) : (
        <List.EmptyView
          title="No Pending Clients"
          description={
            result?.aiUnavailableCount
              ? 'Ray AI did not confirm any deterministic matches.'
              : 'No active payment or enrollment watchlist rows found.'
          }
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
                ].map((candidate) => [candidate.key, candidate]),
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
            setCandidates(cached.snapshot.candidates);
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

  async function sendConfirmationText(
    candidate: HeadScoutFollowUpCandidate,
    variant: ConfirmationFollowUpVariant,
    options?: {
      openContactCard?: boolean;
      copyOnly?: boolean;
    },
  ) {
    setSendingTextKey(candidate.key);
    const toast = await showLoadingToast(
      options?.copyOnly ? 'Copying' : 'Opening',
      candidate.athleteName,
    );
    try {
      const task = buildCandidateTask(candidate);
      const context = await loadScoutPrepContext(task);
      const reminderRecipient = getMeetingReminderRecipient(context);
      if (!reminderRecipient) {
        throw new Error('No reminder phone found');
      }

      const prepared = await prepareConfirmationFollowUp({
        athleteId: candidate.athleteId,
        athleteMainId: candidate.athleteMainId,
        athleteName: candidate.athleteName,
        dueDate: candidate.dueDate || null,
        dueTime: null,
        headScoutName: candidate.headScoutName || context.resolved.head_scout || null,
        recipientNames: reminderRecipient.recipientNames,
        greetingOverride: buildTimeOfDayGreeting(context),
        sport: context.resolved.sport || null,
        gradYear: task.grad_year || null,
        state: context.resolved.state || null,
        reminderVariant: variant,
      });
      if (!prepared.canDraft) {
        throw new Error(prepared.resolvedAppointment.reason);
      }

      if (options?.copyOnly) {
        await Clipboard.copy(prepared.message);
        toast.style = Toast.Style.Success;
        toast.title = 'Copied';
        toast.message = variant === 'confirmation_2' ? 'Confirmation 2' : 'Confirmation 1';
        return;
      }

      const confirmation1 =
        variant === 'confirmation_1'
          ? prepared.message
          : (
              await prepareConfirmationFollowUp({
                athleteId: candidate.athleteId,
                athleteMainId: candidate.athleteMainId,
                athleteName: candidate.athleteName,
                dueDate: candidate.dueDate || null,
                dueTime: null,
                headScoutName: candidate.headScoutName || context.resolved.head_scout || null,
                recipientNames: reminderRecipient.recipientNames,
                greetingOverride: buildTimeOfDayGreeting(context),
                sport: context.resolved.sport || null,
                gradYear: task.grad_year || null,
                state: context.resolved.state || null,
                reminderVariant: 'confirmation_1',
              })
            ).message;
      const confirmation2 =
        variant === 'confirmation_2'
          ? prepared.message
          : (
              await prepareConfirmationFollowUp({
                athleteId: candidate.athleteId,
                athleteMainId: candidate.athleteMainId,
                athleteName: candidate.athleteName,
                dueDate: candidate.dueDate || null,
                dueTime: null,
                headScoutName: candidate.headScoutName || context.resolved.head_scout || null,
                recipientNames: reminderRecipient.recipientNames,
                greetingOverride: buildTimeOfDayGreeting(context),
                sport: context.resolved.sport || null,
                gradYear: task.grad_year || null,
                state: context.resolved.state || null,
                reminderVariant: 'confirmation_2',
              })
            ).message;
      const supabaseConfig = getConfirmationCacheSupabaseConfig();
      if (supabaseConfig && candidate.bookedMeeting?.event_id) {
        const rows = buildSetMeetingConfirmationCacheRows({
          appointmentId: candidate.bookedMeeting.event_id,
          athleteId: candidate.athleteId,
          athleteMainId: candidate.athleteMainId,
          athleteName: candidate.athleteName,
          recipientName: reminderRecipient.recipientNames[0] || '',
          recipientPhone: reminderRecipient.phones[0] || '',
          headScoutName: prepared.headScoutName || candidate.headScoutName || '',
          meetingStartsAt: candidate.bookedMeeting.start || null,
          meetingTimezone: 'America/New_York',
          confirmation1Message: confirmation1,
          confirmation2Message: confirmation2,
          adminUrl: candidate.adminUrl || '',
          taskUrl: candidate.taskUrl || '',
          generatedAt: new Date().toISOString(),
          source: 'set_meetings_confirmation',
        });
        await upsertSetMeetingConfirmationCacheRows(supabaseConfig, rows);
      }

      const eventDate = getBookedMeetingEventDate(candidate.bookedMeeting);
      if (candidate.bookedMeeting?.event_id && eventDate) {
        await updateBookedMeetingTitlePrefix({
          eventId: candidate.bookedMeeting.event_id,
          eventDate,
          prefix: getConfirmationAppointmentPrefix(variant),
        });
      }

      if (variant === 'confirmation_2') {
        push(
          <Confirmation2SendForm
            candidate={candidate}
            recipientNames={reminderRecipient.recipientNames}
            phones={reminderRecipient.phones}
            message={prepared.message}
            onComplete={refreshLive}
          />,
        );
        toast.hide();
        return false;
      }

      let composeMode: 'draft' | 'clipboard-fallback' = 'draft';
      try {
        await open(
          buildMessagesComposeUrlForRecipients(reminderRecipient.phones, prepared.message),
        );
      } catch {
        await Clipboard.copy(prepared.message);
        await open(`sms:${reminderRecipient.phones[0]}`);
        composeMode = 'clipboard-fallback';
      }

      let contactCardCopied = false;
      if (options?.openContactCard && composeMode === 'draft') {
        await setTimeout(1200);
        await copyHeadScoutContactCardToClipboard(
          prepared.headScoutName || candidate.headScoutName || context.resolved.head_scout || null,
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
      setSendingTextKey((current) => (current === candidate.key ? null : current));
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

    setUpdatingMeetingKey(candidate.key);
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
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Save failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setUpdatingMeetingKey((current) => (current === candidate.key ? null : current));
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
              const meetingLabel =
                candidate.currentMeetingLabel?.replace(/^Current:\s*/, '') || null;
              const headScoutLabel = candidate.headScoutName || 'Scout not resolved';
              return (
                <List.Item
                  key={candidate.key}
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
                      ? meetingLabel
                        ? [{ text: meetingLabel }]
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
                              sendingTextKey === candidate.key ? 'Opening…' : 'Send Confirmation'
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
                                updatingMeetingKey === candidate.key ? 'Saving…' : `Mark ${prefix}`
                              }
                              icon={Icon.Pencil}
                              shortcut={
                                index < APPOINTMENT_SHORTCUT_KEYS.length
                                  ? { modifiers: ['opt'], key: APPOINTMENT_SHORTCUT_KEYS[index] }
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
