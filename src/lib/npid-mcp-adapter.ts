import { apiFetch } from "./python-server-client";
import {
  AssignVideoTeamPayload,
  NPIDInboxMessage,
  AthleteNote,
  VideoTeamAssignmentModal,
  VideoTeamContact,
  VideoTeamSearchCategory,
} from "../types/video-team";
import { logger } from "./logger";

/**
 * Fetch inbox threads via FastAPI.
 * Endpoint: POST /api/v1/inbox/threads
 */
export async function fetchInboxThreads(
  limit: number,
  filter_assigned: "unassigned" | "assigned" | "both",
  pageStartNumber = 1,
  onlyPagination = false,
  searchText = ""
): Promise<NPIDInboxMessage[]> {
  const response = await apiFetch("/inbox/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit,
      filter_assigned,
      page_start_number: pageStartNumber,
      only_pagination: false,  // Always false - matches Python reference
      search_text: searchText,
    }),
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
  contact_id?: string;
  athlete_main_id?: string;
  athlete_links?: {
    profile?: string;
    notes?: string;
    search?: string;
    addVideoForm?: string;
  };
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
 * Fetch athlete name via FastAPI.
 * Endpoint: GET /api/v1/athlete/{athlete_id}/name
 */
export async function fetchAthleteName(
  athleteId: string
): Promise<string | null> {
  const response = await apiFetch(`/athlete/${encodeURIComponent(athleteId)}/name`, {
    method: "GET",
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json().catch(() => ({})) as any;
  return data?.name ? String(data.name) : null;
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
  console.log('📧 sendInboxReply called:', { message_id, item_code, reply_text_length: reply_text.length });
  const response = await apiFetch("/inbox/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_id, item_code, reply_text }),
  });

  console.log('📧 inbox/reply response status:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('📧 inbox/reply error response:', errorText);
    let error: any;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { detail: errorText };
    }
    const errorMsg = typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail || error);
    throw new Error(errorMsg || `Reply failed: ${response.status}`);
  }

  const result = await response.json() as any;
  console.log('📧 inbox/reply success:', result);
  return result;
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
  console.log('📝 fetchAthleteNotes API call:', { athleteId, athleteMainId });
  const response = await apiFetch("/notes/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      athlete_id: String(athleteId),
      athlete_main_id: String(athleteMainId),
    }),
  });

  console.log('📝 notes/list response status:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('📝 notes/list error response:', errorText);
    let error: any;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { detail: errorText };
    }
    const errorMsg = typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail || error);
    throw new Error(errorMsg || `Failed to load notes: ${response.status}`);
  }

  const data = await response.json() as { notes?: AthleteNote[] };
  console.log('📝 notes/list success, notes count:', data?.notes?.length ?? 0);
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
  console.log('📝 addAthleteNote API call:', params);
  const response = await apiFetch("/notes/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      athlete_id: String(params.athleteId),
      athlete_main_id: String(params.athleteMainId),
      title: params.title,
      description: params.description,
    }),
  });

  console.log('📝 notes/add response status:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('📝 notes/add error response:', errorText);
    let error: any;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { detail: errorText };
    }
    const errorMsg = typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail || error);
    throw new Error(errorMsg || `Failed to add note: ${response.status}`);
  }

  const result = await response.json().catch(() => ({})) as any;
  console.log('📝 notes/add response:', result);
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
): Promise<{ athleteMainIds: Map<string, string> }> {
  const athleteMainIds = new Map<string, string>();
  const missingIds: string[] = [];

  // Identify threads missing athlete_main_id
  for (const thread of threads) {
    // Only resolve using a real athlete/contact id.
    // DO NOT fallback to thread/message ids (video_msg_id), those will corrupt mappings.
    const athleteId = thread.contact_id || (thread as any).athlete_id;

    if (!athleteId) {
      console.warn('⚠️ Thread missing contact_id; skipping resolve:', thread);
      continue;
    }

    if (!thread.athleteMainId) {
      missingIds.push(athleteId);
    } else {
      athleteMainIds.set(athleteId, thread.athleteMainId);
    }
  }

  console.log(`🔍 BULK RESOLVE: ${missingIds.length} of ${threads.length} threads missing athlete_main_id`);

  if (missingIds.length === 0) {
    return { athleteMainIds };
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
          athleteMainIds.set(athleteId, data.athlete_main_id);
          console.log(`✅ Resolved ${athleteId} → main_id: ${data.athlete_main_id}`);
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

  console.log(`✅ BULK RESOLVE: Resolved ${athleteMainIds.size} athlete_main_ids`);
  return { athleteMainIds };
}

// ============== Contact Enrichment ==============

export interface ContactInfo {
  contactId: string;
  studentAthlete: {
    name: string;
    email: string | null;
    phone: string | null;
  };
  parent1: {
    name: string;
    relationship: string;
    email: string | null;
    phone: string | null;
  } | null;
  parent2: {
    name: string;
    relationship: string;
    email: string | null;
    phone: string | null;
  } | null;
}

/**
 * Fetch enriched contact info (student + parents).
 * Endpoint: GET /api/v1/contacts/{contact_id}/enriched
 */
export async function fetchContactInfo(
  contactId: string,
  athleteMainId: string
): Promise<ContactInfo> {
  logger.info(`🌐 API: Fetching contact info for ${contactId}`, { athleteMainId });

  const response = await apiFetch(
    `/contacts/${contactId}/enriched?athlete_main_id=${athleteMainId}`
  );

  if (!response.ok) {
    logger.error(`❌ API: Failed to fetch contact info for ${contactId}`, {
      status: response.status,
      statusText: response.statusText,
    });
    throw new Error(`Failed to fetch contact info: ${response.status}`);
  }

  const data = await response.json();
  logger.info(`✅ API: Successfully fetched contact info for ${contactId}`, {
    hasStudent: !!data.student_athlete,
    hasParent1: !!data.parent1,
    hasParent2: !!data.parent2,
  });

  return data;
}

/**
 * Transform API ContactInfo to cache format.
 */
export function transformContactInfoToCache(info: ContactInfo): any {
  return {
    contactId: Number(info.contactId),
    studentName: info.studentAthlete.name,
    studentEmail: info.studentAthlete.email,
    studentPhone: info.studentAthlete.phone,
    parent1Name: info.parent1?.name || null,
    parent1Relationship: info.parent1?.relationship || null,
    parent1Email: info.parent1?.email || null,
    parent1Phone: info.parent1?.phone || null,
    parent2Name: info.parent2?.name || null,
    parent2Relationship: info.parent2?.relationship || null,
    parent2Email: info.parent2?.email || null,
    parent2Phone: info.parent2?.phone || null,
  };
}

/**
 * Transform cached data to ContactInfo format.
 */
export function transformCacheToContactInfo(cached: any): ContactInfo {
  return {
    contactId: String(cached.contactId),
    studentAthlete: {
      name: cached.studentName,
      email: cached.studentEmail,
      phone: cached.studentPhone,
    },
    parent1: cached.parent1Name
      ? {
          name: cached.parent1Name,
          relationship: cached.parent1Relationship || 'Parent',
          email: cached.parent1Email,
          phone: cached.parent1Phone,
        }
      : null,
    parent2: cached.parent2Name
      ? {
          name: cached.parent2Name,
          relationship: cached.parent2Relationship || 'Parent',
          email: cached.parent2Email,
          phone: cached.parent2Phone,
        }
      : null,
  };
}
