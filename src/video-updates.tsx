import React, { useState, useEffect } from 'react';
import { Form, ActionPanel, Action, showToast, Toast, LaunchProps, getPreferenceValues } from '@raycast/api';
import { useForm, FormValidation } from '@raycast/utils';
import { Client } from '@notionhq/client';
import { callPythonServer } from './lib/python-server-client';

async function searchNPIDPlayer(query: string): Promise<NPIDPlayer[]> {
  try {
    const result = await callPythonServer('search_player', { query }) as any;
    if (result.status === 'ok') {
      return result.results || [];
    }
    return [];
  } catch (error) {
    console.error('NPID search error:', error);
    return [];
  }
}

async function getNPIDPlayerDetails(playerId: string): Promise<NPIDPlayer | null> {
  try {
    const result = await callPythonServer('get_athlete_details', { player_id: playerId }) as any;
    if (result.status === 'ok' && result.data) {
      const data = result.data;
      return {
        player_id: playerId,
        name: data.name || 'Unknown Player',
        grad_year: data.grad_year || '',
        high_school: data.high_school || '',
        city: data.location ? data.location.split(',')[0]?.trim() : '',
        state: data.location ? data.location.split(',')[1]?.trim() : '',
        positions: data.positions || '',
        sport: data.sport || ''
      };
    }
    return null;
  } catch (error) {
    console.error('NPID player details error:', error);
    return null;
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
  player_id: string;
  name: string;
  grad_year: string;
  high_school: string;
  city: string;
  state: string;
  positions: string;
  sport: string;
}

export default function VideoUpdatesCommand(
  props: LaunchProps<{ draftValues: VideoUpdateFormValues }>,
) {
  const [searchResults, setSearchResults] = useState<NPIDPlayer[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<NPIDPlayer | null>(null);
  const [activeTasks, setActiveTasks] = useState<NotionTask[]>([]);

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
          const result = await callPythonServer('update_video_profile', {
            player_id: playerId,
            youtube_link: formValues.youtubeLink,
            season: formValues.season,
            video_type: formValues.videoType
          }) as any;

          if (result.status === 'ok' && result.data?.success) {
            toast.style = Toast.Style.Success;
            toast.title = 'Video Updated Successfully';
            toast.message = `Video added to ${athleteName}'s NPID profile`;
            reset();
            setSelectedPlayer(null);
            setSearchResults([]);
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
      season: FormValidation.Required,
      videoType: FormValidation.Required,
    },
    initialValues: props.draftValues || {
      athleteName: '',
      youtubeLink: '',
      season: 'Junior Season',
      videoType: 'Highlights',
      playerId: '',
      searchMode: 'name',
      notionTaskId: '',
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
          const results = await searchNPIDPlayer(values.athleteName);
          setSearchResults(results);
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

  // Get player details when player ID is provided
  useEffect(() => {
    const getPlayerDetails = async () => {
      if (values.playerId && values.searchMode === 'id') {
        const player = await getNPIDPlayerDetails(values.playerId);
        setSelectedPlayer(player);
      } else {
        setSelectedPlayer(null);
      }
    };

    getPlayerDetails();
  }, [values.playerId, values.searchMode]);

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

      <Form.Dropdown title="Season" {...itemProps.season}>
        <Form.Dropdown.Item value="7th Grade Season" title="7th Grade Season" />
        <Form.Dropdown.Item value="8th Grade Season" title="8th Grade Season" />
        <Form.Dropdown.Item value="Freshman Season" title="Freshman Season" />
        <Form.Dropdown.Item value="Sophomore Season" title="Sophomore Season" />
        <Form.Dropdown.Item value="Junior Season" title="Junior Season" />
        <Form.Dropdown.Item value="Senior Season" title="Senior Season" />
      </Form.Dropdown>

      <Form.Dropdown title="Video Type" {...itemProps.videoType}>
        <Form.Dropdown.Item value="Highlights" title="Highlights" />
        <Form.Dropdown.Item value="Skills" title="Skills" />
        <Form.Dropdown.Item value="Highlights | Skills" title="Highlights | Skills" />
      </Form.Dropdown>
    </Form>
  );
}
