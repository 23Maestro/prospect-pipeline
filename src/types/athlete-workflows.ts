export interface VideoUpdateFormValues {
  athleteName: string;
  youtubeLink: string;
  season: string;
  videoType: string;
}

export type VideoUpdateLogStatus = 'start' | 'success' | 'failure';
export type PostUploadStep = 'email' | 'stage' | 'cache' | 'task';

export type PostUploadStepResult = {
  step: PostUploadStep;
  success: boolean;
  error?: string;
  skipped?: boolean;
};

export type AthleteTaskSummary = {
  task_id: string;
  title?: string | null;
  assigned_owner?: string | null;
  completion_date?: string | null;
  description?: string | null;
};

export type EligibleTaskLookupResult =
  | { eligible: true; taskId: string }
  | {
      eligible: false;
      reason: 'missing_assignment' | 'assigned_to_other' | 'already_completed' | 'not_found';
    };

export interface NPIDVideoProgressPlayer {
  primaryPosition?: string;
  secondaryPosition?: string;
  thirdPosition?: string;
  paidStatus?: string;
  athleteName?: string;
  name: string;
  player_id: string;
  id?: number;
  videoProgress?: string;
  videoProgressStatus?: string;
  stage?: string;
  videoDueDate?: string;
  videoDueDateSort?: number;
  sportName?: string;
  sport?: string;
  gradYear?: number;
  grad_year?: number;
  highSchoolCity?: string;
  city?: string;
  highSchoolState?: string;
  state?: string;
  highSchool?: string;
  high_school?: string;
  athleteId?: number;
  assignedVideoEditor?: string;
  assignedDate?: string;
  assignedDateSort?: number;
  athlete_main_id?: string;
}

export interface EmailTemplateOption {
  title: string;
  value: string;
}

export interface EmailRecipients {
  athlete: { email?: string | null; checked?: boolean } | null;
  parents: { id: string; email?: string | null; checked?: boolean }[];
  other_email?: string | null;
}

export interface EmailTemplateData {
  sender_name: string;
  sender_email: string;
  subject: string;
  message: string;
}
