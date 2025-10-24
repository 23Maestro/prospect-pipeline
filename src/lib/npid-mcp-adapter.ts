/**
 * NPID REST API Adapter
 *
 * Wraps Python REST API client (npid_api_client.py) for use in TypeScript/Raycast
 * Migrated from MCP/Selenium to direct REST API calls
 */

import { callPythonServer } from './python-server-client';
import type {
  NPIDInboxMessage,
  VideoTeamAssignmentModal,
  VideoTeamContact,
  VideoTeamSearchCategory,
  VideoTeamMessageDetail,
} from '../types/video-team';
import type { TaskStage, TaskStatus } from '../types/workflow';

export interface AssignVideoTeamPayload {
  messageId: string;
  contactId: string;
  athleteMainId?: string | null;
  ownerId: string;
  stage: TaskStage;
  status: TaskStatus;
  formToken: string;
}

export interface AssignmentDefaults {
  defaultOwnerId?: string;
  defaultStage?: TaskStage;
  defaultStatus?: TaskStatus;
}

/**
 * Fetch inbox threads with pagination support
 */
export async function fetchInboxThreads(limit: number = 50): Promise<NPIDInboxMessage[]> {
  try {
    const result = await callPythonServer<{ threads: NPIDInboxMessage[] }>(
      'get_inbox_threads',
      { limit }
    );
    return result.threads || [];
  } catch (error) {
    console.error('Failed to fetch inbox threads:', error);
    throw new Error(`Failed to fetch inbox threads: ${error}`);
  }
}

/**
 * Fetch assignment modal data (owners, stages, statuses, CSRF token)
 */
export async function fetchAssignmentModal(
  messageId: string,
  itemCode?: string
): Promise<VideoTeamAssignmentModal> {
  try {
    const result = await callPythonServer<VideoTeamAssignmentModal>(
      'get_assignment_modal',
      { message_id: messageId, item_code: itemCode }
    );
    return result;
  } catch (error) {
    console.error('Failed to fetch assignment modal:', error);
    throw new Error(`Failed to fetch assignment modal: ${error}`);
  }
}

/**
 * Assign a video team message to an owner with stage/status
 */
export async function assignVideoTeamMessage(payload: AssignVideoTeamPayload): Promise<boolean> {
  try {
    const result = await callPythonServer<{ success: boolean }>(
      'assign_thread',
      {
        messageId: payload.messageId,
        ownerId: payload.ownerId,
        status: payload.status,
        formToken: payload.formToken,
      }
    );
    return result.success;
  } catch (error) {
    console.error('Failed to assign video team message:', error);
    throw new Error(`Failed to assign message: ${error}`);
  }
}

/**
 * Search for contacts (athletes, parents, coaches)
 */
export async function resolveContactsForAssignment(
  searchQuery: string,
  searchCategory: VideoTeamSearchCategory
): Promise<VideoTeamContact[]> {
  try {
    const result = await callPythonServer<{ contacts: VideoTeamContact[] }>(
      'search_contacts',
      {
        query: searchQuery,
        category: searchCategory,
      }
    );
    return result.contacts || [];
  } catch (error) {
    console.error('Failed to search contacts:', error);
    throw new Error(`Failed to search contacts: ${error}`);
  }
}

/**
 * Fetch full message detail (HTML content, attachments, etc.)
 */
export async function fetchMessageDetail(
  messageId: string,
  itemCode?: string
): Promise<VideoTeamMessageDetail> {
  try {
    const result = await callPythonServer<VideoTeamMessageDetail>(
      'get_message_detail',
      { message_id: messageId, item_code: itemCode }
    );
    return result;
  } catch (error) {
    console.error('Failed to fetch message detail:', error);
    throw new Error(`Failed to fetch message detail: ${error}`);
  }
}

/**
 * Get default assignment values (cached from Supabase or user preferences)
 */
export async function fetchAssignmentDefaults(): Promise<AssignmentDefaults> {
  // For now, return empty defaults
  // This can be enhanced to read from Supabase or Raycast preferences
  return {
    defaultOwnerId: undefined,
    defaultStage: undefined,
    defaultStatus: undefined,
  };
}

/**
 * Send email to athlete (automation helper)
 */
export async function sendEmailToAthlete(
  athleteEmail: string,
  subject: string,
  body: string
): Promise<boolean> {
  try {
    const result = await callPythonServer<{ success: boolean }>(
      'send_email',
      {
        to: athleteEmail,
        subject,
        body,
      }
    );
    return result.success;
  } catch (error) {
    console.error('Failed to send email:', error);
    throw new Error(`Failed to send email: ${error}`);
  }
}
