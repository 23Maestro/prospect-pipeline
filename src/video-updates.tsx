import React, { useState, useEffect } from 'react';
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
} from '@raycast/api';
import { useForm, FormValidation } from '@raycast/utils';
import { callPythonServer, getSeasons, apiFetch, SeasonsRequest } from './lib/fastapi-client';
import { resolveAndCacheAthleteMainId } from './lib/athlete-id-service';
import { updateCachedTaskStatusStage } from './lib/video-progress-cache';
import * as cheerio from 'cheerio';
import * as fs from 'fs';

// Logging utility - writes to file and console (console helps during dev)
const LOG_FILE = '/Users/singleton23/raycast_logs/console.log';
const rawConsoleLog = console.log.bind(console);
function log(...args: any[]) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}`;
  rawConsoleLog(message);
  try {
    fs.appendFileSync(LOG_FILE, message + '\n');
  } catch {
    rawConsoleLog('[ERROR] Failed to write log');
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    // Use apiFetch instead of callPythonServer
    const response = await apiFetch('/video/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      log('⚠️ Search failed with status:', response.status);
      return [];
    }

    const data = (await response.json()) as any;
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
      sport:
        player.sport_alias || player.sport_name?.toLowerCase().replace(/'/g, '').replace(/ /g, '-'),
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
    if (error instanceof Error && error.name === 'AbortError') {
      log('⏱️ Search timed out');
    }
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

function extractVideoIdFromText(text: string): string | null {
  if (!text) return null;
  const cleaned = text.replace(/&amp;/g, '&');
  const match = cleaned.match(/(?:\?|&|\\u0026)e=(\d+)/i);
  return match ? match[1] : null;
}

function normalizeVideoId(value?: string | null): string {
  if (!value) return '';
  const match = value.match(/\d+/);
  return match ? match[0] : value;
}

function parseSortableHtmlDetailed(
  html: string,
): { id: string; title: string; approved: boolean; subtitle?: string }[] {
  if (!html) return [];
  try {
    const $ = cheerio.load(html);
    const items: { id: string; title: string; approved: boolean; subtitle?: string }[] = [];
    $('.video-item, li, .highlight-video').each((_, el) => {
      const linkHref = $(el).find('a[href*="videoedit"]').attr('href') || '';
      const dataUrl = $(el).find('[data-url*="videoedit"]').attr('data-url') || '';
      const onClick = $(el).find('[onclick*="videoedit"]').attr('onclick') || '';
      const htmlChunk = $(el).html() || '';
      const linkId =
        extractVideoIdFromText(linkHref) ||
        extractVideoIdFromText(dataUrl) ||
        extractVideoIdFromText(onClick) ||
        extractVideoIdFromText(htmlChunk);
      const id =
        normalizeVideoId(linkId) ||
        normalizeVideoId($(el).attr('data-id')) ||
        normalizeVideoId($(el).attr('id'));
      const fullText = $(el).text().trim();

      // Check for approval status
      const approved =
        $(el).hasClass('approved') ||
        $(el).find('.approved, .badge-success').length > 0 ||
        fullText.toLowerCase().includes('npid approved');

      // Extract title (remove approval text if present)
      const title = fullText.replace(/\(NPID Approved\)/gi, '').trim();

      // Try to extract season info as subtitle
      const seasonMatch = title.match(
        /(High School|Club|College|AAU)\s*-\s*(Freshman|Sophomore|Junior|Senior|[0-9]{4})\s*-\s*(\w+)/i,
      );
      const subtitle = seasonMatch ? seasonMatch[0] : undefined;

      if (id && title) {
        items.push({ id, title, approved, subtitle });
      }
    });
    // Fallback: try regex if no data-id found
    if (items.length === 0) {
      const regex = /videoedit[^"']*?e=(\d+)[^>]*>([^<]+)/gi;
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

type VideoEditFormDetails = {
  documentId: string;
  formData: Record<string, string>;
  approvalFields: string[];
  currentUrl: string;
};

function isApprovedFromForm(formData: Record<string, string>, approvalFields: string[]): boolean {
  const keys = new Set<string>(approvalFields);
  Object.keys(formData).forEach((key) => {
    if (key.toLowerCase().includes('approve')) {
      keys.add(key);
    }
  });

  for (const key of keys) {
    const value = formData[key];
    if (!value) continue;
    const normalized = String(value).toLowerCase();
    if (['1', 'on', 'true', 'yes', 'checked'].includes(normalized)) {
      return true;
    }
  }

  return false;
}

function parseVideoEditForm(html: string): VideoEditFormDetails {
  const formData: Record<string, string> = {};
  const approvalFields: string[] = [];
  let documentId = '';
  let currentUrl = '';

  if (!html) {
    return { documentId, formData, approvalFields, currentUrl };
  }

  const $ = cheerio.load(html);
  const forms = $('form');
  let form = forms.first();
  forms.each((_, el) => {
    const candidate = $(el);
    if (candidate.find('input[name="documentid"]').length > 0) {
      form = candidate;
      return false;
    }
    if (candidate.find('input[name^="videourl["]').length > 0) {
      form = candidate;
      return false;
    }
    return undefined;
  });

  const addApprovalField = (name: string) => {
    const lowered = name.toLowerCase();
    if (lowered.includes('approve') || lowered.includes('approved')) {
      if (!approvalFields.includes(name)) approvalFields.push(name);
    }
  };

  form.find('input, select, textarea').each((_, el) => {
    const element = $(el);
    const name = element.attr('name')?.trim();
    if (!name) return;
    const tag = element.get(0).tagName.toLowerCase();

    if (tag === 'input') {
      const inputType = (element.attr('type') || 'text').toLowerCase();
      if (inputType === 'checkbox') {
        addApprovalField(name);
        if (element.is(':checked')) {
          formData[name] = String(element.val() ?? 'on');
        }
        return;
      }
      addApprovalField(name);
      formData[name] = String(element.val() ?? '');
      return;
    }

    if (tag === 'select') {
      const selected = element.find('option:selected');
      const value = selected.attr('value') ?? selected.text();
      addApprovalField(name);
      formData[name] = String(value ?? '');
      return;
    }

    if (tag === 'textarea') {
      addApprovalField(name);
      formData[name] = String(element.val() ?? element.text() ?? '');
    }
  });

  documentId = formData.documentid || '';
  if (!documentId) {
    const docKey = Object.keys(formData).find((key) => key.startsWith('videourl['));
    if (docKey) {
      const match = docKey.match(/\[(\d+)\]/);
      if (match) documentId = match[1];
    }
  }

  if (documentId) {
    const urlKey = `videourl[${documentId}]`;
    if (formData[urlKey]) currentUrl = formData[urlKey];
  }

  return { documentId, formData, approvalFields, currentUrl };
}

function summarizeVideoFormData(formData: Record<string, string>) {
  const summary: Record<string, string> = {};
  const keys = [
    'documentid',
    'videoType',
    'updateVideoSeason',
    'approve_video',
    'approve_video_checkbox',
    'schoolinfo[add_video_season]',
    'athlete_main_id',
  ];

  keys.forEach((key) => {
    if (key in formData) summary[key] = formData[key];
  });

  Object.keys(formData).forEach((key) => {
    if (key.startsWith('videourl[') || key.startsWith('url_source[')) {
      summary[key] = formData[key];
    }
  });

  if ('_token' in formData) {
    summary._token = `len:${(formData._token || '').length}`;
  }

  return summary;
}

async function fetchVideoEditHtml(params: {
  athleteId: string;
  athleteMainId: string;
  videoId: string;
}): Promise<string> {
  const query = new URLSearchParams({
    athlete_id: params.athleteId,
    athlete_main_id: params.athleteMainId,
    video_id: params.videoId,
    is_from_video_mail_box: '',
  });
  log('🧹 Fetch video edit form', params);
  const resp = await apiFetch(`/video/edit?${query.toString()}`);
  if (!resp.ok) {
    const errText = await resp.text();
    log('⚠️ Video edit fetch failed', {
      status: resp.status,
      contentType: resp.headers.get('content-type'),
      body: errText,
    });
    throw new Error(`Video edit HTTP ${resp.status}`);
  }
  const data = (await resp.json().catch(() => ({}))) as any;
  const html = data?.html || '';
  if (!html) {
    log('⚠️ Video edit response missing HTML', data);
  }
  return html;
}

async function submitVideoUpdate(params: {
  athleteId: string;
  formData: Record<string, string>;
}): Promise<void> {
  log('📝 Submit video update', { athleteId: params.athleteId });
  const resp = await apiFetch('/video/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: params.athleteId,
      form_data: params.formData,
    }),
  });
  log('📥 Video update response', {
    status: resp.status,
    ok: resp.ok,
    contentType: resp.headers.get('content-type'),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    log('⚠️ Video update error body', { body: errText });
    let detail = '';
    try {
      const parsed = JSON.parse(errText) as any;
      detail = parsed?.detail || '';
    } catch {
      detail = '';
    }
    throw new Error(detail || `HTTP ${resp.status}`);
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
  const [hasTriedMainId, setHasTriedMainId] = useState(false);
  const [seasons, setSeasons] = useState<{ value: string; title: string; season: string }[]>([]);
  const [isFetchingSeasons, setIsFetchingSeasons] = useState(false);
  const { push, pop } = useNavigation();

  const { handleSubmit, itemProps, reset, focus, values, setValue } =
    useForm<VideoUpdateFormValues>({
      async onSubmit(formValues) {
        const toast = await showToast({
          style: Toast.Style.Animated,
          title: 'Processing video update...',
        });

        try {
          let athleteId = selectedPlayer?.player_id || '';
          let athleteName = formValues.athleteName;
          const sportAlias = selectedPlayer?.sport || '';
          const athleteMainId = fetchedAthleteMainId || '';
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

          if (isFetchingMainId) {
            toast.style = Toast.Style.Failure;
            toast.title = 'Resolving athlete_main_id...';
            toast.message = 'Failed;try again.';
            return;
          }

          if (!athleteMainId) {
            toast.style = Toast.Style.Failure;
            toast.title = 'Missing athlete_main_id';
            toast.message = 'N/A athlete_main_id.';
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
              const error = (await response
                .json()
                .catch(() => ({ detail: `HTTP ${response.status}` }))) as any;
              log('⚠️ video submit failed', { status: response.status, error });
              throw new Error(error.detail || error.message || 'Unknown error');
            }
            const result = (await response.json()) as any;
            log('📥 add_career_video response:', result);
            const success = response.ok && result?.success === true;
            if (success) {
              toast.style = Toast.Style.Success;
              toast.title = 'Video Uploaded!';
              const updatedVideos = parseSortableHtml(
                result?.sortable_html || result?.data?.sortable_html || '',
              );
              toast.message =
                updatedVideos.length > 0
                  ? `Latest video: ${updatedVideos[0]}`
                  : 'Highlight added successfully';

              if (AUTO_POST_UPLOAD_ACTIONS) {
                await runPostUploadActions({
                  athleteId,
                  athleteMainId,
                  athleteName,
                  videoMsgId,
                });
              }

              reset();
              setSelectedPlayer(null);
              setSeasons([]);
              setFetchedAthleteMainId(null);
            } else {
              toast.style = Toast.Style.Failure;
              toast.title = 'NPID Update Failed';
              toast.message = result?.message || result?.detail || `HTTP ${response.status}`;
            }
          } catch (updateError) {
            console.error('NPID update error:', updateError);
            toast.style = Toast.Style.Failure;
            toast.title = 'NPID Update Error';
            toast.message =
              updateError instanceof Error ? updateError.message : 'Failed to update NPID profile';
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
        videoType:
          props.draftValues?.videoType &&
            [
              'Full Season Highlight',
              'Partial Season Highlight',
              'Single Game Highlight',
              'Skills/Training Video',
            ].includes(props.draftValues.videoType)
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

  // Extract athlete_main_id from profile page when player is selected
  // Uses central service which handles cache check, API fetch, and write-back
  useEffect(() => {
    let cancelled = false;
    const fetchMainId = async () => {
      const playerId = selectedPlayer?.player_id;
      if (!playerId) {
        setFetchedAthleteMainId(null);
        setIsFetchingMainId(false);
        setHasTriedMainId(false);
        return;
      }

      log('🆔 Resolving athlete_main_id for player_id:', playerId);
      setIsFetchingMainId(true);
      setFetchedAthleteMainId(null);
      setHasTriedMainId(false);

      try {
        // Use central service - handles cache, API, and write-back
        const result = await resolveAndCacheAthleteMainId(playerId);

        if (cancelled) return;

        if (result?.athleteMainId) {
          log('✅ Resolved athlete_main_id:', result.athleteMainId, 'source:', result.source);
          setFetchedAthleteMainId(result.athleteMainId);
        } else {
          log('⚠️ Could not resolve athlete_main_id');
          await showToast({ style: Toast.Style.Failure, title: 'Could not resolve athlete ID' });
          setFetchedAthleteMainId(null);
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to resolve athlete_main_id:', error);
        setFetchedAthleteMainId(null);
      } finally {
        if (!cancelled) {
          setIsFetchingMainId(false);
          setHasTriedMainId(true);
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
        const athleteMainId = fetchedAthleteMainId || '';
        log('📅 Fetching seasons with:', { athleteId, sportAlias, videoType, athleteMainId });

        if (isFetchingMainId || !hasTriedMainId) {
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
          console.error(
            'Failed to fetch seasons via FastAPI, falling back to Python client:',
            error,
          );
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
  }, [values.videoType, selectedPlayer, fetchedAthleteMainId, isFetchingMainId, hasTriedMainId]);

  const loadSeasonsViaFastAPI = async (params: SeasonsRequest) => {
    const result = await getSeasons(params);
    normalizeAndApplySeasons(result);
  };

  const loadSeasonsViaPython = async ({
    athleteId,
    athleteMainId,
    sportAlias,
    videoType,
  }: SeasonsRequest) => {
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
    if (normalized.length === 0) {
      setValue('season', '');
    } else if (!normalized.some((s) => s.value === values.season)) {
      setValue('season', normalized[0].value);
    }
  };

  const fetchTemplates = async (athleteId: string) => {
    const resp = await apiFetch(`/email/templates/${encodeURIComponent(athleteId)}`);
    if (!resp.ok) throw new Error(`Templates HTTP ${resp.status}`);
    const payload = (await resp.json().catch(() => ({}))) as any;
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
    return resp.json() as Promise<{
      sender_name: string;
      sender_email: string;
      subject: string;
      message: string;
    }>;
  };

  const fetchRecipients = async (athleteId: string) => {
    const resp = await apiFetch(`/email/recipients/${encodeURIComponent(athleteId)}`);
    if (!resp.ok) throw new Error(`Recipients HTTP ${resp.status}`);
    const payload = (await resp.json().catch(() => ({}))) as any;
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    log('📨 Email send request', {
      athleteId: params.athleteId,
      templateId: params.templateId,
      includeAthlete: params.includeAthlete ?? true,
      parentCount: (params.parentIds ?? []).length,
      otherEmail: params.otherEmail ?? '',
    });
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
      signal: controller.signal,
    });
    clearTimeout(timeout);
    log('📨 Email send response', {
      status: resp.status,
      ok: resp.ok,
      contentType: resp.headers.get('content-type'),
    });
    if (!resp.ok) {
      const err = (await resp.json().catch(() => ({}))) as any;
      throw new Error(err.detail || `Email HTTP ${resp.status}`);
    }
    const result = (await resp.json().catch(() => ({}))) as any;
    if (!result?.success) throw new Error(result?.message || 'Email send failed');
  };

  const updateStageDone = async (videoMsgId: string) => {
    const resp = await apiFetch(`/video/${encodeURIComponent(videoMsgId)}/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_msg_id: videoMsgId, stage: 'done' }),
    });
    if (!resp.ok) {
      const err = (await resp.json().catch(() => ({}))) as any;
      throw new Error(err.detail || `Stage HTTP ${resp.status}`);
    }
  };

  const formatDate = (date: Date) => {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear());
    return `${month}/${day}/${year}`;
  };

  const formatTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const completeVideoEditingTask = async ({
    athleteId,
    athleteMainId,
  }: {
    athleteId: string;
    athleteMainId: string;
  }) => {
    const now = new Date();
    const completedDate = formatDate(now);
    const completedTime = formatTime(now);
    const description = `${completedDate} - Video Editing Complete`;

    log('🧾 Task completion start', {
      athleteId,
      athleteMainId,
      completedDate,
      completedTime,
      description,
    });

    const resp = await apiFetch('/tasks/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete_id: athleteId,
        athlete_main_id: athleteMainId,
        task_title: 'Video Editing',
        assigned_owner: 'Jerami Singleton',
        description,
        completed_date: completedDate,
        completed_time: completedTime,
        is_completed: true,
      }),
    });

    log('📥 Task completion response', {
      status: resp.status,
      ok: resp.ok,
      contentType: resp.headers.get('content-type'),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      log('⚠️ Task completion error body', { body: errText });
      let detail = '';
      try {
        const parsed = JSON.parse(errText) as any;
        detail = parsed?.detail || '';
      } catch {
        detail = '';
      }
      throw new Error(detail || `HTTP ${resp.status}`);
    }

    const result = (await resp.json().catch(() => ({}))) as any;
    log('✅ Task completion success', result);
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
      const picked = templates.find((t) => t.value === DEFAULT_TEMPLATE_ID) || templates[0];
      if (!picked) {
        log('⚠️ No templates available, skipping email');
        return;
      }
      const data = await fetchTemplateData(picked.value, athleteId);

      // Fetch recipients to include athlete + parents + Other
      const recipients = await fetchRecipients(athleteId);
      const parentIds = recipients.parents.filter((p: any) => p?.id).map((p: any) => String(p.id));

      log('📧 Sending email to all recipients', {
        athleteId,
        parentIds,
        includeAthlete: true,
        otherEmail: 'jholcomb@prospectid.com',
      });

      try {
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
        log('✅ Email sent automatically', {
          template: picked.value,
          recipientCount: 1 + parentIds.length + 1,
        });
      } catch (emailError) {
        log('⚠️ Email send failed, continuing', emailError);
      }

      if (videoMsgId) {
        await updateStageDone(videoMsgId);
        log('✅ Stage updated to done', { videoMsgId });
        const numericId = Number(videoMsgId);
        if (!Number.isNaN(numericId)) {
          try {
            await updateCachedTaskStatusStage(numericId, { stage: 'Done' });
            log('✅ Cache updated to Done', { videoMsgId });
          } catch (cacheError) {
            log('⚠️ Cache update failed', cacheError);
          }
        } else {
          log('⚠️ Invalid video_msg_id for cache update', { videoMsgId });
        }
      } else {
        log('⚠️ No video_msg_id; skipped stage update');
      }

      try {
        await completeVideoEditingTask({ athleteId, athleteMainId });
        log('✅ Task marked complete', { athleteId });
      } catch (taskError) {
        log('⚠️ Task completion skipped', taskError);
      }
    } catch (error) {
      log('⚠️ Post-upload automation failed', error);
    }
  };

  useEffect(() => {
    if (values.season && !seasons.some((s) => s.value === values.season)) {
      setValue('season', '');
    }
  }, [values.season, seasons, setValue]);

  const safeSeasonValue = seasons.some((s) => s.value === values.season) ? values.season : '';

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
          <Action.Push
            title="Edit SA Videos"
            icon={Icon.Pencil}
            target={
              <EditSAVideosForm
                onBack={pop}
                selectedPlayer={selectedPlayer}
                fetchedAthleteMainId={fetchedAthleteMainId}
              />
            }
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'd' }}
          />
          {selectedPlayer?.player_id && (
            <ActionPanel.Section title="Quick Links">
              <Action.OpenInBrowser
                title="View PlayerID"
                icon={Icon.Star}
                url={`https://dashboard.nationalpid.com/athlete/profile/${selectedPlayer.player_id}`}
                shortcut={{ modifiers: ['cmd'], key: 'o' }}
              />
              <Action.OpenInBrowser
                title="General Info"
                icon={Icon.Person}
                url={`https://dashboard.nationalpid.com/admin/athletes?contactid=${selectedPlayer.player_id}`}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'o' }}
              />
              <Action.OpenInBrowser
                title="Task: Video Progress ID"
                icon={Icon.Globe}
                url={`https://dashboard.nationalpid.com/videoteammsg/videomailprogress?contactid=${selectedPlayer.player_id}`}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
              />
            </ActionPanel.Section>
          )}
        </ActionPanel>
      }
    >
      <Form.TextField
        title="Student Athlete's Name"
        placeholder="Enter full name to search NPID"
        {...itemProps.athleteName}
        autoFocus
      />

      {isSearching && <Form.Description text="🔍 Searching NPID database..." />}

      {selectedPlayer && (
        <Form.Description
          text={`Selected: ${selectedPlayer.name} (${selectedPlayer.grad_year}) - ${selectedPlayer.high_school} | ID: ${selectedPlayer.player_id} | Main ID: ${isFetchingMainId ? 'Loading...' : fetchedAthleteMainId || 'N/A'}`}
        />
      )}

      <Form.TextField
        title="YouTube Link"
        placeholder="e.g., https://www.youtube.com/watch?v=..."
        {...itemProps.youtubeLink}
        disabled={!selectedPlayer}
      />

      <Form.Dropdown title="Video Type" {...itemProps.videoType} disabled={!values.youtubeLink}>
        <Form.Dropdown.Item value="Full Season Highlight" title="Full Season Highlight" />
        <Form.Dropdown.Item value="Partial Season Highlight" title="Partial Season Highlight" />
        <Form.Dropdown.Item value="Single Game Highlight" title="Single Game Highlight" />
        <Form.Dropdown.Item value="Skills/Training Video" title="Skills/Training Video" />
      </Form.Dropdown>

      <Form.Dropdown
        title="Season/Team"
        {...itemProps.season}
        value={safeSeasonValue}
        disabled={!values.videoType}
      >
        <Form.Dropdown.Item value="" title="-- Season/Team --" />
        {seasons.map((s) => (
          <Form.Dropdown.Item key={s.value} value={s.value} title={s.title} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

function RevisionUpdateForm({
  onBack,
  onUpdated,
  onApprovalChange,
  athleteId,
  athleteMainId,
  videoId,
  videoTitle,
}: {
  onBack: () => void;
  onUpdated?: () => void;
  onApprovalChange?: (videoId: string, approved: boolean) => void;
  athleteId: string;
  athleteMainId: string;
  videoId: string;
  videoTitle: string;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [documentId, setDocumentId] = useState('');
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [currentUrl, setCurrentUrl] = useState('');

  const { handleSubmit, itemProps, setValue } = useForm<{ youtubeLink: string }>({
    async onSubmit(values) {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Updating video link...',
      });
      try {
        if (!documentId) throw new Error('Missing document ID');
        const updated = { ...formData };
        const urlKey = `videourl[${documentId}]`;
        const sourceKey = `url_source[${documentId}]`;
        updated[urlKey] = values.youtubeLink;
        updated[sourceKey] = 'youtube';
        if (!updated.documentid) updated.documentid = documentId;
        if (!updated.athlete_main_id) updated.athlete_main_id = athleteMainId;
        const summary = summarizeVideoFormData(updated);
        const missing: string[] = [];
        ['documentid', urlKey, 'videoType', 'updateVideoSeason', 'athlete_main_id'].forEach(
          (key) => {
            if (!(key in updated) || !updated[key]) missing.push(key);
          },
        );
        log('📝 Revision update submit', {
          athleteId,
          videoId,
          documentId,
          currentUrl,
          newUrl: values.youtubeLink,
          summary,
          missingFields: missing,
        });
        await submitVideoUpdate({ athleteId, formData: updated });
        try {
          const verifyHtml = await fetchVideoEditHtml({ athleteId, athleteMainId, videoId });
          const verifyParsed = parseVideoEditForm(verifyHtml);
          const approvedAfter = isApprovedFromForm(
            verifyParsed.formData,
            verifyParsed.approvalFields,
          );
          log('✅ Revision update verify approval', { videoId, approved: approvedAfter });
          onApprovalChange?.(videoId, approvedAfter);
        } catch (verifyError) {
          log('⚠️ Revision update verify failed', verifyError);
        }
        toast.style = Toast.Style.Success;
        toast.title = 'Revision updated';
        toast.message = videoTitle;
        onUpdated?.();
        onBack();
      } catch (error) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Revision update failed';
        toast.message = error instanceof Error ? error.message : 'Unknown error';
        log('❌ Revision update failed', error);
      }
    },
    validation: {
      youtubeLink: (value) => {
        if (!value) return 'The item is required';
        if (
          !value.startsWith('https://www.youtube.com/') &&
          !value.startsWith('https://youtu.be/')
        ) {
          return 'Please enter a valid YouTube link';
        }
        return undefined;
      },
    },
    initialValues: {
      youtubeLink: '',
    },
  });

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        log('🧹 Load video edit form for revision update', { athleteId, athleteMainId, videoId });
        const html = await fetchVideoEditHtml({ athleteId, athleteMainId, videoId });
        const parsed = parseVideoEditForm(html);
        if (!parsed.documentId) throw new Error('Missing document ID');
        setDocumentId(parsed.documentId);
        setFormData(parsed.formData);
        setCurrentUrl(parsed.currentUrl);
        if (parsed.currentUrl) setValue('youtubeLink', parsed.currentUrl);
        log('✅ Revision update form ready', {
          documentId: parsed.documentId,
          currentUrl: parsed.currentUrl,
          summary: summarizeVideoFormData(parsed.formData),
        });
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Failed to load video edit form',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        log('❌ Revision update form load failed', error);
        onBack();
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [athleteId, athleteMainId, videoId, onBack, setValue]);

  return (
    <Form
      isLoading={isLoading}
      navigationTitle="Revision Update"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Update YouTube Link" onSubmit={handleSubmit} />
          <Action title="Back" icon={Icon.ArrowLeft} onAction={onBack} />
        </ActionPanel>
      }
    >
      <Form.Description title="Video" text={videoTitle} />
      <Form.TextField
        title="YouTube Link"
        placeholder={currentUrl || 'https://www.youtube.com/watch?v=...'}
        {...itemProps.youtubeLink}
      />
    </Form>
  );
}

function EditSAVideosForm({
  onBack,
  selectedPlayer,
  fetchedAthleteMainId,
}: {
  onBack: () => void;
  selectedPlayer: NPIDPlayer | null;
  fetchedAthleteMainId: string | null;
}) {
  const [videos, setVideos] = useState<
    { id: string; title: string; approved: boolean; subtitle?: string }[]
  >([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const { pop } = useNavigation();
  const applyApprovalChange = (videoId: string, approved: boolean) => {
    setVideos((prev) =>
      prev.map((video) => (video.id === videoId ? { ...video, approved } : video)),
    );
  };

  const fetchVideos = async () => {
    if (!selectedPlayer) throw new Error('No athlete selected');
    const athleteId = selectedPlayer.player_id;
    const athleteMainId = fetchedAthleteMainId || '';
    const sportAlias = selectedPlayer.sport;
    if (!athleteId || !athleteMainId || !sportAlias) throw new Error('Missing athlete info');
    const resp = await apiFetch(
      `/video/sortable?athlete_id=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(athleteMainId)}&sport_alias=${encodeURIComponent(sportAlias)}`,
    );
    log('📥 Edit videos sortable response', { status: resp.status, ok: resp.ok });
    if (!resp.ok) {
      const errText = await resp.text();
      log('⚠️ Edit videos sortable failed', { status: resp.status, body: errText });
      throw new Error(`Sortable HTTP ${resp.status}`);
    }
    const data = (await resp.json().catch(() => ({}))) as any;
    return parseSortableHtmlDetailed(data?.html || '');
  };

  const refreshVideos = async () => {
    setIsLoading(true);
    try {
      const parsed = await fetchVideos();
      setVideos(parsed);
      setSelected(new Set());
      log('✅ Edit videos list parsed', { count: parsed.length });
    } catch (error) {
      log('❌ Edit videos refresh failed', error);
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to refresh videos',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        log('🧹 Load edit videos list start', {
          athleteId: selectedPlayer?.player_id,
          athleteMainId: fetchedAthleteMainId || '',
          sportAlias: selectedPlayer?.sport,
        });
        await refreshVideos();
      } catch (error) {
        log('❌ Edit videos list load failed', error);
        await showToast({
          style: Toast.Style.Failure,
          title: 'Failed to load videos',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        onBack();
      } finally {
        log('🧹 Load edit videos list done');
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
    log('🧹 Toggle edit selection', {
      videoId: id,
      selected: newSelected.has(id),
      selectedCount: newSelected.size,
    });
  };

  const removeVideo = async (videoId: string) => {
    if (!selectedPlayer) throw new Error('No athlete selected');
    const athleteId = selectedPlayer.player_id;
    const athleteMainId = fetchedAthleteMainId || '';
    log('🗑️ Removing video', { videoId, athleteId, athleteMainId });
    const resp = await apiFetch('/video/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete_id: athleteId,
        athlete_main_id: athleteMainId,
        video_id: videoId,
      }),
    });
    log('📥 Remove video response', {
      videoId,
      status: resp.status,
      ok: resp.ok,
      contentType: resp.headers.get('content-type'),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      log('⚠️ Remove video failed response', { videoId, body: errText });
      let detail = '';
      try {
        const parsed = JSON.parse(errText) as any;
        detail = parsed?.detail || '';
      } catch {
        detail = '';
      }
      throw new Error(detail || `HTTP ${resp.status}`);
    }
  };

  const handleDeleteSelected = async () => {
    log('🗑️ Delete selected requested', { selectedCount: selected.size });
    if (selected.size === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No videos selected',
        message: 'Select at least one video to delete',
      });
      log('⚠️ Delete selected aborted: no videos selected');
      return;
    }
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Deleting videos...' });
    try {
      for (const id of Array.from(selected)) {
        await removeVideo(id);
      }
      toast.style = Toast.Style.Success;
      toast.title = `Deleted ${selected.size} video(s)`;
      log('✅ Delete selected success', { deletedCount: selected.size });
      await refreshVideos();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Delete failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
      log('❌ Delete selected failed', error);
    }
  };

  const handleDeleteSingle = async (video: { id: string; title: string }) => {
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Deleting video...' });
    try {
      await removeVideo(video.id);
      toast.style = Toast.Style.Success;
      toast.title = 'Video deleted';
      toast.message = video.title;
      await refreshVideos();
      log('✅ Delete single success', { videoId: video.id });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Delete failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
      log('❌ Delete single failed', error);
    }
  };

  const handleUnapprove = async (video: { id: string; title: string }) => {
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Unapproving video...' });
    try {
      if (!selectedPlayer) throw new Error('No athlete selected');
      const athleteId = selectedPlayer.player_id;
      const athleteMainId = fetchedAthleteMainId || '';
      const html = await fetchVideoEditHtml({ athleteId, athleteMainId, videoId: video.id });
      const parsed = parseVideoEditForm(html);
      if (!parsed.documentId) throw new Error('Missing document ID');
      const updated = { ...parsed.formData };
      if (!updated.documentid) updated.documentid = parsed.documentId;
      if (!updated.athlete_main_id) updated.athlete_main_id = athleteMainId;
      const approvalKeys = new Set<string>(parsed.approvalFields);
      Object.keys(updated).forEach((key) => {
        if (key.toLowerCase().includes('approve')) approvalKeys.add(key);
      });
      if (approvalKeys.size === 0) {
        approvalKeys.add('approve_video');
      }
      if (![...approvalKeys].some((key) => key.toLowerCase().includes('approve_video_checkbox'))) {
        approvalKeys.add('approve_video_checkbox');
        approvalKeys.add(`approve_video_checkbox[${parsed.documentId}]`);
      }
      if (![...approvalKeys].some((key) => key.toLowerCase().includes('approve_video'))) {
        approvalKeys.add('approve_video');
      }
      approvalKeys.forEach((name) => {
        const lowered = name.toLowerCase();
        if (lowered.includes('checkbox')) {
          updated[name] = 'off';
        } else {
          updated[name] = '0';
        }
      });
      const summary = summarizeVideoFormData(updated);
      log('📝 Unapprove submit', {
        athleteId,
        videoId: video.id,
        documentId: parsed.documentId,
        approvalFields: Array.from(approvalKeys),
        summary,
      });
      await submitVideoUpdate({ athleteId, formData: updated });
      try {
        const verifyHtml = await fetchVideoEditHtml({
          athleteId,
          athleteMainId,
          videoId: video.id,
        });
        const verifyParsed = parseVideoEditForm(verifyHtml);
        const approvedAfter = isApprovedFromForm(
          verifyParsed.formData,
          verifyParsed.approvalFields,
        );
        log('✅ Unapprove verify approval', { videoId: video.id, approved: approvedAfter });
        applyApprovalChange(video.id, approvedAfter);
      } catch (verifyError) {
        log('⚠️ Unapprove verify failed', verifyError);
      }
      toast.style = Toast.Style.Success;
      toast.title = 'Video unapproved';
      toast.message = video.title;
      await refreshVideos();
      log('✅ Unapprove success', { videoId: video.id });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Unapprove failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
      log('❌ Unapprove failed', error);
    }
  };

  const handleApprove = async (video: { id: string; title: string }) => {
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Approving video...' });
    try {
      if (!selectedPlayer) throw new Error('No athlete selected');
      const athleteId = selectedPlayer.player_id;
      const athleteMainId = fetchedAthleteMainId || '';
      const html = await fetchVideoEditHtml({ athleteId, athleteMainId, videoId: video.id });
      const parsed = parseVideoEditForm(html);
      if (!parsed.documentId) throw new Error('Missing document ID');
      const updated = { ...parsed.formData };
      if (!updated.documentid) updated.documentid = parsed.documentId;
      if (!updated.athlete_main_id) updated.athlete_main_id = athleteMainId;
      const approvalKeys = new Set<string>(parsed.approvalFields);
      Object.keys(updated).forEach((key) => {
        if (key.toLowerCase().includes('approve')) approvalKeys.add(key);
      });
      if (approvalKeys.size === 0) {
        approvalKeys.add('approve_video');
      }
      if (![...approvalKeys].some((key) => key.toLowerCase().includes('approve_video_checkbox'))) {
        approvalKeys.add('approve_video_checkbox');
        approvalKeys.add(`approve_video_checkbox[${parsed.documentId}]`);
      }
      if (![...approvalKeys].some((key) => key.toLowerCase().includes('approve_video'))) {
        approvalKeys.add('approve_video');
      }
      approvalKeys.forEach((name) => {
        const lowered = name.toLowerCase();
        if (lowered.includes('checkbox')) {
          updated[name] = 'on';
        } else {
          updated[name] = '1';
        }
      });
      const summary = summarizeVideoFormData(updated);
      log('📝 Approve submit', {
        athleteId,
        videoId: video.id,
        documentId: parsed.documentId,
        approvalFields: Array.from(approvalKeys),
        summary,
      });
      await submitVideoUpdate({ athleteId, formData: updated });
      try {
        const verifyHtml = await fetchVideoEditHtml({
          athleteId,
          athleteMainId,
          videoId: video.id,
        });
        const verifyParsed = parseVideoEditForm(verifyHtml);
        const approvedAfter = isApprovedFromForm(
          verifyParsed.formData,
          verifyParsed.approvalFields,
        );
        log('✅ Approve verify approval', { videoId: video.id, approved: approvedAfter });
        applyApprovalChange(video.id, approvedAfter);
      } catch (verifyError) {
        log('⚠️ Approve verify failed', verifyError);
      }
      toast.style = Toast.Style.Success;
      toast.title = 'Video approved';
      toast.message = video.title;
      await refreshVideos();
      log('✅ Approve success', { videoId: video.id });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Approve failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
      log('❌ Approve failed', error);
    }
  };

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Edit SA Videos"
      searchBarPlaceholder="Search videos..."
    >
      {videos.length === 0 && !isLoading ? (
        <List.EmptyView
          title="No videos found"
          description="This athlete has no videos to manage"
        />
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
                    title="Delete This Video"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={() => handleDeleteSingle(video)}
                  />
                  <Action
                    title={`Delete Selected (${selected.size})`}
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={handleDeleteSelected}
                    shortcut={{ modifiers: ['cmd'], key: 'd' }}
                  />
                  <Action
                    title="Unapprove Video"
                    icon={Icon.XMarkCircle}
                    style={Action.Style.Destructive}
                    onAction={() => handleUnapprove(video)}
                  />
                  <Action
                    title="Approve Video"
                    icon={Icon.CheckCircle}
                    onAction={() => handleApprove(video)}
                  />
                  <Action.Push
                    title="Revision Update"
                    icon={Icon.Pencil}
                    target={
                      <RevisionUpdateForm
                        onBack={pop}
                        onUpdated={refreshVideos}
                        onApprovalChange={applyApprovalChange}
                        athleteId={selectedPlayer?.player_id || ''}
                        athleteMainId={fetchedAthleteMainId || ''}
                        videoId={video.id}
                        videoTitle={video.title}
                      />
                    }
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action
                    title="Refresh Videos"
                    icon={Icon.ArrowClockwise}
                    onAction={refreshVideos}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
                  />
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
