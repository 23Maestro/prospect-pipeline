import React, { useState, useEffect } from "react";
import {
  Form,
  ActionPanel,
  Action,
  showToast,
  Toast,
  LaunchProps,
  useNavigation,
  List,
  Icon,
  Color,
} from "@raycast/api";
import { useForm, FormValidation } from "@raycast/utils";
import { callPythonServer, getSeasons, apiFetch, SeasonsRequest } from "./lib/python-server-client";
import * as cheerio from "cheerio";
import * as fs from "fs";



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

    // Use apiFetch instead of callPythonServer
    const response = await apiFetch('/video/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName
      })
    });

    if (!response.ok) {
      log('⚠️ Search failed with status:', response.status);
      return [];
    }

    const data = await response.json() as any;
    const results = data.tasks || [];

    log('✅ Search returned', results.length, 'results');
    return results.map((player: any) => ({
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
      athlete_main_id: (player.athlete_main_id || '').toString(),
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

function parseSortableHtml(html: string): string[] {
  if (!html) return [];
  try {
    const $ = cheerio.load(html);
    return $('.video-item, .highlight-video, li')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
  } catch (error) {
    log('⚠️ Failed to parse sortable HTML', error);
    return [];
  }
}

function parseSortableHtmlDetailed(html: string): { id: string; title: string; approved: boolean; subtitle?: string }[] {
  if (!html) return [];
  try {
    const $ = cheerio.load(html);
    const items: { id: string; title: string; approved: boolean; subtitle?: string }[] = [];
    $('.video-item, li, .highlight-video').each((_, el) => {
      const id = $(el).attr('data-id') || $(el).attr('id') || '';
      const fullText = $(el).text().trim();

      // Check for approval status
      const approved = $(el).hasClass('approved') ||
        $(el).find('.approved, .badge-success').length > 0 ||
        fullText.toLowerCase().includes('npid approved');

      // Extract title (remove approval text if present)
      const title = fullText.replace(/\(NPID Approved\)/gi, '').trim();

      // Try to extract season info as subtitle
      const seasonMatch = title.match(/(High School|Club|College|AAU)\s*-\s*(Freshman|Sophomore|Junior|Senior|[0-9]{4})\s*-\s*(\w+)/i);
      const subtitle = seasonMatch ? seasonMatch[0] : undefined;

      if (id && title) {
        items.push({ id, title, approved, subtitle });
      }
    });
    // Fallback: try regex if no data-id found
    if (items.length === 0) {
      const regex = /data-id\s*=\s*"(\d+)"[^>]*>([^<]+)/gi;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const id = match[1];
        const title = match[2].trim();
        const approved = title.toLowerCase().includes('npid approved');
        if (id && title) {
          items.push({ id, title: title.replace(/\(NPID Approved\)/gi, '').trim(), approved });
        }
      }
    }
    return items;
  } catch (error) {
    log('⚠️ Failed to parse sortable HTML (detailed)', error);
    return [];
  }
}

// Background automation toggles (keep false unless you want auto email + stage update after upload)
const AUTO_POST_UPLOAD_ACTIONS = true;
const DEFAULT_TEMPLATE_ID = '172'; // Editing Done: Video Editing Complete

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
  athlete_main_id: string;
}

export default function VideoUpdatesCommand(
  props: LaunchProps<{ draftValues: VideoUpdateFormValues }>,
) {

  const [isSearching, setIsSearching] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<NPIDPlayer | null>(null);
  const [fetchedAthleteMainId, setFetchedAthleteMainId] = useState<string | null>(null);
  const [isFetchingMainId, setIsFetchingMainId] = useState(false);
  const [mainIdResolvedForAthleteId, setMainIdResolvedForAthleteId] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<{ value: string, title: string, season: string }[]>([]);
  const [isFetchingSeasons, setIsFetchingSeasons] = useState(false);
  const { push, pop } = useNavigation();

  const selectPlayer = (player: NPIDPlayer | null) => {
    setSelectedPlayer(player);
    setFetchedAthleteMainId(null);
    setIsFetchingMainId(false);
    setMainIdResolvedForAthleteId(null);
    setSeasons([]);
    setValue('season', '');
  };

  const { handleSubmit, itemProps, reset, focus, values, setValue } = useForm<VideoUpdateFormValues>({
    async onSubmit(formValues) {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Processing video update...',
      });

      try {
        let athleteId = selectedPlayer?.player_id || '';
        let athleteName = formValues.athleteName;
        const sportAlias = selectedPlayer?.sport || '';
        const athleteMainId = mainIdResolvedForAthleteId === athleteId ? (fetchedAthleteMainId || '') : '';
        const videoMsgId = selectedPlayer?.id ? selectedPlayer.id.toString() : '';

        if (selectedPlayer) {
          athleteId = selectedPlayer.player_id;
          athleteName = selectedPlayer.name;
        }

        if (!athleteId) {
          toast.style = Toast.Style.Failure;
          toast.title = 'Athlete ID Required';
          toast.message = 'Please search for a player.';
          return;
        }

        if (isFetchingMainId || mainIdResolvedForAthleteId !== athleteId) {
          toast.style = Toast.Style.Failure;
          toast.title = 'Resolving athlete_main_id...';
          toast.message = 'Please wait a moment and try again.';
          return;
        }

        if (!athleteMainId) {
          toast.style = Toast.Style.Failure;
          toast.title = 'Missing athlete_main_id';
          toast.message = 'Cannot proceed without athlete_main_id.';
          return;
        }

        if (!sportAlias) {
          toast.style = Toast.Style.Failure;
          toast.title = 'Missing sport alias';
          toast.message = 'Please re-select the athlete to capture their sport.';
          return;
        }

        await toast.show();
        toast.title = 'Updating NPID Profile...';
        toast.message = `Updating video for ${athleteName} (ID: ${athleteId})`;

        try {
          const selectedSeason = seasons.find((s) => s.value === formValues.season);

          log('🎬 Submitting video:', {
            athleteId,
            youtubeLink: formValues.youtubeLink,
            season: formValues.season,
            seasonType: selectedSeason?.season,
            videoType: formValues.videoType,
            sportAlias,
            athleteMainId,
          });

          const response = await apiFetch('/video/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              athlete_id: athleteId,
              athlete_main_id: athleteMainId,
              video_url: formValues.youtubeLink,
              video_type: formValues.videoType,
              season: formValues.season,
              season_type: selectedSeason?.season || '',
              source: 'youtube',
              auto_approve: true,
              sport: sportAlias,
            }),
          });

          if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}` })) as any;
            log('⚠️ video submit failed', { status: response.status, error });
            throw new Error(error.detail || error.message || 'Unknown error');
          }
          const result = await response.json() as any;
          log('📥 add_career_video response:', result);
          const success = response.ok && (result?.success === true);
          if (success) {
            toast.style = Toast.Style.Success;
            toast.title = 'Video Uploaded!';
            const updatedVideos = parseSortableHtml(result?.sortable_html || result?.data?.sortable_html || '');
            toast.message = updatedVideos.length > 0
              ? `Latest video: ${updatedVideos[0]}`
              : 'Highlight added successfully';

            if (AUTO_POST_UPLOAD_ACTIONS) {
              void runPostUploadActions({
                athleteId,
                athleteMainId,
                athleteName,
                videoMsgId,
              });
            }

            reset();
            selectPlayer(null);
            setFetchedAthleteMainId(null);
            setMainIdResolvedForAthleteId(null);
          } else {
            toast.style = Toast.Style.Failure;
            toast.title = 'NPID Update Failed';
            toast.message = result?.message || result?.detail || `HTTP ${response.status}`;
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
      season: '',
      videoType: props.draftValues?.videoType &&
        ['Full Season Highlight', 'Partial Season Highlight', 'Single Game Highlight', 'Skills/Training Video'].includes(props.draftValues.videoType)
        ? props.draftValues.videoType
        : '',
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
            selectPlayer(results[0]);
          } else {
            log('⚠️ No search results found');
            selectPlayer(null);
          }
        } catch (error) {
          console.error('Search error:', error);
          selectPlayer(null);
        } finally {
          setIsSearching(false);
        }
      } else {
        selectPlayer(null);
      }
    };

    const timeoutId = setTimeout(searchPlayers, 500);
    return () => clearTimeout(timeoutId);
  }, [values.athleteName]);

  // Extract athlete_main_id from profile page when player is selected
  useEffect(() => {
    let cancelled = false;
    const fetchMainId = async () => {
      const playerId = selectedPlayer?.player_id;
      if (!playerId) {
        setFetchedAthleteMainId(null);
        setIsFetchingMainId(false);
        setMainIdResolvedForAthleteId(null);
        return;
      }

      log('🆔 Fetching athlete_main_id for player_id:', playerId);
      setIsFetchingMainId(true);
      setFetchedAthleteMainId(null);
      setMainIdResolvedForAthleteId(null);

      try {
        const resp = await apiFetch(`/athlete/${encodeURIComponent(playerId)}/resolve`);

        if (cancelled) return;

        if (resp.status === 404) {
          await showToast({ style: Toast.Style.Failure, title: 'Athlete not found' });
          setFetchedAthleteMainId(null);
          return;
        }

        if (resp.status >= 500) {
          await showToast({ style: Toast.Style.Failure, title: 'Resolution failed' });
          setFetchedAthleteMainId(null);
          return;
        }

        const result = await resp.json().catch(() => ({})) as any;
        log('📥 resolve response:', result);

        if (result?.athlete_main_id) {
          log('✅ Fetched athlete_main_id:', result.athlete_main_id);
          setFetchedAthleteMainId(String(result.athlete_main_id));
        } else {
          log('⚠️ No athlete_main_id in response');
          setFetchedAthleteMainId(null);
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to fetch athlete_main_id:', error);
        setFetchedAthleteMainId(null);
      } finally {
        if (!cancelled) {
          setIsFetchingMainId(false);
          setMainIdResolvedForAthleteId(playerId);
        }
      }
    };

    void fetchMainId();
    return () => {
      cancelled = true;
    };
  }, [selectedPlayer]);


  // Fetch seasons when video type or selected player changes
  useEffect(() => {
    const fetchSeasons = async () => {
      if (values.videoType && selectedPlayer) {
        const athleteId = selectedPlayer.player_id;
        const sportAlias = selectedPlayer.sport;
        const videoType = values.videoType;
        const athleteMainId = mainIdResolvedForAthleteId === athleteId ? (fetchedAthleteMainId || '') : '';
        log('📅 Fetching seasons with:', { athleteId, sportAlias, videoType, athleteMainId });

        if (isFetchingMainId || mainIdResolvedForAthleteId !== athleteId) {
          setSeasons([]);
          setValue('season', '');
          return;
        }

        if (!athleteId || !sportAlias || !videoType || !athleteMainId) {
          console.error('Missing params:', { athleteId, sportAlias, videoType, athleteMainId });
          setSeasons([]);
          setValue('season', '');
          try {
            await showToast({
              style: Toast.Style.Failure,
              title: 'Missing athlete_main_id',
              message: 'Cannot load seasons without athlete_main_id.',
            });
          } catch {
            // ignore toast errors
          }
          return;
        }

        setIsFetchingSeasons(true);
        try {
          await loadSeasonsViaFastAPI({ athleteId, athleteMainId, sportAlias, videoType });
        } catch (error) {
          console.error('Failed to fetch seasons via FastAPI, falling back to Python client:', error);
          try {
            await loadSeasonsViaPython({ athleteId, athleteMainId, sportAlias, videoType });
          } catch (fallbackError) {
            console.error('Fallback seasons fetch also failed:', fallbackError);
            setSeasons([]);
            setValue('season', '');
            const fallbackMessage =
              fallbackError instanceof Error
                ? fallbackError.message
                : typeof fallbackError === 'object'
                  ? JSON.stringify(fallbackError)
                  : String(fallbackError);
            await showToast({
              style: Toast.Style.Failure,
              title: 'Failed to load seasons',
              message: fallbackMessage,
            });
          }
        } finally {
          setIsFetchingSeasons(false);
        }
      }
    };
    fetchSeasons();
  }, [values.videoType, selectedPlayer, fetchedAthleteMainId, isFetchingMainId, mainIdResolvedForAthleteId]);

  const loadSeasonsViaFastAPI = async (params: SeasonsRequest) => {
    const result = await getSeasons(params);
    normalizeAndApplySeasons(result);
  };

  const loadSeasonsViaPython = async ({ athleteId, athleteMainId, sportAlias, videoType }: SeasonsRequest) => {
    const result = await callPythonServer<any>('get_video_seasons', {
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
      sport_alias: sportAlias,
      video_type: videoType,
    });
    normalizeAndApplySeasons(result);
  };

  const normalizeAndApplySeasons = (raw: any) => {
    const rawSeasons = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.data)
        ? raw.data
        : Array.isArray(raw?.seasons)
          ? raw.seasons
          : [];

    if (!Array.isArray(rawSeasons)) {
      log('⚠️ Seasons response in unexpected format:', raw);
      setSeasons([]);
      setValue('season', '');
      return;
    }

    log('✅ Seasons loaded:', rawSeasons.length, 'items');
    const normalized = rawSeasons
      .map((s: any) => {
        const value = s?.season_id ?? s?.seasonId ?? s?.value;
        const title = s?.label ?? s?.title ?? '';
        const season = s?.season ?? '';
        if (!value || !title) return null;
        return {
          value: String(value),
          title: String(title),
          season: String(season),
        };
      })
      .filter((s) => s) as { value: string; title: string; season: string }[];

    setSeasons(normalized);
    if (normalized.length > 0) {
      setValue('season', normalized[0].value);
    } else {
      setValue('season', '');
    }
  };

  const fetchSortableVideos = async (): Promise<{ id: string; title: string; approved: boolean; subtitle?: string }[]> => {
    if (!selectedPlayer) throw new Error('No athlete selected');
    const athleteId = selectedPlayer.player_id;
    const athleteMainId = fetchedAthleteMainId || '';
    const sportAlias = selectedPlayer.sport;
    if (!athleteId || !athleteMainId || !sportAlias) {
      throw new Error('Missing athlete info for sortable fetch');
    }
    const resp = await apiFetch(`/video/sortable?athlete_id=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(athleteMainId)}&sport_alias=${encodeURIComponent(sportAlias)}`);
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Failed to load videosortable: HTTP ${resp.status} ${txt}`);
    }
    const data = await resp.json().catch(() => ({})) as any;
    const html = data?.html || '';
    return parseSortableHtmlDetailed(html);
  };

  const fetchTemplates = async (athleteId: string) => {
    const resp = await apiFetch(`/email/templates/${encodeURIComponent(athleteId)}`);
    if (!resp.ok) throw new Error(`Templates HTTP ${resp.status}`);
    const payload = await resp.json().catch(() => ({})) as any;
    const templates = Array.isArray(payload.templates) ? payload.templates : [];
    return templates.map((t: any) => ({ value: t.value, title: t.label || t.value || 'Template' }));
  };

  const fetchTemplateData = async (templateId: string, athleteId: string) => {
    const resp = await apiFetch('/email/template-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId, athlete_id: athleteId }),
    });
    if (!resp.ok) throw new Error(`Template data HTTP ${resp.status}`);
    return resp.json() as Promise<{ sender_name: string; sender_email: string; subject: string; message: string }>;
  };

  const fetchRecipients = async (athleteId: string) => {
    const resp = await apiFetch(`/email/recipients/${encodeURIComponent(athleteId)}`);
    if (!resp.ok) throw new Error(`Recipients HTTP ${resp.status}`);
    const payload = await resp.json().catch(() => ({})) as any;
    const recipients = payload.recipients || {};
    return {
      athlete: recipients.athlete || null,
      parents: Array.isArray(recipients.parents) ? recipients.parents : [],
    };
  };

  const sendEmail = async (params: {
    athleteId: string;
    templateId: string;
    senderName: string;
    senderEmail: string;
    subject: string;
    message: string;
    includeAthlete?: boolean;
    parentIds?: string[];
    otherEmail?: string;
  }) => {
    const resp = await apiFetch('/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete_id: params.athleteId,
        template_id: params.templateId,
        notification_from: params.senderName,
        notification_from_email: params.senderEmail,
        notification_subject: params.subject,
        notification_message: params.message,
        include_athlete: params.includeAthlete ?? true,
        parent_ids: params.parentIds ?? [],
        other_email: params.otherEmail ?? '',
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as any;
      throw new Error(err.detail || `Email HTTP ${resp.status}`);
    }
    const result = await resp.json().catch(() => ({})) as any;
    if (!result?.success) throw new Error(result?.message || 'Email send failed');
  };

  const updateStageDone = async (videoMsgId: string) => {
    const resp = await apiFetch(`/video/${encodeURIComponent(videoMsgId)}/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_msg_id: videoMsgId, stage: 'done' }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as any;
      throw new Error(err.detail || `Stage HTTP ${resp.status}`);
    }
  };

  const runPostUploadActions = async ({
    athleteId,
    athleteMainId,
    athleteName,
    videoMsgId,
  }: {
    athleteId: string;
    athleteMainId: string;
    athleteName: string;
    videoMsgId: string;
  }) => {
    try {
      log('🤖 Post-upload automation start', { athleteId, athleteMainId, videoMsgId });
      const templates = await fetchTemplates(athleteId);
      const picked =
        templates.find((t) => t.value === DEFAULT_TEMPLATE_ID) ||
        templates[0];
      if (!picked) {
        log('⚠️ No templates available, skipping email');
        return;
      }
      const data = await fetchTemplateData(picked.value, athleteId);

      // Fetch recipients to include athlete + parents + Other
      const recipients = await fetchRecipients(athleteId);
      const parentIds = recipients.parents
        .filter((p: any) => p?.id)
        .map((p: any) => String(p.id));

      log('📧 Sending email to all recipients', {
        athleteId,
        parentIds,
        includeAthlete: true,
        otherEmail: 'jholcomb@prospectid.com'
      });

      await sendEmail({
        athleteId,
        templateId: picked.value,
        senderName: data.sender_name || 'Prospect ID Video',
        senderEmail: data.sender_email || 'videoteam@prospectid.com',
        subject: data.subject || '',
        message: data.message || '',
        includeAthlete: true,
        parentIds,
        otherEmail: 'jholcomb@prospectid.com',
      });
      log('✅ Email sent automatically', { template: picked.value, recipientCount: 1 + parentIds.length + 1 });

      if (videoMsgId) {
        await updateStageDone(videoMsgId);
        log('✅ Stage updated to done', { videoMsgId });
      } else {
        log('⚠️ No video_msg_id; skipped stage update');
      }
    } catch (error) {
      log('⚠️ Post-upload automation failed', error);
    }
  };

  const handleDeleteLatest = async () => {
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Deleting latest video...' });
    try {
      const list = await fetchSortableVideos();
      if (list.length === 0) {
        toast.style = Toast.Style.Failure;
        toast.title = 'No videos found';
        toast.message = 'Sortable list is empty';
        return;
      }
      const latest = list[0];
      const athleteId = selectedPlayer?.player_id || '';
      const athleteMainId = fetchedAthleteMainId || '';
      const resp = await apiFetch('/video/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athlete_id: athleteId,
          athlete_main_id: athleteMainId,
          video_id: latest.id,
        })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as any;
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      toast.style = Toast.Style.Success;
      toast.title = 'Deleted latest video';
      toast.message = latest.title;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Delete failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
    }
  };

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
          <Action
            title="Delete Latest Video"
            onAction={() => handleDeleteLatest()}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'd' }}
          />
          <Action
            title="Delete Multiple Videos"
            onAction={() => push(<DeleteVideosForm onBack={pop} selectedPlayer={selectedPlayer} fetchedAthleteMainId={fetchedAthleteMainId} />)}
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
          text={`Selected: ${selectedPlayer.name} (${selectedPlayer.grad_year}) - ${selectedPlayer.high_school} | ID: ${selectedPlayer.player_id} | Main ID: ${isFetchingMainId || mainIdResolvedForAthleteId !== selectedPlayer.player_id ? 'Loading...' : (fetchedAthleteMainId || 'N/A')}`}
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
        {seasons.length === 0
          ? <Form.Dropdown.Item value="" title="-- Season/Team --" />
          : seasons.map((s) => (
            <Form.Dropdown.Item key={s.value} value={s.value} title={s.title} />
          ))}
      </Form.Dropdown>
    </Form>
  );
}

function DeleteVideosForm({
  onBack,
  selectedPlayer,
  fetchedAthleteMainId,
}: {
  onBack: () => void;
  selectedPlayer: NPIDPlayer | null;
  fetchedAthleteMainId: string | null;
}) {
  const [videos, setVideos] = useState<{ id: string; title: string; approved: boolean; subtitle?: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        if (!selectedPlayer) throw new Error('No athlete selected');
        const athleteId = selectedPlayer.player_id;
        const athleteMainId = fetchedAthleteMainId || '';
        const sportAlias = selectedPlayer.sport;
        if (!athleteId || !athleteMainId || !sportAlias) throw new Error('Missing athlete info');

        const resp = await apiFetch(`/video/sortable?athlete_id=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(athleteMainId)}&sport_alias=${encodeURIComponent(sportAlias)}`);
        const data = await resp.json().catch(() => ({})) as any;
        const parsed = parseSortableHtmlDetailed(data?.html || '');
        setVideos(parsed);
      } catch (error) {
        await showToast({ style: Toast.Style.Failure, title: 'Failed to load videos', message: error instanceof Error ? error.message : 'Unknown error' });
        onBack();
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [selectedPlayer, fetchedAthleteMainId, onBack]);

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const handleDelete = async () => {
    if (selected.size === 0) {
      await showToast({ style: Toast.Style.Failure, title: 'No videos selected', message: 'Select at least one video to delete' });
      return;
    }
    if (!selectedPlayer) return;
    const athleteId = selectedPlayer.player_id;
    const athleteMainId = fetchedAthleteMainId || '';
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Deleting videos...' });
    try {
      for (const id of Array.from(selected)) {
        const resp = await apiFetch('/video/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ athlete_id: athleteId, athlete_main_id: athleteMainId, video_id: id }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({})) as any;
          throw new Error(err.detail || `HTTP ${resp.status}`);
        }
      }
      toast.style = Toast.Style.Success;
      toast.title = `Deleted ${selected.size} video(s)`;
      onBack();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Delete failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
    }
  };

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Delete Videos"
      searchBarPlaceholder="Search videos..."
    >
      {videos.length === 0 && !isLoading ? (
        <List.EmptyView title="No videos found" description="This athlete has no videos to delete" />
      ) : (
        videos.map((video, index) => (
          <List.Item
            key={video.id}
            title={video.title}
            subtitle={video.subtitle}
            accessories={[
              { text: `#${index + 1}` },
              ...(video.approved ? [{ tag: { value: 'NPID Approved', color: Color.Green } }] : []),
              { icon: selected.has(video.id) ? Icon.CheckCircle : Icon.Circle },
            ]}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  <Action
                    title={selected.has(video.id) ? 'Deselect Video' : 'Select Video'}
                    icon={selected.has(video.id) ? Icon.CircleProgress : Icon.CheckCircle}
                    onAction={() => toggleSelection(video.id)}
                  />
                  <Action
                    title={`Delete Selected (${selected.size})`}
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={handleDelete}
                    shortcut={{ modifiers: ['cmd'], key: 'd' }}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action title="Back" icon={Icon.ArrowLeft} onAction={onBack} />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
