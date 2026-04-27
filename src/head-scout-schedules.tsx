import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Icon,
  type KeyEquivalent,
  List,
  open,
  showHUD,
  showToast,
  Toast,
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
  easternLocalIsoToDate,
  fetchHeadScoutBookedMeetings,
  fetchHeadScoutSlots,
  filterVisibleHeadScoutSlots,
  formatHeadScoutSlotForTimezone,
  formatHeadScoutWeekLabel,
  resolveAthleteTimezone,
  updateBookedMeetingTitlePrefix,
  type BookedMeetingEvent,
  type HeadScoutSchedule,
  type HeadScoutSlot,
  type HeadScoutSlotsResponse,
} from './lib/head-scout-schedules';
import {
  APPOINTMENT_TITLE_PREFIXES,
  resolveAppointmentTitleOutcome,
  type AppointmentTitlePrefix,
} from './lib/head-scout-event-prefix';
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
import {
  fetchScoutPortalTasks,
  loadScoutPrepContext,
  stripMoveThisTaskPrefix,
} from './lib/scout-prep';
import type { ScoutPortalTask, ScoutPrepContext } from './features/scout-prep/types';

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

async function showLoadingToast(title: string, message?: string) {
  return showToast({
    style: Toast.Style.Animated,
    title: String(title || '').trim().slice(0, 24),
    message: String(message || '')
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
    default:
      return Color.SecondaryText;
  }
}

function buildMeetingDayLabel(candidate: HeadScoutFollowUpCandidate): string {
  const raw = candidate.bookedMeeting?.start || '';
  const parsed = raw ? new Date(raw) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
    }).format(parsed);
  }

  const fallback = candidate.bookedMeeting?.date_time_label || '';
  const match = fallback.match(/^[A-Za-z]{3}\s+\d{2}\/\d{2}\/\d{2}/);
  if (match) {
    const value = new Date(match[0]);
    if (!Number.isNaN(value.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'numeric',
        day: 'numeric',
      }).format(value);
    }
  }

  return 'No date';
}

function getMeetingSortValue(candidate: HeadScoutFollowUpCandidate): number {
  const currentMeeting = candidate.bookedMeeting
    ? easternLocalIsoToDate(candidate.bookedMeeting.start)
    : null;
  if (currentMeeting && !Number.isNaN(currentMeeting.getTime())) {
    return currentMeeting.getTime();
  }
  const dueValue = Date.parse(String(candidate.dueDate || '').trim());
  return Number.isNaN(dueValue) ? Number.POSITIVE_INFINITY : dueValue;
}

function getMeetingSortBucket(candidate: HeadScoutFollowUpCandidate, now = new Date()): number {
  const currentMeeting = candidate.bookedMeeting
    ? easternLocalIsoToDate(candidate.bookedMeeting.start)
    : null;
  const meetingTs = currentMeeting?.getTime() || Number.NaN;
  const soonCutoff = now.getTime() + 72 * 60 * 60 * 1000;

  if (!Number.isNaN(meetingTs) && meetingTs >= now.getTime() && meetingTs <= soonCutoff) {
    return 0;
  }
  if (candidate.lifecycleState === 'rescheduled' && candidate.needsConfirmationText) {
    return 1;
  }
  if (
    candidate.needsManualReview ||
    candidate.oldFollowUpDateDetected ||
    candidate.lifecycleState === 'follow_up_due'
  ) {
    return 2;
  }
  if (!Number.isNaN(meetingTs) && meetingTs >= now.getTime()) {
    return 3;
  }
  return 4;
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

function isActualSetMeetingEvent(event?: Pick<BookedMeetingEvent, 'title'> | null): boolean {
  const title = String(event?.title || '').trim();
  if (!title) {
    return false;
  }

  if (resolveAppointmentTitleOutcome(title) !== 'active') {
    return false;
  }

  const normalized = title.toLowerCase();
  if (normalized.startsWith('follow up -')) {
    return false;
  }
  if (normalized.startsWith('(fu)')) {
    return false;
  }
  if (normalized.startsWith('(cl)')) {
    return false;
  }
  if (normalized.startsWith('(*)')) {
    return false;
  }

  return true;
}

function cleanMeetingResolveTitle(title?: string | null): string {
  return String(title || '')
    .trim()
    .replace(/^Follow Up -\s*/i, '')
    .replace(/^\(NS\)\*2\s*/i, '')
    .replace(/^\((?:ACF\*?2?|CF|RSP|CAN|FU|CL|NS|\*)\)\s*/i, '')
    .trim();
}

function normalizeAthleteMatchKey(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resolveAthleteDisplayName(taskName: string, eventTitle: string): string {
  const cleanedTitle = cleanMeetingResolveTitle(eventTitle);
  const normalizedTitle = cleanedTitle.toLowerCase();
  const normalizedTaskName = String(taskName || '')
    .trim()
    .toLowerCase();
  const startIndex = normalizedTitle.indexOf(normalizedTaskName);
  if (startIndex >= 0) {
    return cleanedTitle.slice(startIndex, startIndex + normalizedTaskName.length).trim();
  }
  return String(taskName || '').trim();
}

function pickJeramiConfirmationTask(tasks: ScoutPortalTask[] | Array<Record<string, unknown>>) {
  const matches = tasks.filter((task) => {
    const rawTask = task as Record<string, unknown>;
    const title = String(task.title || '')
      .trim()
      .toLowerCase();
    const description = String(task.description || '')
      .trim()
      .toLowerCase();
    const assignedOwner = String(rawTask.assigned_owner || rawTask.assignedOwner || '')
      .trim()
      .toLowerCase();
    const isConfirmation =
      title.includes('confirmation call') || description.includes('confirm the meeting set');
    return isConfirmation && assignedOwner === 'jerami singleton';
  });

  if (!matches.length) {
    return null;
  }

  return [...matches].sort((left, right) => {
    const rawLeft = left as Record<string, unknown>;
    const rawRight = right as Record<string, unknown>;
    const leftCompleted = String(left.completion_date || rawLeft.completionDate || '').trim();
    const rightCompleted = String(right.completion_date || rawRight.completionDate || '').trim();
    if (!leftCompleted && rightCompleted) return -1;
    if (leftCompleted && !rightCompleted) return 1;
    const leftDate = Date.parse(String(left.due_date || rawLeft.dueDate || '').trim());
    const rightDate = Date.parse(String(right.due_date || rawRight.dueDate || '').trim());
    if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate) && leftDate !== rightDate) {
      return rightDate - leftDate;
    }
    return String(right.task_id || rawRight.taskId || '').localeCompare(
      String(left.task_id || rawLeft.taskId || ''),
    );
  })[0];
}

async function loadWeeklyJeramiMeetingCandidates(
  weekOffset: number,
): Promise<HeadScoutFollowUpCandidate[]> {
  const [weekly, jeramiTasks] = await Promise.all([
    fetchHeadScoutBookedMeetings(weekOffset),
    fetchScoutPortalTasks(weekOffset > 0 ? 'nextWeek' : 'thisWeek'),
  ]);

  const actualMeetings = (weekly.events || []).filter((event) => isActualSetMeetingEvent(event));
  const filteredJeramiTasks = (jeramiTasks || []).filter((task) => {
    const title = String(task.title || '')
      .trim()
      .toLowerCase();
    const assignedOwner = String(task.assigned_owner || '')
      .trim()
      .toLowerCase();
    return assignedOwner === 'jerami singleton' && title.includes('confirmation call');
  });

  const tasksByAthlete = new Map<string, ScoutPortalTask[]>();
  for (const task of filteredJeramiTasks) {
    const key = normalizeAthleteMatchKey(task.athlete_name);
    if (!key) continue;
    const existing = tasksByAthlete.get(key) || [];
    existing.push(task);
    tasksByAthlete.set(key, existing);
  }

  const resolved = actualMeetings.map((event) => {
    const cleanedTitleKey = normalizeAthleteMatchKey(cleanMeetingResolveTitle(event.title));
    const matchingTaskEntry = Array.from(tasksByAthlete.entries()).find(([athleteKey]) =>
      cleanedTitleKey.includes(athleteKey),
    );
    if (!matchingTaskEntry) {
      return null;
    }

    const [athleteKey, matchingTasks] = matchingTaskEntry;
    const confirmationTask = pickJeramiConfirmationTask(matchingTasks);
    if (!confirmationTask) {
      return null;
    }

    tasksByAthlete.delete(athleteKey);

    const athleteId = String(
      confirmationTask.athlete_id || confirmationTask.contact_id || '',
    ).trim();
    const athleteMainId = String(confirmationTask.athlete_main_id || '').trim();
    if (!athleteId || !athleteMainId) {
      return null;
    }

    return {
      key: `${athleteId}:${athleteMainId}`,
      athleteId,
      athleteMainId,
      athleteName: resolveAthleteDisplayName(
        String(confirmationTask.athlete_name || '').trim(),
        event.title,
      ),
      dueDate: String(confirmationTask.due_date || '').trim() || event.start,
      stage: 'Meeting Set',
      currentTask:
        stripMoveThisTaskPrefix(String(confirmationTask.title || '').trim()) || 'Confirmation Call',
      taskId: String(confirmationTask.task_id || '').trim(),
      adminUrl: `https://dashboard.nationalpid.com/admin/athletes?contactid=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(athleteMainId)}`,
      taskUrl: `https://dashboard.nationalpid.com/admin/athletes?contactid=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(athleteMainId)}&tasktab=1`,
      source: 'website' as const,
      crmSalesStage: 'Meeting Set',
      headScoutName: event.assigned_owner || null,
      bookedMeetingTitle: event.title,
      bookedMeeting: event,
      previousMeeting: null,
      followUpTask: {
        taskId: String(confirmationTask.task_id || '').trim(),
        title: String(confirmationTask.title || '').trim() || null,
        description: String(confirmationTask.description || '').trim() || null,
        dueDate: String(confirmationTask.due_date || '').trim() || null,
        completionDate: String(confirmationTask.completion_date || '').trim() || null,
        assignedOwner: String(confirmationTask.assigned_owner || '').trim() || null,
      },
      lifecycleState: 'scheduled',
      needsConfirmationText: true,
      needsManualReview: false,
      reason: 'Weekly booked meeting assigned to Jerami confirmation queue.',
      operatorStatus: 'active_meeting_queue',
      badges: [],
      currentMeetingLabel: event.date_time_label,
      oldFollowUpDateDetected: false,
      meetingTimezone: null,
    } satisfies HeadScoutFollowUpCandidate;
  });

  return resolved
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => getMeetingSortValue(left) - getMeetingSortValue(right));
}

export function HeadScoutBookingsList({
  scoutName,
  weekOffset = 0,
  weeklyMeetingsOnly = false,
}: HeadScoutBookingsListProps) {
  const [candidates, setCandidates] = useState<HeadScoutFollowUpCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sendingTextKey, setSendingTextKey] = useState<string | null>(null);
  const [updatingMeetingKey, setUpdatingMeetingKey] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const weekWindow = useMemo(() => buildHeadScoutWeekWindow(weekOffset), [weekOffset]);
  const weekLabel = useMemo(
    () => formatHeadScoutWeekLabel(weekWindow.start, weekWindow.end),
    [weekWindow.end, weekWindow.start],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const enriched = weeklyMeetingsOnly
          ? await loadWeeklyJeramiMeetingCandidates(weekOffset)
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
        if (cancelled) return;
        const filteredCandidates = enriched.filter((candidate) => {
          if (
            scoutName &&
            String(candidate.headScoutName || '')
              .trim()
              .toLowerCase() !== scoutName.trim().toLowerCase()
          ) {
            return false;
          }

          if (!weeklyMeetingsOnly) {
            return true;
          }

          const currentMeeting = candidate.bookedMeeting
            ? easternLocalIsoToDate(candidate.bookedMeeting.start)
            : null;
          if (!currentMeeting || Number.isNaN(currentMeeting.getTime())) {
            return false;
          }
          if (candidate.bookedMeeting && !isActualSetMeetingEvent(candidate.bookedMeeting)) {
            return false;
          }

          const meetingDate = currentMeeting.toISOString().slice(0, 10);
          return meetingDate >= weekWindow.start && meetingDate < weekWindow.end;
        });

        setCandidates(
          filteredCandidates.sort((left, right) => {
            const bucketDiff = getMeetingSortBucket(left) - getMeetingSortBucket(right);
            if (bucketDiff !== 0) {
              return bucketDiff;
            }
            const timeDiff = getMeetingSortValue(left) - getMeetingSortValue(right);
            if (timeDiff !== 0) {
              return timeDiff;
            }
            return left.athleteName.localeCompare(right.athleteName);
          }),
        );
      } catch (error) {
        if (!cancelled) {
          await showToast({
            style: Toast.Style.Failure,
            title: 'Failed to load bookings',
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
  }, [refreshTick, scoutName, weekOffset, weekWindow.end, weekWindow.start, weeklyMeetingsOnly]);

  async function sendConfirmationText(
    candidate: HeadScoutFollowUpCandidate,
    variant: ConfirmationFollowUpVariant,
    options?: {
      openContactCard?: boolean;
    },
  ) {
    setSendingTextKey(candidate.key);
    const toast = await showLoadingToast('Opening', candidate.athleteName);
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
      toast.title = 'Open failed';
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
        secondarySubmitTitle={candidate.headScoutName ? 'Msg + Card' : undefined}
        onSubmit={(values, mode) =>
          sendConfirmationText(candidate, values.variant, {
            openContactCard: mode === 'messages_and_contact',
          })
        }
      />
    );
  }

  async function handleMarkMeeting(
    candidate: HeadScoutFollowUpCandidate,
    prefix: AppointmentTitlePrefix,
  ) {
    const meeting = candidate.bookedMeeting;
    const eventDate = String(meeting?.start || '').split('T')[0] || '';
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
      setRefreshTick((current) => current + 1);
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Save failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setUpdatingMeetingKey((current) => (current === candidate.key ? null : current));
    }
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
                      {candidate.athleteId && candidate.athleteMainId ? (
                        <Action.Push
                          title={sendingTextKey === candidate.key ? 'Opening…' : 'Send Confirmation'}
                          icon={Icon.Message}
                          shortcut={{ modifiers: ['cmd'], key: 'm' }}
                          target={buildConfirmationTextForm(candidate)}
                        />
                      ) : null}
                      {candidate.bookedMeeting?.event_id ? (
                        <>
                          {APPOINTMENT_TITLE_PREFIXES.map((prefix, index) => (
                            <Action
                              key={prefix}
                              title={
                                updatingMeetingKey === candidate.key ? 'Saving…' : `Mark ${prefix}`
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
                        </>
                      ) : null}
                      {weeklyMeetingsOnly ? (
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
                      ) : null}
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
  const [isLoading, setIsLoading] = useState(true);
  const [payload, setPayload] = useState<HeadScoutSlotsResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  return (
    <List
      navigationTitle={`Scout Openings • ${weekLabel}`}
      isLoading={isLoading}
      searchBarPlaceholder="Filter head scouts"
    >
      <List.Section title="Open Schedules">
        {payload?.scouts?.map((scout) => {
          const visibleSlots = filterVisibleHeadScoutSlots(scout.slots, initialWeekOffset);
          return (
            <List.Item
              key={scout.scout_name}
              icon={Icon.Person}
              title={scout.scout_name}
              subtitle={`${scout.city}, ${scout.state}`}
              accessories={[
                {
                  tag: {
                    value: `${visibleSlots.length} open`,
                    color: getHeadScoutCountColor(scout.scout_name),
                  },
                },
                ...(syncContext ? [{ text: 'Scout Prep' }] : []),
              ]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="View Open Slots"
                    icon={Icon.Calendar}
                    target={
                      <HeadScoutScheduleList
                        scout={scout}
                        weekStart={payload?.week_start || ''}
                        weekEnd={payload?.week_end || ''}
                        timezoneLabel={payload?.timezone_label || ''}
                        weekOffset={initialWeekOffset}
                        syncContext={syncContext}
                      />
                    }
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
      </List.Section>
      {!isLoading && !payload?.scouts?.length ? (
        <List.EmptyView
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
    </List>
  );
}

export default function Command() {
  return <HeadScoutSchedulesRoot />;
}
