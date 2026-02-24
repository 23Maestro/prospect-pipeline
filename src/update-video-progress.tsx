import { Action, ActionPanel, Form, Toast, showToast } from '@raycast/api';
import { useState } from 'react';
import { apiFetch } from './lib/python-server-client';
import { videoProgressLogger } from './lib/logger';

type Stage = 'on_hold' | 'awaiting_client' | 'in_queue' | 'done';
type Status = 'revisions' | 'hudl' | 'dropbox' | 'external_links' | 'not_approved';

export default function UpdateVideoProgress() {
  const [threadId, setThreadId] = useState('');
  const [stage, setStage] = useState<Stage>('in_queue');
  const [status, setStatus] = useState<Status>('hudl');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const feature = 'update-video-progress.submit';

  async function readApiBody(response: Response) {
    const contentType = response?.headers?.get?.('content-type') || '';
    const text = await response.text();
    let json: any = null;
    if (contentType.includes('application/json') || text.trim().startsWith('{')) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { text, json, contentType };
  }

  function extractApiError(statusCode: number, text: string, json: any): string {
    return (
      json?.message ||
      json?.detail ||
      (typeof text === 'string' ? text.slice(0, 200) : '') ||
      `HTTP ${statusCode}`
    );
  }

  function isExplicitFailurePayload(json: any): boolean {
    return !!(json && typeof json === 'object' && 'success' in json && json.success === false);
  }

  async function handleSubmit() {
    if (isSubmitting) {
      return;
    }

    if (!threadId) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Thread ID required',
      });
      return;
    }

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: 'Updating progress...',
    });

    setIsSubmitting(true);
    try {
      videoProgressLogger.info('VIDEO_PROGRESS_UPDATE_STATUS', {
        event: 'VIDEO_PROGRESS_UPDATE_STATUS',
        step: 'submit',
        status: 'start',
        feature,
        context: {
          threadId,
          selectedStage: stage,
          selectedStatus: status,
        },
      });

      const resolveResp = await apiFetch(`/athlete/${encodeURIComponent(threadId)}/resolve`);
      const resolveBody = await readApiBody(resolveResp);
      videoProgressLogger.info('VIDEO_PROGRESS_UPDATE_STATUS', {
        event: 'VIDEO_PROGRESS_UPDATE_STATUS',
        step: 'resolve',
        status:
          resolveResp.ok && !isExplicitFailurePayload(resolveBody.json) ? 'success' : 'failure',
        feature,
        context: {
          threadId,
          statusCode: resolveResp.status,
          contentType: resolveBody.contentType,
          bodyPreview: resolveBody.text.slice(0, 200),
        },
      });
      if (resolveResp.status === 404) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Athlete not found';
        return;
      }
      if (resolveResp.status >= 500) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Resolution failed';
        return;
      }
      if (!resolveResp.ok || isExplicitFailurePayload(resolveBody.json)) {
        throw new Error(extractApiError(resolveResp.status, resolveBody.text, resolveBody.json));
      }

      const resolved = resolveBody.json || {};
      const videoMsgId = resolved.video_msg_id || resolved.athlete_id || threadId;
      const athleteId = resolved.athlete_id || threadId;

      // Update stage
      const stageResponse = await apiFetch(`/video/${encodeURIComponent(videoMsgId)}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: videoMsgId, stage }),
      });
      const stageBody = await readApiBody(stageResponse);
      videoProgressLogger.info('VIDEO_PROGRESS_UPDATE_STATUS', {
        event: 'VIDEO_PROGRESS_UPDATE_STATUS',
        step: 'update_stage',
        status:
          stageResponse.ok && !isExplicitFailurePayload(stageBody.json) ? 'success' : 'failure',
        feature,
        context: {
          threadId,
          athleteId,
          videoMsgId,
          selectedStage: stage,
          statusCode: stageResponse.status,
          contentType: stageBody.contentType,
          bodyPreview: stageBody.text.slice(0, 200),
        },
      });
      if (!stageResponse.ok || isExplicitFailurePayload(stageBody.json)) {
        throw new Error(extractApiError(stageResponse.status, stageBody.text, stageBody.json));
      }

      // Update status
      const statusResponse = await apiFetch(`/video/${encodeURIComponent(videoMsgId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_msg_id: videoMsgId,
          status,
        }),
      });
      const statusBody = await readApiBody(statusResponse);
      videoProgressLogger.info('VIDEO_PROGRESS_UPDATE_STATUS', {
        event: 'VIDEO_PROGRESS_UPDATE_STATUS',
        step: 'update_status',
        status:
          statusResponse.ok && !isExplicitFailurePayload(statusBody.json) ? 'success' : 'failure',
        feature,
        context: {
          threadId,
          athleteId,
          videoMsgId,
          selectedStatus: status,
          statusCode: statusResponse.status,
          contentType: statusBody.contentType,
          bodyPreview: statusBody.text.slice(0, 200),
        },
      });
      if (!statusResponse.ok || isExplicitFailurePayload(statusBody.json)) {
        throw new Error(extractApiError(statusResponse.status, statusBody.text, statusBody.json));
      }

      toast.style = Toast.Style.Success;
      toast.title = 'Progress updated';
      toast.message = `Stage: ${stage}, Status: ${status}`;

      videoProgressLogger.info('VIDEO_PROGRESS_UPDATE_STATUS', {
        event: 'VIDEO_PROGRESS_UPDATE_STATUS',
        step: 'submit',
        status: 'success',
        feature,
        context: {
          threadId,
          athleteId,
          videoMsgId,
          selectedStage: stage,
          selectedStatus: status,
        },
      });
    } catch (error) {
      videoProgressLogger.error('VIDEO_PROGRESS_UPDATE_STATUS', {
        event: 'VIDEO_PROGRESS_UPDATE_STATUS',
        step: 'submit',
        status: 'failure',
        feature,
        error: error instanceof Error ? error.message : String(error),
        context: {
          threadId,
          selectedStage: stage,
          selectedStatus: status,
        },
      });
      toast.style = Toast.Style.Failure;
      toast.title = 'Update failed';
      toast.message = error instanceof Error ? error.message : JSON.stringify(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isSubmitting ? 'Updating…' : 'Update Progress'}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="threadId"
        title="Thread ID"
        placeholder="11147"
        value={threadId}
        onChange={setThreadId}
      />

      <Form.Dropdown
        id="stage"
        title="Video Stage"
        value={stage}
        onChange={(value) => setStage(value as Stage)}
      >
        <Form.Dropdown.Item value="on_hold" title="On Hold" />
        <Form.Dropdown.Item value="awaiting_client" title="Awaiting Client" />
        <Form.Dropdown.Item value="in_queue" title="In Queue" />
        <Form.Dropdown.Item value="done" title="Done" />
      </Form.Dropdown>

      <Form.Dropdown
        id="status"
        title="Video Status"
        value={status}
        onChange={(value) => setStatus(value as Status)}
      >
        <Form.Dropdown.Item value="revisions" title="Revisions" />
        <Form.Dropdown.Item value="hudl" title="HUDL" />
        <Form.Dropdown.Item value="dropbox" title="Dropbox" />
        <Form.Dropdown.Item value="external_links" title="External Links" />
        <Form.Dropdown.Item value="not_approved" title="Not Approved" />
      </Form.Dropdown>
    </Form>
  );
}
