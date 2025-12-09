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
import { useEffect, useState } from 'react';
import { apiFetch } from './lib/python-server-client';
import {
  getCachedTasks,
  upsertTasks,
  updateCachedTaskStatusStage,
} from './lib/video-progress-cache';

interface VideoProgressTask {
  id?: number; // video_msg_id for updates
  athlete_id: number;
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
  [key: string]: any;
}

function getPositions(task: VideoProgressTask): string {
  return [task.primaryposition, task.secondaryposition, task.thirdposition]
    .filter(pos => pos && pos !== 'NA')
    .join(' | ');
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
  const currentYear = new Date().getFullYear();
  const yearsUntilGrad = gradYear - currentYear;

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

function generateDropboxFolder(task: VideoProgressTask): string {
  // Format: PascalCaseName_YEAR_Sport_STATE
  const pascalName = task.athletename
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
  return [pascalName, task.grad_year, task.sport_name, task.high_school_state]
    .filter(Boolean)
    .join('_');
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
  const [isUpdating, setIsUpdating] = useState(false);
  const [youtubeTitle, setYoutubeTitle] = useState('');
  const [dropboxFolder, setDropboxFolder] = useState('');
  const [approvedDetail, setApprovedDetail] = useState('');

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
      const filtered = allTasks.filter(
        (t) =>
          ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'Uploads', 'External Links'].includes(
            t.video_progress_status
          ) && t.stage !== 'Done'
      );

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
      const response = await apiFetch(`/video/${task.id}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: String(task.id), stage: normalizedStage }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as any;
        throw new Error(err?.message || err?.detail || `HTTP ${response.status}`);
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
      const filtered = allTasks.filter(
        (t) =>
          ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'Uploads', 'External Links'].includes(
            t.video_progress_status
          ) && t.stage !== 'Done'
      );

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
**Sport:** ${task.sport_name}
**Grad Year:** ${task.grad_year}
**Positions:** ${getPositions(task)}
**School:** ${task.high_school}
**City:** ${task.high_school_city}, ${task.high_school_state}
**Editor:** ${task.assignedvideoeditor}
**Due Date:** ${formatDate(task.video_due_date)}
**Status:** ${task.video_progress_status}
**Stage:** ${task.stage}

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
              title="Open in ProspectID"
              url={`https://dashboard.nationalpid.com/athlete/profile/${task.athlete_id}`}
              icon="🌍"
              shortcut={{ modifiers: ['cmd'], key: 'o' }}
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
      const filtered = allTasks.filter(
        (t) => ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'External Links'].includes(t.video_progress_status)
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
  const [selectedStage, setSelectedStage] = useState(task.stage || 'In Queue');

  const handleSubmit = async () => {
    if (!task.id) {
      await showToast({ style: Toast.Style.Failure, title: 'Cannot Update', message: 'Missing video message ID' });
      return;
    }

    setIsSubmitting(true);
    try {
      const normalizedStage = normalizeStage(selectedStage);
      const response = await apiFetch(`/video/${task.id}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: String(task.id), stage: normalizedStage }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as any;
        throw new Error(err?.message || err?.detail || `HTTP ${response.status}`);
      }

      await updateCachedTaskStatusStage(task.id, { stage: selectedStage });
      await showToast({ style: Toast.Style.Success, title: 'Stage Updated', message: `Updated to ${selectedStage}` });

      const allTasks = await getCachedTasks();
      const filtered = allTasks.filter(
        (t) => ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'External Links'].includes(t.video_progress_status)
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

export default function VideoProgress() {
  const [tasks, setTasks] = useState<VideoProgressTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
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
    const filtered = cached.filter(
      (task) =>
        ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'External Links'].includes(
          task.video_progress_status
        )
    );
    setTasks(filtered);
  };

  const loadTasks = async () => {
    try {
      setIsLoading(true);

      // Try cache first
      const cached = await getCachedTasks();
      if (cached.length > 0) {
        const filtered = cached.filter(
          (task) =>
            ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'External Links'].includes(
              task.video_progress_status
            )
        );
        setTasks(filtered);
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
          video_editor: "",
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

      // Filter: active statuses (no stage filter here - we want ALL stages loaded)
      const filtered = data.filter(
        (task) =>
          ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'External Links'].includes(
            task.video_progress_status
          )
      );

      setTasks(filtered);

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

  // Apply both stage and status filters
  const filteredTasks = tasks.filter((task) => {
    const stageMatch = stageFilter === 'all' || task.stage === stageFilter;
    const statusMatch = statusFilter === 'all' || task.video_progress_status === statusFilter;
    return stageMatch && statusMatch;
  });

  // Handle combined filter change
  const handleFilterChange = (value: string) => {
    if (value.startsWith('stage:')) {
      setStageFilter(value.replace('stage:', ''));
    } else if (value.startsWith('status:')) {
      setStatusFilter(value.replace('status:', ''));
    }
  };

  // Build current filter value for display
  const currentFilterValue = stageFilter !== 'all' ? `stage:${stageFilter}` : `status:${statusFilter}`;

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Video Progress (ProspectID)"
      searchBarPlaceholder="Search athletes..."
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
        <List.EmptyView icon={Icon.CheckCircle} title="No Active Tasks" description="All done!" />
      ) : (
        <List.Section title={`In Progress (${filteredTasks.length})`}>
          {filteredTasks.map((task) => (
            <List.Item
              key={task.athlete_id}
              icon={getStageIcon(task.stage)}
              title={task.athletename}
              subtitle={`${task.grad_year} • ${task.sport_name} • ${getPositions(task)}`}
              accessories={[
                { text: formatDate(task.video_due_date) },
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
                  <Action.OpenInBrowser
                    title="Open in ProspectID"
                    url={`https://dashboard.nationalpid.com/athlete/profile/${task.athlete_id}`}
                    icon={Icon.Globe}
                    shortcut={{ modifiers: ['cmd'], key: 'o' }}
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
                    onAction={loadTasks}
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
