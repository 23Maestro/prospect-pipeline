/**
 * VPS Broker API Adapter
 * Wraps Python VPS broker client for TypeScript extensions
 */

import { spawn } from "child_process";
import * as path from "path";

// Use environment-aware paths
const WORKSPACE_ROOT = process.cwd();
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";
const VPS_BROKER_PATH = path.join(WORKSPACE_ROOT, "src", "python", "vps_broker_api_client.py");

/**
 * Generic function to call VPS Broker Python client
 */
export async function callVPSBroker<T>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const argsJson = JSON.stringify(args).replace(/'/g, "'\\''");
    const command = `${PYTHON_PATH} ${VPS_BROKER_PATH} ${method} '${argsJson}'`;

    const childProcess = spawn(command, {
      shell: true,
      env: {
        ...process.env,
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      }
    });

    let stdout = "";
    let stderr = "";

    childProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    childProcess.on("close", (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result as T);
        } catch (error) {
          console.error("Failed to parse VPS Broker output:", error);
          console.error("Raw output:", stdout);
          reject(new Error(`Failed to parse VPS Broker output: ${stdout.substring(0, 200)}`));
        }
      } else {
        console.error(`VPS Broker exited with code ${code}`);
        console.error(`stderr: ${stderr}`);
        console.error(`stdout: ${stdout}`);
        reject(new Error(`VPS Broker failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    childProcess.on('error', (err) => {
      console.error('VPS Broker spawn error:', err);
      reject(err);
    });
  });
}

/**
 * Update video stage
 * @param threadId - Thread/message ID
 * @param stage - Stage value: "on_hold" | "awaiting_client" | "in_queue" | "done"
 */
export async function updateVideoStage(
  threadId: string,
  stage: string
): Promise<{ success: boolean }> {
  return callVPSBroker<{ success: boolean }>('update_stage', {
    thread_id: threadId,
    stage: stage
  });
}

/**
 * Update video status
 * @param threadId - Thread/message ID
 * @param status - Status value: "revisions" | "hudl" | "dropbox" | "external_links" | "not_approved"
 */
export async function updateVideoStatus(
  threadId: string,
  status: string
): Promise<{ success: boolean }> {
  return callVPSBroker<{ success: boolean }>('update_status', {
    thread_id: threadId,
    status: status
  });
}

/**
 * Send a reply to a thread
 * @param threadId - Thread/message ID
 * @param message - Reply message text
 */
export async function sendReply(
  threadId: string,
  message: string
): Promise<boolean> {
  const result = await callVPSBroker<{ success: boolean }>('send_reply', {
    thread_id: threadId,
    message: message
  });
  return result.success;
}

/**
 * Post a video to athlete profile
 * @param params - Video parameters
 */
export async function postVideo(params: {
  contact_id: string;
  youtube_url: string;
  athlete_id: string;
  sport?: string;
  video_type?: string;
  season?: string;
}): Promise<{ success: boolean }> {
  return callVPSBroker<{ success: boolean }>('post_video', {
    contact_id: params.contact_id,
    youtube_url: params.youtube_url,
    athlete_id: params.athlete_id,
    sport: params.sport || 'football',
    video_type: params.video_type || 'Partial Season Highlight',
    season: params.season || 'highschool:16267'
  });
}

/**
 * Get email templates for a contact
 * @param contactId - Contact ID
 */
export async function getEmailTemplates(contactId: string): Promise<any[]> {
  return callVPSBroker<any[]>('get_email_templates', {
    contact_id: contactId
  });
}

/**
 * Get inbox threads
 */
export async function getInbox(): Promise<any[]> {
  return callVPSBroker<any[]>('get_inbox');
}

/**
 * Get video progress data with optional filters
 */
export async function getVideoProgress(filters?: Record<string, string>): Promise<any[]> {
  return callVPSBroker<any[]>('get_video_progress', {
    filters: filters || {}
  });
}

/**
 * Assign a thread to video team
 */
export async function assignThread(payload: {
  messageId: string;
  ownerId: string;
  contactId?: string;
  athleteMainId?: string;
  stage?: string;
  status?: string;
  contactFor?: string;
  contact?: string;
}): Promise<boolean> {
  const result = await callVPSBroker<{ success: boolean }>('assign_thread', payload);
  return result.success;
}
