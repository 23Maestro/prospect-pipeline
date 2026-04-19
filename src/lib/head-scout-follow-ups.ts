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
  buildCalendarMonthWindow,
  fetchBookedMeeting,
  HEAD_SCOUT_ORDER,
  type BookedMeetingEvent,
} from './head-scout-schedules';
import { apiFetch } from './fastapi-client';

const DASHBOARD_BASE_URL = 'https://dashboard.nationalpid.com';

const STATE_ABBREVIATIONS: Record<string, string> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
};

type LiveAthleteResolve = {
  grad_year?: string | null;
  state?: string | null;
  sport?: string | null;
  head_scout?: string | null;
};

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
  websiteStage?: string | null;
  headScoutName?: string | null;
  bookedMeetingTitle?: string | null;
  bookedMeeting?: BookedMeetingEvent | null;
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

function isMeetingSetWebsiteStage(stage?: string | null): boolean {
  return (
    String(stage || '')
      .trim()
      .toLowerCase() === 'meeting set'
  );
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
  websiteStage?: string | null;
  selectedTask: ScoutAthleteTask | null;
}): boolean {
  if (isMeetingSetWebsiteStage(args.websiteStage)) {
    return true;
  }
  return isConfirmationCallTask(args.selectedTask);
}

function buildBookedMeetingTitle(args: {
  athleteName?: string | null;
  sport?: string | null;
  gradYear?: string | null;
  state?: string | null;
}): string {
  const athleteName = String(args.athleteName || '').trim();
  const sport = String(args.sport || '').trim();
  const gradYear = String(args.gradYear || '').trim();
  const rawState = String(args.state || '').trim();
  const upperState = rawState.toUpperCase();
  const state =
    STATE_ABBREVIATIONS[upperState] || (upperState.length === 2 ? upperState : rawState);
  return [athleteName, sport, gradYear, state].filter(Boolean).join(' ').trim();
}

async function fetchLiveAthleteResolve(athleteId: string): Promise<LiveAthleteResolve | null> {
  const response = await apiFetch(
    `/athlete/${encodeURIComponent(athleteId)}/resolve?force_refresh=true`,
  );
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json().catch(() => ({}))) as LiveAthleteResolve;
  return payload && typeof payload === 'object' ? payload : null;
}

function findHeadScoutSchedule(headScoutName?: string | null) {
  const normalized = String(headScoutName || '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  return (
    HEAD_SCOUT_ORDER.find((scout) => scout.scout_name.trim().toLowerCase() === normalized) || null
  );
}

function parseDueDateValue(dueDate?: string | null): Date {
  const parsed = new Date(String(dueDate || '').trim());
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
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
      const websiteStage =
        stageOptions.find((option) => option.selected)?.label ||
        stageOptions.find((option) => option.selected)?.value ||
        null;
      const selectedTask = selectRelevantTask(tasks);
      if (!selectedTask || !shouldIncludeCandidate({ websiteStage, selectedTask })) {
        return null;
      }

      const parents = parseParentNames(entry.profile);
      const currentTask = buildTaskStage(selectedTask);
      return {
        key: `${entry.athleteId}:${entry.athleteMainId}`,
        athleteId: entry.athleteId,
        athleteMainId: entry.athleteMainId,
        athleteName: entry.athleteName,
        parent1Name: parents.parent1Name,
        parent2Name: parents.parent2Name,
        dueDate: selectedTask.due_date || null,
        stage: isMeetingSetWebsiteStage(websiteStage) ? 'Meeting Set' : currentTask,
        currentTask,
        taskId: String(selectedTask.task_id || '').trim(),
        adminUrl: buildAdminUrl(entry.athleteId, entry.athleteMainId),
        taskUrl: buildTaskUrl(entry.athleteId, entry.athleteMainId),
        source: entry.source,
        websiteStage,
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
  const liveResolve = await fetchLiveAthleteResolve(candidate.athleteId);
  const headScoutName = String(liveResolve?.head_scout || '').trim();
  const headScout = findHeadScoutSchedule(headScoutName);
  const bookedMeetingTitle = buildBookedMeetingTitle({
    athleteName: candidate.athleteName,
    sport: liveResolve?.sport,
    gradYear: liveResolve?.grad_year,
    state: liveResolve?.state,
  });

  if (!headScout || !bookedMeetingTitle) {
    return { ...candidate, headScoutName: headScoutName || null, bookedMeetingTitle };
  }

  const window = buildCalendarMonthWindow(parseDueDateValue(candidate.dueDate));
  try {
    const booked = await fetchBookedMeeting({
      calendarOwnerId: headScout.calendar_owner_id,
      title: bookedMeetingTitle,
      start: window.start,
      end: window.end,
    });
    return {
      ...candidate,
      headScoutName,
      bookedMeetingTitle,
      bookedMeeting: booked.event || null,
    };
  } catch {
    return {
      ...candidate,
      headScoutName,
      bookedMeetingTitle,
      bookedMeeting: null,
    };
  }
}
