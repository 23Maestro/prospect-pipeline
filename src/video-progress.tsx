import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Form,
  Icon,
  List,
  Toast,
  showToast,
  useNavigation,
  getPreferenceValues,
  Clipboard,
} from '@raycast/api';
import { format } from 'date-fns';
import { useEffect, useState, useRef } from 'react';
import { apiFetch } from './lib/python-server-client';
import {
  getCachedTasks,
  upsertTasks,
  updateCachedTaskStatusStage,
  getCachedContactInfo,
  upsertContactInfo,
} from './lib/video-progress-cache';
import { batchResolveAndCache, getAthleteMainId } from './lib/athlete-id-service';
import {
  fetchContactInfo,
  transformContactInfoToCache,
  transformCacheToContactInfo,
  type ContactInfo,
} from './lib/npid-mcp-adapter';
import { AthleteNotesList, AddAthleteNoteForm } from './components/athlete-notes';
import { logger } from './lib/logger';
import EmailStudentAthletesCommand from './email-student-athletes';

interface VideoProgressTask {
  id?: number; // video_msg_id for updates
  athlete_id: number;
  athlete_main_id?: string;
  athletename: string;
  video_progress_status: string;
  stage: string;
  sport_name: string;
  grad_year: number;
  video_due_date: string;
  assignedvideoeditor: string;
  primaryposition: string;
  secondaryposition: string;
  thirdposition: string;
  high_school: string;
  high_school_city: string;
  high_school_state: string;
  date_completed?: string;
  raw_search?: boolean;
  [key: string]: any;
}

interface RawSearchResult {
  athlete_id: string;
  athlete_main_id?: string;
  name?: string;
  grad_year?: string;
  sport?: string;
  state?: string;
  city?: string;
  high_school?: string;
  email?: string;
  positions?: string;
  source?: string;
}

interface RawSearchResponse {
  success: boolean;
  count: number;
  results: RawSearchResult[];
  sources?: Array<Record<string, any>>;
}

const MIN_ACTIVE_GRAD_YEAR = 2026;
const STAGE_PRIORITY: Record<string, number> = {
  'in queue': 1,
  'awaiting client': 2,
  'on hold': 3,
  'done': 4,
};

async function readResponseBody(response: any) {
  const contentType = response?.headers?.get?.('content-type') || '';
  const text = await response.text();
  let json: any = null;
  if (contentType.includes('application/json')) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { text, json, contentType };
}

function getPositions(task: VideoProgressTask): string {
  return [task.primaryposition, task.secondaryposition, task.thirdposition]
    .filter(pos => pos && pos !== 'NA')
    .join(' | ');
}

function splitRawPositions(positions?: string): { primary: string; secondary: string; third: string } {
  if (!positions) {
    return { primary: '', secondary: '', third: '' };
  }
  const parts = positions
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    primary: parts[0] || '',
    secondary: parts[1] || '',
    third: parts[2] || '',
  };
}

function mapRawSearchResultToTask(result: RawSearchResult, index: number): VideoProgressTask {
  const rawId = Number(result.athlete_id);
  const athleteId = Number.isFinite(rawId) && rawId > 0 ? rawId : -(index + 1);
  const gradYear = Number(result.grad_year) || 0;
  const positions = splitRawPositions(result.positions);
  const sourceLabel = result.source ? `Raw Search (${result.source})` : 'Raw Search';

  return {
    athlete_id: athleteId,
    athlete_main_id: result.athlete_main_id,
    athletename: result.name || result.athlete_id || 'Unknown',
    video_progress_status: sourceLabel,
    stage: sourceLabel,
    sport_name: result.sport || '',
    grad_year: gradYear,
    video_due_date: '',
    assignedvideoeditor: '',
    primaryposition: positions.primary,
    secondaryposition: positions.secondary,
    thirdposition: positions.third,
    high_school: result.high_school || '',
    high_school_city: result.city || '',
    high_school_state: result.state || '',
    raw_search: true,
  };
}

function getStatusIcon(status: string): { source: string } | Icon {
  switch (status) {
    case 'Revise':
    case 'Revisions':
      return { source: 'revisions-icon.png' };
    case 'HUDL':
      return { source: 'hudl-logo.png' };
    case 'Dropbox':
      return { source: 'dropbox-ios.png' };
    case 'Not Approved':
      return Icon.XMarkCircle;
    case 'External Links':
      return { source: 'external-links.png' };
    default:
      return Icon.Circle;
  }
}

function getStageIcon(stage: string): { source: string } | Icon {
  switch (stage) {
    case 'In Queue':
      return { source: 'in-queue-stage.png' };
    case 'Awaiting Client':
      return { source: 'awaiting-stage.png' };
    case 'On Hold':
      return { source: 'on-hold-stage.png' };
    case 'Done':
      return { source: 'done-stage.png' };
    default:
      return Icon.Circle;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'Revise':
    case 'Revisions':
      return '#AF52DE';
    case 'HUDL':
      return '#FF3B30';
    case 'Dropbox':
      return '#007AFF';
    case 'Not Approved':
      return '#FF9500';
    case 'Uploads':
      return '#FF2D92';
    case 'External Links':
      return '#34C759';
    default:
      return '#8E8E93';
  }
}

const getTaskStage = (task: VideoProgressTask) =>
  (task.video_progress_stage || task.stage || '').trim();

const normalizeStageValue = (stage?: string) => (stage || '').trim().toLowerCase();

function formatDate(dateString: string): string {
  if (!dateString) return 'No due date';
  try {
    return format(new Date(dateString), 'MMM d, yyyy');
  } catch {
    return dateString;
  }
}

function normalizeStatus(displayStatus: string): 'revisions' | 'hudl' | 'dropbox' | 'external_links' | 'not_approved' {
  switch (displayStatus.toLowerCase()) {
    case 'revise':
    case 'revisions':
      return 'revisions';
    case 'hudl':
      return 'hudl';
    case 'dropbox':
      return 'dropbox';
    case 'external links':
    case 'external_links':
      return 'external_links';
    case 'not approved':
    case 'not_approved':
      return 'not_approved';
    default:
      return 'hudl';
  }
}

function normalizeStage(displayStage: string): 'on_hold' | 'awaiting_client' | 'in_queue' | 'done' {
  switch (displayStage.toLowerCase()) {
    case 'on hold':
    case 'on_hold':
      return 'on_hold';
    case 'awaiting client':
    case 'awaiting_client':
      return 'awaiting_client';
    case 'in queue':
    case 'in_queue':
      return 'in_queue';
    case 'done':
      return 'done';
    default:
      return 'in_queue';
  }
}

function getSeasonName(gradYear: number): string {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0 = January, 7 = August

  // Determine the school year (year it started in fall)
  // If we're before August, we're in the school year that started last fall
  // If we're in August or later, we're in the school year that started this fall
  const schoolYearStart = currentMonth >= 7 ? currentYear : currentYear - 1;

  // Calculate grade level based on years until graduation
  const yearsUntilGrad = gradYear - schoolYearStart;

  switch (yearsUntilGrad) {
    case 1:
      return 'Senior Season';
    case 2:
      return 'Junior Season';
    case 3:
      return 'Sophomore Season';
    case 4:
      return 'Freshman Season';
    case 5:
      return '8th Grade Season';
    case 6:
      return '7th Grade Season';
    default:
      return 'Highlights';
  }
}

function generateYouTubeTitle(task: VideoProgressTask): string {
  // Dynamic title: "Name Class of YEAR Season"
  const seasonName = getSeasonName(task.grad_year);
  const parts = [
    task.athletename,
    task.grad_year ? `Class of ${task.grad_year}` : '',
    seasonName,
  ]
    .filter(Boolean)
    .join(' ');
  return parts;
}

function normalizeSportName(sport: string): string {
  // Strip "Men's " or "Women's " prefix from sport names
  return sport.replace(/^(Men's|Women's)\s+/i, '');
}

function generateDropboxFolder(task: VideoProgressTask): string {
  // Format: PascalCaseName_YEAR_Sport_STATE
  const pascalName = task.athletename
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
  return [pascalName, task.grad_year, normalizeSportName(task.sport_name), task.high_school_state]
    .filter(Boolean)
    .join('_');
}

function shouldIncludeTask(task: VideoProgressTask): boolean {
  if (!task.assignedvideoeditor || task.assignedvideoeditor.trim() !== 'Jerami Singleton') {
    return false;
  }
  const gradYear = Number(task.grad_year);
  if (Number.isFinite(gradYear) && gradYear > 0 && gradYear < MIN_ACTIVE_GRAD_YEAR) {
    return false;
  }
  return true;
}

function sortTasks(tasks: VideoProgressTask[]): VideoProgressTask[] {
  return [...tasks].sort((a, b) => {
    const aYear = Number(a.grad_year) || 9999;
    const bYear = Number(b.grad_year) || 9999;
    if (aYear !== bYear) return aYear - bYear;

    const aStage = getTaskStage(a).toLowerCase();
    const bStage = getTaskStage(b).toLowerCase();
    const aStageRank = STAGE_PRIORITY[aStage] ?? 99;
    const bStageRank = STAGE_PRIORITY[bStage] ?? 99;
    if (aStageRank !== bStageRank) return aStageRank - bStageRank;

    const aDue = a.video_due_date ? new Date(a.video_due_date).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.video_due_date ? new Date(b.video_due_date).getTime() : Number.POSITIVE_INFINITY;
    return aDue - bDue;
  });
}

function ApprovedVideoDetail(task: VideoProgressTask, onBack: () => void): string {
  const positions = getPositions(task);
  const lines = [
    task.athletename.toUpperCase(),
    positions ? `Class of ${task.grad_year} - ${positions}` : `Class of ${task.grad_year}`,
    task.high_school,
    `${task.high_school_city}, ${task.high_school_state}`,
  ];
  return lines.join('\n');
}

interface DetailProps {
  task: VideoProgressTask;
  onBack: () => void;
  onStatusUpdate: (updatedTasks?: VideoProgressTask[]) => void;
}

function VideoProgressDetail({ task, onBack, onStatusUpdate }: DetailProps) {
  const { push, pop } = useNavigation();
  const [isUpdating, setIsUpdating] = useState(false);
  const [youtubeTitle, setYoutubeTitle] = useState('');
  const [dropboxFolder, setDropboxFolder] = useState('');
  const [approvedDetail, setApprovedDetail] = useState('');

  const resolveMainId = async () => {
    // Use central service - handles cache check, API fetch, and write-back
    return await getAthleteMainId(task.athlete_id);
  };


  useEffect(() => {
    setYoutubeTitle(generateYouTubeTitle(task));
    setDropboxFolder(generateDropboxFolder(task));
    setApprovedDetail(ApprovedVideoDetail(task, onBack));
  }, [task]);

  const handleStatusChange = async (newStatus: string) => {
    if (!task.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Cannot Update',
        message: 'Missing video message ID',
      });
      return;
    }

    setIsUpdating(true);
    try {
      const normalizedStatus = normalizeStatus(newStatus);
      const response = await apiFetch(`/video/${task.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: String(task.id), status: normalizedStatus }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as any;
        throw new Error(err?.message || err?.detail || `HTTP ${response.status}`);
      }
      // Update cache for instant UI feedback
      await updateCachedTaskStatusStage(task.id, { status: newStatus });

      await showToast({
        style: Toast.Style.Success,
        title: 'Status Updated',
        message: `Updated to ${newStatus}`,
      });

      // Get fresh data from cache and pass to parent
      const allTasks = await getCachedTasks();
      const filtered = sortTasks(allTasks.filter(shouldIncludeTask));
      onStatusUpdate(filtered);
      onBack();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Update Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleStageChange = async (newStage: string) => {
    if (!task.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Cannot Update',
        message: 'Missing video message ID',
      });
      return;
    }

    setIsUpdating(true);
    try {
      const normalizedStage = normalizeStage(newStage);
      logger.info('Stage update request', {
        videoMsgId: task.id,
        athleteId: task.athlete_id,
        stage: newStage,
        normalizedStage,
      });
      const response = await apiFetch(`/video/${task.id}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: String(task.id), stage: normalizedStage }),
      });
      const { text, json, contentType } = await readResponseBody(response);
      logger.info('Stage update response', {
        videoMsgId: task.id,
        status: response.status,
        contentType,
        bodyPreview: text.slice(0, 500),
      });
      if (!response.ok) {
        const errMessage = json?.message || json?.detail || text.slice(0, 200) || `HTTP ${response.status}`;
        throw new Error(errMessage);
      }
      // Update cache for instant UI feedback
      await updateCachedTaskStatusStage(task.id, { stage: newStage });

      await showToast({
        style: Toast.Style.Success,
        title: 'Stage Updated',
        message: `Updated to ${newStage}`,
      });

      // Get fresh data from cache and pass to parent
      const allTasks = await getCachedTasks();
      const filtered = sortTasks(allTasks.filter(shouldIncludeTask));
      onStatusUpdate(filtered);
      onBack();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Update Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const metadata = `
${normalizeSportName(task.sport_name)} | ${task.grad_year} | ${getPositions(task)} | ${task.high_school} | ${task.high_school_city}, ${task.high_school_state} | ${formatDate(task.video_due_date)} | ${getTaskStage(task)} | ${task.video_progress_status}

---

### YouTube Title
\`\`\`
${youtubeTitle}
\`\`\`

### Dropbox Folder
\`\`\`
${dropboxFolder}
\`\`\`

### Approved Video Title
\`\`\`
${approvedDetail}
\`\`\`
`;

  return (
    <Detail
      navigationTitle={`${task.athletename} • ${task.video_progress_status}`}
      markdown={`# ${task.athletename}\n\n${metadata}`}
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Athlete Notes">
            <Action
              title="View Notes"
              icon={Icon.Clipboard}
              onAction={async () => {
                const mainId = await resolveMainId();
                if (!mainId) {
                  showToast({
                    style: Toast.Style.Failure,
                    title: 'Missing ID',
                    message: 'Could not resolve athlete_main_id',
                  });
                  return;
                }
                push(
                  <AthleteNotesList
                    athleteId={String(task.athlete_id)}
                    athleteMainId={mainId}
                    athleteName={task.athletename}
                  />
                );
              }}
            />
            <Action
              title="Add Note"
              icon={Icon.Plus}
              onAction={async () => {
                const mainId = await resolveMainId();
                if (!mainId) {
                  showToast({
                    style: Toast.Style.Failure,
                    title: 'Missing ID',
                    message: 'Could not resolve athlete_main_id',
                  });
                  return;
                }
                push(
                  <AddAthleteNoteForm
                    athleteId={String(task.athlete_id)}
                    athleteMainId={mainId}
                    athleteName={task.athletename}
                    onComplete={() => pop()}
                  />
                );
              }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Contact Info">
            <Action
              title="View Contact Info"
              icon={Icon.Person}
              onAction={async () => {
                const mainId = await resolveMainId();
                if (!mainId) {
                  showToast({
                    style: Toast.Style.Failure,
                    title: 'Missing ID',
                    message: 'Could not resolve athlete_main_id',
                  });
                  return;
                }
                push(
                  <ContactInfoDetail
                    contactId={String(task.athlete_id)}
                    athleteMainId={mainId}
                    athleteName={task.athletename}
                    onBack={pop}
                  />
                );
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'i' }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Quick Actions">
            <Action
              title="Copy YouTube Title"
              icon="📺"
              onAction={() => {
                Clipboard.copy(youtubeTitle);
                showToast({
                  style: Toast.Style.Success,
                  title: 'Copied to clipboard',
                  message: youtubeTitle,
                });
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'y' }}
            />
            <Action
              title="Copy Approved Video Title"
              icon="✅" // Approved video title icon
              onAction={() => {
                Clipboard.copy(approvedDetail); // Approved video title
                showToast({
                  style: Toast.Style.Success,
                  title: 'Copied to clipboard',
                  message: 'Approved video title',
                });
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'd' }}
            />
            <Action
              title="Copy Dropbox Folder"
              icon="📂"
              onAction={() => {
                Clipboard.copy(dropboxFolder);
                showToast({
                  style: Toast.Style.Success,
                  title: 'Copied to clipboard',
                  message: dropboxFolder,
                });
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'f' }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Update Task">
            <Action.Push
              title="Update Status"
              icon="📊"
              target={<UpdateStatusForm task={task} onUpdate={onStatusUpdate} />}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'x' }}
            />
            <Action.Push
              title="Update Stage"
              icon="🔄"
              target={<UpdateStageForm task={task} onUpdate={onStatusUpdate} />}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Update Due Date">
            <Action.Push
              title="Edit Due Date"
              icon="🗓️"
              target={<EditDueDateForm task={task} onUpdate={onStatusUpdate} />}
              shortcut={{ modifiers: ['cmd'], key: 'd' }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action.OpenInBrowser
              title="View PlayerID"
              url={`https://dashboard.nationalpid.com/athlete/profile/${task.athlete_id}`}
              icon="🌍"
              shortcut={{ modifiers: ['cmd'], key: 'o' }}
            />
            <Action.OpenInBrowser
              title="General Info"
              url={`https://dashboard.nationalpid.com/admin/athletes?contactid=${task.athlete_id}`}
              icon={Icon.Person}
              shortcut={{ modifiers: ['shift', 'cmd'], key: 'o' }}
            />
            <Action.OpenInBrowser
              title="Task: Video Progress ID"
              url={`https://dashboard.nationalpid.com/videoteammsg/videomailprogress?contactid=${task.athlete_id}`}
              icon={Icon.Globe}
            />
            <Action title="Back" icon="⬅️" onAction={onBack} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

interface EditDueDateFormProps {
  task: VideoProgressTask;
  onUpdate: (updatedTasks?: VideoProgressTask[]) => void;
}

function EditDueDateForm({ task, onUpdate }: EditDueDateFormProps) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (values: { dueDate: Date }) => {
    if (!task.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Cannot Update',
        message: 'Missing video message ID',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Format date as MM/DD/YYYY (Laravel format)
      const formattedDate = format(values.dueDate, 'MM/dd/yyyy');

      const response = await apiFetch(`/video/${task.id}/duedate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_msg_id: String(task.id),
          due_date: formattedDate
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as any;
        throw new Error(err?.message || err?.detail || `HTTP ${response.status}`);
      }

      await showToast({
        style: Toast.Style.Success,
        title: 'Due Date Updated',
        message: `Updated to ${formattedDate}`,
      });

      onUpdate();
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Update Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Parse current due date or default to today
  const currentDate = task.video_due_date
    ? new Date(task.video_due_date)
    : new Date();

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Update Due Date"
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.DatePicker
        id="dueDate"
        title="Due Date"
        defaultValue={currentDate}
      />
      <Form.Description text={`Editing due date for: ${task.athletename}`} />
    </Form>
  );
}

interface UpdateCompletionDateFormProps {
  task: VideoProgressTask;
  onBack: () => void;
  onUpdate: (updatedTasks?: VideoProgressTask[]) => void;
}

function UpdateCompletionDateForm({ task, onBack, onUpdate }: UpdateCompletionDateFormProps) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (values: { completionDate: Date }) => {
    if (!task.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Cannot Update',
        message: 'Missing task ID',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const formattedDate = values.completionDate.toISOString();

      // LOCAL ONLY: Update SQLite cache, no API call
      const { updateCachedCompletionDate } = await import('./lib/video-progress-cache');
      await updateCachedCompletionDate(task.id, formattedDate);

      await showToast({
        style: Toast.Style.Success,
        title: 'Completion Date Updated',
        message: `Updated to ${format(values.completionDate, 'MM/dd/yyyy')}`,
      });

      onUpdate();
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Update Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentDate = task.date_completed
    ? new Date(task.date_completed)
    : new Date();

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Update Completion Date"
            onSubmit={handleSubmit}
          />
          <Action title="Cancel" icon={Icon.XMarkCircle} onAction={onBack} />
        </ActionPanel>
      }
    >
      <Form.DatePicker
        id="completionDate"
        title="Completion Date"
        defaultValue={currentDate}
      />
      <Form.Description text={`Editing completion date for: ${task.athletename}`} />
    </Form>
  );
}

const STATUS_OPTIONS = [
  { value: 'Revisions', label: 'Revisions' },
  { value: 'HUDL', label: 'HUDL' },
  { value: 'Dropbox', label: 'Dropbox' },
  { value: 'Not Approved', label: 'Not Approved' },
  { value: 'External Links', label: 'External Links' },
];

const STAGE_OPTIONS = [
  { value: 'In Queue', label: 'In Queue' },
  { value: 'Awaiting Client', label: 'Awaiting Client' },
  { value: 'On Hold', label: 'On Hold' },
  { value: 'Done', label: 'Done' },
];

interface UpdateStatusFormProps {
  task: VideoProgressTask;
  onUpdate: (updatedTasks?: VideoProgressTask[]) => void;
}

function UpdateStatusForm({ task, onUpdate }: UpdateStatusFormProps) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(task.video_progress_status || 'Revisions');

  const handleSubmit = async () => {
    if (!task.id) {
      await showToast({ style: Toast.Style.Failure, title: 'Cannot Update', message: 'Missing video message ID' });
      return;
    }

    setIsSubmitting(true);
    try {
      const normalizedStatus = normalizeStatus(selectedStatus);
      const response = await apiFetch(`/video/${task.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: String(task.id), status: normalizedStatus }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as any;
        throw new Error(err?.message || err?.detail || `HTTP ${response.status}`);
      }

      await updateCachedTaskStatusStage(task.id, { status: selectedStatus });
      await showToast({ style: Toast.Style.Success, title: 'Status Updated', message: `Updated to ${selectedStatus}` });

      const allTasks = await getCachedTasks();
      const filtered = sortTasks(
        allTasks.filter(
          (t) =>
            shouldIncludeTask(t) &&
            ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'External Links'].includes(
              t.video_progress_status
            )
        )
      );
      onUpdate(filtered);
      pop();
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: 'Update Failed', message: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form
      isLoading={isSubmitting}
      navigationTitle={`Update Status • ${task.athletename}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Status" icon={Icon.Checkmark} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Updating status for: ${task.athletename}`} />
      <Form.Dropdown id="status" title="Video Status" value={selectedStatus} onChange={setSelectedStatus}>
        {STATUS_OPTIONS.map((opt) => (
          <Form.Dropdown.Item key={opt.value} value={opt.value} title={opt.label} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

interface UpdateStageFormProps {
  task: VideoProgressTask;
  onUpdate: (updatedTasks?: VideoProgressTask[]) => void;
}

function UpdateStageForm({ task, onUpdate }: UpdateStageFormProps) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedStage, setSelectedStage] = useState(getTaskStage(task) || 'In Queue');

  const handleSubmit = async () => {
    if (!task.id) {
      await showToast({ style: Toast.Style.Failure, title: 'Cannot Update', message: 'Missing video message ID' });
      return;
    }

    setIsSubmitting(true);
    try {
      const normalizedStage = normalizeStage(selectedStage);
      logger.info('Stage update request', {
        videoMsgId: task.id,
        athleteId: task.athlete_id,
        stage: selectedStage,
        normalizedStage,
      });
      const response = await apiFetch(`/video/${task.id}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: String(task.id), stage: normalizedStage }),
      });
      const { text, json, contentType } = await readResponseBody(response);
      logger.info('Stage update response', {
        videoMsgId: task.id,
        status: response.status,
        contentType,
        bodyPreview: text.slice(0, 500),
      });
      if (!response.ok) {
        const errMessage = json?.message || json?.detail || text.slice(0, 200) || `HTTP ${response.status}`;
        throw new Error(errMessage);
      }

      await updateCachedTaskStatusStage(task.id, { stage: selectedStage });
      await showToast({ style: Toast.Style.Success, title: 'Stage Updated', message: `Updated to ${selectedStage}` });

      const allTasks = await getCachedTasks();
      const filtered = sortTasks(
        allTasks.filter(
          (t) =>
            shouldIncludeTask(t) &&
            ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'External Links'].includes(
              t.video_progress_status
            )
        )
      );
      onUpdate(filtered);
      pop();
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: 'Update Failed', message: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form
      isLoading={isSubmitting}
      navigationTitle={`Update Stage • ${task.athletename}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Stage" icon={Icon.Checkmark} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Updating stage for: ${task.athletename}`} />
      <Form.Dropdown id="stage" title="Video Stage" value={selectedStage} onChange={setSelectedStage}>
        {STAGE_OPTIONS.map((opt) => (
          <Form.Dropdown.Item key={opt.value} value={opt.value} title={opt.label} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

interface ContactInfoDetailProps {
  contactId: string;
  athleteMainId: string;
  athleteName: string;
  onBack: () => void;
}

function ContactInfoDetail({ contactId, athleteMainId, athleteName, onBack }: ContactInfoDetailProps) {
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadContactInfo();
  }, [contactId]);

  const loadContactInfo = async () => {
    try {
      setIsLoading(true);
      logger.info(`📞 CONTACT_INFO: Starting load for athlete ${contactId}`, { athleteName, athleteMainId });

      // Cache-first: check SQLite cache
      const cached = await getCachedContactInfo(Number(contactId));
      if (cached) {
        const transformed = transformCacheToContactInfo(cached);
        setContactInfo(transformed);
        setIsLoading(false);
        logger.info(`✅ CONTACT_INFO: Loaded from cache for ${contactId}`, {
          studentName: cached.studentName,
          hasParent1: !!cached.parent1Name,
          hasParent2: !!cached.parent2Name,
        });
      }

      // Background fetch: get fresh data from API
      logger.info(`🌐 CONTACT_INFO: Fetching from API for ${contactId}`);
      const fresh = await fetchContactInfo(contactId, athleteMainId);
      logger.info(`✅ CONTACT_INFO: Fetched from API for ${contactId}`, {
        studentName: fresh.studentAthlete.name,
        hasParent1: !!fresh.parent1,
        hasParent2: !!fresh.parent2,
      });

      // Cache the fresh data
      const cacheData = transformContactInfoToCache(fresh);
      await upsertContactInfo(cacheData);
      logger.info(`💾 CONTACT_INFO: Cached data for ${contactId}`, { cacheData });

      // Update UI with fresh data
      setContactInfo(fresh);
      logger.info(`✅ CONTACT_INFO: UI updated with fresh data for ${contactId}`);
    } catch (error) {
      logger.error(`❌ CONTACT_INFO: Failed to load for ${contactId}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to Load Contact Info',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const markdown = generateContactMarkdown(contactInfo);

  return (
    <Detail
      navigationTitle={`Contact Info • ${athleteName}`}
      markdown={markdown}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Student Athlete">
            {contactInfo?.studentAthlete.email && (
              <Action.CopyToClipboard
                title="Copy Student Email"
                content={contactInfo.studentAthlete.email}
                icon={Icon.Envelope}
                shortcut={{ modifiers: ['cmd'], key: 'e' }}
              />
            )}
            {contactInfo?.studentAthlete.phone && (
              <Action.CopyToClipboard
                title="Copy Student Phone"
                content={contactInfo.studentAthlete.phone}
                icon={Icon.Phone}
                shortcut={{ modifiers: ['cmd'], key: 't' }}
              />
            )}
          </ActionPanel.Section>

          {contactInfo?.parent1 && (
            <ActionPanel.Section title={`Parent 1 (${contactInfo.parent1.relationship})`}>
              {contactInfo.parent1.email && (
                <Action.CopyToClipboard
                  title="Copy Parent 1 Email"
                  content={contactInfo.parent1.email}
                  icon={Icon.Envelope}
                  shortcut={{ modifiers: ['cmd', 'shift'], key: 'e' }}
                />
              )}
              {contactInfo.parent1.phone && (
                <Action.CopyToClipboard
                  title="Copy Parent 1 Phone"
                  content={contactInfo.parent1.phone}
                  icon={Icon.Phone}
                  shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
                />
              )}
            </ActionPanel.Section>
          )}

          {contactInfo?.parent2 && (
            <ActionPanel.Section title={`Parent 2 (${contactInfo.parent2.relationship})`}>
              {contactInfo.parent2.email && (
                <Action.CopyToClipboard
                  title="Copy Parent 2 Email"
                  content={contactInfo.parent2.email}
                  icon={Icon.Envelope}
                  shortcut={{ modifiers: ['cmd', 'opt'], key: 'e' }}
                />
              )}
              {contactInfo.parent2.phone && (
                <Action.CopyToClipboard
                  title="Copy Parent 2 Phone"
                  content={contactInfo.parent2.phone}
                  icon={Icon.Phone}
                  shortcut={{ modifiers: ['cmd', 'opt'], key: 't' }}
                />
              )}
            </ActionPanel.Section>
          )}

          <ActionPanel.Section>
            <Action
              title="Refresh Contact Info"
              icon={Icon.ArrowClockwise}
              onAction={loadContactInfo}
              shortcut={{ modifiers: ['cmd'], key: 'r' }}
            />
            <Action title="Back" icon={Icon.ArrowLeft} onAction={onBack} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function generateContactMarkdown(info: ContactInfo | null): string {
  if (!info) return '# Loading...';

  const lines = [
    `# Contact Information`,
    '',
    `## ${info.studentAthlete.name}`,
    `☎️ ${info.studentAthlete.phone || 'N/A'}`,
    `📧 ${info.studentAthlete.email || 'N/A'}`,
    '',
  ];

  if (info.parent1) {
    lines.push(
      `## ${info.parent1.name} (${info.parent1.relationship})`,
      `☎️ ${info.parent1.phone || 'N/A'}`,
      `📧 ${info.parent1.email || 'N/A'}`,
      '',
    );
  }

  if (info.parent2) {
    lines.push(
      `## ${info.parent2.name} (${info.parent2.relationship})`,
      `☎️ ${info.parent2.phone || 'N/A'}`,
      `📧 ${info.parent2.email || 'N/A'}`,
      '',
    );
  }

  return lines.join('\n');
}

export default function VideoProgress() {
  const [tasks, setTasks] = useState<VideoProgressTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<string>('In Queue');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [rawSearchEnabled, setRawSearchEnabled] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [rawSearchResults, setRawSearchResults] = useState<VideoProgressTask[]>([]);
  const [isRawSearchLoading, setIsRawSearchLoading] = useState(false);
  const rawSearchRequestId = useRef(0);
  const { push, pop } = useNavigation();

  useEffect(() => {
    loadTasks();
  }, []);

  const reloadFromCache = async (updatedTasks?: VideoProgressTask[]) => {
    if (updatedTasks) {
      setTasks(updatedTasks);
      return;
    }
    // Reload from cache only (instant, no API call)
    const cached = await getCachedTasks();
    const filtered = cached.filter(shouldIncludeTask);
    const sorted = sortTasks(filtered);
    setTasks(sorted);
  };

  const loadTasks = async () => {
    try {
      setIsLoading(true);

      // Try cache first
      const cached = await getCachedTasks();
      if (cached.length > 0) {
        const filtered = cached.filter(shouldIncludeTask);
        setTasks(sortTasks(filtered));
        setIsLoading(false);
      }

      // Fetch from API in background
      const response = await apiFetch('/video/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: "",
          last_name: "",
          email: "",
          sport: "0",
          states: "0",
          athlete_school: "0",
          editorassigneddatefrom: "",
          editorassigneddateto: "",
          grad_year: "",
          video_progress: "",
          video_progress_stage: "",
          video_progress_status: ""
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to load tasks (HTTP ${response.status})`);
      }
      const result = await response.json() as any;
      const data = result.tasks || [];

      if (!Array.isArray(data)) {
        throw new Error('Invalid data format');
      }

      // Update cache
      await upsertTasks(data);

      // Batch resolve athlete_main_ids for newly fetched tasks
      await batchResolveAndCache(data);

      // Reload from cache to get date_completed preservation
      const updatedCache = await getCachedTasks();
      const filtered = updatedCache.filter(shouldIncludeTask);
      setTasks(sortTasks(filtered));

      await showToast({
        style: filtered.length > 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: `Found ${filtered.length} active tasks`,
        message: filtered.length === 0 ? 'All tasks are done!' : 'Ready to work',
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to load tasks',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const runRawSearch = async (term: string) => {
    const requestId = ++rawSearchRequestId.current;
    const isEmail = term.includes('@');
    logger.info('Raw search start', { term, requestId, isEmail });
    setIsRawSearchLoading(true);
    try {
      const response = await apiFetch('/athlete/raw-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term,
          email: isEmail ? term : undefined,
          include_admin_search: true,
          include_recent_search: true,
        }),
      });
      const { text, json, contentType } = await readResponseBody(response);
      logger.info('Raw search response', {
        term,
        requestId,
        status: response.status,
        contentType,
        length: text.length,
        preview: text.slice(0, 400),
      });
      if (!response.ok) {
        const errMessage = json?.detail || json?.message || text.slice(0, 200) || `HTTP ${response.status}`;
        throw new Error(errMessage);
      }

      const payload = json as RawSearchResponse | null;
      if (!payload || !Array.isArray(payload.results)) {
        throw new Error('Invalid raw search response');
      }
      if (payload.sources) {
        logger.info('Raw search sources', { term, requestId, sources: payload.sources });
      }

      const results = payload.results;
      const mapped = results.map((result, index) => mapRawSearchResultToTask(result, index));

      logger.info('Raw search mapped results', {
        term,
        requestId,
        apiCount: payload.count,
        count: mapped.length,
        sample: mapped[0] ? { athlete_id: mapped[0].athlete_id, name: mapped[0].athletename } : null,
      });

      if (requestId === rawSearchRequestId.current) {
        setRawSearchResults(mapped);
      } else {
        logger.warn('Raw search result discarded (stale request)', { term, requestId });
      }

      if (mapped.length === 0) {
        logger.warn('Raw search returned zero results', { term, requestId });
      }
    } catch (error) {
      logger.error('Raw search failed', {
        term,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (requestId === rawSearchRequestId.current) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Raw Search Failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        setRawSearchResults([]);
      }
    } finally {
      if (requestId === rawSearchRequestId.current) {
        setIsRawSearchLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!rawSearchEnabled) {
      rawSearchRequestId.current += 1;
      if (rawSearchResults.length > 0) {
        logger.info('Raw search disabled, clearing results');
      }
      setRawSearchResults([]);
      setIsRawSearchLoading(false);
      return;
    }

    const term = searchText.trim();
    if (!term) {
      rawSearchRequestId.current += 1;
      logger.info('Raw search term empty, clearing results');
      setRawSearchResults([]);
      setIsRawSearchLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      runRawSearch(term);
    }, 350);

    return () => clearTimeout(timer);
  }, [rawSearchEnabled, searchText]);

  const toggleRawSearch = async () => {
    const next = !rawSearchEnabled;
    setRawSearchEnabled(next);
    if (!next) {
      logger.info('Raw search turned off, reloading cache');
      await reloadFromCache();
    } else {
      logger.info('Raw search turned on');
    }
  };

  const normalizedSearch = searchText.trim().toLowerCase();
  const shouldBypassFilters = rawSearchEnabled && normalizedSearch.length > 0;
  const activeTasks = shouldBypassFilters ? rawSearchResults : tasks;

  const matchesSearch = (task: VideoProgressTask) => {
    if (!normalizedSearch) return true;
    const haystack = [
      task.athletename,
      task.high_school,
      task.high_school_city,
      task.high_school_state,
      String(task.athlete_id || ''),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedSearch);
  };

  // Apply both stage and status filters (unless raw search is active)
  const filteredTasks = activeTasks.filter((task) => {
    if (shouldBypassFilters) {
      return true;
    }
    if (!shouldIncludeTask(task)) {
      return false;
    }
    if (!matchesSearch(task)) {
      return false;
    }
    // When stageFilter is 'all', show only 'In Queue' stage (truly active work)
    // When stageFilter is explicitly set, show ONLY that stage
    const stageValue = getTaskStage(task);
    const stageMatch =
      stageFilter === 'all'
        ? true
        : normalizeStageValue(stageValue) === normalizeStageValue(stageFilter);
    const statusMatch = statusFilter === 'all' || task.video_progress_status === statusFilter;
    return stageMatch && statusMatch;
  });

  // Handle combined filter change
  const handleFilterChange = async (value: string) => {
    if (value.startsWith('stage:')) {
      const stage = value.replace('stage:', '');
      setStageFilter(stage);

      // Reload from cache when switching to Done
      if (stage === 'Done') {
        await reloadFromCache();
      }
    } else if (value.startsWith('status:')) {
      setStatusFilter(value.replace('status:', ''));
    }
  };

  // Build current filter value for display
  const currentFilterValue =
    stageFilter !== 'all' ? `stage:${stageFilter}` : `status:${statusFilter}`;

  return (
    <List
      isLoading={isLoading || isRawSearchLoading}
      navigationTitle="Video Progress (ProspectID)"
      searchBarPlaceholder="Search athletes..."
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by Stage or Status (⌘P)"
          value={currentFilterValue}
          onChange={handleFilterChange}
        >
          <List.Dropdown.Section title="🎬 Stage">
            <List.Dropdown.Item title="All Stages" value="stage:all" />
            <List.Dropdown.Item title="In Queue" value="stage:In Queue" />
            <List.Dropdown.Item title="Awaiting Client" value="stage:Awaiting Client" />
            <List.Dropdown.Item title="On Hold" value="stage:On Hold" />
            <List.Dropdown.Item title="Done" value="stage:Done" />
          </List.Dropdown.Section>
          <List.Dropdown.Section title="📊 Status">
            <List.Dropdown.Item title="All Statuses" value="status:all" />
            <List.Dropdown.Item title="Revisions" value="status:Revisions" />
            <List.Dropdown.Item title="HUDL" value="status:HUDL" />
            <List.Dropdown.Item title="Dropbox" value="status:Dropbox" />
            <List.Dropdown.Item title="Not Approved" value="status:Not Approved" />
            <List.Dropdown.Item title="External Links" value="status:External Links" />
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {filteredTasks.length === 0 ? (
        <List.EmptyView
          icon={Icon.CheckCircle}
          title={shouldBypassFilters ? 'No Raw Search Results' : 'No Active Tasks'}
          description={shouldBypassFilters ? 'Try a different search' : 'All done!'}
        />
      ) : (
        <List.Section
          title={`In Progress (${filteredTasks.length})`}
          subtitle={shouldBypassFilters ? 'Raw Search' : undefined}
        >
          {filteredTasks.map((task) => (
            <List.Item
              key={task.id ?? task.athlete_id}
              icon={getStageIcon(getTaskStage(task))}
              title={task.athletename}
              subtitle={`${task.grad_year} • ${normalizeSportName(task.sport_name)} • ${getPositions(task)}`}
              accessories={[
                getTaskStage(task) === 'Done' && task.date_completed
                  ? { tag: { value: formatDate(task.date_completed), color: Color.Green } }
                  : { text: formatDate(task.video_due_date) },
                {
                  icon: getStatusIcon(task.video_progress_status),
                  text: task.video_progress_status,
                },
              ]}
              actions={
                <ActionPanel>
                  <Action
                    title="View Details"
                    icon={Icon.Eye}
                    onAction={() =>
                      push(
                        <VideoProgressDetail
                          task={task}
                          onBack={pop}
                          onStatusUpdate={reloadFromCache}
                        />
                      )
                    }
                    shortcut={{ modifiers: ['cmd'], key: 'return' }}
                  />
                  <Action.Push
                    title="Email Student Athlete"
                    icon={Icon.Envelope}
                    target={
                      <EmailStudentAthletesCommand
                        draftValues={{ athleteName: task.athletename, emailTemplate: '' }}
                      />
                    }
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'e' }}
                  />
                  <Action
                    title={`Raw Search Mode: ${rawSearchEnabled ? 'On' : 'Off'}`}
                    icon={rawSearchEnabled ? Icon.CheckCircle : Icon.Circle}
                    onAction={toggleRawSearch}
                    shortcut={{ modifiers: ['cmd'], key: 'f' }}
                  />
                  {stageFilter === 'Done' && (
                    <Action
                      title="Set Completion Date"
                      icon={Icon.Calendar}
                      onAction={() =>
                        push(
                          <UpdateCompletionDateForm
                            task={task}
                            onBack={pop}
                            onUpdate={reloadFromCache}
                          />
                        )
                      }
                      shortcut={{ modifiers: ['cmd'], key: 'd' }}
                    />
                  )}
                  <Action.OpenInBrowser
                    title="View PlayerID"
                    url={`https://dashboard.nationalpid.com/athlete/profile/${task.athlete_id}`}
                    icon={Icon.Globe}
                    shortcut={{ modifiers: ['cmd'], key: 'o' }}
                  />
                  <Action.OpenInBrowser
                    title="Task: Video Progress ID"
                    url={`https://dashboard.nationalpid.com/videoteammsg/videomailprogress?contactid=${task.athlete_id}`}
                    icon={Icon.Globe}
                  />
                  <Action.CopyToClipboard
                    title="Copy Athlete Name"
                    content={task.athletename}
                    icon={Icon.CopyClipboard}
                    shortcut={{ modifiers: ['cmd'], key: 'c' }}
                  />
                  <Action
                    title="Reload Tasks"
                    icon={Icon.ArrowClockwise}
                    onAction={async () => {
                      if (shouldBypassFilters) {
                        const term = searchText.trim();
                        if (!term) {
                          logger.warn('Raw search reload skipped (empty term)');
                          return;
                        }
                        await runRawSearch(term);
                        return;
                      }
                      await loadTasks();
                    }}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
