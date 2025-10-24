import React, { useState, useEffect } from 'react';
import { Form, ActionPanel, Action, showToast, Toast, LaunchProps, getPreferenceValues } from '@raycast/api';
import { useForm, FormValidation } from '@raycast/utils';
import { Client } from '@notionhq/client';
import { callPythonServer } from './lib/python-server-client';

async function searchVideoProgressPlayer(query: string): Promise<NPIDPlayer[]> {
  try {
    const nameParts = query.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    const results = await callPythonServer<any[]>('search_video_progress', { first_name: firstName, last_name: lastName });
    return results.map(player => ({
      primaryPosition: player.primaryposition,
      secondaryPosition: player.secondaryposition,
      thirdPosition: player.thirdposition,
      paidStatus: player.paid_status,
      athleteName: player.athletename,
      name: player.athletename, // Add name field
      player_id: player.athlete_id?.toString(), // Add player_id field
      id: player.id,
      videoProgress: player.video_progress,
      videoProgressStatus: player.video_progress_status,
      stage: player.stage,
      videoDueDate: player.video_due_date,
      videoDueDateSort: player.video_due_date_sort,
      sportName: player.sport_name,
      sport: player.sport_name?.toLowerCase().replace(/'/g, '').replace(/ /g, '-'), // Add sport alias
      gradYear: player.grad_year,
      grad_year: player.grad_year, // Add both formats
      highSchoolCity: player.high_school_city,
      city: player.high_school_city, // Add city field
      highSchoolState: player.high_school_state,
      state: player.high_school_state, // Add state field
      highSchool: player.high_school,
      high_school: player.high_school, // Add both formats
      athleteId: player.athlete_id,
      assignedVideoEditor: player.assignedvideoeditor,
      assignedDate: player.assigned_date,
      assignedDateSort: player.assigned_date_sort,
      athlete_main_id: player.athlete_main_id?.toString() || player.athlete_id?.toString(),
    }));
  } catch (error) {
    console.error('NPID video progress search error:', error);
    return [];
  }
}

// Notion helpers (reuse Active Tasks filtering)
type NotionTask = {
  id: string;
  name: string;
  status: string;
  playerId?: string;
};

function getNotion() {
  const { notionToken } = getPreferenceValues();
  return new Client({ auth: notionToken, notionVersion: '2022-06-28' });
}

async function fetchActiveNotionTasks(): Promise<NotionTask[]> {
  const notion = getNotion();
  const response = await notion.databases.query({
    database_id: '19f4c8bd6c26805b9929dfa8eb290a86',
    filter: {
      or: [
        { property: 'Status', status: { equals: 'Revise' } },
        { property: 'Status', status: { equals: 'HUDL' } },
        { property: 'Status', status: { equals: 'Dropbox' } },
        { property: 'Status', status: { equals: 'Not Approved' } },
        { property: 'Status', status: { equals: 'Uploads' } },
      ],
    },
    sorts: [{ property: 'Due Date', direction: 'ascending' }],
  });

  return response.results.map((t: any) => ({
    id: t.id,
    name: t.properties?.['Name']?.title?.[0]?.plain_text || '',
    status: t.properties?.['Status']?.status?.name || '',
    playerId: t.properties?.['PlayerID']?.url || '',
  }));
}

function parseNPIDfromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) return null;
    const idMatch = last.match(/[A-Za-z0-9_-]+/);
    return idMatch ? idMatch[0] : null;
  } catch {
    return null;
  }
}

interface VideoUpdateFormValues {
  athleteName: string;
  youtubeLink: string;
  season: string;
  videoType: string;
  playerId?: string;
  searchMode: 'name' | 'id';
  notionTaskId?: string;
}

interface NPIDPlayer {
  primaryPosition: string;
  secondaryPosition: string;
  thirdPosition: string;
  paidStatus: string;
  athleteName: string;
  name: string; // Display name
  player_id: string; // For API calls
  id: number;
  videoProgress: string;
  videoProgressStatus: string;
  stage: string;
  videoDueDate: string;
  videoDueDateSort: number;
  sportName: string;
  sport: string; // Sport alias for API
  gradYear: number;
  grad_year: number; // Both formats
  highSchoolCity: string;
  city: string; // Short name
  highSchoolState: string;
  state: string; // Short name
  highSchool: string;
  high_school: string; // Both formats
  athleteId: number;
  assignedVideoEditor: string;
  assignedDate: string;
  assignedDateSort: number;
  athlete_main_id?: string;
}

export default function VideoUpdatesCommand(
  props: LaunchProps<{ draftValues: VideoUpdateFormValues }>,
) {
  const [searchResults, setSearchResults] = useState<NPIDPlayer[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<NPIDPlayer | null>(null);
  const [activeTasks, setActiveTasks] = useState<NotionTask[]>([]);
  const [seasons, setSeasons] = useState<{value: string, title: string}[]>([]);
  const [isFetchingSeasons, setIsFetchingSeasons] = useState(false);

  const { handleSubmit, itemProps, reset, focus, values, setValue } = useForm<VideoUpdateFormValues>({
    async onSubmit(formValues) {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Processing video update...',
      });

      try {
        // Determine the player ID to use
        let playerId = formValues.playerId;
        let athleteName = formValues.athleteName;

        if (formValues.searchMode === 'name' && selectedPlayer) {
          playerId = selectedPlayer.player_id;
          athleteName = selectedPlayer.name;
        }

        if (!playerId) {
          toast.style = Toast.Style.Failure;
          toast.title = 'Player ID Required';
          toast.message = 'Please search for and select a player or enter a Player ID.';
          return;
        }

        // Use NPID integration for video updates
        await toast.show();
        toast.title = 'Updating NPID Profile...';
        toast.message = `Updating video for ${athleteName} (ID: ${playerId})`;

        try {
          // Step 1: Upload video
          const result = await callPythonServer('update_video_profile', {
            player_id: playerId,
            youtube_link: formValues.youtubeLink,
            season: formValues.season,
            video_type: formValues.videoType
          }) as any;

          if (result.status === 'ok' && result.data?.success) {
            toast.style = Toast.Style.Success;
            toast.title = 'Video Uploaded!';
            toast.message = `Sending email and updating stage...`;

            // Step 2: Send "Editing Done" email
            try {
              toast.message = `Sending "Editing Done" email...`;
              const emailResult = await callPythonServer('send_email_to_athlete', {
                athlete_name: athleteName,
                template_name: 'Editing Done'
              }) as any;

              if (emailResult.status === 'ok' && emailResult.data?.success) {
                toast.message = `Email sent! Updating stage to Done...`;

                // Step 3: Update stage to "Done"
                try {
                  const stageResult = await callPythonServer('update_video_progress_stage', {
                    athlete_id: playerId,
                    stage: 'Done'
                  }) as any;

                  if (stageResult.status === 'ok' && stageResult.data?.success) {
                    toast.style = Toast.Style.Success;
                    toast.title = 'All Steps Complete!';
                    toast.message = `✅ Video uploaded\n✅ Email sent\n✅ Stage updated to Done`;
                  } else {
                    toast.style = Toast.Style.Success;
                    toast.title = 'Video & Email Complete';
                    toast.message = `✅ Video uploaded\n✅ Email sent\n⚠️ Stage update failed`;
                  }
                } catch (stageError) {
                  console.error('Stage update error:', stageError);
                  toast.style = Toast.Style.Success;
                  toast.title = 'Video & Email Complete';
                  toast.message = `✅ Video uploaded\n✅ Email sent\n⚠️ Stage update failed`;
                }
              } else {
                toast.style = Toast.Style.Success;
                toast.title = 'Video Uploaded';
                toast.message = `✅ Video uploaded\n⚠️ Email send failed`;
              }
            } catch (emailError) {
              console.error('Email send error:', emailError);
              toast.style = Toast.Style.Success;
              toast.title = 'Video Uploaded';
              toast.message = `✅ Video uploaded\n⚠️ Email send failed`;
            }

            reset();
            setSelectedPlayer(null);
            setSearchResults([]);
            setSeasons([]);
          } else {
            toast.style = Toast.Style.Failure;
            toast.title = 'NPID Update Failed';
            toast.message = result.message || 'Unknown error occurred';
          }
        } catch (updateError) {
          console.error('NPID update error:', updateError);
          toast.style = Toast.Style.Failure;
          toast.title = 'NPID Update Error';
          toast.message = updateError instanceof Error ? updateError.message : 'Failed to update NPID profile';
        }
      } catch (error: unknown) {
        console.error('Execution error:', error);
        toast.style = Toast.Style.Failure;
        toast.title = 'Failed to Update NPID';
        if (error instanceof Error) {
          toast.message = error.message || 'An unexpected error occurred.';
        } else {
          toast.message = 'An unexpected error occurred.';
        }
      }
    },
    validation: {
      athleteName: (value) => {
        if (values.searchMode === 'name' && !value) return 'Athlete name is required for name search';
        return undefined;
      },
      playerId: (value) => {
        if (values.searchMode === 'id' && !value) return 'Player ID is required for ID search';
        return undefined;
      },
      youtubeLink: (value) => {
        if (!value) return 'The item is required';
        if (
          !value.startsWith('https://www.youtube.com/') &&
          !value.startsWith('https://youtu.be/')
        ) {
          return 'Please enter a valid YouTube link (e.g., https://www.youtube.com/watch?v=... or https://youtu.be/...)';
        }
        return undefined;
      },
      season: () => {
        // Season is optional - gracefully handle if not available
        return undefined;
      },
      videoType: FormValidation.Required,
    },
    initialValues: {
      athleteName: props.draftValues?.athleteName || '',
      youtubeLink: props.draftValues?.youtubeLink || '',
      season: props.draftValues?.season || '',
      videoType: props.draftValues?.videoType &&
                 ['Full Season Highlight', 'Partial Season Highlight', 'Single Game Highlight', 'Skills/Training Video'].includes(props.draftValues.videoType)
                 ? props.draftValues.videoType
                 : 'Full Season Highlight',
      playerId: props.draftValues?.playerId || '',
      searchMode: props.draftValues?.searchMode || 'name',
      notionTaskId: '', // Always start fresh - let user select from current active tasks
    },
  });

  // Load active tasks from Notion on mount
  useEffect(() => {
    (async () => {
      try {
        const tasks = await fetchActiveNotionTasks();
        setActiveTasks(tasks);
      } catch (e) {
        console.error('Failed to load Notion tasks', e);
      }
    })();
  }, []);

  // When a Notion task is selected, populate form fields
  useEffect(() => {
    if (!values.notionTaskId) return;
    const task = activeTasks.find((t) => t.id === values.notionTaskId);
    if (!task) return;
    if (task.name) setValue('athleteName', task.name);
    const npid = parseNPIDfromUrl(task.playerId);
    if (npid) {
      setValue('playerId', npid);
      setValue('searchMode', 'id');
    } else {
      setValue('playerId', '');
      setValue('searchMode', 'name');
    }
  }, [values.notionTaskId, activeTasks]);

  // Search for players when athlete name changes
  useEffect(() => {
    const searchPlayers = async () => {
      if (values.athleteName && values.athleteName.length > 2 && values.searchMode === 'name') {
        setIsSearching(true);
        try {
          const results = await searchVideoProgressPlayer(values.athleteName);
          setSearchResults(results);
          if (results.length > 0) {
            setSelectedPlayer(results[0]);
          }
        } catch (error) {
          console.error('Search error:', error);
          setSearchResults([]);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSearchResults([]);
      }
    };

    const timeoutId = setTimeout(searchPlayers, 500); // Debounce search
    return () => clearTimeout(timeoutId);
  }, [values.athleteName, values.searchMode]);

  // Fetch seasons when video type or selected player changes
  useEffect(() => {
    const fetchSeasons = async () => {
      if (values.videoType && selectedPlayer) {
        setIsFetchingSeasons(true);
        try {
          const result = await callPythonServer('get_video_seasons', {
            athlete_id: selectedPlayer.player_id,
            sport_alias: selectedPlayer.sport,
            video_type: values.videoType,
            athlete_main_id: selectedPlayer.athlete_main_id,
          }) as any;
          if (result.status === 'ok' && result.data) {
            setSeasons(result.data.map((s: any) => ({ value: s.value, title: s.label })));
            if (result.data.length > 0) {
              setValue('season', result.data[0].value);
            }
          } else {
            setSeasons([]);
          }
        } catch (error) {
          console.error('Failed to fetch seasons', error);
          setSeasons([]);
        } finally {
          setIsFetchingSeasons(false);
        }
      }
    };
    fetchSeasons();
  }, [values.videoType, selectedPlayer]);

  return (
    <Form
      enableDrafts
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Update NPID Video Profile" onSubmit={handleSubmit} />
          <Action
            title="Focus Athlete Name"
            onAction={() => focus('athleteName')}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'a' }}
          />
          <Action
            title="Focus Youtube Link"
            onAction={() => focus('youtubeLink')}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'y' }}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown title="Student Athlete (Active)" {...itemProps.notionTaskId} placeholder="Select from Notion">
        <Form.Dropdown.Item value="" title="(Skip - Enter name manually)" />
        {activeTasks.map((t) => (
          <Form.Dropdown.Item key={t.id} value={t.id} title={t.name || 'Untitled'} />
        ))}
      </Form.Dropdown>
      <Form.Separator />

      <Form.Description text="Enhanced NPID integration: Search for athletes by name or enter Player ID directly. Videos will be added to NPID profiles with automatic Notion sync." />
      <Form.Separator />

      <Form.Dropdown title="Search Mode" {...itemProps.searchMode}>
        <Form.Dropdown.Item value="name" title="Search by Name" />
        <Form.Dropdown.Item value="id" title="Enter Player ID" />
      </Form.Dropdown>

      {values.searchMode === 'name' ? (
        <>
          <Form.TextField
            title="Student Athlete's Name"
            placeholder="Enter full name to search NPID"
            {...itemProps.athleteName}
            autoFocus
          />
          
          {isSearching && (
            <Form.Description text="🔍 Searching NPID database..." />
          )}
          
          {searchResults.length > 0 && (
            <>
              <Form.Description text={`Found ${searchResults.length} matching players:`} />
              {searchResults.slice(0, 5).map((player, index) => (
                <Form.Description
                  key={player.player_id}
                  text={`${index + 1}. ${player.name} (${player.grad_year}) - ${player.high_school}, ${player.city}, ${player.state} - ID: ${player.player_id}`}
                />
              ))}
              {searchResults.length > 5 && (
                <Form.Description text={`... and ${searchResults.length - 5} more results`} />
              )}
            </>
          )}
        </>
      ) : (
        <Form.TextField
          title="Player ID"
          placeholder="Enter NPID Player ID"
          {...itemProps.playerId}
          autoFocus
        />
      )}

      {selectedPlayer && (
        <Form.Description 
          text={`Selected: ${selectedPlayer.name} (${selectedPlayer.grad_year}) - ${selectedPlayer.high_school}`} 
        />
      )}

      <Form.TextField
        title="YouTube Link"
        placeholder="e.g., https://www.youtube.com/watch?v=..."
        {...itemProps.youtubeLink}
      />

      <Form.Dropdown title="Video Type" {...itemProps.videoType}>
        <Form.Dropdown.Item value="Full Season Highlight" title="Full Season Highlight" />
        <Form.Dropdown.Item value="Partial Season Highlight" title="Partial Season Highlight" />
        <Form.Dropdown.Item value="Single Game Highlight" title="Single Game Highlight" />
        <Form.Dropdown.Item value="Skills/Training Video" title="Skills/Training Video" />
      </Form.Dropdown>

      <Form.Dropdown title="Season" {...itemProps.season}>
        {isFetchingSeasons ? (
          <Form.Dropdown.Item value="" title="Loading seasons..." />
        ) : (
          <>
            <Form.Dropdown.Item value="" title="(Skip - No Season)" />
            {seasons.map((s) => (
              <Form.Dropdown.Item key={s.value} value={s.value} title={s.title} />
            ))}
          </>
        )}
      </Form.Dropdown>
    </Form>
  );
}
