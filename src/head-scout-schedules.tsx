import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Icon,
  List,
  open,
  showToast,
  Toast,
} from '@raycast/api';
import { useEffect, useMemo, useState } from 'react';
import {
  enrichHeadScoutFollowUpCandidate,
  loadHeadScoutFollowUpCandidates,
  type HeadScoutFollowUpCandidate,
} from './lib/head-scout-follow-ups';
import {
  buildHeadScoutScriptMarkdown,
  easternLocalIsoToDate,
  fetchHeadScoutSlots,
  filterVisibleHeadScoutSlots,
  formatHeadScoutSlotForTimezone,
  formatHeadScoutWeekLabel,
  resolveAthleteTimezone,
  updateBookedMeetingTitlePrefix,
  type HeadScoutSchedule,
  type HeadScoutSlot,
  type HeadScoutSlotsResponse,
} from './lib/head-scout-schedules';
import {
  APPOINTMENT_TITLE_PREFIXES,
  type AppointmentTitlePrefix,
} from './lib/head-scout-event-prefix';
import { syncCallScriptToggleToNotion } from './lib/notion-call-scripts';
import { prepareConfirmationFollowUp } from './lib/scout-follow-up-queue';
import {
  buildMessagesComposeUrlForRecipients,
  buildTimeOfDayGreeting,
  getMeetingReminderRecipient,
} from './lib/scout-prep-contact';
import { loadScoutPrepContext } from './lib/scout-prep';
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
};

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

function buildFollowUpDetailMarkdown(candidate: HeadScoutFollowUpCandidate): string {
  const lines = [
    `# ${candidate.athleteName}`,
    '',
    `CRM Stage: ${candidate.crmSalesStage || 'Not resolved'}`,
    '',
    `Lifecycle: ${candidate.lifecycleState || 'Not resolved'}`,
    '',
    `Head Scout: ${candidate.headScoutName || 'Not resolved'}`,
    '',
    `Current Booked Meeting: ${candidate.bookedMeeting?.date_time_label || 'Not found'}`,
    '',
    `Previous Meeting: ${candidate.previousMeeting?.date_time_label || 'Not found'}`,
    '',
    `Operator Status: ${candidate.operatorStatus || 'N/A'}`,
    '',
    `Reason: ${candidate.reason || 'N/A'}`,
    '',
    `Parent 1: ${candidate.parent1Name || 'N/A'}`,
  ];

  if (candidate.parent2Name) {
    lines.push('', `Parent 2: ${candidate.parent2Name}`);
  }

  lines.push(
    '',
    `[Open Admin](${candidate.adminUrl})`,
    '',
    `[Open Task Tab](${candidate.taskUrl})`,
  );
  return lines.join('\n');
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

export function HeadScoutBookingsList({ scoutName }: HeadScoutBookingsListProps) {
  const [candidates, setCandidates] = useState<HeadScoutFollowUpCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sendingTextKey, setSendingTextKey] = useState<string | null>(null);
  const [updatingMeetingKey, setUpdatingMeetingKey] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const baseCandidates = await loadHeadScoutFollowUpCandidates();
        if (cancelled) return;
        const enriched = await Promise.all(
          baseCandidates.map((candidate) => enrichHeadScoutFollowUpCandidate(candidate)),
        );
        if (cancelled) return;

        setCandidates(
          (scoutName
            ? enriched.filter(
                (candidate) =>
                  String(candidate.headScoutName || '')
                    .trim()
                    .toLowerCase() === scoutName.trim().toLowerCase(),
              )
            : enriched
          ).sort((left, right) => {
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
  }, [refreshTick, scoutName]);

  async function handleSendConfirmationText(candidate: HeadScoutFollowUpCandidate) {
    setSendingTextKey(candidate.key);
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
      });
      if (!prepared.canDraft) {
        throw new Error(prepared.resolvedAppointment.reason);
      }

      try {
        await open(
          buildMessagesComposeUrlForRecipients(reminderRecipient.phones, prepared.message),
        );
        await showToast({
          style: Toast.Style.Success,
          title: 'Messages opened',
          message: 'Confirmation text draft ready.',
        });
      } catch {
        await Clipboard.copy(prepared.message);
        await open(`sms:${reminderRecipient.phones[0]}`);
        await showToast({
          style: Toast.Style.Success,
          title: 'Messages opened',
          message: 'Confirmation text copied to clipboard.',
        });
      }
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to build confirmation text',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSendingTextKey((current) => (current === candidate.key ? null : current));
    }
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
        title: 'No editable booked meeting',
        message: 'Current booked meeting event id was not resolved.',
      });
      return;
    }

    setUpdatingMeetingKey(candidate.key);
    try {
      const result = await updateBookedMeetingTitlePrefix({
        eventId: meeting.event_id,
        eventDate,
        prefix,
      });
      await showToast({
        style: Toast.Style.Success,
        title: `${prefix} saved`,
        message: result.updated_title,
      });
      setRefreshTick((current) => current + 1);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to update meeting title',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setUpdatingMeetingKey((current) => (current === candidate.key ? null : current));
    }
  }

  return (
    <List
      isLoading={isLoading || Boolean(sendingTextKey) || Boolean(updatingMeetingKey)}
      navigationTitle={scoutName ? `${scoutName} Bookings` : 'Meeting Set Bookings'}
      searchBarPlaceholder="Search athlete, parents, stage, or scout"
      isShowingDetail
    >
      {candidates.length ? (
        <List.Section title="Meeting Set + Confirmation" subtitle={String(candidates.length)}>
          {candidates.map((candidate) => (
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
                candidate.currentMeetingLabel ||
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
              accessories={candidate.badges.map((badge) => ({ tag: badge.label }))}
              detail={<List.Item.Detail markdown={buildFollowUpDetailMarkdown(candidate)} />}
              actions={
                <ActionPanel>
                  <Action
                    title="Send Confirmation Text"
                    icon={Icon.Message}
                    shortcut={{ modifiers: ['cmd'], key: 'm' }}
                    onAction={() => void handleSendConfirmationText(candidate)}
                  />
                  {candidate.bookedMeeting?.event_id ? (
                    <>
                      {APPOINTMENT_TITLE_PREFIXES.map((prefix) => (
                        <Action
                          key={prefix}
                          title={`Mark ${prefix}`}
                          icon={Icon.Pencil}
                          onAction={() => void handleMarkMeeting(candidate, prefix)}
                        />
                      ))}
                    </>
                  ) : null}
                  <Action.OpenInBrowser
                    title="Open Athlete Admin"
                    shortcut={{ modifiers: ['cmd'], key: 'o' }}
                    url={candidate.adminUrl}
                  />
                  <Action.OpenInBrowser
                    title="Open Athlete Task Tab"
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
                    url={candidate.taskUrl}
                  />
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
          ))}
        </List.Section>
      ) : (
        <List.EmptyView
          title="No Meeting Set bookings"
          description={
            scoutName
              ? `No Meeting Set or confirmation athletes matched ${scoutName}.`
              : 'No Meeting Set or confirmation athletes were found.'
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

    try {
      const result = await syncCallScriptToggleToNotion({
        target: 'script',
        markdown: notionMarkdown,
      });
      await showToast({
        style: Toast.Style.Success,
        title: 'Notion script updated',
        message: `Replaced ${result.toggleTitle} with ${scout.scout_name} slots.`,
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Notion sync failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <List
      navigationTitle={`${scout.scout_name} • ${formatHeadScoutWeekLabel(weekStart, weekEnd)}`}
      searchBarPlaceholder="Filter open slots"
      isShowingDetail={false}
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
                        title="Sync Selected Slots to Notion"
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
