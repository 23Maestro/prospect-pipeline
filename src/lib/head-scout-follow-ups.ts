import type { ScoutAthleteTask, ScoutRecentProfile } from '../features/scout-prep/types';
import {
  fetchAthleteTasks,
  fetchScoutRecentProfiles,
  findNewestIncompleteConfirmationTask,
  findNewestIncompleteFollowUpTask,
  isConfirmationCallTask,
  stripMoveThisTaskPrefix,
} from './scout-prep';
import { listScoutPrepFollowUpPointers } from './scout-prep-follow-up-index';
import { fetchCuratedSalesStageOptions } from './sales-stage';
import {
  getSelectedSalesStageLabel,
  hydrateResolvedAppointment,
  isAppointmentLifecycleCrmStage,
  type AppointmentLifecycleBadge,
  type AppointmentLifecycleState,
  type AppointmentTaskSnapshot,
} from './head-scout-appointment-lifecycle';
import {
  type BookedMeetingEvent,
} from './head-scout-schedules';

const DASHBOARD_BASE_URL = 'https://dashboard.nationalpid.com';

type CandidateSource = 'tracked' | 'recent';

export type HeadScoutFollowUpCandidate = {
  key: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  parent1Name?: string | null;
  parent2Name?: string | null;
  dueDate?: string | null;
  stage: string;
  currentTask: string;
  taskId: string;
  adminUrl: string;
  taskUrl: string;
  source: CandidateSource;
  crmSalesStage?: string | null;
  headScoutName?: string | null;
  bookedMeetingTitle?: string | null;
  bookedMeeting?: BookedMeetingEvent | null;
  previousMeeting?: BookedMeetingEvent | null;
  followUpTask?: AppointmentTaskSnapshot | null;
  lifecycleState?: AppointmentLifecycleState;
  needsConfirmationText: boolean;
  needsManualReview: boolean;
  reason: string;
  operatorStatus?: string | null;
  badges: AppointmentLifecycleBadge[];
  currentMeetingLabel?: string | null;
  oldFollowUpDateDetected: boolean;
  meetingTimezone?: string | null;
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

function parseParentNames(profile?: ScoutRecentProfile | null): {
  parent1Name?: string | null;
  parent2Name?: string | null;
} {
  return {
    parent1Name: profile?.parent_names?.[0] || null,
    parent2Name: profile?.parent_names?.[1] || null,
  };
}

function buildTaskStage(task: ScoutAthleteTask): string {
  return (
    stripMoveThisTaskPrefix(task.title) ||
    String(task.description || '').trim() ||
    'Pending follow-up'
  );
}

function selectRelevantTask(tasks: ScoutAthleteTask[]): ScoutAthleteTask | null {
  const confirmation = findNewestIncompleteConfirmationTask(tasks);
  if (confirmation) {
    return confirmation;
  }
  const followUp = findNewestIncompleteFollowUpTask(tasks);
  if (followUp) {
    return followUp;
  }
  return null;
}

function shouldIncludeCandidate(args: {
  crmSalesStage?: string | null;
  selectedTask: ScoutAthleteTask | null;
}): boolean {
  if (isAppointmentLifecycleCrmStage(args.crmSalesStage)) {
    return true;
  }
  return isConfirmationCallTask(args.selectedTask);
}

export async function loadHeadScoutFollowUpCandidates(): Promise<HeadScoutFollowUpCandidate[]> {
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
      source: CandidateSource;
      profile?: ScoutRecentProfile | null;
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
      const [tasks, stageOptions] = await Promise.all([
        fetchAthleteTasks(entry.athleteId, entry.athleteMainId) as Promise<ScoutAthleteTask[]>,
        fetchCuratedSalesStageOptions(entry.athleteId).catch(() => []),
      ]);
      const crmSalesStage = getSelectedSalesStageLabel(stageOptions);
      const selectedTask = selectRelevantTask(tasks);
      if (!selectedTask && !shouldIncludeCandidate({ crmSalesStage, selectedTask })) {
        return null;
      }
      if (selectedTask && !shouldIncludeCandidate({ crmSalesStage, selectedTask })) {
        return null;
      }

      const parents = parseParentNames(entry.profile);
      const currentTask = selectedTask ? buildTaskStage(selectedTask) : 'Confirmation Call';
      const followUpTask = selectedTask
        ? {
            taskId: String(selectedTask.task_id || '').trim(),
            title: selectedTask.title || null,
            description: selectedTask.description || null,
            dueDate: selectedTask.due_date || null,
            completionDate: selectedTask.completion_date || null,
            assignedOwner: selectedTask.assigned_owner || null,
          }
        : null;
      return {
        key: `${entry.athleteId}:${entry.athleteMainId}`,
        athleteId: entry.athleteId,
        athleteMainId: entry.athleteMainId,
        athleteName: entry.athleteName,
        parent1Name: parents.parent1Name,
        parent2Name: parents.parent2Name,
        dueDate: selectedTask?.due_date || null,
        stage: String(crmSalesStage || currentTask).trim() || currentTask,
        currentTask,
        taskId: String(selectedTask?.task_id || '').trim(),
        adminUrl: buildAdminUrl(entry.athleteId, entry.athleteMainId),
        taskUrl: buildTaskUrl(entry.athleteId, entry.athleteMainId),
        source: entry.source,
        crmSalesStage,
        followUpTask,
        needsConfirmationText: false,
        needsManualReview: false,
        reason: '',
        badges: [],
        oldFollowUpDateDetected: false,
      } satisfies HeadScoutFollowUpCandidate;
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

export async function enrichHeadScoutFollowUpCandidate(
  candidate: HeadScoutFollowUpCandidate,
): Promise<HeadScoutFollowUpCandidate> {
  const resolved = await hydrateResolvedAppointment({
    athleteId: candidate.athleteId,
    athleteName: candidate.athleteName,
    crmSalesStage: candidate.crmSalesStage,
    followUpTask: candidate.followUpTask,
  });
  return {
    ...candidate,
    stage: resolved.crmSalesStage || candidate.stage,
    crmSalesStage: resolved.crmSalesStage,
    headScoutName: resolved.assignedScout || null,
    bookedMeetingTitle: resolved.bookedMeetingTitle || null,
    bookedMeeting: resolved.currentMeeting || null,
    previousMeeting: resolved.previousMeeting || null,
    lifecycleState: resolved.lifecycleState,
    needsConfirmationText: resolved.needsConfirmationText,
    needsManualReview: resolved.needsManualReview,
    reason: resolved.reason,
    operatorStatus: resolved.operatorStatus,
    badges: resolved.badges,
    currentMeetingLabel: resolved.currentMeetingLabel || null,
    oldFollowUpDateDetected: resolved.oldFollowUpDateDetected,
    meetingTimezone: resolved.meetingTimezone || null,
  };
}
