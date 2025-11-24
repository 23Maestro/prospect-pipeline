import {
  Action,
  ActionPanel,
  Detail,
  Cache,
  Icon,
  List,
  Toast,
  showToast,
  useNavigation,
  Clipboard,
  getPreferenceValues,
} from '@raycast/api';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { callPythonServer } from './lib/python-server-client';
import { logDebug, logError, logVideoUpdate } from './lib/logger';

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

const preferences = getPreferenceValues<{ scoutApiKey?: string }>();

const getApiKey = () =>
  preferences.scoutApiKey ||
  process.env.SCOUT_API_KEY ||
  '594168a28d26571785afcb83997cb8185f482e56';

function getPositions(task: VideoProgressTask): string {
  return [task.primaryposition, task.secondaryposition, task.thirdposition]
    .filter(pos => pos && pos !== 'NA')
    .join(' | ');
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'Revise':
    case 'Revisions':
      return Icon.ArrowClockwise;
    case 'HUDL':
      return Icon.CircleFilled;
    case 'Dropbox':
      return Icon.Folder;
    case 'Not Approved':
      return Icon.XMarkCircle;
    case 'Uploads':
      return Icon.ArrowUp;
    case 'External Links':
      return Icon.Link;
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

function normalizeStatus(displayStatus: string): 'Revisions' | 'HUDL' | 'Dropbox' | 'External Links' | 'Not Approved' {
  const normalized = displayStatus.toLowerCase().replace(/[_-]+/g, ' ').trim();

  switch (normalized) {
    case 'revise':
    case 'revisions':
      return 'Revisions';
    case 'dropbox':
      return 'Dropbox';
    case 'external links':
      return 'External Links';
    case 'not approved':
      return 'Not Approved';
    case 'hudl':
    default:
      return 'HUDL';
  }
}

function normalizeStage(displayStage: string): 'On Hold' | 'Awaiting Client' | 'In Queue' | 'Done' {
  if (!displayStage) return 'In Queue';
  const normalized = displayStage.toLowerCase().replace(/[_-]+/g, ' ').trim();

  switch (normalized) {
    case 'on hold':
      return 'On Hold';
    case 'awaiting client':
      return 'Awaiting Client';
    case 'done':
      return 'Done';
    case 'in queue':
    default:
      return 'In Queue';
  }
}

function getStageIcon(stage: string) {
  const normalized = normalizeStage(stage);
  switch (normalized) {
    case 'Done':
      return Icon.Checkmark;
    case 'On Hold':
      return Icon.Pause;
    case 'Awaiting Client':
      return Icon.Person;
    case 'In Queue':
    default:
      return Icon.Clock;
  }
}

function getStageColor(stage: string) {
  const normalized = normalizeStage(stage);
  switch (normalized) {
    case 'Done':
      return '#34C759';
    case 'On Hold':
      return '#FF9500';
    case 'Awaiting Client':
      return '#007AFF';
    case 'In Queue':
    default:
      return '#8E8E93';
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

function ApprovedVideoDetail(task: VideoProgressTask): string {
  const positions = getPositions(task);
  const lines = [
    task.athletename,
    positions ? `Class of ${task.grad_year} - ${positions}` : `Class of ${task.grad_year}`,
    task.high_school,
    `${task.high_school_city}, ${task.high_school_state}`,
  ];
  return lines.join('\n');
}

interface DetailProps {
  task: VideoProgressTask;
  onBack: () => void;
  onStatusUpdate: () => void;
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
    const apiKey = getApiKey();
    logDebug(`[VIDEO_PROGRESS] handleStatusChange called`, {
      athleteName: task.athletename,
      taskId: task.id,
      newStatus,
      scoutApiKey: apiKey ? 'SET' : 'NOT SET'
    });

    if (!task.id) {
      logError('handleStatusChange', 'Missing video message ID', { task });
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
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Updating Status…',
        message: `Setting to ${normalizedStatus}`,
      });

      logDebug(`[VIDEO_PROGRESS] Calling update_video_status`, {
        video_msg_id: String(task.id),
        status: normalizedStatus,
        hasApiKey: !!apiKey
      });

      const result = await callPythonServer('update_video_status', {
        video_msg_id: String(task.id),
        status: normalizedStatus,
        api_key: apiKey
      });

      logVideoUpdate('update_video_status', {
        video_msg_id: String(task.id),
        status: normalizedStatus
      }, result);

      toast.style = Toast.Style.Success;
      toast.title = 'Status Updated';
      toast.message = `Updated to ${normalizedStatus}`;
      onStatusUpdate();
      onBack();
    } catch (error) {
      logVideoUpdate('update_video_status', {
        video_msg_id: String(task.id),
        status: newStatus
      }, undefined, error);

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
    const apiKey = getApiKey();
    logDebug(`[VIDEO_PROGRESS] handleStageChange called`, {
      athleteName: task.athletename,
      taskId: task.id,
      newStage,
      scoutApiKey: apiKey ? 'SET' : 'NOT SET'
    });

    if (!task.id) {
      logError('handleStageChange', 'Missing video message ID', { task });
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
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Updating Stage…',
        message: `Setting to ${normalizedStage}`,
      });

      logDebug(`[VIDEO_PROGRESS] Calling update_video_stage`, {
        video_msg_id: String(task.id),
        stage: normalizedStage,
        hasApiKey: !!apiKey
      });

      const result = await callPythonServer('update_video_stage', {
        video_msg_id: String(task.id),
        stage: normalizedStage,
        api_key: apiKey
      });

      logVideoUpdate('update_video_stage', {
        video_msg_id: String(task.id),
        stage: normalizedStage
      }, result);

      toast.style = Toast.Style.Success;
      toast.title = 'Stage Updated';
      toast.message = `Updated to ${normalizedStage}`;
      onStatusUpdate();
      onBack();
    } catch (error) {
      logVideoUpdate('update_video_stage', {
        video_msg_id: String(task.id),
        stage: newStage
      }, undefined, error);

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
              title="YouTube Title to Clipboard"
              icon={Icon.CopyClipboard}
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
              title="Approved Detail to Clipboard"
              icon={Icon.CopyClipboard}
              onAction={() => {
                Clipboard.copy(approvedDetail);
                showToast({
                  style: Toast.Style.Success,
                  title: 'Copied to clipboard',
                  message: 'Approved video title',
                });
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'a' }}
            />
            <Action
              title="Dropbox Folder to Clipboard"
              icon={Icon.CopyClipboard}
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

          <ActionPanel.Section title="Update Status">
            <Action
              title="Mark as Revise"
              icon={Icon.ArrowClockwise}
              onAction={() => handleStatusChange('Revisions')}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as HUDL"
              icon={Icon.CircleFilled}
              onAction={() => handleStatusChange('HUDL')}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as Dropbox"
              icon={Icon.Folder}
              onAction={() => handleStatusChange('Dropbox')}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as Not Approved"
              icon={Icon.XMarkCircle}
              onAction={() => handleStatusChange('Not Approved')}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as Uploads"
              icon={Icon.ArrowUp}
              onAction={() => handleStatusChange('Uploads')}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as External Links"
              icon={Icon.Link}
              onAction={() => handleStatusChange('External Links')}
              isLoading={isUpdating}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Update Stage">
            <Action
              title="Mark as In Queue"
              icon={Icon.Clock}
              onAction={() => handleStageChange('In Queue')}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as Awaiting Client"
              icon={Icon.Person}
              onAction={() => handleStageChange('Awaiting Client')}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as On Hold"
              icon={Icon.Pause}
              onAction={() => handleStageChange('On Hold')}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as Done"
              icon={Icon.Checkmark}
              onAction={() => handleStageChange('Done')}
              isLoading={isUpdating}
            />
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action.OpenInBrowser
              title="Open in ProspectID"
              url={`https://dashboard.nationalpid.com/athlete/profile/${task.athlete_id}`}
              icon={Icon.Globe}
            />
            <Action title="Back" icon={Icon.ArrowLeft} onAction={onBack} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

export default function VideoProgress() {
  const [tasks, setTasks] = useState<VideoProgressTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { push, pop } = useNavigation();
  const cache = new Cache();

  useEffect(() => {
    void loadTasks();
  }, []);

  const loadTasks = async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    try {
      const CACHE_KEY = 'video_progress_tasks';
      const CACHE_TIME_KEY = 'video_progress_tasks_time';
      const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
      const now = Date.now();

      const cached = cache.get(CACHE_KEY);
      const cacheTime = cache.get(CACHE_TIME_KEY);
      if (cached) {
        const cachedTasks = JSON.parse(cached) as VideoProgressTask[];
        setTasks(cachedTasks);
        if (!force) {
          return;
        }
      }

      // If forcing or no cache, fetch fresh
      setIsLoading(true);

      const data = await callPythonServer<VideoProgressTask[]>('get_video_progress', { filters: {} });

      if (!Array.isArray(data)) {
        throw new Error('Invalid data format');
      }

      // Filter: include Done status and active statuses, but exclude Uploads
      const filtered = data.filter(
        (task) =>
          ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'External Links', 'Done'].includes(
            task.video_progress_status
          )
      );

      // Limit Done to 50 items, keep others as-is
      const doneItems = filtered.filter(t => t.video_progress_status === 'Done').slice(0, 50);
      const activeItems = filtered.filter(t => t.video_progress_status !== 'Done');
      const finalFiltered = [...activeItems, ...doneItems];

      // cache filtered tasks
      cache.set(CACHE_KEY, JSON.stringify(finalFiltered));
      cache.set(CACHE_TIME_KEY, now.toString());

      setTasks(finalFiltered);

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

  const filteredTasks =
    statusFilter === 'all'
      ? tasks
      : tasks.filter((task) => task.video_progress_status === statusFilter);

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Video Progress (ProspectID)"
      searchBarPlaceholder="Search athletes..."
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by Status"
          value={statusFilter}
          onChange={setStatusFilter}
        >
          <List.Dropdown.Item title="All Statuses" value="all" />
          <List.Dropdown.Item title="Revise" value="Revisions" />
          <List.Dropdown.Item title="HUDL" value="HUDL" />
          <List.Dropdown.Item title="Dropbox" value="Dropbox" />
          <List.Dropdown.Item title="Not Approved" value="Not Approved" />
          <List.Dropdown.Item title="External Links" value="External Links" />
          <List.Dropdown.Item title="Done" value="Done" />
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
              icon={{ source: Icon.Plus, tintColor: '#007AFF' }}
              title={task.athletename}
              subtitle={`${task.grad_year} • ${task.sport_name} • ${getPositions(task)}`}
              accessories={[
                { text: formatDate(task.video_due_date) },
                {
                  icon: {
                    source: getStatusIcon(task.video_progress_status),
                    tintColor: getStatusColor(task.video_progress_status),
                  },
                  text: task.video_progress_status,
                },
                {
                  icon: { source: getStageIcon(task.stage), tintColor: getStageColor(task.stage) },
                  text: normalizeStage(task.stage),
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
                          onStatusUpdate={() => loadTasks({ force: true })}
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
                    onAction={() => loadTasks({ force: true })}
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
