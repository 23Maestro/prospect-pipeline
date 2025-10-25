// Database types matching Supabase schema
// ACTUAL status values - no fabrication!

export type TaskSource = 'HUDL' | 'Dropbox' | 'YouTube' | 'Inbox';

export type TaskStatus =
  | 'HUDL'
  | 'Dropbox'
  | 'Not Approved'
  | 'Revise'
  | 'Done'
  | 'Upload';

export type VideoType =
  | 'Full Season Highlight'
  | 'Partial Season Highlight'
  | 'Single Game Highlight'
  | 'Skills/Training Video';

export interface Athlete {
  id: string;
  name: string;
  grad_year: number | null;
  sport: string | null;
  high_school: string | null;
  city: string | null;
  state: string | null;
  player_id: string | null; // NPID player ID
  email: string | null;
  phone: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  athlete_id: string;
  source: TaskSource;
  status: TaskStatus;
  title: string;
  body: string | null;
  due_date: string | null; // ISO date string
  season: number | null;
  sport: string | null;
  positions: string[] | null;
  youtube_link: string | null;
  video_type: VideoType | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  embedding: number[] | null;
}

export interface TaskWithAthlete extends Task {
  athlete: Athlete;
}

// API Response types
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

// Form types
export interface CreateTaskInput {
  athlete_id: string;
  source: TaskSource;
  status: TaskStatus;
  title: string;
  body?: string;
  due_date?: string;
  season?: number;
  sport?: string;
  positions?: string[];
  youtube_link?: string;
  video_type?: VideoType;
  assigned_to?: string;
  [key: string]: unknown;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  title?: string;
  body?: string;
  due_date?: string;
  youtube_link?: string;
  video_type?: VideoType;
  assigned_to?: string;
  [key: string]: unknown;
}

// Kanban column configuration
export interface KanbanColumn {
  id: TaskStatus;
  title: string;
  color: string;
}

export const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'HUDL', title: 'HUDL', color: 'bg-orange-500' },
  { id: 'Dropbox', title: 'Dropbox', color: 'bg-blue-500' },
  { id: 'Not Approved', title: 'Not Approved', color: 'bg-red-500' },
  { id: 'Revise', title: 'Revise', color: 'bg-yellow-500' },
  { id: 'Upload', title: 'Upload', color: 'bg-purple-500' },
  { id: 'Done', title: 'Done', color: 'bg-green-500' },
];

// Email template mapping
export function getEmailTemplateForStatus(status: TaskStatus): string | null {
  switch (status) {
    case 'Done':
      return 'Editing Done';
    case 'Revise':
      return 'Video Instructions';
    default:
      return null; // No automatic email for other statuses
  }
}
