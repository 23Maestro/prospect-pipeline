import { callPythonServer } from "./python-server-client";
import {
  AssignVideoTeamPayload,
  NPIDInboxMessage,
  VideoTeamAssignmentModal,
  VideoTeamContact,
  VideoTeamSearchCategory,
} from "../types/video-team";

export async function fetchInboxThreads(
  limit: number,
  filter_assigned: "unassigned" | "assigned" | "both"
): Promise<NPIDInboxMessage[]> {
  return callPythonServer<NPIDInboxMessage[]>("get_inbox_threads", { limit, filter_assigned });
}

export async function fetchMessageDetail(
  message_id: string,
  item_code: string
): Promise<{ content: string }> {
  return callPythonServer<{ content: string }>("get_message_detail", { message_id, item_code });
}

export async function fetchAssignmentModal(
  message_id: string,
  item_code: string
): Promise<{ modal: VideoTeamAssignmentModal; contacts: VideoTeamContact[] }> {
  const modalData = await callPythonServer<VideoTeamAssignmentModal>(
    "get_assignment_modal",
    { message_id, item_code }
  );
  
  // Python returns modal data directly, wrap it for compatibility
  return {
    modal: modalData,
    contacts: [] // No preloaded contacts from modal
  };
}

export async function assignVideoTeamMessage(
  payload: AssignVideoTeamPayload
): Promise<{ success: boolean }> {
  const response = await callPythonServer<{ success: boolean }>("assign_thread", {
    ...payload,
    contactFor: payload.searchFor ?? payload.contactFor ?? 'athlete',
  });
  return response;
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
  let contacts = await callPythonServer<VideoTeamContact[]>("search_contacts", {
    query: searchValue,
    search_type: defaultSearchFor,
  });

  // STEP 2: If no results and we searched for athlete, fallback to parent
  if (contacts.length === 0 && defaultSearchFor === 'athlete') {
    contacts = await callPythonServer<VideoTeamContact[]>("search_contacts", {
      query: searchValue,
      search_type: 'parent',
    });

    // Return parent as the searchForUsed since we found results there
    if (contacts.length > 0) {
      return { contacts, searchForUsed: 'parent' };
    }
  }

  // STEP 3: Return whatever we found with the original search type
  return { contacts, searchForUsed: defaultSearchFor };
}

export async function fetchAssignmentDefaults(
  contact_id: string
): Promise<{ stage?: string; status?: string }> {
  return callPythonServer<{ stage?: string; status?: string }>("get_assignment_defaults", {
    contact_id,
  });
}

export async function sendEmailToAthlete(
  athleteName: string,
  templateName: string
): Promise<{ success: boolean; error?: string }> {
  return callPythonServer<{ success: boolean; error?: string }>("send_email_to_athlete", {
    athlete_name: athleteName,
    template_name: templateName,
  });
}
