const ACTIVE_OPERATOR_NAME = 'Jerami Singleton';

const ACTIVITY_BY_STAGE = new Map([
  ['left voice mail 1', { activitySubtype: 'call_attempt_1', activityKind: 'dial', trackerOutcome: 'voicemail', countsAsDial: true, countsAsContact: false }],
  ['left voicemail 1', { activitySubtype: 'call_attempt_1', activityKind: 'dial', trackerOutcome: 'voicemail', countsAsDial: true, countsAsContact: false }],
  ['left voice mail 2', { activitySubtype: 'call_attempt_2', activityKind: 'dial', trackerOutcome: 'voicemail', countsAsDial: true, countsAsContact: false }],
  ['left voicemail 2', { activitySubtype: 'call_attempt_2', activityKind: 'dial', trackerOutcome: 'voicemail', countsAsDial: true, countsAsContact: false }],
  ['never spoke to', { activitySubtype: 'call_attempt_3', activityKind: 'dial', trackerOutcome: 'voicemail', countsAsDial: true, countsAsContact: false }],
  ['called - unable to leave vm', { activitySubtype: 'unable_to_leave_vm', activityKind: 'dial', trackerOutcome: 'unable_to_leave_vm', countsAsDial: true, countsAsContact: false }],
  ['spoke to - not interested', { activitySubtype: 'spoke_to_not_interested', activityKind: 'contact', trackerOutcome: 'not_interested', countsAsDial: true, countsAsContact: true }],
  ['spoke to - athlete, not parent', { activitySubtype: 'spoke_to_athlete_not_parent', activityKind: 'contact', trackerOutcome: 'spoke_follow_up', countsAsDial: true, countsAsContact: true }],
  ['spoke to - too young', { activitySubtype: 'spoke_to_too_young', activityKind: 'contact', trackerOutcome: 'spoke_follow_up', countsAsDial: true, countsAsContact: true }],
  ['spoke to - follow up', { activitySubtype: 'spoke_to_follow_up', activityKind: 'contact', trackerOutcome: 'spoke_follow_up', countsAsDial: true, countsAsContact: true }],
  ['spoke to - i need to follow up', { activitySubtype: 'spoke_to_follow_up', activityKind: 'contact', trackerOutcome: 'spoke_follow_up', countsAsDial: true, countsAsContact: true }],
]);

const ACTIVITY_SUBTYPES = new Map([
  ['call_attempt_1', ACTIVITY_BY_STAGE.get('left voice mail 1')],
  ['call_attempt_2', ACTIVITY_BY_STAGE.get('left voice mail 2')],
  ['call_attempt_3', ACTIVITY_BY_STAGE.get('never spoke to')],
  ['unable_to_leave_vm', ACTIVITY_BY_STAGE.get('called - unable to leave vm')],
  ['spoke_to_not_interested', ACTIVITY_BY_STAGE.get('spoke to - not interested')],
  ['spoke_to_athlete_not_parent', ACTIVITY_BY_STAGE.get('spoke to - athlete, not parent')],
  ['spoke_to_too_young', ACTIVITY_BY_STAGE.get('spoke to - too young')],
  ['spoke_to_follow_up', ACTIVITY_BY_STAGE.get('spoke to - i need to follow up')],
]);

const SNAPSHOT_ONLY_EVENT_TYPES = new Set(['pipeline_task_backfill_current']);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function stringValue(value) {
  return String(value || '').trim();
}

function payload(row) {
  return row?.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json)
    ? row.payload_json
    : {};
}

function getPath(source, path) {
  return path.reduce((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[key];
  }, source);
}

function firstValue(row, paths) {
  const body = payload(row);
  for (const path of paths) {
    const value = path[0] === '$row' ? getPath(row, path.slice(1)) : getPath(body, path);
    const text = stringValue(value);
    if (text) return text;
  }
  return '';
}

function normalizeActivitySubtype(value) {
  const normalized = normalizeText(value).replace(/[\s-]+/g, '_');
  if (normalized === 'spoke_follow_up') return 'spoke_to_follow_up';
  if (normalized === 'called_unable_to_leave_vm') return 'unable_to_leave_vm';
  return ACTIVITY_SUBTYPES.has(normalized) ? normalized : '';
}

function classifyActivity(row) {
  const crmStage = normalizeText(row?.crm_stage);
  if (ACTIVITY_BY_STAGE.has(crmStage)) return ACTIVITY_BY_STAGE.get(crmStage);

  const byPayload = normalizeActivitySubtype(firstValue(row, [
    ['activity_subtype'],
    ['activitySubtype'],
    ['tracker_activity_subtype'],
    ['tracker_outcome'],
    ['task_status'],
    ['$row', 'task_status'],
  ]));
  if (byPayload) return ACTIVITY_SUBTYPES.get(byPayload);

  const taskStatus = normalizeText(row?.task_status);
  if (taskStatus.includes('call attempt 2')) return ACTIVITY_SUBTYPES.get('call_attempt_2');
  if (taskStatus.includes('call attempt 3')) return ACTIVITY_SUBTYPES.get('call_attempt_3');
  if (taskStatus.includes('call attempt 1') || taskStatus === 'call attempt') return ACTIVITY_SUBTYPES.get('call_attempt_1');
  if (taskStatus.includes('unable') && taskStatus.includes('leave') && taskStatus.includes('vm')) {
    return ACTIVITY_SUBTYPES.get('unable_to_leave_vm');
  }
  if (taskStatus.includes('not interested')) return ACTIVITY_SUBTYPES.get('spoke_to_not_interested');
  if (taskStatus.includes('athlete') && taskStatus.includes('not parent')) return ACTIVITY_SUBTYPES.get('spoke_to_athlete_not_parent');
  if (taskStatus.includes('too young')) return ACTIVITY_SUBTYPES.get('spoke_to_too_young');
  if (taskStatus.includes('spoke') && taskStatus.includes('follow')) return ACTIVITY_SUBTYPES.get('spoke_to_follow_up');
  return null;
}

function materializationStatus(row) {
  return firstValue(row, [
    ['materialization_status'],
    ['materialization_proof', 'materialization_status'],
    ['owner_context', 'materialization_status'],
  ]);
}

function taskAssignedOwner(row) {
  return firstValue(row, [
    ['task_assigned_owner'],
    ['assigned_owner'],
    ['owner_context', 'task_assigned_owner'],
    ['materialization_proof', 'task_assigned_owner'],
  ]);
}

function ownerProof(row) {
  if (stringValue(payload(row).assigned_owner)) return 'payload.assigned_owner';
  return firstValue(row, [
    ['$row', 'owner_proof'],
    ['owner_proof'],
    ['owner_context', 'owner_proof'],
    ['owner_context', 'resolved_from_field'],
    ['materialization_proof', 'owner_proof'],
    ['materialization_proof', 'resolved_from_field'],
  ]);
}

function sourceOwner(row) {
  return firstValue(row, [
    ['$row', 'source_owner'],
    ['source_owner'],
    ['assigned_owner'],
    ['owner_context', 'active_operator_name'],
    ['owner_context', 'resolved_owner_name'],
    ['active_operator_name'],
    ['operator_name'],
  ]);
}

function hasActiveOperatorProof(row, activeOperatorName = ACTIVE_OPERATOR_NAME) {
  const status = materializationStatus(row);
  const assignedOwner = taskAssignedOwner(row);
  const source = sourceOwner(row);
  const proof = ownerProof(row);
  if (status === 'operator_task') return { ok: true, sourceOwner: assignedOwner || source || activeOperatorName, ownerProof: proof || 'materialization_status' };
  if (assignedOwner === activeOperatorName) return { ok: true, sourceOwner: assignedOwner, ownerProof: proof || 'task_assigned_owner' };
  if (source === activeOperatorName && proof) return { ok: true, sourceOwner: source, ownerProof: proof };
  return { ok: false, sourceOwner: source || assignedOwner, ownerProof: proof };
}

function isTimOrOtherOperator(row, activeOperatorName = ACTIVE_OPERATOR_NAME) {
  const owners = [taskAssignedOwner(row), sourceOwner(row), firstValue(row, [['owner_context', 'resolved_owner_name']])].filter(Boolean);
  return owners.some((owner) => owner && owner !== activeOperatorName);
}

function taskIdFromLifecycle(row) {
  return firstValue(row, [
    ['task_id'],
    ['taskId'],
    ['current_task_id'],
    ['selected_task_id'],
    ['matched_weekly_task_id'],
    ['materialization_proof', 'task_id'],
    ['owner_context', 'task_id'],
  ]);
}

function stableTaskId(row) {
  return taskIdFromLifecycle(row) || `lifecycle:${row.id}`;
}

function taskTitle(row, activity) {
  return firstValue(row, [['task_title'], ['taskTitle'], ['current_task_title']]) ||
    row.task_status ||
    row.crm_stage ||
    activity.activitySubtype;
}

function taskDescription(row) {
  return firstValue(row, [['task_description'], ['taskDescription'], ['description'], ['current_task_description']]) || null;
}

function lifecycleOccurredAt(row, fallbackNow) {
  const sourceFields = [
    { source: 'payload.completion_date', paths: [['completion_date'], ['completed_at'], ['completedAt'], ['task_completed_at'], ['taskCompletedAt']] },
    { source: 'payload.occurred_at', paths: [['occurred_at'], ['occurredAt'], ['activity_occurred_at'], ['activityOccurredAt']] },
    { source: 'payload.due_at', paths: [['due_at'], ['dueAt'], ['task_due_at'], ['taskDueAt'], ['due_date'], ['dueDate']] },
    { source: 'lifecycle.created_at', paths: [['$row', 'created_at']] },
  ];
  for (const field of sourceFields) {
    const value = firstValue(row, field.paths);
    if (value) return { value, source: field.source };
  }
  return { value: fallbackNow, source: 'backsync.updated_at' };
}

export function classifyLifecycleActivityCandidate(row, options = {}) {
  if (!row?.id) return { eligible: false, reason: 'missing_lifecycle_event_id' };
  if (!stringValue(row.athlete_id) || !stringValue(row.athlete_main_id) || !stringValue(row.athlete_key)) {
    return { eligible: false, reason: 'missing_athlete_identity' };
  }
  if (row.event_type === 'meeting_set') {
    return { eligible: false, reason: 'meeting_set_lifecycle_event' };
  }

  const activity = classifyActivity(row);
  if (!activity) return { eligible: false, reason: 'not_countable_activity' };
  if (SNAPSHOT_ONLY_EVENT_TYPES.has(row.event_type) && !taskIdFromLifecycle(row)) {
    return { eligible: false, reason: 'snapshot_without_task_id', activity };
  }

  const activeOperatorName = options.activeOperatorName || ACTIVE_OPERATOR_NAME;
  if (isTimOrOtherOperator(row, activeOperatorName)) {
    return { eligible: false, reason: 'tim_or_non_operator_proof', activity };
  }

  const proof = hasActiveOperatorProof(row, activeOperatorName);
  if (!proof.ok) {
    return {
      eligible: false,
      reason: SNAPSHOT_ONLY_EVENT_TYPES.has(row.event_type) ? 'snapshot_only_event_type' : 'missing_operator_proof',
      activity,
    };
  }

  return {
    eligible: true,
    activity,
    taskId: stableTaskId(row),
    sourceOwner: proof.sourceOwner || activeOperatorName,
    ownerProof: proof.ownerProof || 'materialization_status',
  };
}

export function buildCallActivityEventFromLifecycle(row, options = {}) {
  const candidate = classifyLifecycleActivityCandidate(row, options);
  if (!candidate.eligible) return null;
  const now = options.updatedAt || new Date().toISOString();
  const activity = candidate.activity;
  const occurrence = lifecycleOccurredAt(row, now);
  return {
    athlete_key: row.athlete_key,
    athlete_id: String(row.athlete_id),
    athlete_main_id: String(row.athlete_main_id),
    athlete_name: firstValue(row, [['athlete_name'], ['name'], ['$row', 'athlete_name']]) || null,
    task_id: candidate.taskId,
    task_title: taskTitle(row, activity),
    task_description: taskDescription(row),
    activity_type: activity.activitySubtype,
    activity_kind: activity.activityKind,
    activity_subtype: activity.activitySubtype,
    occurred_at: occurrence.value,
    source_owner: candidate.sourceOwner,
    owner_proof: candidate.ownerProof,
    payload_json: {
      ...payload(row),
      lifecycle_event_id: row.id,
      lifecycle_event_type: row.event_type,
      lifecycle_created_at: row.created_at || null,
      lifecycle_dedupe_key: row.dedupe_key || null,
      occurred_at_source: occurrence.source,
      supabase_synced_at: now,
      source_table: 'lifecycle_events',
      activity_kind: activity.activityKind,
      activity_subtype: activity.activitySubtype,
      counts_as_dial: activity.countsAsDial,
      counts_as_contact: activity.countsAsContact,
      counts_as_meeting_set: false,
      counts_as_post_meeting_outcome: false,
      tracker_outcome: activity.trackerOutcome,
      active_operator_name: options.activeOperatorName || ACTIVE_OPERATOR_NAME,
      task_assigned_owner: taskAssignedOwner(row) || candidate.sourceOwner,
      source_owner: candidate.sourceOwner,
      owner_proof: candidate.ownerProof,
      materialization_status: 'operator_task',
      materialization_reason: 'task_assigned_owner_matches_active_operator',
      materialization_proof: {
        ...(payload(row).materialization_proof || {}),
        task_assigned_owner: taskAssignedOwner(row) || candidate.sourceOwner,
        materialization_status: 'operator_task',
        status: 'operator_task',
        reason: 'task_assigned_owner_matches_active_operator',
      },
    },
    updated_at: now,
  };
}

export function groupLifecycleRows(rows) {
  const groups = {};
  for (const row of rows) {
    const body = payload(row);
    const key = JSON.stringify({
      event_type: row.event_type || null,
      crm_stage: row.crm_stage || null,
      task_status: row.task_status || null,
      tracker_outcome: body.tracker_outcome || null,
      activity_subtype: body.activity_subtype || null,
      materialization_status: body.materialization_status || body.materialization_proof?.materialization_status || null,
      task_assigned_owner: body.task_assigned_owner || body.owner_context?.task_assigned_owner || null,
      owner_proof: body.owner_proof || body.owner_context?.owner_proof || null,
    });
    groups[key] = (groups[key] || 0) + 1;
  }
  return Object.entries(groups)
    .map(([key, count]) => ({ ...JSON.parse(key), count }))
    .sort((left, right) => right.count - left.count);
}

export function summarizeLifecycleCandidates(rows, existing = {}) {
  const activityTaskIds = new Set(existing.callActivityTaskIds || []);
  const trackerDedupeKeys = new Set(existing.callTrackerDedupeKeys || []);
  const excludedRowsByReason = {};
  const missingActivityFactCandidates = [];
  const uniqueMissingByTaskId = new Map();
  const uniqueSafeByTaskId = new Map();
  let safeContactCandidates = 0;
  let safeDialCandidates = 0;
  let alreadyInCallActivityEvents = 0;
  let alreadyInCallTrackerEvents = 0;

  for (const row of rows) {
    const candidate = classifyLifecycleActivityCandidate(row);
    if (!candidate.eligible) {
      excludedRowsByReason[candidate.reason] = (excludedRowsByReason[candidate.reason] || 0) + 1;
      continue;
    }
    if (!uniqueSafeByTaskId.has(candidate.taskId)) {
      uniqueSafeByTaskId.set(candidate.taskId, {
        task_id: candidate.taskId,
        activity_subtype: candidate.activity.activitySubtype,
        counts_as_dial: candidate.activity.countsAsDial,
        counts_as_contact: candidate.activity.countsAsContact,
        first_lifecycle_event_id: row.id,
        first_created_at: row.created_at,
        event_type: row.event_type,
        crm_stage: row.crm_stage,
        task_status: row.task_status,
      });
    }
    if (candidate.activity.countsAsDial) safeDialCandidates += 1;
    if (candidate.activity.countsAsContact) safeContactCandidates += 1;
    const trackerDedupeKey = `activity:${candidate.taskId}`;
    const inActivity = activityTaskIds.has(candidate.taskId);
    const inTracker = trackerDedupeKeys.has(trackerDedupeKey);
    if (inActivity) alreadyInCallActivityEvents += 1;
    if (inTracker) alreadyInCallTrackerEvents += 1;
    if (!inActivity && !inTracker) {
      const missing = {
        lifecycle_event_id: row.id,
        event_type: row.event_type,
        crm_stage: row.crm_stage,
        task_status: row.task_status,
        task_id: candidate.taskId,
        activity_subtype: candidate.activity.activitySubtype,
        counts_as_dial: candidate.activity.countsAsDial,
        counts_as_contact: candidate.activity.countsAsContact,
        occurred_at: row.created_at,
      };
      missingActivityFactCandidates.push(missing);
      if (!uniqueMissingByTaskId.has(candidate.taskId)) uniqueMissingByTaskId.set(candidate.taskId, missing);
    }
  }
  const uniqueSafeCandidates = [...uniqueSafeByTaskId.values()];
  const uniqueMissingActivityFactCandidates = [...uniqueMissingByTaskId.values()];

  return {
    lifecycleCandidateCounts: groupLifecycleRows(rows),
    alreadyInCallActivityEvents,
    alreadyInMeetingEvents: existing.alreadyInMeetingEvents || 0,
    alreadyInCallTrackerEvents,
    missingActivityFactCandidates,
    uniqueSafeActivityTaskCandidates: uniqueSafeCandidates,
    uniqueMissingActivityFactCandidates,
    missingMeetingSetCandidates: existing.missingMeetingSetCandidates || [],
    missingOutcomeCandidates: existing.missingOutcomeCandidates || [],
    excludedRowsByReason,
    suspectedAllTimeContactGap: uniqueMissingActivityFactCandidates.filter((row) => row.counts_as_contact).length,
    suspectedAllTimeDialGap: uniqueMissingActivityFactCandidates.filter((row) => row.counts_as_dial).length,
    safeDialCandidates,
    safeContactCandidates,
    uniqueSafeActivityTaskCount: uniqueSafeCandidates.length,
    uniqueSafeContactTaskCount: uniqueSafeCandidates.filter((row) => row.counts_as_contact).length,
    uniqueSafeDialTaskCount: uniqueSafeCandidates.filter((row) => row.counts_as_dial).length,
    uniqueMissingActivityTaskCount: uniqueMissingActivityFactCandidates.length,
    uniqueMissingContactTaskCount: uniqueMissingActivityFactCandidates.filter((row) => row.counts_as_contact).length,
    uniqueMissingDialTaskCount: uniqueMissingActivityFactCandidates.filter((row) => row.counts_as_dial).length,
  };
}
