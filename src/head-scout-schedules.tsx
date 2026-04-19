import { Action, ActionPanel, Icon, List, showToast, Toast } from '@raycast/api';
import { useEffect, useMemo, useState } from 'react';
import {
  enrichHeadScoutFollowUpCandidate,
  loadHeadScoutFollowUpCandidates,
  type HeadScoutFollowUpCandidate,
} from './lib/head-scout-follow-ups';
import {
  buildHeadScoutScriptMarkdown,
  fetchHeadScoutSlots,
  filterVisibleHeadScoutSlots,
  formatHeadScoutSlotForTimezone,
  formatHeadScoutWeekLabel,
  resolveAthleteTimezone,
  type HeadScoutSchedule,
  type HeadScoutSlot,
  type HeadScoutSlotsResponse,
} from './lib/head-scout-schedules';
import { syncCallScriptToggleToNotion } from './lib/notion-call-scripts';
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

type HeadScoutBookingsListProps = {
  scoutName?: string;
};

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
  const bookedStart = String(candidate.bookedMeeting?.start || '').trim();
  const bookedValue = bookedStart ? Date.parse(bookedStart) : Number.NaN;
  if (!Number.isNaN(bookedValue)) {
    return bookedValue;
  }

  const dueValue = Date.parse(String(candidate.dueDate || '').trim());
  if (!Number.isNaN(dueValue)) {
    return dueValue;
  }

  return Number.POSITIVE_INFINITY;
}

function buildFollowUpDetailMarkdown(candidate: HeadScoutFollowUpCandidate): string {
  const lines = [
    `# ${candidate.athleteName}`,
    '',
    `Head Scout: ${candidate.headScoutName || 'Not resolved'}`,
    '',
    `Booked Meeting: ${candidate.bookedMeeting?.date_time_label || 'Not found'}`,
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

function HeadScoutBookingsList({ scoutName }: HeadScoutBookingsListProps) {
  const [candidates, setCandidates] = useState<HeadScoutFollowUpCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
  }, [scoutName]);

  return (
    <List
      isLoading={isLoading}
      navigationTitle={scoutName ? `${scoutName} Bookings` : 'Meeting Set Bookings'}
      searchBarPlaceholder="Search athlete, parents, stage, or scout"
      isShowingDetail
    >
      {candidates.length ? (
        <List.Section title="Meeting Set + Confirmation" subtitle={String(candidates.length)}>
          {candidates.map((candidate) => (
            <List.Item
              key={candidate.key}
              icon={candidate.bookedMeeting ? Icon.CheckCircle : Icon.Circle}
              title={`${candidate.athleteName} - ${buildMeetingDayLabel(candidate)}`}
              keywords={[
                candidate.athleteName,
                candidate.parent1Name || '',
                candidate.parent2Name || '',
                candidate.headScoutName || '',
              ]}
              detail={<List.Item.Detail markdown={buildFollowUpDetailMarkdown(candidate)} />}
              actions={
                <ActionPanel>
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
                    title="View Bookings"
                    icon={Icon.List}
                    target={<HeadScoutBookingsList scoutName={scout.scout_name} />}
                  />
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
      navigationTitle={`Head Scout Schedules • ${weekLabel}`}
      isLoading={isLoading}
      searchBarPlaceholder="Filter head scouts"
    >
      <List.Section title="Bookings">
        <List.Item
          key="meeting-set-bookings"
          icon={Icon.List}
          title="My Meeting Set Bookings"
          accessories={[{ text: 'Search athletes fast' }]}
          actions={
            <ActionPanel>
              <Action.Push
                title="View Bookings"
                icon={Icon.List}
                target={<HeadScoutBookingsList />}
              />
            </ActionPanel>
          }
        />
      </List.Section>
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
                { text: `${visibleSlots.length} open` },
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
                    title="View Bookings"
                    icon={Icon.List}
                    target={<HeadScoutBookingsList scoutName={scout.scout_name} />}
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
