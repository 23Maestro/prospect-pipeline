import { apiFetch } from "./python-server-client";
import {
  AssignVideoTeamPayload,
  NPIDInboxMessage,
  AthleteNote,
  VideoTeamAssignmentModal,
  VideoTeamContact,
  VideoTeamSearchCategory,
} from "../types/video-team";

/**
 * Fetch inbox threads via FastAPI.
 * Endpoint: POST /api/v1/inbox/threads
 */
export async function fetchInboxThreads(
  limit: number,
  filter_assigned: "unassigned" | "assigned" | "both"
): Promise<NPIDInboxMessage[]> {
  const response = await apiFetch("/inbox/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit, filter_assigned }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch inbox threads: ${response.status}`);
  }

  const data = await response.json() as any;
  return data.threads || [];
}

/**
 * Fetch message detail via FastAPI.
 * Endpoint: POST /api/v1/inbox/message
 */
export async function fetchMessageDetail(
  message_id: string,
  item_code: string
): Promise<{
  content: string;
  timestamp?: string;
  subject?: string;
  from_name?: string;
  from_email?: string;
  message_id?: string;
  item_code?: string;
  attachments?: Array<{
    fileName: string;
    url: string;
    downloadable: boolean;
    expiresAt?: string | null;
  }>;
}> {
  const response = await apiFetch("/inbox/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_id, item_code }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch message detail: ${response.status}`);
  }

  return response.json() as any;
}

/**
 * Send reply to inbox message via FastAPI.
 * Endpoint: POST /api/v1/inbox/reply
 */
export async function sendInboxReply(
  message_id: string,
  item_code: string,
  reply_text: string
): Promise<{ success: boolean }> {
  const response = await apiFetch("/inbox/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_id, item_code, reply_text }),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as any;
    throw new Error(error.detail || `Reply failed: ${response.status}`);
  }

  return response.json() as any;
}

/**
 * Fetch assignment modal data via FastAPI.
 * Endpoint: POST /api/v1/inbox/assignment-modal
 */
export async function fetchAssignmentModal(
  message_id: string,
  item_code: string
): Promise<{ modal: VideoTeamAssignmentModal; contacts: VideoTeamContact[] }> {
  const response = await apiFetch("/inbox/assignment-modal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_id, item_code }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch assignment modal: ${response.status}`);
  }

  const data = await response.json() as any;
  return {
    modal: data.modal,
    contacts: [] // Contacts fetched separately via search
  };
}

/**
 * Assign video team message via FastAPI.
 * Endpoint: POST /api/v1/inbox/assign
 * Returns: { success, contact_id, athlete_main_id, message_id }
 */
export async function assignVideoTeamMessage(
  payload: AssignVideoTeamPayload
): Promise<{ success: boolean; contact_id?: string; athlete_main_id?: string; message_id?: string }> {
  const response = await apiFetch("/inbox/assign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      contactFor: payload.searchFor ?? payload.contactFor ?? 'athlete',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as any;
    throw new Error(error.detail || `Assignment failed: ${response.status}`);
  }

  return response.json() as any;
}

/**
 * Search contacts via FastAPI.
 * Endpoint: POST /api/v1/inbox/contacts/search
 */
async function searchContacts(query: string, search_type: string): Promise<VideoTeamContact[]> {
  const response = await apiFetch("/inbox/contacts/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, search_type }),
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json() as any;
  return data.contacts || [];
}

/**
 * CRITICAL CONTACT RESOLUTION RULE - DO NOT MODIFY WITHOUT UPDATING .kiro/steering/contact-resolution.md
 *
 * When assigning video team messages, contact type determination follows this EXACT logic:
 * 1. First, try searching as "athlete" (the student athlete themselves)
 * 2. If NO results found → the message is from a PARENT → search as "parent"
 * 3. If results found → the message is from the STUDENT ATHLETE → use "athlete" results
 * 4. If still no results → suggest manual website search (video progress search is ONLY for assignment modal)
 *
 * This prevents data loss when contact information is missing or incomplete.
 */
export async function resolveContactsForAssignment(
  searchValue: string,
  defaultSearchFor: VideoTeamSearchCategory
): Promise<{ contacts: VideoTeamContact[]; searchForUsed: VideoTeamSearchCategory }> {
  // STEP 1: Always try athlete first (default behavior)
  let contacts = await searchContacts(searchValue, defaultSearchFor);

  // STEP 2: If no results and we searched for athlete, fallback to parent
  if (contacts.length === 0 && defaultSearchFor === 'athlete') {
    contacts = await searchContacts(searchValue, 'parent');

    // Return parent as the searchForUsed since we found results there
    if (contacts.length > 0) {
      return { contacts, searchForUsed: 'parent' };
    }
  }

  // STEP 3: Return whatever we found with the original search type
  return { contacts, searchForUsed: defaultSearchFor };
}

/**
 * Fetch athlete notes via FastAPI.
 */
export async function fetchAthleteNotes(
  athleteId: string,
  athleteMainId: string
): Promise<AthleteNote[]> {
  const response = await apiFetch("/notes/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as any;
    throw new Error(error.detail || `Failed to load notes: ${response.status}`);
  }

  const data = await response.json() as { notes?: AthleteNote[] };
  return data?.notes ?? [];
}

/**
 * Add a new athlete note.
 */
export async function addAthleteNote(params: {
  athleteId: string;
  athleteMainId: string;
  title: string;
  description: string;
}): Promise<void> {
  const response = await apiFetch("/notes/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      athlete_id: params.athleteId,
      athlete_main_id: params.athleteMainId,
      title: params.title,
      description: params.description,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as any;
    throw new Error(error.detail || `Failed to add note: ${response.status}`);
  }

  const result = await response.json().catch(() => ({})) as any;
  if (result?.success === false) {
    throw new Error(result?.message || "Failed to add note");
  }
}

/**
 * Fetch assignment defaults via FastAPI.
 * Endpoint: POST /api/v1/inbox/assignment-defaults
 */
export async function fetchAssignmentDefaults(
  contact_id: string
): Promise<{ stage?: string; status?: string }> {
  const response = await apiFetch("/inbox/assignment-defaults", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact_id }),
  });

  if (!response.ok) {
    return { stage: undefined, status: undefined };
  }

  return response.json() as any;
}

/**
 * Send email to athlete via FastAPI.
 * Uses the email router: POST /api/v1/email/send
 * Note: This endpoint still uses the email router, not inbox router
 */
export async function sendEmailToAthlete(
  athleteName: string,
  templateName: string
): Promise<{ success: boolean; error?: string }> {
  // For now, keep using callPythonServer until email router is connected
  // to the video progress page email functionality
  const { callPythonServer } = await import("./python-server-client");
  return callPythonServer<{ success: boolean; error?: string }>("send_email_to_athlete", {
    athlete_name: athleteName,
    template_name: templateName,
  });
}

/**
 * Video attachment from athlete.
 */
export interface VideoAttachment {
  athlete_id: string;
  athletename: string;
  attachment: string; // Filename
  created_date: string;
  expiry_date: string;
  fileType: string; // MP4, etc.
  message_id: string; // video_msg_id alias
}

/**
 * Fetch all video mail attachments via FastAPI.
 * Endpoint: GET /api/v1/video/attachments
 */
export async function fetchVideoAttachments(): Promise<VideoAttachment[]> {
  const response = await apiFetch("/video/attachments", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch video attachments: ${response.status}`);
  }

  const data = (await response.json()) as { attachments: VideoAttachment[]; count: number };
  return data.attachments || [];
}

/**
 * Resolved athlete IDs.
 */
export interface ResolvedAthleteIds {
  athlete_id: string;
  athlete_main_id: string;
  name?: string;
  grad_year?: string;
  high_school?: string;
  city?: string;
  state?: string;
  positions?: string;
  sport?: string;
}

/**
 * Bulk resolve missing athlete_main_id values for inbox threads.
 * Uses /athlete/{athlete_id}/resolve endpoint with caching.
 *
 * EDGE CASE: 98% of 375 inbox athletes are missing cached athlete_main_id.
 * This function proactively resolves all missing IDs on inbox load.
 */
export async function bulkResolveAthleteMainIds(
  threads: NPIDInboxMessage[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const missingIds: string[] = [];

  // Identify threads missing athlete_main_id
  for (const thread of threads) {
    const athleteId = thread.contact_id || thread.player_id || thread.thread_id;

    if (!athleteId) {
      console.warn('⚠️ Thread missing all ID fields:', thread.id);
      continue;
    }

    if (!thread.athleteMainId) {
      missingIds.push(athleteId);
    } else {
      resolved.set(athleteId, thread.athleteMainId);
    }
  }

  console.log(`🔍 BULK RESOLVE: ${missingIds.length} of ${threads.length} threads missing athlete_main_id`);

  if (missingIds.length === 0) {
    return resolved;
  }

  // Batch resolve with concurrency limit (10 at a time)
  const BATCH_SIZE = 10;
  for (let i = 0; i < missingIds.length; i += BATCH_SIZE) {
    const batch = missingIds.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (athleteId) => {
      try {
        const response = await apiFetch(`/athlete/${encodeURIComponent(athleteId)}/resolve`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
          console.warn(`⚠️ Failed to resolve ${athleteId}: ${response.status}`);
          return;
        }

        const data = (await response.json()) as ResolvedAthleteIds;
        if (data.athlete_main_id) {
          resolved.set(athleteId, data.athlete_main_id);
          console.log(`✅ Resolved ${athleteId} → ${data.athlete_main_id}`);
        }
      } catch (error) {
        console.error(`❌ Error resolving ${athleteId}:`, error);
      }
    });

    await Promise.all(promises);

    // Progress logging
    const progress = Math.min(i + BATCH_SIZE, missingIds.length);
    console.log(`📊 Progress: ${progress}/${missingIds.length} resolved`);
  }

  console.log(`✅ BULK RESOLVE: Resolved ${resolved.size - (threads.length - missingIds.length)} new IDs`);
  return resolved;
}
