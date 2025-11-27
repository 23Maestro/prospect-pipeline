import { Action, ActionPanel, Form, Toast, showToast, getPreferenceValues } from '@raycast/api';
import { useState } from 'react';
import { callPythonServer, API_BASE } from './lib/python-server-client';

type Stage = "on_hold" | "awaiting_client" | "in_queue" | "done";
type Status = "revisions" | "hudl" | "dropbox" | "external_links" | "not_approved";

const API_BASE_URL = API_BASE;

export default function UpdateVideoProgress() {
  const preferences = getPreferenceValues<{ scoutApiKey?: string }>();
  const [threadId, setThreadId] = useState('');
  const [stage, setStage] = useState<Stage>('in_queue');
  const [status, setStatus] = useState<Status>('hudl');

  async function handleSubmit() {
    const apiKey = preferences.scoutApiKey || process.env.SCOUT_API_KEY || '594168a28d26571785afcb83997cb8185f482e56';
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

    try {
      const resolveResp = await fetch(`${API_BASE_URL}/athlete/${encodeURIComponent(threadId)}/resolve`);
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
      const resolved = await resolveResp.json().catch(() => ({}));
      const videoMsgId = resolved.video_msg_id || resolved.athlete_id || threadId;
      const athleteId = resolved.athlete_id || threadId;

      // Update stage
      const stageResponse = await fetch(`${API_BASE_URL}/video/${encodeURIComponent(videoMsgId)}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: videoMsgId, stage }),
      });
      const stageResult = await stageResponse.json().catch(() => ({}));
      if (!stageResponse.ok) {
        throw new Error(stageResult?.message || stageResult?.detail || `HTTP ${stageResponse.status}`);
      }

      // Update status
      await callPythonServer('update_video_status', { athlete_id: athleteId, status, api_key: apiKey });

      toast.style = Toast.Style.Success;
      toast.title = 'Progress updated';
      toast.message = `Stage: ${stage}, Status: ${status}`;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Update failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Update Progress" onSubmit={handleSubmit} />
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
