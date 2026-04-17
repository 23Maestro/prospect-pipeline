export type ScoutPrepGrade = 'Freshman' | 'Sophomore' | 'Junior' | 'Senior';

export type ScoutPrepFormValues = {
  athleteName: string;
  parent1Name: string;
  parent2Name?: string;
  gradYear: ScoutPrepGrade;
  sport: string;
};

export type ScoutPrepAIOutput = {
  rapportCues: string[];
  localTimeInsight?: string | null;
  rapportSource: 'ai' | 'fallback';
  microEnrichment?: ScoutPrepMicroEnrichment | null;
};

export type ScoutPrepMicroEnrichment = {
  rapportAnchor?: string | null;
  suggestedLiveRapportLane?: string | null;
  gpaToneLine?: string | null;
  deficitEmphasis?: string | null;
  sportPromptBias?: string | null;
};

export type ScoutPortalTask = {
  task_id?: string | null;
  contact_id: string;
  athlete_main_id?: string | null;
  athlete_id?: string | null;
  athlete_name: string;
  due_date?: string | null;
  completion_date?: string | null;
  assigned_owner?: string | null;
  grad_year?: string | null;
  title?: string | null;
  description?: string | null;
  athlete_admin_url?: string | null;
  athlete_profile_url?: string | null;
  athlete_task_url?: string | null;
};

export type ScoutRecentProfile = {
  athlete_id: string;
  athlete_main_id: string;
  athlete_name: string;
  grad_year?: string | null;
  sport?: string | null;
  state?: string | null;
  parent_names?: string[] | null;
};

export type ScoutRecentProfileCheckStatus = 'loading' | 'matched' | 'not_found' | 'error';

export type ScoutPrepContext = {
  task: ScoutPortalTask;
  resolved: {
    athlete_id?: string | null;
    athlete_main_id?: string | null;
    sport?: string | null;
    high_school?: string | null;
    city?: string | null;
    state?: string | null;
    positions?: string | null;
    gpa?: string | null;
    height?: string | null;
    weight?: string | null;
  };
  contactInfo: {
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
  };
  notes: Array<{
    title: string;
    description: string;
    metadata?: string | null;
    created_by?: string | null;
    created_at?: string | null;
  }>;
  tasks: Array<{
    task_id?: string;
    title?: string | null;
    assigned_owner?: string | null;
    due_date?: string | null;
    completion_date?: string | null;
    description?: string | null;
    row_text?: string | null;
  }>;
};

export type ScoutAthleteTask = {
  task_id: string;
  title?: string | null;
  assigned_owner?: string | null;
  due_date?: string | null;
  completion_date?: string | null;
  description?: string | null;
  row_text?: string | null;
};

export type SalesStageOption = {
  value: string;
  label: string;
  selected: boolean;
};

export type SalesStageOptionsResponse = {
  success: boolean;
  count: number;
  selected_value?: string | null;
  selected_label?: string | null;
  options: SalesStageOption[];
};

export type SalesStageUpdateResponse = {
  success: boolean;
  stage: string;
  athlete_id: string;
  athlete_main_id: string;
  status_code: number;
  tasks_count: number;
  created_task?: ScoutAthleteTask | null;
};

export type MeetingSetTemplateResponse = {
  success: boolean;
  meeting_name?: string | null;
  selected_recruit_timezone?: string | null;
  recruit_timezone_options: SalesStageOption[];
  details_template?: string | null;
};
