import { updateCachedTaskStatusStage } from './video-progress-cache';
import {
  buildEditingDoneRecipientPayload,
  DEFAULT_EDITING_DONE_TEMPLATE_ID,
  DEFAULT_SENDER_EMAIL,
  DEFAULT_SENDER_NAME,
  fetchEmailRecipients,
  fetchEmailTemplateData,
  fetchEmailTemplates,
  sendEmailViaAPI,
} from './email-workflow';
import { apiFetch } from './fastapi-client';
import type {
  AthleteTaskSummary,
  EligibleTaskLookupResult,
  PostUploadStepResult,
  VideoUpdateLogStatus,
} from '../types/athlete-workflows';

type LogEvent = (
  event: string,
  step: string,
  status: VideoUpdateLogStatus,
  context: Record<string, unknown>,
  error?: string,
) => void;

function normalizeText(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${month}/${day}/${year}`;
}

function formatTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

async function updateStageDone(videoMsgId: string) {
  const response = await apiFetch(`/video/${encodeURIComponent(videoMsgId)}/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_msg_id: videoMsgId, stage: 'done' }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as any;
    throw new Error(error.detail || `Stage HTTP ${response.status}`);
  }
}

async function completeVideoEditingTask({
  athleteId,
  athleteMainId,
  taskId,
}: {
  athleteId: string;
  athleteMainId: string;
  taskId?: string;
}) {
  const now = new Date();
  const completedDate = formatDate(now);
  const completedTime = formatTime(now);
  const description = `${completedDate} - Video Editing Complete`;

  const response = await apiFetch('/tasks/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
      task_id: taskId,
      task_title: 'Video Editing',
      assigned_owner: 'Jerami Singleton',
      description,
      completed_date: completedDate,
      completed_time: completedTime,
      is_completed: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = '';
    try {
      const parsed = JSON.parse(errorText) as any;
      detail = parsed?.detail || '';
    } catch {
      detail = '';
    }
    throw new Error(detail || `HTTP ${response.status}`);
  }

  return (await response.json().catch(() => ({}))) as any;
}

export async function fetchEligibleJeramiVideoEditingTask({
  athleteId,
  athleteMainId,
  logEvent,
}: {
  athleteId: string;
  athleteMainId: string;
  logEvent?: LogEvent;
}): Promise<EligibleTaskLookupResult> {
  const response = await apiFetch('/tasks/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText.slice(0, 200) || `Tasks HTTP ${response.status}`);
  }

  const payload = (await response.json().catch(() => ({}))) as any;
  const tasks = (Array.isArray(payload.tasks) ? payload.tasks : []) as AthleteTaskSummary[];
  const videoEditingMatches = tasks.filter(
    (task) => normalizeText(task.title) === normalizeText('Video Editing') && task.task_id,
  );
  if (videoEditingMatches.length === 0) {
    logEvent?.('VIDEO_UPDATES_TASK_COMPLETE', 'select-task', 'success', {
      athleteId,
      athleteMainId,
      reason: 'not_found',
    });
    return { eligible: false, reason: 'not_found' };
  }

  const jeramiMatches = videoEditingMatches.filter(
    (task) => normalizeText(task.assigned_owner) === normalizeText('Jerami Singleton'),
  );
  if (jeramiMatches.length === 0) {
    logEvent?.('VIDEO_UPDATES_TASK_COMPLETE', 'select-task', 'success', {
      athleteId,
      athleteMainId,
      reason: 'assigned_to_other',
      candidateCount: videoEditingMatches.length,
    });
    return { eligible: false, reason: 'assigned_to_other' };
  }

  const incompleteJeramiMatches = jeramiMatches.filter(
    (task) => !normalizeText(task.completion_date),
  );
  if (incompleteJeramiMatches.length === 0) {
    logEvent?.('VIDEO_UPDATES_TASK_COMPLETE', 'select-task', 'success', {
      athleteId,
      athleteMainId,
      reason: 'already_completed',
      candidateCount: jeramiMatches.length,
    });
    return { eligible: false, reason: 'already_completed' };
  }

  const chosen = incompleteJeramiMatches[0];
  logEvent?.('VIDEO_UPDATES_TASK_COMPLETE', 'select-task', 'success', {
    athleteId,
    athleteMainId,
    taskId: chosen.task_id,
    candidateCount: videoEditingMatches.length,
    jeramiCandidateCount: jeramiMatches.length,
    incompleteJeramiCandidateCount: incompleteJeramiMatches.length,
  });
  return { eligible: true, taskId: chosen.task_id };
}

function summarizePostUploadResults(results: PostUploadStepResult[]) {
  const failures = results.filter((result) => !result.success);
  const failedSteps = failures.map((result) => result.step);
  const uniqueFailedSteps = Array.from(new Set(failedSteps));
  return {
    failures,
    hasFailures: failures.length > 0,
    failedSteps: uniqueFailedSteps,
    warningMessage:
      uniqueFailedSteps.length > 0 ? `Follow-up warnings: ${uniqueFailedSteps.join(', ')}` : '',
  };
}

export async function runVideoPostUploadActions({
  athleteId,
  athleteMainId,
  videoMsgId,
  logEvent,
}: {
  athleteId: string;
  athleteMainId: string;
  videoMsgId: string;
  logEvent: LogEvent;
}) {
  logEvent('VIDEO_UPDATES_POST_UPLOAD', 'start', 'start', {
    athleteId,
    athleteMainId,
    hasVideoMsgId: !!videoMsgId,
  });

  const results: PostUploadStepResult[] = [];
  let taskHudMessage: string | undefined;

  logEvent('VIDEO_UPDATES_EMAIL', 'request', 'start', {
    athleteId,
    templateId: DEFAULT_EDITING_DONE_TEMPLATE_ID,
  });
  try {
    const templates = await fetchEmailTemplates(athleteId);
    const picked =
      templates.find((template) => template.value === DEFAULT_EDITING_DONE_TEMPLATE_ID) ||
      templates[0];
    if (!picked) {
      throw new Error('No email templates available');
    }
    const data = await fetchEmailTemplateData(picked.value, athleteId);
    const recipients = await fetchEmailRecipients(athleteId);
    const recipientPayload = buildEditingDoneRecipientPayload(recipients, {
      respectCheckedParents: false,
    });

    logEvent('VIDEO_UPDATES_EMAIL', 'request', 'success', {
      athleteId,
      templateId: picked.value,
      includeAthlete: recipientPayload.includeAthlete,
      parentCount: recipientPayload.parentIds.length,
      otherEmail: recipientPayload.otherEmail,
    });

    await sendEmailViaAPI({
      athleteId,
      templateId: picked.value,
      senderName: data.sender_name || DEFAULT_SENDER_NAME,
      senderEmail: data.sender_email || DEFAULT_SENDER_EMAIL,
      subject: data.subject || '',
      message: data.message || '',
      includeAthlete: recipientPayload.includeAthlete,
      parentIds: recipientPayload.parentIds,
      otherEmail: recipientPayload.otherEmail,
    });
    logEvent('VIDEO_UPDATES_EMAIL', 'send', 'success', {
      athleteId,
      templateId: picked.value,
      recipientCount:
        Number(recipientPayload.includeAthlete) +
        recipientPayload.parentIds.length +
        Number(!!recipientPayload.otherEmail),
    });
    results.push({ step: 'email', success: true });
  } catch (error) {
    const message = getErrorMessage(error);
    logEvent('VIDEO_UPDATES_EMAIL', 'send', 'failure', { athleteId }, message);
    results.push({ step: 'email', success: false, error: message });
  }

  if (!videoMsgId) {
    const error = 'missing_video_msg_id';
    logEvent('VIDEO_UPDATES_STAGE', 'request', 'failure', { athleteId }, error);
    logEvent('VIDEO_UPDATES_CACHE_SYNC', 'request', 'failure', { athleteId }, error);
    results.push({ step: 'stage', success: false, error });
    results.push({ step: 'cache', success: false, error });
  } else {
    logEvent('VIDEO_UPDATES_STAGE', 'request', 'start', { athleteId, videoMsgId });
    try {
      await updateStageDone(videoMsgId);
      logEvent('VIDEO_UPDATES_STAGE', 'request', 'success', { athleteId, videoMsgId });
      results.push({ step: 'stage', success: true });
    } catch (error) {
      const message = getErrorMessage(error);
      logEvent('VIDEO_UPDATES_STAGE', 'request', 'failure', { athleteId, videoMsgId }, message);
      results.push({ step: 'stage', success: false, error: message });
    }

    logEvent('VIDEO_UPDATES_CACHE_SYNC', 'request', 'start', { athleteId, videoMsgId });
    const numericId = Number(videoMsgId);
    if (Number.isNaN(numericId)) {
      const error = 'invalid_video_msg_id';
      logEvent('VIDEO_UPDATES_CACHE_SYNC', 'request', 'failure', { athleteId, videoMsgId }, error);
      results.push({ step: 'cache', success: false, error });
    } else {
      try {
        await updateCachedTaskStatusStage(numericId, { stage: 'Done' });
        logEvent('VIDEO_UPDATES_CACHE_SYNC', 'request', 'success', { athleteId, videoMsgId });
        results.push({ step: 'cache', success: true });
      } catch (error) {
        const message = getErrorMessage(error);
        logEvent(
          'VIDEO_UPDATES_CACHE_SYNC',
          'request',
          'failure',
          { athleteId, videoMsgId },
          message,
        );
        results.push({ step: 'cache', success: false, error: message });
      }
    }
  }

  logEvent('VIDEO_UPDATES_TASK_COMPLETE', 'request', 'start', { athleteId, athleteMainId });
  try {
    const taskLookup = await fetchEligibleJeramiVideoEditingTask({
      athleteId,
      athleteMainId,
      logEvent,
    });
    if (!taskLookup.eligible) {
      taskHudMessage =
        taskLookup.reason === 'assigned_to_other'
          ? 'Upload complete. Task skipped: assigned to another editor.'
          : taskLookup.reason === 'already_completed'
            ? 'Upload complete. Task already completed.'
            : 'Upload complete. No Jerami Video Editing task found.';
      results.push({ step: 'task', success: true, skipped: true });
    } else {
      const result = await completeVideoEditingTask({
        athleteId,
        athleteMainId,
        taskId: taskLookup.taskId,
      });
      logEvent('VIDEO_UPDATES_TASK_COMPLETE', 'request', 'success', {
        athleteId,
        athleteMainId,
        taskId: taskLookup.taskId,
        responseTaskId: result?.task_id || taskLookup.taskId,
      });
      taskHudMessage = 'Video Editing task completed';
      results.push({ step: 'task', success: true });
    }
  } catch (error) {
    const message = getErrorMessage(error);
    logEvent(
      'VIDEO_UPDATES_TASK_COMPLETE',
      'request',
      'failure',
      {
        athleteId,
        athleteMainId,
      },
      message,
    );
    results.push({ step: 'task', success: false, error: message });
  }

  const summary = summarizePostUploadResults(results);
  if (summary.hasFailures) {
    logEvent(
      'VIDEO_UPDATES_POST_UPLOAD',
      'complete',
      'failure',
      {
        athleteId,
        athleteMainId,
        failedSteps: summary.failedSteps,
      },
      summary.warningMessage,
    );
  } else {
    logEvent('VIDEO_UPDATES_POST_UPLOAD', 'complete', 'success', {
      athleteId,
      athleteMainId,
    });
  }

  return { summary, taskHudMessage };
}
