import React, { useState, useEffect } from 'react';
import { Form, ActionPanel, Action, showToast, Toast, LaunchProps } from '@raycast/api';
import { useForm, FormValidation } from '@raycast/utils';
import { callPythonServer } from './lib/python-server-client';
import * as fs from 'fs';

// Logging utility - writes to file only (console.log would cause recursion)
const LOG_FILE = '/Users/singleton23/raycast_logs/console.log';
function log(...args: any[]) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
  // Write to file only - DO NOT call console.log here (causes infinite recursion)
  try {
    fs.appendFileSync(LOG_FILE, message + '\n');
  } catch {
    // Can't log errors here either - would cause recursion
    fs.appendFileSync(LOG_FILE, `[ERROR] Failed to write log\n`);
  }
}

async function searchVideoProgressPlayer(query: string): Promise<NPIDPlayer[]> {
  log('🔍 searchVideoProgressPlayer called with:', query);
  try {
    const nameParts = query.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    log('🔍 Searching for:', { firstName, lastName });
    const results = await callPythonServer<any[]>('search_video_progress', { first_name: firstName, last_name: lastName });
    log('✅ Search returned', results.length, 'results');
    return results.map(player => ({
      primaryPosition: player.primaryposition,
      secondaryPosition: player.secondaryposition,
      thirdPosition: player.thirdposition,
      paidStatus: player.paid_status,
      athleteName: player.athletename,
      name: player.athletename,
      player_id: player.athlete_id?.toString(),
      id: player.id,
      videoProgress: player.video_progress,
      videoProgressStatus: player.video_progress_status,
      stage: player.stage,
      videoDueDate: player.video_due_date,
      videoDueDateSort: player.video_due_date_sort,
      sportName: player.sport_name,
      sport: player.sport_alias || player.sport_name?.toLowerCase().replace(/'/g, '').replace(/ /g, '-'),
      gradYear: player.grad_year,
      grad_year: player.grad_year,
      highSchoolCity: player.high_school_city,
      city: player.high_school_city,
      highSchoolState: player.high_school_state,
      state: player.high_school_state,
      highSchool: player.high_school,
      high_school: player.high_school,
      athleteId: player.athlete_id,
      assignedVideoEditor: player.assignedvideoeditor,
      assignedDate: player.assigned_date,
      assignedDateSort: player.assigned_date_sort,
      athlete_main_id: player.athlete_main_id?.toString(),
    }));
  } catch (error) {
    console.error('NPID video progress search error:', error);
    return [];
  }
}

interface VideoUpdateFormValues {
  athleteName: string;
  youtubeLink: string;
  season: string;
  videoType: string;
}

interface NPIDPlayer {
  primaryPosition: string;
  secondaryPosition: string;
  thirdPosition: string;
  paidStatus: string;
  athleteName: string;
  name: string;
  player_id: string;
  id: number;
  videoProgress: string;
  videoProgressStatus: string;
  stage: string;
  videoDueDate: string;
  videoDueDateSort: number;
  sportName: string;
  sport: string;
  gradYear: number;
  grad_year: number;
  highSchoolCity: string;
  city: string;
  highSchoolState: string;
  state: string;
  highSchool: string;
  high_school: string;
  athleteId: number;
  assignedVideoEditor: string;
  assignedDate: string;
  assignedDateSort: number;
  athlete_main_id?: string;
}

export default function VideoUpdatesCommand(
  props: LaunchProps<{ draftValues: VideoUpdateFormValues }>,
) {
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<NPIDPlayer | null>(null);
  const [fetchedAthleteMainId, setFetchedAthleteMainId] = useState<string | null>(null);
  const [isFetchingMainId, setIsFetchingMainId] = useState(false);
  const [seasons, setSeasons] = useState<{ value: string, title: string }[]>([]);
  const [isFetchingSeasons, setIsFetchingSeasons] = useState(false);

  const { handleSubmit, itemProps, reset, focus, values, setValue } = useForm<VideoUpdateFormValues>({
    async onSubmit(formValues) {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Processing video update...',
      });

      try {
        let playerId = '';
        let athleteName = formValues.athleteName;

        if (selectedPlayer) {
          playerId = selectedPlayer.player_id;
          athleteName = selectedPlayer.name;
        }

        if (!playerId) {
          toast.style = Toast.Style.Failure;
          toast.title = 'Player ID Required';
          toast.message = 'Please search for a player.';
          return;
        }

        await toast.show();
        toast.title = 'Updating NPID Profile...';
        toast.message = `Updating video for ${athleteName} (ID: ${playerId})`;

        try {
          log('🎬 Submitting video:', { playerId, youtubeLink: formValues.youtubeLink, season: formValues.season, videoType: formValues.videoType });
          const result = await callPythonServer('update_video_profile', {
            player_id: playerId,
            youtube_link: formValues.youtubeLink,
            season: formValues.season,
            video_type: formValues.videoType
          }) as any;
          log('📥 update_video_profile response:', result);
          if (result.status === 'ok' && result.data?.success) {
            toast.style = Toast.Style.Success;
            toast.title = 'Video Uploaded!';
            toast.message = `Sending email and updating stage...`;

            try {
              log('📧 Sending email to:', athleteName);
              toast.message = `Sending "Editing Done" email...`;
              const emailResult = await callPythonServer('send_email_to_athlete', {
                athlete_name: athleteName,
                template_name: 'Editing Done'
              }) as any;

              if (emailResult.status === 'ok' && emailResult.data?.success) {
                toast.message = `Email sent! Updating stage to Done...`;

                try {
                  log('🏁 Updating stage to done for:', playerId);
                  const stageResult = await callPythonServer('update_video_stage', {
                    athlete_id: playerId,
                    stage: 'done'
                  }) as any;
                  log('📥 update_video_stage response:', stageResult);

                  if (stageResult.success) {
                    toast.style = Toast.Style.Success;
                    toast.title = 'All Steps Complete!';
                    toast.message = `✅ Video uploaded\n✅ Email sent\n✅ Status updated to Done`;
                  } else {
                    toast.style = Toast.Style.Success;
                    toast.title = 'Video & Email Complete';
                    toast.message = `✅ Video uploaded\n✅ Email sent\n⚠️ Status update failed`;
                  }
                } catch (stageError) {
                  console.error('Stage update error:', stageError);
                  toast.style = Toast.Style.Success;
                  toast.title = 'Video & Email Complete';
                  toast.message = `✅ Video uploaded\n✅ Email sent\n⚠️ Status update failed`;
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
            setSeasons([]);
            setFetchedAthleteMainId(null);
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
        if (!value) return 'Athlete name is required';
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
    },
  });

  // Search for players when athlete name changes
  useEffect(() => {
    const searchPlayers = async () => {
      if (values.athleteName && values.athleteName.length > 2) {
        log('🔎 Starting search for:', values.athleteName);
        setIsSearching(true);
        try {
          const results = await searchVideoProgressPlayer(values.athleteName);
          if (results.length > 0) {
            log('✅ Auto-selecting first player:', results[0].name, 'ID:', results[0].player_id);
            setSelectedPlayer(results[0]);
          } else {
            log('⚠️ No search results found');
            setSelectedPlayer(null);
          }
        } catch (error) {
          console.error('Search error:', error);
          setSelectedPlayer(null);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSelectedPlayer(null);
      }
    };

    const timeoutId = setTimeout(searchPlayers, 500);
    return () => clearTimeout(timeoutId);
  }, [values.athleteName]);

  // Fetch athlete_main_id when player is selected
  useEffect(() => {
    const fetchMainId = async () => {
      if (selectedPlayer && selectedPlayer.player_id) {
        log('🆔 Fetching athlete_main_id for player_id:', selectedPlayer.player_id);
        setIsFetchingMainId(true);
        try {
          const result = await callPythonServer('get_athlete_details', { player_id: selectedPlayer.player_id }) as any;
          log('📥 get_athlete_details response:', result);
          if (result?.athlete_main_id) {
            log('✅ Fetched athlete_main_id:', result.athlete_main_id);
            setFetchedAthleteMainId(result.athlete_main_id);
          } else {
            log('⚠️ No athlete_main_id in response');
            setFetchedAthleteMainId(null);
          }
        } catch (error) {
          console.error('Failed to fetch athlete_main_id:', error);
          setFetchedAthleteMainId(null);
        } finally {
          setIsFetchingMainId(false);
        }
      } else {
        setFetchedAthleteMainId(null);
      }
    };
    fetchMainId();
  }, [selectedPlayer]);

  // Fetch seasons when video type or selected player changes
  useEffect(() => {
    const fetchSeasons = async () => {
      if (values.videoType && selectedPlayer) {
        const athleteId = selectedPlayer.player_id;
        const sportAlias = selectedPlayer.sport;
        const videoType = values.videoType;
        let athleteMainId = fetchedAthleteMainId;
        log('📅 Fetching seasons with:', { athleteId, sportAlias, videoType, athleteMainId });

        if (!athleteMainId && athleteId) {
          log('⚠️ athlete_main_id not cached, fetching...');
          const det = await callPythonServer('get_athlete_details', { player_id: athleteId }) as any;
          athleteMainId = det?.athlete_main_id;
          log('✅ Fetched athlete_main_id for seasons:', athleteMainId);
        }

        if (!athleteId || !sportAlias || !videoType || !athleteMainId) {
          console.error('Missing params:', { athleteId, sportAlias, videoType, athleteMainId });
          setSeasons([]);
          return;
        }

        setIsFetchingSeasons(true);
        try {
          const result = await callPythonServer('get_video_seasons', {
            athlete_id: athleteId,
            sport_alias: sportAlias,
            video_type: videoType,
            athlete_main_id: athleteMainId,
          }) as any;
          log('📥 get_video_seasons response:', result);

          if (result.status === 'ok' && result.data) {
            log('✅ Seasons loaded:', result.data.length, 'items');
            // Use 'label' from API response for display, 'value' for submission
            setSeasons(result.data.map((s: any) => ({ value: s.value, title: s.label })));
            if (result.data.length > 0) {
              setValue('season', result.data[0].value);
            }
          } else {
            log('⚠️ Failed to load seasons or no data:', result);
            setSeasons([]);
          }
        } catch (error) {
          console.error('Failed to fetch seasons:', error);
          setSeasons([]);
        } finally {
          setIsFetchingSeasons(false);
        }
      }
    };
    fetchSeasons();
  }, [values.videoType, selectedPlayer, fetchedAthleteMainId]);

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
      <Form.TextField
        title="Student Athlete's Name"
        placeholder="Enter full name to search NPID"
        {...itemProps.athleteName}
        autoFocus
      />

      {isSearching && (
        <Form.Description text="🔍 Searching NPID database..." />
      )}

      {selectedPlayer && (
        <Form.Description
          text={`Selected: ${selectedPlayer.name} (${selectedPlayer.grad_year}) - ${selectedPlayer.high_school} | ID: ${selectedPlayer.player_id} | Main ID: ${isFetchingMainId ? 'Loading...' : (fetchedAthleteMainId || 'N/A')}`}
        />
      )}

      <Form.TextField
        title="YouTube Link"
        placeholder="e.g., https://www.youtube.com/watch?v=..."
        {...itemProps.youtubeLink}
        disabled={!selectedPlayer}
      />

      <Form.Dropdown
        title="Video Type"
        {...itemProps.videoType}
        disabled={!values.youtubeLink}
      >
        <Form.Dropdown.Item value="Full Season Highlight" title="Full Season Highlight" />
        <Form.Dropdown.Item value="Partial Season Highlight" title="Partial Season Highlight" />
        <Form.Dropdown.Item value="Single Game Highlight" title="Single Game Highlight" />
        <Form.Dropdown.Item value="Skills/Training Video" title="Skills/Training Video" />
      </Form.Dropdown>

      <Form.Dropdown
        title="Season/Team"
        {...itemProps.season}
        disabled={!values.videoType}
      >
        {isFetchingSeasons ? (
          <Form.Dropdown.Item value="" title="Loading seasons..." />
        ) : seasons.length === 0 ? (
          <Form.Dropdown.Item value="" title="(No seasons available - Update student profile)" />
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
