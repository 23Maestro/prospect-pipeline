import { Toast, showToast } from '@raycast/api';
import {
  callPythonServer,
  fetchAuthStatus,
  reloadAuthSessions,
  type AuthStatusResponse,
} from './fastapi-client';

export interface AuthRecoveryState {
  title: string;
  message: string;
  authStatus: AuthStatusResponse;
}

export async function diagnoseAuthFailure(
  statusCode: number,
  message: string,
): Promise<AuthRecoveryState | null> {
  const looksAuthRelated =
    [401, 502, 503].includes(statusCode) ||
    /auth|session|login|non-json|unauthorized/i.test(message || '');

  if (!looksAuthRelated) {
    return null;
  }

  try {
    const authStatus = await fetchAuthStatus();
    if (!authStatus.summary.likely_disconnected) {
      return null;
    }

    return {
      title: 'Prospect ID Session Needs Reconnect',
      message,
      authStatus,
    };
  } catch {
    return null;
  }
}

export function buildAuthRecoveryMarkdown(recovery: AuthRecoveryState): string {
  const sessionFile = recovery.authStatus.session_file;
  const sharedProbe = recovery.authStatus.shared_session.probe;
  const videoProbe = recovery.authStatus.video_progress_session.probe;

  return [
    '# Prospect ID Session Recovery',
    '',
    recovery.message,
    '',
    '## Current State',
    `- Saved session file: ${sessionFile.exists ? 'present' : 'missing'}`,
    `- Session file modified: ${sessionFile.modified_at || 'unknown'}`,
    `- Shared session valid: ${recovery.authStatus.summary.shared_session_valid ? 'yes' : 'no'}`,
    `- Video progress valid: ${recovery.authStatus.summary.video_progress_session_valid ? 'yes' : 'no'}`,
    '',
    '## Upstream Checks',
    `- Shared probe: HTTP ${sharedProbe.status_code} (${sharedProbe.content_type || 'unknown content-type'})`,
    `- Shared redirect: ${sharedProbe.location || 'none'}`,
    `- Video progress probe: HTTP ${videoProbe.status_code} (${videoProbe.content_type || 'unknown content-type'})`,
    `- Video progress redirect: ${videoProbe.location || 'none'}`,
    '',
    '## What To Do',
    '- Use `Reconnect Prospect ID Session` to refresh `~/.npid_session.pkl` with the existing login flow and reload FastAPI.',
    '- `Open Prospect ID Login` is for browser inspection only. Browser login alone does not rewrite the saved pickle used by FastAPI.',
  ].join('\n');
}

export async function reconnectProspectIdSession(
  onReconnectSuccess?: () => Promise<void> | void,
): Promise<AuthStatusResponse> {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: 'Reconnecting Prospect ID session',
    message: 'Refreshing saved cookies and reloading FastAPI',
  });

  try {
    const loginResult = await callPythonServer<{ success?: boolean }>('login', {});
    if (!loginResult?.success) {
      throw new Error('Login did not report success');
    }

    const authStatus = await reloadAuthSessions();
    if (authStatus.summary.likely_disconnected) {
      throw new Error('Prospect ID still rejects the refreshed session');
    }

    if (onReconnectSuccess) {
      await onReconnectSuccess();
    }

    toast.style = Toast.Style.Success;
    toast.title = 'Prospect ID session refreshed';
    toast.message = 'Current view reloaded';
    return authStatus;
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = 'Reconnect failed';
    toast.message = error instanceof Error ? error.message : 'Unknown error';
    throw error;
  }
}
