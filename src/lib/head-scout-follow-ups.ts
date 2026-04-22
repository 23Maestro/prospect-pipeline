import type {
  ScoutAthleteTask,
  ScoutPortalTask,
  ScoutRecentProfile,
} from '../features/scout-prep/types';
import {
  fetchAthleteTasks,
  fetchScoutPortalTaskBuckets,
  fetchScoutRecentProfiles,
  findNewestIncompleteConfirmationTask,
  findNewestIncompleteFollowUpTask,
  isConfirmationCallTask,
  type ScoutTaskRange,
  stripMoveThisTaskPrefix,
} from './scout-prep';
import { fetchCuratedSalesStageOptions } from './sales-stage';
import {
  getSelectedSalesStageLabel,
  hydrateResolvedAppointment,
  type AppointmentLifecycleBadge,
  type AppointmentLifecycleState,
  type AppointmentTaskSnapshot,
} from './head-scout-appointment-lifecycle';
import {
  isActiveMeetingQueueItem,
  resolveSalesLifecycle,
  type OperatorWorkflowStatus,
} from './sales-lifecycle';
import { getActiveMeetingFallbackRows, type ActiveMeetingFallbackRow } from './supabase-lifecycle';
import {
  fetchAthleteBookedMeetings,
  type BookedMeetingEvent,
} from './head-scout-schedules';

const DASHBOARD_BASE_URL = 'https://dashboard.nationalpid.com';
const ACTIVE_TASK_RANGES = ['todayPastDue', 'today', 'tomorrow', 'future'] as const satisfies readonly ScoutTaskRange[];

type CandidateSource = 'website' | 'supabase';

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
  operatorStatus?: OperatorWorkflowStatus | null;
  badges: AppointmentLifecycleBadge[];
  currentMeetingLabel?: string | null;
  oldFollowUpDateDetected: boolean;
  meetingTimezone?: string | null;
  supabaseState?: ActiveMeetingFallbackRow | null;
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

function buildTaskLabelFromStatus(taskStatus?: string | null): string {
  switch (String(taskStatus || '').trim().toLowerCase()) {
    case 'confirmation_call':
      return 'Confirmation Call';
    case 'spoke_to_follow_up':
      return 'Spoke To - Follow Up';
    case 'call_attempt_2':
      return 'Call Attempt 2';
    case 'call_attempt_1':
      return 'Call Attempt 1';
    case 'no_show':
      return 'No Show';
    default:
      return 'Confirmation Call';
  }
}

function isMeetingLikeEvent(event?: Pick<BookedMeetingEvent, 'title'> | null): boolean {
  const normalized = String(event?.title || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return !(
    normalized.startsWith('follow up -') ||
    normalized.startsWith('(fu)') ||
    normalized.startsWith('(cl)') ||
    normalized.startsWith('(*)')
  );
}

function buildSupabaseBookedMeetingEvent(
  row?: ActiveMeetingFallbackRow | null,
  athleteName?: string | null,
): BookedMeetingEvent | null {
  const eventId = String(row?.currentAppointmentId || '').trim();
  const start = String(row?.appointmentStartsAt || '').trim();
  if (!eventId || !start) {
    return null;
  }

  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) {
    return null;
  }

  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

  return {
    event_id: eventId,
    title: String(athleteName || row?.athleteName || '').trim() || 'Booked Meeting',
    assigned_owner: String(row?.headScout || '').trim(),
    start,
    end: endDate.toISOString(),
    date_time_label: new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
    }).format(startDate),
  };
}

function normalizeIsoMinute(value?: string | null): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toISOString().slice(0, 16);
}

function selectPreferredBookedMeeting(args: {
  supabaseState?: ActiveMeetingFallbackRow | null;
  athleteEvents: BookedMeetingEvent[];
  athleteName: string;
}): BookedMeetingEvent | null {
  const appointmentId = String(args.supabaseState?.currentAppointmentId || '').trim();
  const appointmentStart = normalizeIsoMinute(args.supabaseState?.appointmentStartsAt);
  const filteredEvents = args.athleteEvents.filter((event) => isMeetingLikeEvent(event));

  if (appointmentId) {
    const idMatch = filteredEvents.find(
      (event) => String(event.event_id || '').trim() === appointmentId,
    );
    if (idMatch) {
      return idMatch;
    }
  }

  if (appointmentStart) {
    const startMatch = filteredEvents.find(
      (event) => normalizeIsoMinute(event.start) === appointmentStart,
    );
    if (startMatch) {
      return startMatch;
    }
  }

  return buildSupabaseBookedMeetingEvent(args.supabaseState, args.athleteName);
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

function selectRelevantPortalTask(tasks: ScoutPortalTask[]): ScoutPortalTask | null {
  const confirmations = tasks.filter((task) => isConfirmationCallTask(task));
  if (confirmations.length > 0) {
    return [...confirmations].sort((left, right) =>
      String(right.task_id || '').localeCompare(String(left.task_id || '')),
    )[0];
  }

  const followUps = tasks.filter((task) => {
    const title = stripMoveThisTaskPrefix(task.title).toLowerCase();
    return (
      title.includes('follow up') ||
      title.includes('follow-up') ||
      title.includes('call attempt')
    );
  });
  if (followUps.length > 0) {
    return [...followUps].sort((left, right) =>
      String(right.task_id || '').localeCompare(String(left.task_id || '')),
    )[0];
  }

  return null;
}

function buildPortalTaskSnapshot(task?: ScoutPortalTask | null): AppointmentTaskSnapshot | null {
  if (!task) {
    return null;
  }

  return {
    taskId: String(task.task_id || '').trim() || null,
    title: task.title || null,
    description: task.description || null,
    dueDate: task.due_date || null,
    completionDate: task.completion_date || null,
    assignedOwner: task.assigned_owner || null,
  };
}

function buildPortalTaskStage(task?: ScoutPortalTask | null): string | null {
  if (!task) {
    return null;
  }

  return (
    stripMoveThisTaskPrefix(task.title) ||
    String(task.description || '').trim() ||
    null
  );
}

function shouldIncludeCandidate(args: {
  crmSalesStage?: string | null;
  selectedTask: ScoutAthleteTask | null;
}): boolean {
  const lifecycle = resolveSalesLifecycle(args.crmSalesStage);
  if (isActiveMeetingQueueItem(lifecycle) || lifecycle.operatorStatus === 'needs_manual_review') {
    return true;
  }
  return isConfirmationCallTask(args.selectedTask);
}

export async function loadHeadScoutFollowUpCandidates(): Promise<HeadScoutFollowUpCandidate[]> {
  const [recentProfiles, supabaseRows, websiteTaskBuckets] = await Promise.all([
    fetchScoutRecentProfiles(),
    getActiveMeetingFallbackRows().catch(() => []),
    fetchScoutPortalTaskBuckets(ACTIVE_TASK_RANGES),
  ]);

  const recentByKey = new Map(
    recentProfiles.map((profile) => [
      `${profile.athlete_id.trim()}:${profile.athlete_main_id.trim()}`,
      profile,
    ]),
  );

  const websiteTaskByKey = new Map<string, ScoutPortalTask>();
  for (const task of Object.values(websiteTaskBuckets).flat()) {
    const athleteId = String(task.athlete_id || task.contact_id || '').trim();
    const athleteMainId = String(task.athlete_main_id || '').trim();
    if (!athleteId || !athleteMainId) {
      continue;
    }
    const key = `${athleteId}:${athleteMainId}`;
    const selected = selectRelevantPortalTask(
      [websiteTaskByKey.get(key), task].filter(Boolean) as ScoutPortalTask[],
    );
    if (selected) {
      websiteTaskByKey.set(key, selected);
    }
  }

  const baseEntries = new Map<
    string,
    {
      athleteId: string;
      athleteMainId: string;
      athleteName: string;
      source: CandidateSource;
      profile?: ScoutRecentProfile | null;
      supabaseState?: ActiveMeetingFallbackRow | null;
      websiteTask?: ScoutPortalTask | null;
    }
  >();

  for (const row of supabaseRows) {
    const athleteId = row.athleteId.trim();
    const athleteMainId = row.athleteMainId.trim();
    if (!athleteId || !athleteMainId) {
      continue;
    }
    const key = `${athleteId}:${athleteMainId}`;
    if (!baseEntries.has(key)) {
      baseEntries.set(key, {
        athleteId,
        athleteMainId,
        athleteName:
          row.athleteName.trim() ||
          websiteTaskByKey.get(key)?.athlete_name ||
          recentByKey.get(key)?.athlete_name?.trim() ||
          '',
        source: 'supabase',
        profile: recentByKey.get(key) || null,
        supabaseState: row,
        websiteTask: websiteTaskByKey.get(key) || null,
      });
      continue;
    }

    const existing = baseEntries.get(key);
    if (existing) {
      existing.supabaseState = row;
      existing.profile = existing.profile || recentByKey.get(key) || null;
      existing.websiteTask = existing.websiteTask || websiteTaskByKey.get(key) || null;
      if (!existing.athleteName.trim()) {
        existing.athleteName =
          row.athleteName.trim() ||
          existing.websiteTask?.athlete_name ||
          existing.profile?.athlete_name?.trim() ||
          '';
      }
    }
  }

  const candidates = await Promise.all(
    Array.from(baseEntries.values()).map(async (entry) => {
      const [tasks, stageOptions] = await Promise.all([
        fetchAthleteTasks(entry.athleteId, entry.athleteMainId) as Promise<ScoutAthleteTask[]>,
        fetchCuratedSalesStageOptions(entry.athleteId).catch(() => []),
      ]);
      const crmSalesStage = getSelectedSalesStageLabel(stageOptions) || entry.supabaseState?.crmStage || null;
      const selectedTask = selectRelevantTask(tasks);
      if (!selectedTask && !shouldIncludeCandidate({ crmSalesStage, selectedTask })) {
        return null;
      }
      if (selectedTask && !shouldIncludeCandidate({ crmSalesStage, selectedTask })) {
        return null;
      }

      const parents = parseParentNames(entry.profile);
      const websiteTask = entry.websiteTask || null;
      const currentTask =
        (selectedTask ? buildTaskStage(selectedTask) : null) ||
        buildPortalTaskStage(websiteTask) ||
        entry.supabaseState?.currentTaskTitle ||
        buildTaskLabelFromStatus(entry.supabaseState?.taskStatus);
      const followUpTask = selectedTask
        ? {
            taskId: String(selectedTask.task_id || '').trim(),
            title: selectedTask.title || null,
            description: selectedTask.description || null,
            dueDate: selectedTask.due_date || null,
            completionDate: selectedTask.completion_date || null,
            assignedOwner: selectedTask.assigned_owner || null,
          }
        : buildPortalTaskSnapshot(websiteTask);
      return {
        key: `${entry.athleteId}:${entry.athleteMainId}`,
        athleteId: entry.athleteId,
        athleteMainId: entry.athleteMainId,
        athleteName: entry.athleteName,
        parent1Name: parents.parent1Name,
        parent2Name: parents.parent2Name,
        dueDate:
          selectedTask?.due_date ||
          websiteTask?.due_date ||
          entry.supabaseState?.appointmentStartsAt ||
          null,
        stage: String(crmSalesStage || currentTask).trim() || currentTask,
        currentTask,
        taskId:
          String(selectedTask?.task_id || '').trim() ||
          String(websiteTask?.task_id || '').trim() ||
          String(entry.supabaseState?.currentTaskId || '').trim(),
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
        supabaseState: entry.supabaseState || null,
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

export async function loadHeadScoutWeeklyMeetingCandidates(args: {
  weekStart: string;
  weekEnd: string;
}): Promise<HeadScoutFollowUpCandidate[]> {
  const supabaseRows = await getActiveMeetingFallbackRows().catch(() => []);

  return supabaseRows
    .filter((row) => {
      const startsAt = String(row.appointmentStartsAt || '').trim();
      if (!startsAt) {
        return false;
      }
      const parsed = new Date(startsAt);
      if (Number.isNaN(parsed.getTime())) {
        return false;
      }
      const meetingDate = parsed.toISOString().slice(0, 10);
      return meetingDate >= args.weekStart && meetingDate < args.weekEnd;
    })
    .map(
      (row) =>
        ({
          key: `${row.athleteId}:${row.athleteMainId}`,
          athleteId: row.athleteId,
          athleteMainId: row.athleteMainId,
          athleteName: row.athleteName,
          dueDate: row.appointmentStartsAt || null,
          stage: String(row.crmStage || '').trim() || buildTaskLabelFromStatus(row.taskStatus),
          currentTask:
            String(row.currentTaskTitle || '').trim() || buildTaskLabelFromStatus(row.taskStatus),
          taskId: String(row.currentTaskId || '').trim(),
          adminUrl: buildAdminUrl(row.athleteId, row.athleteMainId),
          taskUrl: buildTaskUrl(row.athleteId, row.athleteMainId),
          source: 'supabase',
          crmSalesStage: row.crmStage || null,
          headScoutName: row.headScout || null,
          needsConfirmationText: false,
          needsManualReview: false,
          reason: '',
          badges: [],
          oldFollowUpDateDetected: false,
          supabaseState: row,
        }) satisfies HeadScoutFollowUpCandidate,
    )
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
  const athleteEvents =
    String(candidate.athleteMainId || '').trim()
      ? await fetchAthleteBookedMeetings({
          athleteId: candidate.athleteId,
          athleteMainId: candidate.athleteMainId,
        })
          .then((payload) => payload.events || [])
          .catch(() => [])
      : [];
  const preferredBookedMeeting = selectPreferredBookedMeeting({
    supabaseState: candidate.supabaseState || null,
    athleteEvents,
    athleteName: candidate.athleteName,
  });
  const resolved = await hydrateResolvedAppointment({
    athleteId: candidate.athleteId,
    athleteMainId: candidate.athleteMainId,
    athleteName: candidate.athleteName,
    crmSalesStage: candidate.crmSalesStage,
    followUpTask: candidate.followUpTask,
    headScoutName: candidate.headScoutName || candidate.supabaseState?.headScout || null,
    bookedMeetings: preferredBookedMeeting ? [preferredBookedMeeting] : null,
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
