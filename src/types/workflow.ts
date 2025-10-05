export type TaskStage = 'On Hold' | 'Awaiting Client' | 'In Queue' | 'Done';
export type TaskStatus =
  | 'Revisions'
  | 'HUDL'
  | 'Dropbox'
  | 'External Links'
  | 'Not Approved'
  | 'Approved';

export interface VideoTask {
  id: string; // Asana task gid
  taskName: string; // Asana task name
  permalinkUrl: string; // Asana link
  dueOn?: string | null; // YYYY-MM-DD

  // Canonical keys
  player_id?: string; // REQUIRED for sync

  // Stage/Status (DB = source for timelines)
  stage: TaskStage; // Video Stage (enum)
  status: TaskStatus; // Video Status (enum)

  // Metadata (website is source-of-truth for backfill)
  athleteName?: string;
  sport?: string;
  gradYear?: string;
  city?: string;
  state?: string;
  highSchool?: string;
  positions?: string;
  paymentStatus?: 'Paid' | 'Unpaid' | 'Unknown';
}
