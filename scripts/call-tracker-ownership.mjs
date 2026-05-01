const DEFAULT_TRACKED_OWNER = 'Jerami Singleton';

function normalizeOwnerName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isIncompleteTask(task) {
  const value = String(task?.completion_date || '').trim().toLowerCase();
  return !value || value === '-' || value === '--' || value === 'n/a' || value === 'not completed' || value === 'incomplete';
}

function ownerFromTask(task) {
  return String(task?.assigned_owner || task?.assignedOwner || '').trim() || null;
}

function isRelevantTask(task) {
  const title = String(task?.title || '').trim().toLowerCase();
  const description = String(task?.description || '').trim().toLowerCase();
  return (
    title.includes('call attempt') ||
    title.includes('confirmation call') ||
    title.startsWith('spoke to') ||
    title.includes('follow up') ||
    title.includes('no show') ||
    title.includes('reschedule pending') ||
    title.includes('res. pending') ||
    title.includes('close won') ||
    title.includes('close lost') ||
    title.includes('canceled') ||
    title.includes('cancelled') ||
    description.includes('call the family') ||
    description.includes('confirm the meeting set') ||
    description.includes('follow up')
  );
}

function sortNewestTasks(left, right) {
  const leftId = Number.parseInt(String(left?.task_id || '0'), 10);
  const rightId = Number.parseInt(String(right?.task_id || '0'), 10);
  if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
    return rightId - leftId;
  }
  return String(right?.task_id || '').localeCompare(String(left?.task_id || ''));
}

function sameAthleteIdentity(args) {
  const expectedAthleteId = String(args.athleteId || '').trim();
  const expectedAthleteMainId = String(args.athleteMainId || '').trim();
  const candidateAthleteId = String(args.candidateAthleteId || '').trim();
  const candidateAthleteMainId = String(args.candidateAthleteMainId || '').trim();
  if (!expectedAthleteId || !expectedAthleteMainId) return false;
  if (!candidateAthleteId && !candidateAthleteMainId) return true;
  return expectedAthleteId === candidateAthleteId && expectedAthleteMainId === candidateAthleteMainId;
}

export function isTrackedOwner(value, trackedOwnerName = DEFAULT_TRACKED_OWNER) {
  return normalizeOwnerName(value) === normalizeOwnerName(trackedOwnerName);
}

export function resolveCallTrackerOwnership(args = {}) {
  const trackedOwnerName = args.trackedOwnerName || DEFAULT_TRACKED_OWNER;
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  const exactTaskId = String(args.selectedTaskId || args.currentTaskId || '').trim();
  const exactTask = exactTaskId
    ? tasks.find((task) => String(task?.task_id || '').trim() === exactTaskId) || null
    : null;
  const relevantTasks = tasks.filter(isRelevantTask).sort(sortNewestTasks);
  const incompleteRelevantTasks = relevantTasks.filter(isIncompleteTask);
  const taskCandidates = [exactTask, ...incompleteRelevantTasks, ...relevantTasks].filter(Boolean);
  const taskWithOwner = taskCandidates.find((task) => ownerFromTask(task));

  if (taskWithOwner) {
    const sourceOwner = ownerFromTask(taskWithOwner);
    return {
      isTrackedOwner: isTrackedOwner(sourceOwner, trackedOwnerName),
      sourceOwner,
      ownerProof: String(taskWithOwner?.task_id || '').trim() === exactTaskId ? 'exact_task_owner' : 'relevant_task_owner',
    };
  }

  const bookedMeeting = args.bookedMeeting || null;
  const bookedOwner = String(bookedMeeting?.assigned_owner || bookedMeeting?.assignedOwner || '').trim();
  const bookedAthleteId = bookedMeeting?.athlete_id || bookedMeeting?.athleteId || args.bookedAthleteId;
  const bookedAthleteMainId = bookedMeeting?.athlete_main_id || bookedMeeting?.athleteMainId || args.bookedAthleteMainId;
  if (
    bookedOwner &&
    isTrackedOwner(bookedOwner, trackedOwnerName) &&
    sameAthleteIdentity({
      athleteId: args.athleteId,
      athleteMainId: args.athleteMainId,
      candidateAthleteId: bookedAthleteId,
      candidateAthleteMainId: bookedAthleteMainId,
    })
  ) {
    return {
      isTrackedOwner: isTrackedOwner(bookedOwner, trackedOwnerName),
      sourceOwner: bookedOwner,
      ownerProof: 'booked_event_owner',
    };
  }

  const profile = args.resolvedProfile || {};
  const profileOwner =
    String(profile.scouting_coordinator || '').trim() ||
    String(profile.head_scout || '').trim() ||
    String(args.pipelineState?.head_scout || '').trim() ||
    null;
  if (profileOwner) {
    return {
      isTrackedOwner: isTrackedOwner(profileOwner, trackedOwnerName),
      sourceOwner: profileOwner,
      ownerProof: 'resolved_profile_owner',
    };
  }

  const detail = [
    `athlete=${String(args.athleteName || '').trim() || 'unknown'}`,
    `athlete_id=${String(args.athleteId || '').trim() || 'missing'}`,
    `athlete_main_id=${String(args.athleteMainId || '').trim() || 'missing'}`,
    `appointment_id=${String(args.appointmentId || '').trim() || 'missing'}`,
    `live_event_id=${String(args.liveEventId || '').trim() || 'missing'}`,
  ].join(' ');
  throw new Error(`Unable to resolve call tracker owner proof: ${detail}`);
}
