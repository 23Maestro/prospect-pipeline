import { Action, ActionPanel, Form, Toast, showToast } from '@raycast/api';
import { useState } from 'react';
import { updateVideoStage, updateVideoStatus } from './lib/vps-broker-adapter';

type Stage = "on_hold" | "awaiting_client" | "in_queue" | "done";
type Status = "revisions" | "hudl" | "dropbox" | "external_links" | "not_approved";

export default function UpdateVideoProgress() {
  const [threadId, setThreadId] = useState('');
  const [stage, setStage] = useState<Stage>('in_queue');
  const [status, setStatus] = useState<Status>('hudl');

  async function handleSubmit() {
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
      // Update stage
      await updateVideoStage(threadId, stage);
      
      // Update status  
      await updateVideoStatus(threadId, status);

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

