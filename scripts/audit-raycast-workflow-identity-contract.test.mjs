import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RAYCAST_WORKFLOW_IDENTITY_CONTRACTS,
  auditRaycastWorkflowIdentityFiles,
  auditRaycastWorkflowIdentityText,
} from './audit-raycast-workflow-identity-contract.mjs';

const repoRoot = process.cwd();

test('confirmed reschedule identity contract maps action bucket and canonical ids', () => {
  const contract = RAYCAST_WORKFLOW_IDENTITY_CONTRACTS.find(
    (candidate) => candidate.id === 'scout-prep.confirmed-reschedule.previous-appointment',
  );

  assert.equal(contract?.bucket, 'Meetings');
  assert.deepEqual(contract?.canonicalIds, [
    {
      name: 'previousAppointmentId',
      adapterFields: ['previous_event_id', 'previous_appointment_id'],
      allowedDerivers: ['src/domain/appointment-truth.ts'],
    },
  ]);
});

test('meeting set identity contract maps action bucket and canonical ids', () => {
  const contract = RAYCAST_WORKFLOW_IDENTITY_CONTRACTS.find(
    (candidate) => candidate.id === 'scout-prep.meeting-set.appointment',
  );

  assert.equal(contract?.bucket, 'Meetings');
  assert.deepEqual(contract?.canonicalIds, [
    {
      name: 'appointmentId',
      adapterFields: ['open_event_id', 'appointmentId', 'sourceEventId'],
      allowedDerivers: [
        'src/domain/post-call-action.ts',
        'src/domain/meeting-set-contract.ts',
        'src/lib/set-meeting-confirmation-cache-sync.ts',
      ],
    },
  ]);
});

test('post-call task completion contract maps action bucket and canonical ids', () => {
  const contract = RAYCAST_WORKFLOW_IDENTITY_CONTRACTS.find(
    (candidate) => candidate.id === 'scout-prep.post-call-update.task-completion',
  );

  assert.equal(contract?.bucket, 'Pre-Meeting Tasks');
  assert.deepEqual(contract?.canonicalIds, [
    {
      name: 'taskId',
      adapterFields: ['task_id', 'taskId'],
      allowedDerivers: [
        'src/domain/scout-task-selection.ts',
        'src/domain/post-call-action.ts',
        'src/lib/scout-prep-task-completion.ts',
      ],
    },
  ]);
});

test('contact cache identity contract maps action bucket and canonical ids', () => {
  const contract = RAYCAST_WORKFLOW_IDENTITY_CONTRACTS.find(
    (candidate) => candidate.id === 'scout-prep.contact-cache.identity',
  );

  assert.equal(contract?.bucket, 'Admin Data & Contacts');
  assert.deepEqual(contract?.canonicalIds, [
    {
      name: 'athleteContactIdentity',
      adapterFields: ['athlete_id', 'athlete_main_id', 'contact_id'],
      allowedDerivers: [
        'src/lib/scout-prep.tsx',
        'src/domain/athlete-contact-cache.ts',
        'src/lib/athlete-contact-cache.ts',
      ],
    },
  ]);
});

test('head scout confirmation identity contract maps action bucket and canonical ids', () => {
  const contract = RAYCAST_WORKFLOW_IDENTITY_CONTRACTS.find(
    (candidate) => candidate.id === 'head-scout.confirmation.appointment',
  );

  assert.equal(contract?.bucket, 'Meetings');
  assert.equal(contract?.file, 'src/head-scout-schedules.tsx');
  assert.deepEqual(contract?.canonicalIds, [
    {
      name: 'appointmentId',
      adapterFields: ['eventId', 'appointmentId', 'appointment_id'],
      allowedDerivers: [
        'src/domain/set-meetings-candidate.ts',
        'src/lib/head-scout-schedules.ts',
      ],
    },
  ]);
});

test('client messages task identity contracts map buckets and canonical ids', () => {
  const exportContract = RAYCAST_WORKFLOW_IDENTITY_CONTRACTS.find(
    (candidate) => candidate.id === 'client-messages.export.current-task-id',
  );
  const completionContract = RAYCAST_WORKFLOW_IDENTITY_CONTRACTS.find(
    (candidate) => candidate.id === 'client-messages.send.task-completion',
  );

  assert.equal(exportContract?.bucket, 'Client Communication');
  assert.deepEqual(exportContract?.canonicalIds, [
    {
      name: 'currentTaskId',
      adapterFields: ['currentTaskId', 'task_id', 'taskId'],
      allowedDerivers: [
        'src/lib/supabase-lifecycle.ts',
        'src/lib/client-message-export.ts',
      ],
    },
  ]);
  assert.equal(completionContract?.bucket, 'Client Communication, Pre-Meeting Tasks');
  assert.deepEqual(completionContract?.canonicalIds, [
    {
      name: 'currentTaskId',
      adapterFields: ['taskId', 'task_id'],
      allowedDerivers: [
        'src/lib/supabase-lifecycle.ts',
        'src/lib/client-message-export.ts',
        'src/lib/client-message-sandbox.ts',
        'src/lib/scout-prep-task-completion.ts',
      ],
    },
  ]);
});

test('head scout prefix outcome and pending client contracts map buckets and canonical ids', () => {
  const prefixContract = RAYCAST_WORKFLOW_IDENTITY_CONTRACTS.find(
    (candidate) => candidate.id === 'head-scout.prefix-outcome-stage',
  );
  const pendingContract = RAYCAST_WORKFLOW_IDENTITY_CONTRACTS.find(
    (candidate) => candidate.id === 'pending-clients.watchlist.source-event-identity',
  );

  assert.equal(prefixContract?.bucket, 'Meetings, Enrollments & Outcomes, Lifecycle & Stage Truth');
  assert.deepEqual(prefixContract?.canonicalIds, [
    {
      name: 'postCallStage',
      adapterFields: ['initialStageLabel'],
      allowedDerivers: ['src/domain/sales-stage-contract.ts'],
    },
  ]);
  assert.equal(pendingContract?.bucket, 'Enrollments & Outcomes');
  assert.deepEqual(pendingContract?.canonicalIds, [
    {
      name: 'sourceEventId',
      adapterFields: ['source_event_id', 'sourceEventId'],
      allowedDerivers: [
        'src/domain/pending-client-watchlist.ts',
        'src/lib/pending-client-watchlist.ts',
      ],
    },
  ]);
});

test('batch stage completion contract maps action bucket and canonical ids', () => {
  const contract = RAYCAST_WORKFLOW_IDENTITY_CONTRACTS.find(
    (candidate) => candidate.id === 'scout-prep.batch-stage-completion.action-plan',
  );

  assert.equal(contract?.bucket, 'Lifecycle & Stage Truth, Pre-Meeting Tasks');
  assert.deepEqual(contract?.canonicalIds, [
    {
      name: 'taskId',
      adapterFields: ['task_id', 'taskId'],
      allowedDerivers: [
        'src/domain/post-call-action.ts',
        'src/domain/scout-task-selection.ts',
        'src/lib/scout-prep-task-completion.ts',
      ],
    },
  ]);
});

test('current Scout Prep confirmed reschedule uses one canonical previous appointment identity', () => {
  const source = readFileSync(join(repoRoot, 'src/scout-prep.tsx'), 'utf8');
  const findings = auditRaycastWorkflowIdentityText({
    relativePath: 'src/scout-prep.tsx',
    source,
  });

  assert.deepEqual(findings, []);
});

test('current Raycast workflow identity contracts pass for all mapped files', () => {
  assert.deepEqual(auditRaycastWorkflowIdentityFiles({ repoRoot }), []);
});

test('audit flags UI-local Meeting Set appointment identity split from the action plan', () => {
  const source = `
    await syncAthleteContactCacheFromScoutPrepContext({
      context: activeContext,
    });
    const rescheduleAppointmentIdentity = resolveConfirmedRescheduleAppointmentIdentity({});
    const reschedulePayload = {
      previous_event_id: rescheduleAppointmentIdentity.previousEventId,
    };
    await recordRescheduled({
      previousAppointmentId: rescheduleAppointmentIdentity.previousAppointmentId,
      payload: {
        previous_appointment_id: rescheduleAppointmentIdentity.previousAppointmentId,
      },
    });
    const payload = { open_event_id: openEventId };
    await submitMeetingSet(payload);
    await recordMeetingSet({
      appointmentId: openEventId,
      sourceEventId: openEventId,
    });
    await syncMeetingSetConfirmationCacheFromScoutPrep({
      meetingSet: { openEventId },
      meetingSetResult: { open_event_id: otherOpenEventId },
    });
  `;

  const findings = auditRaycastWorkflowIdentityText({
    relativePath: 'src/scout-prep.tsx',
    source,
  });

  assert.deepEqual(
    findings.map((finding) => finding.ruleId),
    [
      'missing-meeting-set-initial-plan',
      'missing-meeting-set-submit-from-plan',
      'missing-meeting-set-action-plan',
      'missing-meeting-set-record-from-plan',
      'missing-meeting-set-cache-sync',
      'ui-local-meeting-set-appointment-derivation',
      'ui-local-meeting-set-appointment-derivation',
      'missing-post-call-task-completion-plan',
      'missing-post-call-task-id-from-plan',
      'missing-post-call-crm-stage-from-plan',
      'missing-batch-post-call-action-plan',
      'missing-batch-task-id-from-plan',
      'missing-batch-crm-stage-from-plan',
    ],
  );
});

test('audit flags UI-local Post-Call task completion identity and stage coupling', () => {
  const source = `
    await syncAthleteContactCacheFromScoutPrepContext({
      context: activeContext,
    });
    const rescheduleAppointmentIdentity = resolveConfirmedRescheduleAppointmentIdentity({});
    const reschedulePayload = {
      previous_event_id: rescheduleAppointmentIdentity.previousEventId,
    };
    await recordRescheduled({
      previousAppointmentId: rescheduleAppointmentIdentity.previousAppointmentId,
      payload: {
        previous_appointment_id: rescheduleAppointmentIdentity.previousAppointmentId,
      },
    });
    const initialPlan = buildPostCallActionPlan({});
    await submitMeetingSet(initialPlan.laravelMeetingSetSubmit);
    const actionPlan = buildPostCallActionPlan({ meetingSetResult });
    await recordMeetingSet(actionPlan.supabaseLifecycleWrite.args);
    await syncMeetingSetConfirmationCacheFromScoutPrep({
      meetingSet: { openEventId: meetingSetInput.openEventId },
    });
    await completeScoutPrepTaskAfterVoicemail({
      taskId: selectedTask.task_id,
      crmStage: stageLabel,
    });
  `;

  const findings = auditRaycastWorkflowIdentityText({
    relativePath: 'src/scout-prep.tsx',
    source,
  });

  assert.deepEqual(
    findings.map((finding) => finding.ruleId),
    [
      'missing-post-call-task-completion-plan',
      'missing-post-call-task-id-from-plan',
      'missing-post-call-crm-stage-from-plan',
      'ui-local-post-call-task-completion-derivation',
      'missing-batch-post-call-action-plan',
      'missing-batch-task-id-from-plan',
      'missing-batch-crm-stage-from-plan',
    ],
  );
});

test('audit flags split Laravel and Supabase previous appointment derivation in UI code', () => {
  const source = `
    await syncAthleteContactCacheFromScoutPrepContext({
      context: activeContext,
    });
    const taskCompletion = actionPlan.laravelTaskCompletion;
    await completeScoutPrepTaskAfterVoicemail({
      taskId: taskCompletion.taskId,
      crmStage: taskCompletion.crmStage,
    });
    const initialPlan = buildPostCallActionPlan({});
    await submitMeetingSet(initialPlan.laravelMeetingSetSubmit);
    const actionPlan = buildPostCallActionPlan({ meetingSetResult });
    await recordMeetingSet(actionPlan.supabaseLifecycleWrite.args);
    await syncMeetingSetConfirmationCacheFromScoutPrep({
      meetingSet: { openEventId: meetingSetInput.openEventId },
    });
    rescheduleMeetingPayload = {
      previous_event_id: initialBookedMeeting?.event_id || currentBookedMeeting?.event_id || '',
    };
    await recordRescheduled({
      previousAppointmentId: initialBookedMeeting?.event_id || null,
      payload: {
        previous_appointment_id: initialBookedMeeting?.event_id || null,
      },
    });
  `;

  const findings = auditRaycastWorkflowIdentityText({
    relativePath: 'src/scout-prep.tsx',
    source,
  });

  assert.deepEqual(
    findings.map((finding) => finding.ruleId),
    [
      'missing-required-resolver',
      'missing-laravel-previous-event-id',
      'missing-supabase-previous-appointment-id',
      'missing-supabase-payload-previous-appointment-id',
      'ui-local-previous-appointment-derivation',
      'ui-local-previous-appointment-derivation',
      'ui-local-previous-appointment-derivation',
      'missing-batch-post-call-action-plan',
      'missing-batch-task-id-from-plan',
      'missing-batch-crm-stage-from-plan',
    ],
  );
});

test('audit flags UI-local contact-cache durable identity assembly', () => {
  const source = `
    const rescheduleAppointmentIdentity = resolveConfirmedRescheduleAppointmentIdentity({});
    const reschedulePayload = {
      previous_event_id: rescheduleAppointmentIdentity.previousEventId,
    };
    await recordRescheduled({
      previousAppointmentId: rescheduleAppointmentIdentity.previousAppointmentId,
      payload: {
        previous_appointment_id: rescheduleAppointmentIdentity.previousAppointmentId,
      },
    });
    const initialPlan = buildPostCallActionPlan({});
    await submitMeetingSet(initialPlan.laravelMeetingSetSubmit);
    const actionPlan = buildPostCallActionPlan({ meetingSetResult });
    await recordMeetingSet(actionPlan.supabaseLifecycleWrite.args);
    await syncMeetingSetConfirmationCacheFromScoutPrep({
      meetingSet: { openEventId: meetingSetInput.openEventId },
    });
    const taskCompletion = actionPlan.laravelTaskCompletion;
    await completeScoutPrepTaskAfterVoicemail({
      taskId: taskCompletion.taskId,
      crmStage: taskCompletion.crmStage,
    });
    await upsertAthleteContactCacheRows(config, [{
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
      contact_id: contactId,
    }]);
  `;

  const findings = auditRaycastWorkflowIdentityText({
    relativePath: 'src/scout-prep.tsx',
    source,
  });

  assert.deepEqual(
    findings.map((finding) => finding.ruleId),
    [
      'missing-contact-cache-context-sync',
      'ui-local-contact-cache-identity-derivation',
      'missing-batch-post-call-action-plan',
      'missing-batch-task-id-from-plan',
      'missing-batch-crm-stage-from-plan',
    ],
  );
});

test('audit flags split Head Scout confirmation appointment identity', () => {
  const source = `
    async function markConfirmationAppointmentPrefix(candidate, variant) {
      await updateBookedMeetingTitlePrefix({
        eventId: candidate.bookedMeeting.event_id,
      });
    }
    async function sendConfirmationText(candidate, variant) {
      const cached = await readCachedSetMeetingConfirmation({
        appointmentId: row.source_event_id,
        variant,
      });
    }
  `;

  const findings = auditRaycastWorkflowIdentityText({
    relativePath: 'src/head-scout-schedules.tsx',
    source,
  });

  assert.deepEqual(
    findings.map((finding) => finding.ruleId),
    [
      'missing-head-scout-candidate-identity-key',
      'missing-head-scout-cache-read-from-booked-meeting',
      'ui-local-head-scout-confirmation-appointment-derivation',
      'missing-prefix-stage-domain-helper',
      'missing-pending-client-resolve-helper',
      'missing-pending-client-row-source-event-id',
    ],
  );
});

test('audit flags Client Messages completion without canonical currentTaskId', () => {
  const source = `
    await completeScoutPrepTaskAfterVoicemail({
      athleteId,
      athleteMainId,
      crmStage: chat.clientMatch.crmStage || null,
      taskTitle,
    });
  `;

  const findings = auditRaycastWorkflowIdentityText({
    relativePath: 'src/client-message-inbox.tsx',
    source,
  });

  assert.deepEqual(
    findings.map((finding) => finding.ruleId),
    ['missing-client-message-task-id-from-match'],
  );
});

test('audit flags Client Messages export without canonical currentTaskId', () => {
  const source = `
    export type PipelineClientExportRow = {
      currentTaskTitle: string | null;
    };
    return {
      currentTaskTitle: row.currentTaskTitle || row.taskStatus || null,
    };
  `;

  const findings = auditRaycastWorkflowIdentityText({
    relativePath: 'src/lib/client-message-export.ts',
    source,
  });

  assert.deepEqual(
    findings.map((finding) => finding.ruleId),
    [
      'missing-client-message-export-current-task-id-field',
      'missing-client-message-client-current-task-id',
      'missing-client-message-pending-current-task-id',
    ],
  );
});

test('audit flags Head Scout inline prefix-to-stage mapping', () => {
  const source = `
    function buildSetMeetingCandidateIdentityKey(candidate) {}
    await updateBookedMeetingTitlePrefix({ eventId: candidate.bookedMeeting.event_id });
    await readCachedSetMeetingConfirmation({ appointmentId: candidate.bookedMeeting?.event_id });
    const followUpStage =
      prefix === '(RSP)'
        ? 'Meeting Result - Res. Pending'
        : prefix === '(CAN)'
          ? 'Meeting Result - Canceled'
          : null;
    await markPendingClientResolved(sourceEventId);
    await handleMarkResolved(row.source_event_id);
  `;

  const findings = auditRaycastWorkflowIdentityText({
    relativePath: 'src/head-scout-schedules.tsx',
    source,
  });

  assert.deepEqual(
    findings.map((finding) => finding.ruleId),
    [
      'missing-prefix-stage-domain-helper',
      'ui-local-prefix-stage-derivation',
    ],
  );
});

test('audit flags batch stage completion that bypasses the post-call action plan', () => {
  const source = `
    const rescheduleAppointmentIdentity = resolveConfirmedRescheduleAppointmentIdentity({});
    const reschedulePayload = {
      previous_event_id: rescheduleAppointmentIdentity.previousEventId,
    };
    await recordRescheduled({
      previousAppointmentId: rescheduleAppointmentIdentity.previousAppointmentId,
      payload: { previous_appointment_id: rescheduleAppointmentIdentity.previousAppointmentId },
    });
    const initialPlan = buildPostCallActionPlan({});
    await submitMeetingSet(initialPlan.laravelMeetingSetSubmit);
    const actionPlan = buildPostCallActionPlan({ meetingSetResult });
    await recordMeetingSet(actionPlan.supabaseLifecycleWrite.args);
    await syncMeetingSetConfirmationCacheFromScoutPrep({
      meetingSet: { openEventId: meetingSetInput.openEventId },
    });
    const taskCompletion = actionPlan.laravelTaskCompletion;
    await completeScoutPrepTaskAfterVoicemail({
      taskId: taskCompletion.taskId,
      crmStage: taskCompletion.crmStage,
    });
    await syncAthleteContactCacheFromScoutPrepContext({ context: activeContext });
    function runScoutPrepStageCompletionBatchRow(args) {
      await completeScoutPrepTaskAfterVoicemail({
        taskId: args.row.task.task_id,
        crmStage: args.stageLabel,
      });
    }
  `;

  const findings = auditRaycastWorkflowIdentityText({
    relativePath: 'src/scout-prep.tsx',
    source,
  });

  assert.deepEqual(
    findings.map((finding) => finding.ruleId),
    [
      'missing-batch-post-call-action-plan',
      'missing-batch-task-id-from-plan',
      'missing-batch-crm-stage-from-plan',
    ],
  );
});
