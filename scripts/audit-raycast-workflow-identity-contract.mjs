#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export const RAYCAST_WORKFLOW_IDENTITY_CONTRACTS = [
  {
    id: 'scout-prep.confirmed-reschedule.previous-appointment',
    action: 'Scout Prep / Post-Call Update / Meeting Result - Rescheduled',
    bucket: 'Meetings',
    file: 'src/scout-prep.tsx',
    canonicalIds: [
      {
        name: 'previousAppointmentId',
        adapterFields: ['previous_event_id', 'previous_appointment_id'],
        allowedDerivers: ['src/domain/appointment-truth.ts'],
      },
    ],
    requiredPatterns: [
      {
        ruleId: 'missing-required-resolver',
        pattern: /resolveConfirmedRescheduleAppointmentIdentity/u,
        message:
          'Confirmed reschedule must resolve previous appointment identity through the Meetings-owned appointment truth domain.',
      },
      {
        ruleId: 'missing-laravel-previous-event-id',
        pattern: /previous_event_id:\s*rescheduleAppointmentIdentity\.previousEventId/u,
        message:
          'Laravel previous_event_id must be mapped from the resolved confirmed-reschedule identity.',
      },
      {
        ruleId: 'missing-supabase-previous-appointment-id',
        pattern:
          /previousAppointmentId:\s*rescheduleAppointmentIdentity\.previousAppointmentId/u,
        message:
          'Supabase recordRescheduled previousAppointmentId must use the same resolved confirmed-reschedule identity.',
      },
      {
        ruleId: 'missing-supabase-payload-previous-appointment-id',
        pattern:
          /previous_appointment_id:\s*rescheduleAppointmentIdentity\.previousAppointmentId/u,
        message:
          'Supabase previous_appointment_id payload must use the same resolved confirmed-reschedule identity.',
      },
    ],
    forbiddenPatterns: [
      {
        ruleId: 'ui-local-previous-appointment-derivation',
        pattern: /previous_event_id:\s*initialBookedMeeting\?\.event_id[\s\S]*?(?:,|\n)/u,
        message:
          'UI code must not derive Laravel previous_event_id directly from booked meeting fields.',
      },
      {
        ruleId: 'ui-local-previous-appointment-derivation',
        pattern: /previousAppointmentId:\s*initialBookedMeeting\?\.event_id[\s\S]*?(?:,|\n)/u,
        message:
          'UI code must not derive Supabase previousAppointmentId directly from booked meeting fields.',
      },
      {
        ruleId: 'ui-local-previous-appointment-derivation',
        pattern: /previous_appointment_id:\s*initialBookedMeeting\?\.event_id[\s\S]*?(?:,|\n)/u,
        message:
          'UI code must not derive Supabase previous_appointment_id payload directly from booked meeting fields.',
      },
    ],
  },
  {
    id: 'scout-prep.meeting-set.appointment',
    action: 'Scout Prep / Post-Call Update / Meeting Set',
    bucket: 'Meetings',
    file: 'src/scout-prep.tsx',
    canonicalIds: [
      {
        name: 'appointmentId',
        adapterFields: ['open_event_id', 'appointmentId', 'sourceEventId'],
        allowedDerivers: [
          'src/domain/post-call-action.ts',
          'src/domain/meeting-set-contract.ts',
          'src/lib/set-meeting-confirmation-cache-sync.ts',
        ],
      },
    ],
    requiredPatterns: [
      {
        ruleId: 'missing-meeting-set-initial-plan',
        pattern: /const\s+initialPlan\s*=\s*buildPostCallActionPlan\(/u,
        message: 'Meeting Set must build the Laravel submit payload through the post-call action plan.',
      },
      {
        ruleId: 'missing-meeting-set-submit-from-plan',
        pattern: /submitMeetingSet\(initialPlan\.laravelMeetingSetSubmit\)/u,
        message: 'Meeting Set Laravel submit must use the action-plan payload.',
      },
      {
        ruleId: 'missing-meeting-set-action-plan',
        pattern: /const\s+actionPlan\s*=\s*buildPostCallActionPlan\([\s\S]*?meetingSetResult/u,
        message: 'Meeting Set Supabase writes must be built from the action plan after Laravel submit.',
      },
      {
        ruleId: 'missing-meeting-set-record-from-plan',
        pattern: /recordMeetingSet\(actionPlan\.supabaseLifecycleWrite\.args\)/u,
        message: 'Meeting Set Supabase lifecycle write must use the action-plan args.',
      },
      {
        ruleId: 'missing-meeting-set-cache-sync',
        pattern:
          /syncMeetingSetConfirmationCacheFromScoutPrep\([\s\S]*?openEventId:\s*meetingSetInput\.openEventId/u,
        message: 'Meeting Set confirmation-cache sync must carry the action-plan meetingSet openEventId.',
      },
    ],
    forbiddenPatterns: [
      {
        ruleId: 'ui-local-meeting-set-appointment-derivation',
        pattern:
          /recordMeetingSet\(\{[\s\S]*?appointmentId:\s*(?:openEventId|meetingSetInput\.openEventId)[\s\S]*?\}\)/u,
        message: 'UI code must not derive Meeting Set Supabase appointmentId outside the action plan.',
      },
      {
        ruleId: 'ui-local-meeting-set-appointment-derivation',
        pattern:
          /recordMeetingSet\(\{[\s\S]*?sourceEventId:\s*(?:openEventId|meetingSetInput\.openEventId)[\s\S]*?\}\)/u,
        message: 'UI code must not derive Meeting Set Supabase sourceEventId outside the action plan.',
      },
    ],
  },
  {
    id: 'scout-prep.post-call-update.task-completion',
    action: 'Scout Prep / Post-Call Update / task completion',
    bucket: 'Pre-Meeting Tasks',
    file: 'src/scout-prep.tsx',
    canonicalIds: [
      {
        name: 'taskId',
        adapterFields: ['task_id', 'taskId'],
        allowedDerivers: [
          'src/domain/scout-task-selection.ts',
          'src/domain/post-call-action.ts',
          'src/lib/scout-prep-task-completion.ts',
        ],
      },
    ],
    requiredPatterns: [
      {
        ruleId: 'missing-post-call-task-completion-plan',
        pattern: /const\s+taskCompletion\s*=\s*actionPlan\.laravelTaskCompletion/u,
        message: 'Post-Call Update task completion must use the action-plan task selection.',
      },
      {
        ruleId: 'missing-post-call-task-id-from-plan',
        pattern: /taskId:\s*taskCompletion\.taskId/u,
        message: 'Post-Call Update taskId must come from the action-plan task completion.',
      },
      {
        ruleId: 'missing-post-call-crm-stage-from-plan',
        pattern: /crmStage:\s*taskCompletion\.crmStage/u,
        message: 'Post-Call Update crmStage must come from the action-plan task completion.',
      },
    ],
    forbiddenPatterns: [
      {
        ruleId: 'ui-local-post-call-task-completion-derivation',
        pattern:
          /completeScoutPrepTaskAfterVoicemail\(\{[\s\S]*?taskId:\s*(?:selectedTask|matchedTask|task)\.task_id[\s\S]*?crmStage:\s*(?:stageLabel|selectedStageLabel|args\.stageLabel)/u,
        message:
          'Post-Call Update must not couple a UI-selected task_id directly to the selected crmStage.',
      },
    ],
  },
  {
    id: 'scout-prep.contact-cache.identity',
    action: 'Scout Prep / contact-cache sync',
    bucket: 'Admin Data & Contacts',
    file: 'src/scout-prep.tsx',
    canonicalIds: [
      {
        name: 'athleteContactIdentity',
        adapterFields: ['athlete_id', 'athlete_main_id', 'contact_id'],
        allowedDerivers: [
          'src/lib/scout-prep.tsx',
          'src/domain/athlete-contact-cache.ts',
          'src/lib/athlete-contact-cache.ts',
        ],
      },
    ],
    requiredPatterns: [
      {
        ruleId: 'missing-contact-cache-context-sync',
        pattern: /syncAthleteContactCacheFromScoutPrepContext\(\{\s*context:/u,
        message:
          'Scout Prep contact-cache writes must pass ScoutPrepContext to the contact-cache sync helper.',
      },
    ],
    forbiddenPatterns: [
      {
        ruleId: 'ui-local-contact-cache-identity-derivation',
        pattern:
          /upsertAthleteContactCacheRows\([\s\S]*?athlete_id:\s*athleteId[\s\S]*?athlete_main_id:\s*athleteMainId[\s\S]*?contact_id:\s*contactId/u,
        message:
          'UI code must not assemble durable athlete_contact_cache identity rows directly.',
      },
    ],
  },
  {
    id: 'head-scout.confirmation.appointment',
    action: 'Head Scout Schedules / confirmation text',
    bucket: 'Meetings',
    file: 'src/head-scout-schedules.tsx',
    canonicalIds: [
      {
        name: 'appointmentId',
        adapterFields: ['eventId', 'appointmentId', 'appointment_id'],
        allowedDerivers: [
          'src/domain/set-meetings-candidate.ts',
          'src/lib/head-scout-schedules.ts',
        ],
      },
    ],
    requiredPatterns: [
      {
        ruleId: 'missing-head-scout-candidate-identity-key',
        pattern: /buildSetMeetingCandidateIdentityKey\(candidate\)/u,
        message:
          'Head Scout confirmation actions must key UI state through the Set Meetings candidate identity.',
      },
      {
        ruleId: 'missing-head-scout-title-prefix-from-booked-meeting',
        pattern:
          /updateBookedMeetingTitlePrefix\(\{[\s\S]*?eventId:\s*candidate\.bookedMeeting\.event_id/u,
        message:
          'Head Scout title-prefix update must use the booked meeting event identity.',
      },
      {
        ruleId: 'missing-head-scout-cache-read-from-booked-meeting',
        pattern:
          /readCachedSetMeetingConfirmation\(\{[\s\S]*?appointmentId:\s*candidate\.bookedMeeting\?\.event_id/u,
        message:
          'Head Scout confirmation cache read must use the same booked meeting event identity.',
      },
    ],
    forbiddenPatterns: [
      {
        ruleId: 'ui-local-head-scout-confirmation-appointment-derivation',
        pattern:
          /readCachedSetMeetingConfirmation\(\{[\s\S]*?appointmentId:\s*(?:row\.source_event_id|candidate\.taskId|candidate\.followUpTask\?\.taskId)/u,
        message:
          'Head Scout confirmation cache reads must not derive appointment identity from task or pending-client IDs.',
      },
    ],
  },
  {
    id: 'client-messages.export.current-task-id',
    action: 'Client Messages / export client directory',
    bucket: 'Client Communication',
    file: 'src/lib/client-message-export.ts',
    canonicalIds: [
      {
        name: 'currentTaskId',
        adapterFields: ['currentTaskId', 'task_id', 'taskId'],
        allowedDerivers: [
          'src/lib/supabase-lifecycle.ts',
          'src/lib/client-message-export.ts',
        ],
      },
    ],
    requiredPatterns: [
      {
        ruleId: 'missing-client-message-export-current-task-id-field',
        pattern: /currentTaskId:\s*string\s*\|\s*null/u,
        message:
          'Client Messages export rows must carry the canonical currentTaskId when lifecycle truth provides it.',
      },
      {
        ruleId: 'missing-client-message-client-current-task-id',
        pattern: /currentTaskId:\s*row\.currentTaskId\s*\|\|\s*null/u,
        message:
          'Client lifecycle rows must preserve Supabase currentTaskId into the Client Messages export.',
      },
      {
        ruleId: 'missing-client-message-pending-current-task-id',
        pattern: /currentTaskId:\s*String\(task\.task_id\s*\|\|\s*''\)\.trim\(\)\s*\|\|\s*null/u,
        message:
          'Pending task rows must preserve Laravel task_id into the Client Messages export.',
      },
    ],
    forbiddenPatterns: [],
  },
  {
    id: 'client-messages.contact-cache.current-task-id',
    action: 'Client Messages / contact-cache admission',
    bucket: 'Admin Data & Contacts',
    file: 'src/lib/athlete-contact-cache.ts',
    canonicalIds: [
      {
        name: 'currentTaskId',
        adapterFields: ['current_task_id', 'currentTaskId'],
        allowedDerivers: [
          'src/lib/supabase-lifecycle.ts',
          'src/lib/athlete-contact-cache.ts',
          'src/lib/student-athlete-message-resolver.ts',
        ],
      },
    ],
    requiredPatterns: [
      {
        ruleId: 'missing-contact-cache-current-task-id-select',
        pattern: /select=athlete_key,crm_stage,task_status,current_task_id,event_type/u,
        message:
          'Contact-cache Client Messages admission must read lifecycle current_task_id with stage/title context.',
      },
      {
        ruleId: 'missing-contact-cache-current-task-id-output',
        pattern: /currentTaskId:\s*String\(lifecycle\?\.current_task_id\s*\|\|\s*''\)\.trim\(\)\s*\|\|\s*null/u,
        message:
          'Contact-cache Client Messages admission must expose currentTaskId to downstream message completion.',
      },
    ],
    forbiddenPatterns: [],
  },
  {
    id: 'client-messages.send.task-completion',
    action: 'Client Messages / Send Follow-Up / task completion',
    bucket: 'Client Communication, Pre-Meeting Tasks',
    file: 'src/client-message-inbox.tsx',
    canonicalIds: [
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
    ],
    requiredPatterns: [
      {
        ruleId: 'missing-client-message-task-id-from-match',
        pattern: /taskId:\s*chat\.clientMatch\.currentTaskId\s*\|\|\s*null/u,
        message:
          'Client Messages task completion must pass the canonical currentTaskId when available.',
      },
    ],
    forbiddenPatterns: [],
  },
  {
    id: 'head-scout.prefix-outcome-stage',
    action: 'Head Scout Schedules / Meeting Prefix / post-call stage',
    bucket: 'Meetings, Enrollments & Outcomes, Lifecycle & Stage Truth',
    file: 'src/head-scout-schedules.tsx',
    canonicalIds: [
      {
        name: 'postCallStage',
        adapterFields: ['initialStageLabel'],
        allowedDerivers: ['src/domain/sales-stage-contract.ts'],
      },
    ],
    requiredPatterns: [
      {
        ruleId: 'missing-prefix-stage-domain-helper',
        pattern: /postCallStageForAppointmentTitlePrefix\(prefix\)/u,
        message:
          'Head Scout prefix actions must resolve post-call outcome stage through the lifecycle/stage domain.',
      },
    ],
    forbiddenPatterns: [
      {
        ruleId: 'ui-local-prefix-stage-derivation',
        pattern:
          /prefix\s*===\s*'\(RSP\)'[\s\S]*?'Meeting Result - Res\. Pending'[\s\S]*?prefix\s*===\s*'\(CAN\)'[\s\S]*?'Meeting Result - Canceled'/u,
        message:
          'Head Scout UI must not map appointment title prefixes to lifecycle stages inline.',
      },
    ],
  },
  {
    id: 'scout-prep.batch-stage-completion.action-plan',
    action: 'Scout Prep / Batch Operations / sales stage task completion',
    bucket: 'Lifecycle & Stage Truth, Pre-Meeting Tasks',
    file: 'src/scout-prep.tsx',
    canonicalIds: [
      {
        name: 'taskId',
        adapterFields: ['task_id', 'taskId'],
        allowedDerivers: [
          'src/domain/post-call-action.ts',
          'src/domain/scout-task-selection.ts',
          'src/lib/scout-prep-task-completion.ts',
        ],
      },
    ],
    requiredPatterns: [
      {
        ruleId: 'missing-batch-post-call-action-plan',
        pattern:
          /function\s+runScoutPrepStageCompletionBatchRow[\s\S]*?const\s+actionPlan\s*=\s*buildPostCallActionPlan\(/u,
        message:
          'Batch sales-stage completion must use the shared post-call action plan before task completion.',
      },
      {
        ruleId: 'missing-batch-task-id-from-plan',
        pattern:
          /function\s+runScoutPrepStageCompletionBatchRow[\s\S]*?taskId:\s*taskCompletion\.taskId/u,
        message:
          'Batch sales-stage completion taskId must come from the action-plan task completion.',
      },
      {
        ruleId: 'missing-batch-crm-stage-from-plan',
        pattern:
          /function\s+runScoutPrepStageCompletionBatchRow[\s\S]*?crmStage:\s*taskCompletion\.crmStage/u,
        message:
          'Batch sales-stage completion crmStage must come from the action-plan task completion.',
      },
    ],
    forbiddenPatterns: [],
  },
  {
    id: 'pending-clients.watchlist.source-event-identity',
    action: 'Head Scout Schedules / Pending Clients / Remove',
    bucket: 'Enrollments & Outcomes',
    file: 'src/head-scout-schedules.tsx',
    canonicalIds: [
      {
        name: 'sourceEventId',
        adapterFields: ['source_event_id', 'sourceEventId'],
        allowedDerivers: [
          'src/domain/pending-client-watchlist.ts',
          'src/lib/pending-client-watchlist.ts',
        ],
      },
    ],
    requiredPatterns: [
      {
        ruleId: 'missing-pending-client-resolve-helper',
        pattern: /markPendingClientResolved\(sourceEventId\)/u,
        message:
          'Pending Client removal must patch the watchlist through the Pending Client helper.',
      },
      {
        ruleId: 'missing-pending-client-row-source-event-id',
        pattern: /handleMarkResolved\(row\.source_event_id\)/u,
        message:
          'Pending Client removal must pass the watchlist row source_event_id to the helper.',
      },
    ],
    forbiddenPatterns: [
      {
        ruleId: 'pending-client-source-event-used-as-task-completion-id',
        pattern:
          /completeScoutPrepTaskAfterVoicemail\(\{[\s\S]*?taskId:\s*row\.source_event_id/u,
        message:
          'Pending Client source_event_id identifies the watchlist row/event support surface, not a Laravel task completion id.',
      },
    ],
  },
];

function lineNumberForIndex(source, index) {
  return source.slice(0, index).split('\n').length;
}

function buildFinding(contract, relativePath, rule) {
  return {
    contractId: contract.id,
    action: contract.action,
    bucket: contract.bucket,
    file: relativePath,
    ruleId: rule.ruleId,
    message: rule.message,
  };
}

export function auditRaycastWorkflowIdentityText({ relativePath, source }) {
  const findings = [];
  for (const contract of RAYCAST_WORKFLOW_IDENTITY_CONTRACTS) {
    if (relativePath !== contract.file) continue;

    for (const rule of contract.requiredPatterns) {
      if (!rule.pattern.test(source)) {
        findings.push(buildFinding(contract, relativePath, rule));
      }
    }

    for (const rule of contract.forbiddenPatterns) {
      for (const match of source.matchAll(new RegExp(rule.pattern, 'gu'))) {
        findings.push({
          ...buildFinding(contract, relativePath, rule),
          line: lineNumberForIndex(source, match.index || 0),
        });
      }
    }
  }
  return findings;
}

export function auditRaycastWorkflowIdentityFiles(args = {}) {
  const repoRoot = args.repoRoot || process.cwd();
  return RAYCAST_WORKFLOW_IDENTITY_CONTRACTS.flatMap((contract) => {
    const fullPath = resolve(repoRoot, contract.file);
    const source = readFileSync(fullPath, 'utf8');
    return auditRaycastWorkflowIdentityText({
      relativePath: relative(repoRoot, fullPath),
      source,
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const jsonMode = process.argv.includes('--json');
  const findings = auditRaycastWorkflowIdentityFiles();
  if (jsonMode) {
    console.log(JSON.stringify({ findings }, null, 2));
  } else if (findings.length) {
    console.error('Raycast workflow identity contract violations:');
    for (const finding of findings) {
      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      console.error(`- ${location} [${finding.ruleId}] ${finding.message}`);
    }
  } else {
    console.log('Raycast workflow identity contracts passed.');
  }
  process.exitCode = findings.length ? 1 : 0;
}
