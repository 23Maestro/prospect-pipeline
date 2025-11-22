/**
 * VPS Broker API Adapter
 * Wraps Python VPS broker client for TypeScript extensions
 * Uses secure Python execution with no command injection risks
 */

import { executePythonScript } from "./python-executor";
import { VPS_BROKER_PATH } from "./python-config";

/**
 * Generic function to call VPS Broker Python client
 * Handles JSON serialization and error management
 */
async function callVPSBroker<T>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return executePythonScript<T>(VPS_BROKER_PATH, method, args, {
    contextName: "VPS Broker",
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
 * @param message - Reply message text (with proper Unicode/apostrophe support)
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
 * IMPORTANT: All parameters are REQUIRED - no defaults
 * User must explicitly provide sport, video_type, and season values
 *
 * @param params - Video parameters (all required)
 * @param params.contact_id - Contact ID
 * @param params.youtube_url - YouTube video URL
 * @param params.athlete_id - Athlete ID
 * @param params.sport - Sport type (required, no default) - USER DECIDES
 * @param params.video_type - Video type (required, no default) - USER DECIDES
 * @param params.season - Season ID (required, no default) - USER DECIDES
 */
export async function postVideo(params: {
  contact_id: string;
  youtube_url: string;
  athlete_id: string;
  sport: string;           // REQUIRED - NO DEFAULT
  video_type: string;      // REQUIRED - NO DEFAULT
  season: string;          // REQUIRED - NO DEFAULT
}): Promise<{ success: boolean }> {
  return callVPSBroker<{ success: boolean }>('post_video', {
    contact_id: params.contact_id,
    youtube_url: params.youtube_url,
    athlete_id: params.athlete_id,
    sport: params.sport,
    video_type: params.video_type,
    season: params.season
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
