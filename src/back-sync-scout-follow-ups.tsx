import { Action, ActionPanel, Icon, List, Toast, showToast } from '@raycast/api';
import { useEffect, useMemo, useState } from 'react';
import type { ScoutAthleteTask, ScoutRecentProfile } from './features/scout-prep/types';
import {
  fetchAthleteTasks,
  fetchScoutRecentProfiles,
  findNewestIncompleteConfirmationTask,
  findNewestIncompleteFollowUpTask,
  stripMoveThisTaskPrefix,
} from './lib/scout-prep';
import {
  listScoutPrepFollowUpPointers,
  type ScoutPrepFollowUpPointer,
} from './lib/scout-prep-follow-up-index';
import { buildConfirmationMessage } from './lib/scout-follow-up-templates';
import {
  upsertScoutFollowUpTrackerEntry,
  type LightweightFollowUpTrackerEntry,
} from './lib/scout-follow-up-tracker';
import {
  getCachedMeetingSetQueueContext,
  inferHeadScoutNameFromText,
  upsertCraftFollowUpReminder,
} from './lib/scout-follow-up-queue';

const DASHBOARD_BASE_URL = 'https://dashboard.nationalpid.com';

type SyncCandidate = {
  key: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  parent1Name?: string | null;
  parent2Name?: string | null;
  dueDate?: string | null;
  stage: string;
  adminUrl: string;
  taskUrl: string;
  taskId: string;
  source: 'tracked' | 'recent';
};

function buildAdminUrl(athleteId: string, athleteMainId: string): string {
  const params = new URLSearchParams({ contactid: athleteId.trim() });
  if (athleteMainId.trim()) {
    params.set('athlete_main_id', athleteMainId.trim());
  }
  return `${DASHBOARD_BASE_URL}/admin/athletes?${params.toString()}`;
}

function buildTaskUrl(athleteId: string, athleteMainId: string): string {
  const url = new URL(buildAdminUrl(athleteId, athleteMainId));
  url.searchParams.set('tasktab', '1');
  return url.toString();
}

function parseParentNames(profile?: ScoutRecentProfile | null): { parent1Name?: string | null; parent2Name?: string | null } {
  return {
    parent1Name: profile?.parent_names?.[0] || null,
    parent2Name: profile?.parent_names?.[1] || null,
  };
}

function pickNextTask(tasks: ScoutAthleteTask[]): ScoutAthleteTask | null {
  const followUp = findNewestIncompleteFollowUpTask(tasks);
  const confirmation = findNewestIncompleteConfirmationTask(tasks);
  if (!followUp) return confirmation;
  if (!confirmation) return followUp;

  const followUpId = Number.parseInt(String(followUp.task_id || ''), 10);
  const confirmationId = Number.parseInt(String(confirmation.task_id || ''), 10);
  if (Number.isNaN(followUpId)) return confirmation;
  if (Number.isNaN(confirmationId)) return followUp;
  return followUpId >= confirmationId ? followUp : confirmation;
}

function buildStage(task: ScoutAthleteTask): string {
  return (
    stripMoveThisTaskPrefix(task.title) ||
    String(task.description || '').trim() ||
    'Pending follow-up'
  );
}

function buildDetailMarkdown(candidate: SyncCandidate): string {
  return [
    `# ${candidate.athleteName}`,
    '',
    `- Source: ${candidate.source === 'tracked' ? 'Follow-Up List' : 'Recent Profiles'}`,
    `- Stage: ${candidate.stage}`,
    `- Due Date: ${candidate.dueDate || 'N/A'}`,
    `- Parent 1: ${candidate.parent1Name || 'N/A'}`,
    `- Parent 2: ${candidate.parent2Name || 'N/A'}`,
    `- Task ID: ${candidate.taskId}`,
    '',
    `[Open Admin](${candidate.adminUrl})`,
    '',
    `[Open Task Tab](${candidate.taskUrl})`,
  ].join('\n');
}

function parseLegacyTaskDueAt(value?: string | null): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(?:[A-Za-z]{3}\s+)?(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?$/i);
  if (!match) return null;

  const month = Number.parseInt(match[1], 10) - 1;
  const day = Number.parseInt(match[2], 10);
  const yearValue = Number.parseInt(match[3], 10);
  const year = match[3].length === 2 ? 2000 + yearValue : yearValue;
  let hour = Number.parseInt(match[4] || '0', 10);
  const minute = Number.parseInt(match[5] || '0', 10);
  const meridiem = String(match[6] || '').toUpperCase();

  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  const date = new Date(year, month, day, hour, minute);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function buildCraftMessage(candidate: SyncCandidate): Promise<string> {
  if (candidate.stage.toLowerCase().includes('confirmation')) {
    const dueAt = parseLegacyTaskDueAt(candidate.dueDate);
    const cachedMeeting = await getCachedMeetingSetQueueContext({
      athleteId: candidate.athleteId,
      athleteMainId: candidate.athleteMainId,
    });

    if (dueAt) {
      return buildConfirmationMessage({
        headScoutName:
          String(cachedMeeting?.headScoutName || '').trim() ||
          inferHeadScoutNameFromText(candidate.stage) ||
          '',
        dueAt,
        meetingTimezone: cachedMeeting?.meetingTimezone || 'EST',
      });
    }
  }

  return candidate.stage;
}

async function syncCandidateToTracker(candidate: SyncCandidate) {
  const entry: LightweightFollowUpTrackerEntry = {
    athleteId: candidate.athleteId,
    athleteMainId: candidate.athleteMainId,
    athleteName: candidate.athleteName,
    parent1Name: candidate.parent1Name,
    parent2Name: candidate.parent2Name,
    stage: candidate.stage,
    dueDate: candidate.dueDate,
    adminUrl: candidate.adminUrl,
  };
  const notionResult = await upsertScoutFollowUpTrackerEntry(entry);
  const dueAt = parseLegacyTaskDueAt(candidate.dueDate);

  if (dueAt) {
    const craftMessage = await buildCraftMessage(candidate);
    await upsertCraftFollowUpReminder({
      title: `${candidate.athleteName} | ${candidate.stage}`,
      athleteName: candidate.athleteName,
      messageType: candidate.stage.toLowerCase().includes('confirmation')
        ? 'confirmation'
        : 'call_attempt_2',
      dueAt,
      filledMessage: craftMessage,
      notionUrl: notionResult.pageUrl,
    });
  }

  return notionResult;
}

async function buildCandidates(): Promise<SyncCandidate[]> {
  const [pointers, recentProfiles] = await Promise.all([
    listScoutPrepFollowUpPointers(),
    fetchScoutRecentProfiles(),
  ]);

  const recentByKey = new Map(
    recentProfiles.map((profile) => [
      `${profile.athlete_id.trim()}:${profile.athlete_main_id.trim()}`,
      profile,
    ]),
  );

  const baseEntries = new Map<
    string,
    {
      athleteId: string;
      athleteMainId: string;
      athleteName: string;
      source: 'tracked' | 'recent';
      profile?: ScoutRecentProfile | null;
      pointer?: ScoutPrepFollowUpPointer | null;
    }
  >();

  for (const pointer of pointers) {
    const key = `${pointer.athleteId.trim()}:${pointer.athleteMainId.trim()}`;
    baseEntries.set(key, {
      athleteId: pointer.athleteId.trim(),
      athleteMainId: pointer.athleteMainId.trim(),
      athleteName: pointer.athleteName.trim(),
      source: 'tracked',
      profile: recentByKey.get(key) || null,
      pointer,
    });
  }

  for (const profile of recentProfiles) {
    const athleteId = profile.athlete_id.trim();
    const athleteMainId = profile.athlete_main_id.trim();
    const key = `${athleteId}:${athleteMainId}`;
    if (!baseEntries.has(key)) {
      baseEntries.set(key, {
        athleteId,
        athleteMainId,
        athleteName: profile.athlete_name.trim(),
        source: 'recent',
        profile,
      });
    }
  }

  const candidates = await Promise.all(
    Array.from(baseEntries.values()).map(async (entry) => {
      const tasks = (await fetchAthleteTasks(entry.athleteId, entry.athleteMainId)) as ScoutAthleteTask[];
      const nextTask = pickNextTask(tasks);
      if (!nextTask) {
        return null;
      }

      const parents = parseParentNames(entry.profile);
      return {
        key: `${entry.athleteId}:${entry.athleteMainId}`,
        athleteId: entry.athleteId,
        athleteMainId: entry.athleteMainId,
        athleteName: entry.athleteName,
        parent1Name: parents.parent1Name,
        parent2Name: parents.parent2Name,
        dueDate: nextTask.due_date || null,
        stage: buildStage(nextTask),
        adminUrl: buildAdminUrl(entry.athleteId, entry.athleteMainId),
        taskUrl: buildTaskUrl(entry.athleteId, entry.athleteMainId),
        taskId: String(nextTask.task_id || '').trim(),
        source: entry.source,
      } satisfies SyncCandidate;
    }),
  );

  return candidates
    .filter((candidate) => candidate !== null)
    .sort((left, right) => {
      const leftDate = Date.parse(left.dueDate || '');
      const rightDate = Date.parse(right.dueDate || '');
      if (Number.isNaN(leftDate) && Number.isNaN(rightDate)) {
        return left.athleteName.localeCompare(right.athleteName);
      }
      if (Number.isNaN(leftDate)) return 1;
      if (Number.isNaN(rightDate)) return -1;
      return leftDate - rightDate || left.athleteName.localeCompare(right.athleteName);
    });
}

export default function BackSyncScoutFollowUpsCommand() {
  const [candidates, setCandidates] = useState<SyncCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncingKey, setSyncingKey] = useState<string | null>(null);
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const nextCandidates = await buildCandidates();
      setCandidates(nextCandidates);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to load back sync candidates',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const countSubtitle = useMemo(() => String(candidates.length), [candidates.length]);

  async function handleSync(candidate: SyncCandidate) {
    setSyncingKey(candidate.key);
    try {
      await syncCandidateToTracker(candidate);
      await showToast({
        style: Toast.Style.Success,
        title: 'Synced to Coordination Tracker',
        message: `${candidate.athleteName} • ${candidate.stage}`,
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Back sync failed',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSyncingKey(null);
    }
  }

  async function handleSyncAll() {
    if (!candidates.length || isSyncingAll) {
      return;
    }

    setIsSyncingAll(true);
    let successCount = 0;
    let failureCount = 0;

    for (const candidate of candidates) {
      try {
        await syncCandidateToTracker(candidate);
        successCount += 1;
      } catch {
        failureCount += 1;
      }
    }

    setIsSyncingAll(false);
    await showToast({
      style: failureCount ? Toast.Style.Failure : Toast.Style.Success,
      title: failureCount ? 'Sync all finished with failures' : 'All candidates synced',
      message: `${successCount} synced${failureCount ? `, ${failureCount} failed` : ''}`,
    });
  }

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Back Sync Follow-Ups"
      searchBarPlaceholder="Search back sync candidates"
    >
      {candidates.length > 0 ? (
        <List.Section title="Candidates" subtitle={countSubtitle}>
          {candidates.map((candidate) => (
            <List.Item
              key={candidate.key}
              icon={candidate.source === 'tracked' ? Icon.List : Icon.Clock}
              title={candidate.athleteName}
              subtitle={candidate.stage}
              accessories={[
                { text: candidate.dueDate || 'No due date' },
                { icon: candidate.source === 'tracked' ? Icon.List : Icon.Clock },
              ]}
              detail={<List.Item.Detail markdown={buildDetailMarkdown(candidate)} />}
              actions={
                <ActionPanel>
                  <Action
                    title={syncingKey === candidate.key ? 'Syncing…' : 'Sync to Coordination Tracker'}
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ['cmd'], key: 's' }}
                    onAction={() => void handleSync(candidate)}
                  />
                  <Action
                    title={isSyncingAll ? 'Syncing All…' : 'Sync All to Coordination Tracker'}
                    icon={Icon.Upload}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
                    onAction={() => void handleSyncAll()}
                  />
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
                  <Action title="Reload" icon={Icon.ArrowClockwise} onAction={() => void load()} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : (
        <List.EmptyView
          title="No back sync candidates"
          description="No incomplete follow-up or confirmation tasks were found in the tracked list or recent profiles."
          actions={
            <ActionPanel>
              <Action
                title={isSyncingAll ? 'Syncing All…' : 'Sync All to Coordination Tracker'}
                icon={Icon.Upload}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
                onAction={() => void handleSyncAll()}
              />
              <Action title="Reload" icon={Icon.ArrowClockwise} onAction={() => void load()} />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}
