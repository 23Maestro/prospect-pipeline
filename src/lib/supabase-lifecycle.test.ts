import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  buildLifecycleMutationEvent,
  buildAppointmentRow,
  buildAppointmentId,
  buildAthleteKey,
  buildReminderDedupeKey,
  resolveAppointmentStatusProjectionForSalesStage,
  resolveLifecycleRetentionDecision,
} from './supabase-lifecycle';
import { mergeAppointmentTruthRow } from '../domain/appointment-truth';

test('buildAthleteKey keeps athlete and main id together', () => {
  assert.equal(buildAthleteKey('123', '456'), '123:456');
});

test('buildAppointmentId prefers explicit appointment id', () => {
  assert.equal(
    buildAppointmentId({
      athleteId: '123',
      athleteMainId: '456',
      appointmentId: 'evt_1',
      startsAt: '2026-04-21T10:00:00-04:00',
    }),
    'evt_1',
  );
});

test('buildAppointmentId falls back to athlete key + starts_at', () => {
  assert.equal(
    buildAppointmentId({
      athleteId: '123',
      athleteMainId: '456',
      startsAt: '2026-04-21T10:00:00-04:00',
    }),
    'appointment:123:456:2026-04-21T14:00:00.000Z',
  );
});

test('appointment row carries durable appointment truth fields', () => {
  const row = buildAppointmentRow(
    {
      athleteId: '1490881',
      athleteMainId: '952706',
      athleteName: 'Richard Hayes',
    },
    {
      appointmentId: '611014',
      headScout: 'Ryan Lietz',
      startsAt: '2026-05-15T18:00:00-05:00',
      status: 'scheduled',
      sourceEventId: '611014',
      meetingTimezone: 'America/Chicago',
      meetingTimezoneLabel: 'CST',
      calendarTimezone: 'America/New_York',
      originalAppointmentId: '611014',
      rescheduleSequence: 0,
      operatorOwner: 'Jerami Singleton',
      operatorOwnerKey: 'jerami_singleton',
      appointmentRole: 'initial_set',
      statusReason: 'meeting_set_written',
      sourceSystem: 'scout_prep_action',
      sourcePayload: {
        owner_proof: 'raycast_operator_context',
      },
    },
    '2026-05-15T17:30:00.000Z',
  );

  assert.equal(row.id, '611014');
  assert.equal(row.meeting_timezone, 'America/Chicago');
  assert.equal(row.meeting_timezone_label, 'CST');
  assert.equal(row.calendar_timezone, 'America/New_York');
  assert.equal(row.original_appointment_id, '611014');
  assert.equal(row.previous_appointment_id, null);
  assert.equal(row.reschedule_sequence, 0);
  assert.equal(row.operator_owner, 'Jerami Singleton');
  assert.equal(row.operator_owner_key, 'jerami_singleton');
  assert.equal(row.head_scout, 'Ryan Lietz');
  assert.equal(row.head_scout_key, 'ryan_lietz');
  assert.equal(row.appointment_role, 'initial_set');
  assert.equal(row.source_system, 'scout_prep_action');
});

test('rescheduled appointment row carries previous and original appointment ids', () => {
  const row = buildAppointmentRow(
    {
      athleteId: '1490881',
      athleteMainId: '952706',
      athleteName: 'Richard Hayes',
    },
    {
      appointmentId: '622222',
      headScout: 'Luther Winfield',
      startsAt: '2026-05-20T18:00:00-05:00',
      status: 'rescheduled',
      sourceEventId: '622222',
      previousAppointmentId: '611014',
      originalAppointmentId: '611014',
      rescheduleSequence: 1,
      appointmentRole: 'reschedule',
      sourceSystem: 'scout_prep_action',
    },
    '2026-05-15T17:30:00.000Z',
  );

  assert.equal(row.previous_appointment_id, '611014');
  assert.equal(row.original_appointment_id, '611014');
  assert.equal(row.reschedule_sequence, 1);
  assert.equal(row.appointment_role, 'reschedule');
  assert.equal(row.head_scout_key, 'luther_winfield');
});

test('appointment truth merge preserves durable fields when support writes omit them', () => {
  const existing = buildAppointmentRow(
    {
      athleteId: '1490881',
      athleteMainId: '952706',
      athleteName: 'Richard Hayes',
    },
    {
      appointmentId: '611014',
      headScout: 'Ryan Lietz',
      startsAt: '2026-05-15T18:00:00-05:00',
      status: 'scheduled',
      sourceEventId: '611014',
      meetingTimezone: 'America/Chicago',
      meetingTimezoneLabel: 'CST',
      originalAppointmentId: '611014',
      operatorOwner: 'Jerami Singleton',
      operatorOwnerKey: 'jerami_singleton',
      appointmentRole: 'initial_set',
      sourceSystem: 'scout_prep_action',
      sourcePayload: { owner_proof: 'raycast_operator_context' },
    },
    '2026-05-15T17:30:00.000Z',
  );
  const confirmationWrite = buildAppointmentRow(
    {
      athleteId: '1490881',
      athleteMainId: '952706',
      athleteName: 'Richard Hayes',
    },
    {
      appointmentId: '611014',
      headScout: 'Ryan Lietz',
      status: 'confirmation_sent',
      sourceEventId: '611014',
      appointmentRole: 'confirmation',
      statusReason: 'confirmation_sent',
      sourcePayload: { message_variant: 'confirmation_1' },
    },
    '2026-05-15T18:00:00.000Z',
  );

  const merged = mergeAppointmentTruthRow(existing, confirmationWrite);

  assert.equal(merged.status, 'confirmation_sent');
  assert.equal(merged.status_reason, 'confirmation_sent');
  assert.equal(merged.meeting_timezone, 'America/Chicago');
  assert.equal(merged.meeting_timezone_label, 'CST');
  assert.equal(merged.starts_at, '2026-05-15T23:00:00.000Z');
  assert.equal(merged.original_appointment_id, '611014');
  assert.equal(merged.operator_owner, 'Jerami Singleton');
  assert.equal(merged.operator_owner_key, 'jerami_singleton');
  assert.equal(merged.appointment_role, 'confirmation');
  assert.deepEqual(merged.source_payload, {
    owner_proof: 'raycast_operator_context',
    message_variant: 'confirmation_1',
  });
});

test('buildReminderDedupeKey normalizes send_at', () => {
  assert.equal(
    buildReminderDedupeKey({
      appointmentId: 'evt_1',
      kind: 'confirmation',
      suffix: 'queued',
      sendAt: '2026-04-22T09:30:00-04:00',
    }),
    'evt_1:confirmation:queued:2026-04-22T13:30:00.000Z',
  );
});

test('enrollment event titles purge lifecycle rows even if supabase is stale', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Set',
    bookedEventTitle: '(ENR $69) Victor Williams Football 2028 TX',
  });

  assert.equal(result.action, 'purge');
});

test('(FU) event titles soft archive active meeting rows', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Set',
    bookedEventTitle: '(FU) Terry Smith Football 2028 TX',
  });

  assert.equal(result.action, 'soft_archive');
});

test('(CAN) event titles soft archive active meeting rows', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Result - Canceled',
    bookedEventTitle: '(CAN) Levi Childers Football 2026 CA',
  });

  assert.equal(result.action, 'soft_archive');
});

test('(NS) event titles soft archive active meeting rows', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Set',
    bookedEventTitle: '(NS) Terry Smith Football 2028 TX',
  });

  assert.equal(result.action, 'soft_archive');
});

test('(CL) event titles purge lifecycle rows as close lost', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Set',
    bookedEventTitle: '(CL) Terry Smith Football 2028 TX',
  });

  assert.equal(result.action, 'purge');
});

test('terminal crm stages purge lifecycle rows without title help', () => {
  const result = resolveLifecycleRetentionDecision({
    liveCrmStage: 'Actual Meeting Closed Won',
  });

  assert.equal(result.action, 'purge');
});

test('reschedule-pending sales stage projects onto the current appointment status', () => {
  assert.deepEqual(
    resolveAppointmentStatusProjectionForSalesStage({
      crmStage: 'Meeting Result - Res. Pending',
      appointmentId: '611014',
    }),
    {
      appointmentId: '611014',
      status: 'reschedule_pending',
      statusReason: 'sales_stage_reschedule_pending',
    },
  );
});

test('sales stage appointment projection needs an appointment id', () => {
  assert.equal(
    resolveAppointmentStatusProjectionForSalesStage({
      crmStage: 'Meeting Result - Res. Pending',
      appointmentId: null,
    }),
    null,
  );
  assert.equal(
    resolveAppointmentStatusProjectionForSalesStage({
      crmStage: 'Meeting Set',
      appointmentId: '611014',
    }),
    null,
  );
});

test('lifecycle mutation event logs left voicemail as dial-only operator activity', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/tasks/complete',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    crmStage: 'Left Voice Mail 1',
    taskId: '9901',
    taskTitle: 'Call Attempt 1',
    taskAssignedOwner: 'Jerami Singleton',
    completedAt: '2026-05-01T14:30:00.000Z',
  });

  assert.equal(event.eventType, 'task_completed');
  assert.equal(event.payload.source_post, '/tasks/complete');
  assert.equal(event.payload.athlete_name, 'Avery Jones');
  assert.equal(event.payload.task_id, '9901');
  assert.equal(event.payload.activity_subtype, 'call_attempt_1');
  assert.equal(event.payload.activity_kind, 'dial');
  assert.equal(event.payload.counts_as_dial, true);
  assert.equal(event.payload.counts_as_contact, false);
  assert.equal(event.payload.completed_at, '2026-05-01T14:30:00.000Z');
  assert.equal(event.payload.occurred_at, '2026-05-01T14:30:00.000Z');
  assert.equal(event.payload.operator_owner, 'Jerami Singleton');
  assert.equal(event.payload.operator_owner_key, 'jerami_singleton');
  assert.equal(event.payload.task_assigned_owner, 'Jerami Singleton');
  assert.equal(event.payload.owner_proof, 'task.assigned_owner');
  assert.equal(event.payload.materialization_status, 'operator_task');
});

test('lifecycle mutation countable activity requires athlete name', () => {
  assert.throws(
    () =>
      buildLifecycleMutationEvent({
        sourcePost: '/tasks/complete',
        athleteId: '1489000',
        athleteMainId: '951000',
        athleteName: '',
        crmStage: 'Left Voice Mail 1',
        taskId: '9901',
        taskTitle: 'Call Attempt 1',
        taskAssignedOwner: 'Jerami Singleton',
        completedAt: '2026-05-01T14:30:00.000Z',
      }),
    /requires athleteName/,
  );
});

test('lifecycle mutation event keeps unable to leave voicemail dial-only', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/tasks/complete',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    crmStage: 'Called - Unable to Leave VM',
    taskId: '9902',
    taskTitle: 'Called - Unable to Leave VM',
    taskAssignedOwner: 'Jerami Singleton',
    completedAt: '2026-05-01T15:30:00.000Z',
  });

  assert.equal(event.payload.activity_subtype, 'unable_to_leave_vm');
  assert.equal(event.payload.activity_kind, 'dial');
  assert.equal(event.payload.counts_as_dial, true);
  assert.equal(event.payload.counts_as_contact, false);
});

test('lifecycle mutation event logs spoke to too young as dial and contact', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/tasks/complete',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    crmStage: 'Spoke to - Too Young',
    taskId: '9903',
    taskTitle: 'Spoke to - Too Young',
    taskAssignedOwner: 'Jerami Singleton',
    completedAt: '2026-05-01T16:30:00.000Z',
  });

  assert.equal(event.payload.activity_subtype, 'spoke_to_too_young');
  assert.equal(event.payload.activity_kind, 'contact');
  assert.equal(event.payload.counts_as_dial, true);
  assert.equal(event.payload.counts_as_contact, true);
});

test('meeting set lifecycle mutation derives owner proof from task assignment when payload proof is absent', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/sales/meeting-set',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    crmStage: 'Meeting Set',
    taskId: '9907',
    taskTitle: 'Confirmation Call',
    taskAssignedOwner: 'Jerami Singleton',
    occurredAt: '2026-05-01T19:30:00.000Z',
    appointmentId: '613999',
  });

  assert.equal(event.eventType, 'meeting_set');
  assert.equal(event.payload.counts_as_dial, true);
  assert.equal(event.payload.counts_as_contact, true);
  assert.equal(event.payload.counts_as_meeting_set, true);
  assert.equal(event.payload.task_assigned_owner, 'Jerami Singleton');
  assert.equal(event.payload.owner_proof, 'task.assigned_owner');
  assert.equal((event.payload.owner_context as Record<string, unknown>).owner_proof, 'task.assigned_owner');
});

test('meeting set lifecycle mutation does not require confirmation task id when appointment proof exists', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/sales/meeting-set',
    athleteId: '1490881',
    athleteMainId: '952706',
    athleteName: 'Richard Hayes',
    crmStage: 'Meeting Set',
    taskTitle: 'Confirmation Call',
    taskAssignedOwner: 'Jerami Singleton',
    occurredAt: '2026-05-15T22:50:59.000Z',
    appointmentId: '611014',
    payload: {
      owner_proof: 'raycast_operator_context',
      meeting_name: 'Richard Hayes Football 2028 TX',
      materialization_status: 'operator_task',
    },
  });

  assert.equal(event.eventType, 'meeting_set');
  assert.equal(event.payload.task_id, null);
  assert.equal(event.payload.appointment_id, '611014');
  assert.equal(event.payload.counts_as_dial, true);
  assert.equal(event.payload.counts_as_contact, true);
  assert.equal(event.payload.counts_as_meeting_set, true);
  assert.equal(event.payload.owner_proof, 'raycast_operator_context');
  assert.equal(event.state.currentAppointmentId, '611014');
});

test('meeting set lifecycle mutation preserves existing owner proof mirrors while normalizing canonical fields', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/sales/meeting-set',
    athleteId: '1490499',
    athleteMainId: '952328',
    athleteName: 'Elia Imani',
    crmStage: 'Meeting Set',
    taskId: '626651',
    taskTitle: 'Confirmation Call',
    taskAssignedOwner: 'Jerami Singleton',
    occurredAt: '2026-05-04T19:00:00.000Z',
    appointmentId: '588339',
    payload: {
      owner_proof: 'raycast_operator_context',
      booked_meeting_assigned_owner: 'Ryan Lietz',
      owner_context: {
        booked_meeting_assigned_owner: 'Ryan Lietz',
        resolved_owner_name: 'Ryan Lietz',
        appointment_setter_legacy_user_id: '1354049',
      },
      materialization_proof: {
        owner_proof: 'raycast_operator_context',
      },
    },
  });

  const ownerContext = event.payload.owner_context as Record<string, unknown>;
  const materializationProof = event.payload.materialization_proof as Record<string, unknown>;
  assert.equal(event.payload.owner_proof, 'raycast_operator_context');
  assert.equal(event.payload.task_assigned_owner, 'Jerami Singleton');
  assert.equal(event.payload.booked_meeting_assigned_owner, 'Ryan Lietz');
  assert.equal(ownerContext.booked_meeting_assigned_owner, 'Ryan Lietz');
  assert.equal(ownerContext.resolved_owner_name, 'Ryan Lietz');
  assert.equal(ownerContext.appointment_setter_legacy_user_id, '1354049');
  assert.equal(materializationProof.owner_proof, 'raycast_operator_context');
  assert.equal(materializationProof.materialization_status, 'operator_task');
});

test('lifecycle mutation event rejects missing occurrence clock for countable activity', () => {
  assert.throws(
    () =>
      buildLifecycleMutationEvent({
        sourcePost: '/tasks/complete',
        athleteId: '1489000',
        athleteMainId: '951000',
        athleteName: 'Avery Jones',
        crmStage: 'Left Voice Mail 1',
        taskId: '9904',
        taskTitle: 'Call Attempt 1',
        taskAssignedOwner: 'Jerami Singleton',
      }),
    /requires completedAt, occurredAt, or dueAt/,
  );
});

test('lifecycle mutation event rejects missing raw CRM stage for countable activity', () => {
  assert.throws(
    () =>
      buildLifecycleMutationEvent({
        sourcePost: '/tasks/complete',
        athleteId: '1489000',
        athleteMainId: '951000',
        athleteName: 'Avery Jones',
        taskId: '9904',
        taskTitle: 'Call Attempt 1',
        taskAssignedOwner: 'Jerami Singleton',
        completedAt: '2026-05-01T17:30:00.000Z',
      }),
    /requires raw crmStage/,
  );
});

test('lifecycle mutation event rejects missing owner proof for countable activity', () => {
  assert.throws(
    () =>
      buildLifecycleMutationEvent({
        sourcePost: '/tasks/complete',
        athleteId: '1489000',
        athleteMainId: '951000',
        athleteName: 'Avery Jones',
        crmStage: 'Left Voice Mail 1',
        taskId: '9905',
        taskTitle: 'Call Attempt 1',
        completedAt: '2026-05-01T17:30:00.000Z',
      }),
    /requires taskAssignedOwner/,
  );
});

test('lifecycle mutation event keeps Tim-owned call activity non-materialized and non-countable', () => {
  const event = buildLifecycleMutationEvent({
    sourcePost: '/tasks/complete',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    crmStage: 'Spoke to - Too Young',
    taskId: '9906',
    taskTitle: 'Spoke to - Too Young',
    taskAssignedOwner: 'Tim Risner',
    completedAt: '2026-05-01T18:30:00.000Z',
  });

  assert.equal(event.payload.activity_subtype, 'spoke_to_too_young');
  assert.equal(event.payload.materialization_status, 'not_operator_task');
  assert.equal(event.payload.materialization_reason, 'task_assigned_owner_is_other_owner');
  assert.equal(event.payload.counts_as_dial, false);
  assert.equal(event.payload.counts_as_contact, false);
});

test('Laravel POST wrappers call the shared lifecycle mutation writer after success', () => {
  const scoutPrepSource = fs.readFileSync('src/lib/scout-prep.tsx', 'utf8');
  const salesStageSource = fs.readFileSync('src/lib/sales-stage.ts', 'utf8');

  assert.match(scoutPrepSource, /lifecycleSalesStage\(\{\s*sourcePost: '\/tasks\/complete'/);
  assert.match(scoutPrepSource, /lifecycleSalesStage\(\{\s*sourcePost: '\/tasks\/update'/);
  assert.match(scoutPrepSource, /lifecycleSalesStage\(\{\s*sourcePost: '\/tasks\/call-attempt-3-sent'/);
  assert.match(scoutPrepSource, /lifecycleSalesStage\(\{\s*sourcePost: '\/tasks\/follow-up-message-sent'/);
  assert.match(salesStageSource, /lifecycleSalesStage\(\{\s*sourcePost: '\/sales\/stage'/);
});

test('Scout Prep Supabase writes happen after the matching Laravel write succeeds', () => {
  const scoutPrepSource = fs.readFileSync('src/lib/scout-prep.tsx', 'utf8');
  const salesStageSource = fs.readFileSync('src/lib/sales-stage.ts', 'utf8');

  const taskCompletion = scoutPrepSource.slice(
    scoutPrepSource.indexOf('export async function completeScoutPrepTaskAfterVoicemail'),
    scoutPrepSource.indexOf('export async function fetchScoutTaskPopup'),
  );
  assert.ok(taskCompletion.indexOf("apiFetch('/tasks/complete'") < taskCompletion.indexOf('lifecycleSalesStage({'));
  assert.ok(taskCompletion.indexOf('if (!response.ok)') < taskCompletion.indexOf('lifecycleSalesStage({'));

  const taskUpdate = scoutPrepSource.slice(
    scoutPrepSource.indexOf('export async function updateScoutPrepTask'),
    scoutPrepSource.indexOf('export async function recordCallAttempt3MessageSent'),
  );
  assert.ok(taskUpdate.indexOf("apiFetch('/tasks/update'") < taskUpdate.indexOf('lifecycleSalesStage({'));
  assert.ok(taskUpdate.indexOf('if (!response.ok)') < taskUpdate.indexOf('lifecycleSalesStage({'));

  const callAttempt3 = scoutPrepSource.slice(
    scoutPrepSource.indexOf('export async function recordCallAttempt3MessageSent'),
    scoutPrepSource.indexOf('const FOLLOW_UP_STAGE_BY_VARIANT'),
  );
  assert.ok(callAttempt3.indexOf("apiFetch('/tasks/call-attempt-3-sent'") < callAttempt3.indexOf('lifecycleSalesStage({'));
  assert.ok(callAttempt3.indexOf('if (!response.ok)') < callAttempt3.indexOf('lifecycleSalesStage({'));

  const followUp = scoutPrepSource.slice(
    scoutPrepSource.indexOf('export async function recordVoicemailFollowUpMessageSent'),
    scoutPrepSource.indexOf('export function resolveGradeLabel'),
  );
  assert.ok(followUp.indexOf("apiFetch('/tasks/follow-up-message-sent'") < followUp.indexOf('lifecycleSalesStage({'));
  assert.ok(followUp.indexOf('if (!response.ok)') < followUp.indexOf('lifecycleSalesStage({'));

  const salesStage = salesStageSource.slice(
    salesStageSource.indexOf('export async function updateSalesStage'),
    salesStageSource.indexOf('export async function submitMeetingSet'),
  );
  assert.ok(salesStage.indexOf("apiFetch('/sales/stage'") < salesStage.indexOf('lifecycleSalesStage({'));
  assert.ok(salesStage.indexOf('if (!response.ok)') < salesStage.indexOf('lifecycleSalesStage({'));
});

test('Scout Prep voicemail follow-up persistence is shared after Messages draft handoff', () => {
  const commandSource = fs.readFileSync('src/scout-prep.tsx', 'utf8');
  const helperStart = commandSource.indexOf('async function persistVoicemailFollowUpMessageSent');
  const formStart = commandSource.indexOf('function VoicemailFollowUpRecipientForm');
  const formEnd = commandSource.indexOf('function ScoutPrepDetail');

  assert.ok(helperStart > -1, 'missing shared voicemail follow-up persistence helper');
  assert.ok(formStart > -1 && formEnd > formStart, 'missing voicemail follow-up form boundary');

  const helper = commandSource.slice(helperStart, formStart);
  assert.match(helper, /recordVoicemailFollowUpMessageSent\(\{/);
  assert.match(helper, /recordVoicemailFollowUpSentBestEffort\(\{/);

  const form = commandSource.slice(formStart, formEnd);
  const persistCallCount = (form.match(/persistVoicemailFollowUpMessageSent\(\{/g) || []).length;
  assert.equal(persistCallCount, 1);

  const draftHandoffBranch = form.slice(
    form.indexOf('const mode = await openMessagesDraftForRecipients'),
    form.indexOf('async function handleSubmit'),
  );
  assert.match(draftHandoffBranch, /persistVoicemailFollowUpMessageSent\(\{/);
  assert.ok(
    draftHandoffBranch.indexOf("selectedVariant === 'no_show'") <
      draftHandoffBranch.indexOf('completeSentTextTask({'),
  );
});

test('Scout Prep post-call success closes pushed form before refreshing command root', () => {
  const commandSource = fs.readFileSync('src/scout-prep.tsx', 'utf8');
  const helper = commandSource.slice(
    commandSource.indexOf('async function completeScoutPrepMutationSuccess'),
    commandSource.indexOf('function formatTaskIdLabel'),
  );
  const formStart = commandSource.indexOf('export function PostCallUpdateForm');
  const submitStart = commandSource.indexOf('async function handleSubmit', formStart);
  const postCallFlow = commandSource.slice(
    submitStart,
    commandSource.indexOf('return (', submitStart),
  );

  assert.match(helper, /await args\.onReturnToRootList\?\.\(\);/);
  assert.doesNotMatch(helper, /popToRoot/);
  assert.match(postCallFlow, /completeScoutPrepMutationSuccess\(\{[\s\S]*title:/);
  assert.doesNotMatch(postCallFlow, /onReturnToRootList: onSaved/);
  assert.match(postCallFlow, /await popViewsThenRefreshRoot\(pop, closeAfterSaveViews, onSaved\);/);
});

test('Scout Prep task rows expose MaxPreps actions from the action panel', () => {
  const commandSource = fs.readFileSync('src/scout-prep.tsx', 'utf8');
  const taskItemStart = commandSource.indexOf('function ScoutPrepTaskItem');
  const taskItemEnd = commandSource.indexOf('export default function ScoutPrepCommand', taskItemStart);
  const taskItem = commandSource.slice(taskItemStart, taskItemEnd);
  const athleteInfo = taskItem.slice(
    taskItem.indexOf('<ActionPanel.Section title="Athlete Info">'),
    taskItem.indexOf('<ActionPanel.Section title="Athlete Note">'),
  );

  assert.match(athleteInfo, /title="Open MaxPreps Search"/);
  assert.match(athleteInfo, /shortcut=\{\{ modifiers: \['cmd'\], key: 'h' \}\}/);
  assert.match(athleteInfo, /title="Resolve MaxPreps Context"/);
  assert.match(athleteInfo, /shortcut=\{\{ modifiers: \['cmd', 'shift'\], key: 'r' \}\}/);
});

test('Set Meetings reschedule actions pass the booked meeting into Scout Prep post-call form', () => {
  const source = fs.readFileSync('src/head-scout-schedules.tsx', 'utf8');
  const actionPanel = source.slice(
    source.indexOf('title="Reschedule Pending"'),
    source.indexOf('<ActionPanel.Section title="Navigation">'),
  );

  assert.match(actionPanel, /initialStageLabel="Meeting Result - Res\. Pending"[\s\S]*initialBookedMeeting=\{candidate\.bookedMeeting\}/);
  assert.match(actionPanel, /initialStageLabel="Meeting Result - Rescheduled"[\s\S]*initialBookedMeeting=\{candidate\.bookedMeeting\}/);
  assert.match(source, /prefix === '\(RSP\)'[\s\S]*'Meeting Result - Res\. Pending'/);
  assert.match(source, /prefix === '\(CAN\)'[\s\S]*'Meeting Result - Canceled'/);
  assert.match(source, /title: result\.updated_title \|\| meeting\.title/);
});

test('Set Meetings prefix actions use command Y U H J N shortcuts', () => {
  const source = fs.readFileSync('src/head-scout-schedules.tsx', 'utf8');
  assert.match(source, /APPOINTMENT_SHORTCUT_KEYS: readonly KeyEquivalent\[\] = \['y', 'u', 'h', 'j', 'n'\]/);
  assert.match(source, /modifiers: \['cmd'\], key: APPOINTMENT_SHORTCUT_KEYS\[index\]/);
  assert.doesNotMatch(source, /modifiers: \['opt'\], key: APPOINTMENT_SHORTCUT_KEYS\[index\]/);
});

test('Scout Prep Reschedule Pending fast path conditionally updates stage plus two Notes-tab writes', () => {
  const commandSource = fs.readFileSync('src/scout-prep.tsx', 'utf8');
  const handleSubmit = commandSource.slice(
    commandSource.indexOf('async function handleSubmit'),
    commandSource.indexOf('let taskCompletionMessage'),
  );
  const rescheduleFastPath = handleSubmit.slice(
    handleSubmit.indexOf(
      'if (isReschedulePendingUpdate) {',
      handleSubmit.indexOf("throw new Error('Missing saved meeting description for CAN And Scout Notes');"),
    ),
    handleSubmit.indexOf('let meetingSetResult'),
  );

  assert.match(commandSource, /id="reschedulePendingNoteTitle"/);
  assert.match(commandSource, /id="reschedulePendingNoteDescription"/);
  assert.doesNotMatch(commandSource, /Saves the official sales stage through the captured legacy endpoint/);
  assert.doesNotMatch(commandSource, /Reschedule Pending writes the stage update/);
  assert.doesNotMatch(commandSource, /Add the title and description reason/);
  assert.match(handleSubmit, /cacheMeetingDescriptionForReschedulePending\(\{/);
  assert.match(handleSubmit, /isReschedulePendingStage\(stageLabel\)/);
  assert.match(handleSubmit, /requiresPostMeetingOperatorNote/);
  assert.match(rescheduleFastPath, /if \(!isReschedulePendingStage\(selectedCurrentStageLabel\)\)/);
  assert.match(rescheduleFastPath, /await updateSalesStage\(\{/);
  assert.match(rescheduleFastPath, /title: getPostMeetingScoutNotesTitle\(stageLabel\)/);
  assert.match(commandSource, /CAN And Scout Notes/);
  assert.match(rescheduleFastPath, /await addAthleteNote\(\{\s*athleteId,\s*athleteMainId,\s*title: reschedulePendingOperatorNoteTitle/s);
  assert.ok(
    rescheduleFastPath.indexOf('await updateSalesStage({') <
      rescheduleFastPath.indexOf('title: getPostMeetingScoutNotesTitle(stageLabel)'),
  );
  assert.match(rescheduleFastPath, /await popViewsThenRefreshRoot\(pop, closeAfterSaveViews, onSaved\);[\s\S]*return;/);
});

test('Scout Prep meeting-set Supabase writes happen after Laravel meeting creation and stage save', () => {
  const commandSource = fs.readFileSync('src/scout-prep.tsx', 'utf8');
  const postCallFlow = commandSource.slice(
    commandSource.indexOf('async function handleSubmit'),
    commandSource.indexOf('let taskCompletionMessage'),
  );

  assert.ok(postCallFlow.indexOf('submitMeetingSet(initialPlan.laravelMeetingSetSubmit)') > -1);
  assert.ok(postCallFlow.indexOf('updateSalesStage({') > -1);
  assert.ok(postCallFlow.indexOf('recordMeetingSet(actionPlan.supabaseLifecycleWrite.args)') > -1);
  assert.ok(postCallFlow.indexOf('syncMeetingSetConfirmationCacheFromScoutPrep({') > -1);
  assert.ok(
    postCallFlow.indexOf('submitMeetingSet(initialPlan.laravelMeetingSetSubmit)') <
      postCallFlow.indexOf('recordMeetingSet(actionPlan.supabaseLifecycleWrite.args)'),
  );
  assert.ok(
    postCallFlow.indexOf('updateSalesStage({') <
      postCallFlow.indexOf('recordMeetingSet(actionPlan.supabaseLifecycleWrite.args)'),
  );
  assert.ok(
    postCallFlow.indexOf('recordMeetingSet(actionPlan.supabaseLifecycleWrite.args)') <
      postCallFlow.indexOf('syncMeetingSetConfirmationCacheFromScoutPrep({'),
  );
  const confirmationCacheCatch = postCallFlow.slice(
    postCallFlow.indexOf("logFailure(\n            'SCOUT_PREP_SET_MEETING_REMINDER_CACHE_SYNC'"),
    postCallFlow.indexOf('if (rescheduleMeetingPayload && rescheduleMeetingResult)'),
  );
  assert.doesNotMatch(confirmationCacheCatch, /throw error;/);
});

test('task completion wrapper never promotes a task title into raw CRM stage', () => {
  const scoutPrepSource = fs.readFileSync('src/lib/scout-prep.tsx', 'utf8');

  assert.doesNotMatch(scoutPrepSource, /crmStage:\s*args\.crmStage\s*\|\|\s*args\.taskTitle/);
  assert.match(scoutPrepSource, /crmStage:\s*args\.crmStage\s*\|\|\s*null/);
  assert.match(
    scoutPrepSource,
    /activitySubtype:\s*args\.crmStage\s*\?\s*undefined\s*:\s*'needs_manual_review'/,
  );
});

test('shared lifecycle mutation writer upserts call activity facts at action time', () => {
  const source = fs.readFileSync('src/lib/supabase-lifecycle.ts', 'utf8');

  assert.match(source, /supabase-lifecycle-translator/);
  assert.match(source, /taskStatusForStage\(args\.crmStage, args\.taskStatus\)/);
  assert.match(source, /buildCallActivityFact/);
  assert.match(source, /buildCallLogFactFromCallActivityFact/);
  assert.match(source, /request\(config, 'call_log'/);
  assert.match(source, /onConflict: 'dedupe_key'/);
  assert.match(source, /rawCrmStage: event\.state\.crmStage/);
  assert.match(source, /rawTaskStatus: event\.state\.taskStatus/);
});

test('recordMeetingSet writes canonical call_log fact with action-time reporting clock', () => {
  const source = fs.readFileSync('src/lib/supabase-lifecycle.ts', 'utf8');
  const recordMeetingSetSource = source.slice(
    source.indexOf('export async function recordMeetingSet'),
    source.indexOf('export async function recordConfirmationQueued'),
  );

  assert.match(recordMeetingSetSource, /const recordedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(recordMeetingSetSource, /dedupeKey = `meeting_set:\$\{buildAthleteKey/);
  assert.match(recordMeetingSetSource, /occurredAt: recordedAt/);
  assert.match(recordMeetingSetSource, /occurred_at: recordedAt/);
  assert.match(recordMeetingSetSource, /buildCallLogFactFromMeetingSetFact/);
  assert.match(recordMeetingSetSource, /request\(config, 'call_log'/);
  assert.doesNotMatch(recordMeetingSetSource, /occurredAt: args\.startsAt/);
});

test('sales stage wrapper does not let generic lifecycle sync block Meeting Set task completion', () => {
  const salesStageSource = fs.readFileSync('src/lib/sales-stage.ts', 'utf8');

  assert.match(salesStageSource, /classifyMeetingSetStage\(resolvedStage\)/);
  assert.match(salesStageSource, /SALES_STAGE_LIFECYCLE_SYNC/);
  assert.match(salesStageSource, /catch \(error\)/);
});

test('Laravel POST wrappers do not hand-build lifecycle mutation payload keys', () => {
  const scoutPrepSource = fs.readFileSync('src/lib/scout-prep.tsx', 'utf8');
  const salesStageSource = fs.readFileSync('src/lib/sales-stage.ts', 'utf8');
  const forbiddenKeys = [
    'source_post',
    'activity_subtype',
    'owner_proof',
    'materialization_status',
    'materialization_reason',
  ];

  for (const key of forbiddenKeys) {
    assert.doesNotMatch(scoutPrepSource, new RegExp(`${key}\\s*:`));
    assert.doesNotMatch(salesStageSource, new RegExp(`${key}\\s*:`));
  }
});
