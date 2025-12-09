// src/types/video-team.ts

import { TaskStage, TaskStatus } from './workflow';

/**
 * Represents the structure of a player's data from NPID.
 * This is simplified to match what is used in the extension.
 */
export interface NPIDPlayer {
  player_id: string;
  athlete_name: string;
  grad_year: string;
  high_school: string;
  city: string;
  state: string;
  positions: string;
  payment_status: 'Paid' | 'Unpaid' | 'Unknown';
}

/**
 * Represents the JSON structure of a single message/thread
 * returned by the `inbox_scraper.py` script.
 */
export interface NPIDInboxMessage {
  id: string;
  itemCode: string;
  thread_id: string;
  player_id: string;
  contact_id?: string; // athlete_id alias
  name: string;
  email: string;
  subject: string;
  content: string;
  preview: string;
  status: 'assigned' | 'unassigned';
  timestamp: string;
  timeStampDisplay: string | null;
  timeStampIso: string | null;
  is_reply_with_signature: boolean;
  isUnread?: boolean;
  stage?: string;
  videoStatus?: string;
  canAssign?: boolean;
  athleteMainId?: string | null;
  attachments?: VideoTeamAttachment[];
  athleteLinks?: {
    profile: string;
    search: string;
    notes: string;
  };
}

export interface AthleteNote {
  title: string;
  description: string;
  metadata?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

export interface VideoTeamAttachment {
  fileName: string;
  url: string | null;
  expiresAt: string | null;
  downloadable: boolean;
}

export interface VideoTeamMessageDetail {
  messageId: string;
  itemCode: string;
  subject: string;
  messageHtml: string;
  messageMarkdown: string;
  messagePlain: string;
  fromName: string;
  fromEmail: string;
  toName: string;
  toEmail: string;
  contactId: string;
  videoProgressStatus: string;
  stage: string;
  isAssigned: boolean;
  rawTimeStamp: string;
  timeStampDisplay: string | null;
  timeStampIso: string | null;
  unreadCount: number;
  attachments: VideoTeamAttachment[];
  athleteLinks: {
    profile: string;
    search: string;
    notes: string;
  };
  statusMeta: {
    active: string;
    lock: string;
    clientUpdate: string;
    lastPayment: string;
  };
}

export type VideoTeamSearchCategory =
  | 'athlete'
  | 'parent'
  | 'hs coach'
  | 'club coach'
  | 'college coach';

export interface VideoTeamContact {
  contactId: string;
  athleteMainId: string | null;
  name: string;
  top500: string | null;
  gradYear: string | null;
  state: string | null;
  sport: string | null;
  videoEditor: string | null;
  email?: string | null;
}

export interface VideoTeamAssignmentOwner {
  value: string;
  label: string;
  color?: string | null;
  selected?: boolean;
}

export interface VideoTeamAssignmentOption {
  value: string;
  label: string;
}

export interface VideoTeamAssignmentModal {
  formToken: string;
  messageId: string;
  owners: VideoTeamAssignmentOwner[];
  defaultOwner?: VideoTeamAssignmentOwner;
  stages: VideoTeamAssignmentOption[];
  videoStatuses: VideoTeamAssignmentOption[];
  defaultSearchFor: VideoTeamSearchCategory;
  contactSearchValue: string;
  contactTask?: string;
  athleteMainId?: string | null;
  contactFor: VideoTeamSearchCategory;
}

/**
 * Represents the data required for an assignment action.
 * This is used by the assignment modal.
 */
export interface VideoTeamAssignment {
  messageId: string;
  contactId: string;
  athleteMainId?: string | null;
  ownerId: string;
  stage: TaskStage;
  status: TaskStatus;
  dueDate?: string;
  searchFor: VideoTeamSearchCategory;
}

/**
 * Payload for assigning video team message via API.
 */
export interface AssignVideoTeamPayload {
  messageId: string;
  ownerId: string;
  contact_id?: string;
  contactId?: string;
  athleteMainId?: string;
  stage?: string;
  status?: string;
  contactFor?: string;
  searchFor?: string;
  contact?: string;
  formToken?: string;
}
