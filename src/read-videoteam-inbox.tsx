import {
  Action,
  ActionPanel,
  Cache,
  Icon,
  List,
  Toast,
  open,
  showToast,
  useNavigation,
  Detail,
  Form,
} from '@raycast/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NPIDInboxMessage } from './types/video-team';
import {
  fetchAthleteName,
  fetchInboxThreads,
  fetchMessageDetail,
  sendInboxReply,
} from './lib/npid-mcp-adapter';
import { apiFetch } from './lib/python-server-client';
import { hydrateThreadTimestamps } from './lib/inbox-timestamps';
import { AthleteNotesList, AddAthleteNoteForm } from './components/athlete-notes';
import { ensureAthleteIds } from './lib/athlete-id-resolver';

// Email Content Detail Component - Enhanced with Attachments
function EmailContentDetail({
  message,
  onBack,
  onReply,
}: {
  message: NPIDInboxMessage;
  onBack: () => void;
  onReply: (message: NPIDInboxMessage) => void;
}) {
  const { push, pop } = useNavigation();
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailedTimestamp, setDetailedTimestamp] = useState<string>('');
  const [detailAttachments, setDetailAttachments] = useState<Array<{ fileName: string; url: string; downloadable: boolean }>>([]);
  const [resolvedAthleteName, setResolvedAthleteName] = useState<string | null>(null);
  // Initialize from message (contact_id/athlete_id), then update from API if available
  const resolved = resolveAthleteIdentifiers(message);
  const [contactId, setContactId] = useState<string | null>(resolved.contactId);
  const [athleteMainId, setAthleteMainId] = useState<string | null>(resolved.athleteMainId);
  const [athleteLinks, setAthleteLinks] = useState<{
    profile?: string;
    notes?: string;
    search?: string;
    addVideoForm?: string;
  }>(message.athleteLinks || {});

  useEffect(() => {
    const loadFullMessage = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const details = await fetchMessageDetail(message.id, message.itemCode || message.id);

        if (details && details.content) {
          setFullContent(details.content);
          if (details.timestamp) {
            setDetailedTimestamp(details.timestamp);
          }
          if (details.attachments && details.attachments.length > 0) {
            setDetailAttachments(details.attachments);
          }
          // ✅ Extract contact_id from message detail (parsed from athlete_profile_link)
          if (details.contact_id) {
            setContactId(details.contact_id);
            console.log(`✅ Extracted contact_id from message detail: ${details.contact_id}`);
          }
          if (details.athlete_main_id) {
            setAthleteMainId(details.athlete_main_id);
            console.log(`✅ Extracted athlete_main_id from message detail: ${details.athlete_main_id}`);
          }
          if (details.athlete_links) {
            setAthleteLinks((prev) => ({ ...prev, ...details.athlete_links }));
          }
        } else {
          // Fallback to preview if no content returned
          setFullContent(message.content || message.preview || 'No content available');
        }
      } catch (err) {
        console.error('Failed to fetch full message:', err);
        setError(err instanceof Error ? err.message : 'Failed to load full message');
        // Fallback to preview on error
        setFullContent(message.content || message.preview || 'No content available');
      } finally {
        setIsLoading(false);
      }
    };

    loadFullMessage();
  }, [message.id, message.itemCode, message.content, message.preview]);

  // Notes resolution is now on-demand when actions are clicked

  const contentToDisplay = isLoading
    ? 'Loading full message...'
    : fullContent || message.preview || 'No content available';

  // Use detailed timestamp if available, otherwise raw or unknown
  const displayTimestamp = detailedTimestamp || message.timestamp || 'Unknown';

  const displayName = sanitizeAthleteName(resolvedAthleteName || message.name) || 'Unknown';

  const metadata = (
    <Detail.Metadata>
      <Detail.Metadata.Label title="Name" text={displayName} />
      <Detail.Metadata.Label title="Email" text={message.email || 'No email'} />
      <Detail.Metadata.Separator />
      <Detail.Metadata.Label title="Received" text={displayTimestamp} />
      {detailAttachments.length > 0 && (
        <>
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Attachments" text={`${detailAttachments.length} file(s)`} />
          {detailAttachments.map((att, idx) => (
            <Detail.Metadata.Link
              key={idx}
              title={` `}
              text={att.fileName}
              target={att.url}
            />
          ))}
        </>
      )}
    </Detail.Metadata>
  );

  const normalizedContent = normalizeMessageContent(contentToDisplay) || contentToDisplay;
  const markdownContent = `# ${message.subject}\n\n---\n\n${normalizedContent}${error ? `\n\n> ⚠️ ${error}` : ''}`;

  const resolveContactId = async (): Promise<string | null> => {
    if (contactId) return contactId;

    try {
      const details = await fetchMessageDetail(message.id, message.itemCode || message.id);
      if (details?.contact_id) {
        setContactId(details.contact_id);
        console.log(`✅ Extracted contact_id on demand: ${details.contact_id}`);
      }
      if (details?.athlete_main_id) {
        setAthleteMainId(details.athlete_main_id);
      }
      if (details?.athlete_links) {
        setAthleteLinks((prev) => ({ ...prev, ...details.athlete_links }));
      }
      if (details?.contact_id) {
        return details.contact_id;
      }
    } catch (err) {
      console.error('Failed to resolve contact_id for action:', err);
    }

    return null;
  };

  const resolveAthleteName = async (athleteIdOverride?: string): Promise<string | null> => {
    const resolvedContactId = athleteIdOverride || (await resolveContactId());
    if (!resolvedContactId) return null;
    if (resolvedAthleteName) return resolvedAthleteName;
    const rawName = await fetchAthleteName(resolvedContactId);
    const cleanedName = sanitizeAthleteName(rawName);
    if (cleanedName) {
      setResolvedAthleteName(cleanedName);
      return cleanedName;
    }
    return null;
  };

  const resolveAthleteIdsForMainIdAction = async (): Promise<{ athleteId: string; athleteMainId: string } | null> => {
    const resolvedContactId = await resolveContactId();
    if (!resolvedContactId) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing contact_id',
        message: 'Contact ID not found in inbox thread or message link.',
      });
      return null;
    }

    const ids = await ensureAthleteIds(resolvedContactId, athleteMainId || undefined);
    if (!ids) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing athlete_main_id',
        message: 'Could not resolve athlete_main_id for this contact.',
      });
      return null;
    }

    return ids;
  };

  const openAthleteLink = async (
    kind: 'profile' | 'notes' | 'search',
    fallbackUrl: (id: string) => string,
    extraParams?: Record<string, string>
  ) => {
    const resolvedContactId = await resolveContactId();
    if (!resolvedContactId) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing contact_id',
        message: 'Contact ID not found in inbox thread or message link.',
      });
      return;
    }

    const raw = athleteLinks?.[kind] || '';
    const url = raw
      ? raw.startsWith('http')
        ? raw
        : `https://dashboard.nationalpid.com${raw}`
      : fallbackUrl(resolvedContactId);
    const finalUrl = extraParams ? appendQueryParams(url, extraParams) : url;
    await open(finalUrl);
  };

  return (
    <Detail
      markdown={markdownContent}
      metadata={metadata}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action
              title="Reply to Email"
              icon={Icon.Reply}
              onAction={() => onReply(message)}
              shortcut={{ modifiers: ['cmd'], key: 'return' }}
            />
            <Action title="Back to Inbox" onAction={onBack} icon={Icon.ArrowLeft} />
          </ActionPanel.Section>

          <ActionPanel.Section title="Athlete Notes">
            <Action
              title="View Notes"
              icon={Icon.Clipboard}
              onAction={async () => {
                const ids = await resolveAthleteIdsForMainIdAction();
                if (!ids) return;

                const athleteName = (await resolveAthleteName(ids.athleteId)) || message.name || 'Unknown Athlete';

                push(
                  <AthleteNotesList
                    athleteId={ids.athleteId}
                    athleteMainId={ids.athleteMainId}
                    athleteName={athleteName}
                  />
                );
              }}
            />
            <Action
              title="Add Note"
              icon={Icon.Plus}
              onAction={async () => {
                const ids = await resolveAthleteIdsForMainIdAction();
                if (!ids) return;

                const athleteName = (await resolveAthleteName(ids.athleteId)) || message.name || 'Unknown Athlete';

                push(
                  <AddAthleteNoteForm
                    athleteId={ids.athleteId}
                    athleteMainId={ids.athleteMainId}
                    athleteName={athleteName}
                    onComplete={() => {
                      pop();
                      showToast({
                        style: Toast.Style.Success,
                        title: 'Note added',
                        message: `Note added for ${athleteName}`,
                      });
                    }}
                  />
                );
              }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Video Management">
            <Action
              title="Update Video Stage"
              icon={Icon.ArrowRightCircle}
              onAction={async () => {
                const resolvedContactId = await resolveContactId();
                if (!resolvedContactId) {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: 'Missing athlete_id',
                    message: 'athleteid not found in inbox thread (no fallbacks)',
                  });
                  return;
                }

                if (!message.video_msg_id) {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: 'Missing video_msg_id',
                    message: 'Cannot update stage/status without video_msg_id',
                  });
                  return;
                }

                const athleteName = await resolveAthleteName(resolvedContactId);
                if (!athleteName) {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: 'Missing athlete name',
                    message: 'Could not fetch athlete name from athletename endpoint',
                  });
                  return;
                }

                push(
                  <UpdateStageForm
                    athleteId={resolvedContactId}
                    videoMsgId={String(message.video_msg_id)}
                    athleteName={athleteName}
                    onBack={pop}
                  />
                );
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
            />
            <Action
              title="Upload Video"
              icon={Icon.Upload}
              onAction={async () => {
                const ids = await resolveAthleteIdsForMainIdAction();
                if (!ids) return;

                const athleteName = await resolveAthleteName(ids.athleteId);
                if (!athleteName) {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: 'Missing athlete name',
                    message: 'Could not fetch athlete name from athletename endpoint',
                  });
                  return;
                }

                push(
                  <UploadVideoForm
                    athleteId={ids.athleteId}
                    athleteMainId={ids.athleteMainId}
                    athleteName={athleteName}
                    videoMsgId={String(message.video_msg_id)}
                    sportAlias={message.sport_alias || ''}
                    onBack={pop}
                  />
                );
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'u' }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Quick Links">
            <Action
              title="General Info"
              icon={Icon.Person}
              onAction={async () => {
                const name = await resolveAthleteName();
                const firstName = extractFirstName(name || message.name);
                await openAthleteLink(
                  'search',
                  (id) => `https://dashboard.nationalpid.com/admin/athletes?contactid=${id}`,
                  firstName ? { firstname: firstName } : undefined
                );
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'g' }}
            />
            <Action
              title="View PlayerID"
              icon={Icon.Star}
              onAction={() =>
                openAthleteLink(
                  'profile',
                  (id) => `https://dashboard.nationalpid.com/athlete/profile/${id}`
                )
              }
              shortcut={{ modifiers: ['cmd'], key: 'o' }}
            />
            <Action
              title="Athlete Notes Tab"
              icon={Icon.Clipboard}
              onAction={() =>
                openAthleteLink(
                  'notes',
                  (id) => `https://dashboard.nationalpid.com/admin/athletes?contactid=${id}&notestab=1`
                )
              }
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'n' }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy Player Name" content={message.name} />
            <Action.CopyToClipboard title="Copy Email" content={message.email} />
            <Action.CopyToClipboard title="Copy Message ID" content={message.id} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

// Reply Form Component
function ReplyForm({
  message,
  onBack,
}: {
  message: NPIDInboxMessage;
  onBack: () => void;
}) {
  // Signature is automatically appended by FastAPI (HTML formatted)
  const [replyText, setReplyText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    if (!replyText.trim()) {
      await showToast({ style: Toast.Style.Failure, title: 'Reply cannot be empty' });
      return;
    }

    setIsLoading(true);
    try {
      await sendInboxReply(message.id, message.itemCode || message.id, replyText.trim());
      await showToast({
        style: Toast.Style.Success,
        title: 'Reply sent',
        message: `Message sent to ${message.name}`,
      });
      onBack();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to send reply',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.SubmitForm title="Send Reply" onSubmit={handleSubmit} icon={Icon.Check} />
            <Action title="Cancel" onAction={onBack} icon={Icon.XMarkCircle} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      <Form.Description
        title="Reply To"
        text={`${message.name} (${message.email})\n\nSubject: RE: ${message.subject}`}
      />
      <Form.TextArea
        id="reply"
        title="Message"
        placeholder="Type your reply here..."
        value={replyText}
        onChange={setReplyText}
      />
    </Form>
  );
}

// Search Form Component
function SearchInboxForm({
  onSearch,
  onCancel,
}: {
  onSearch: (query: string) => void;
  onCancel: () => void;
}) {
  const [searchText, setSearchText] = useState('');

  const handleSubmit = () => {
    if (!searchText.trim()) {
      showToast({ style: Toast.Style.Failure, title: 'Search query cannot be empty' });
      return;
    }
    onSearch(searchText.trim());
  };

  return (
    <Form
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.SubmitForm title="Search Inbox" onSubmit={handleSubmit} icon={Icon.MagnifyingGlass} />
            <Action title="Cancel" onAction={onCancel} icon={Icon.XMarkCircle} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      <Form.Description text="Search inbox by athlete name, email, or subject" />
      <Form.TextField
        id="search"
        title="Search Query"
        placeholder="Search"
        value={searchText}
        onChange={setSearchText}
      />
    </Form>
  );
}

function formatTimestamp(message: NPIDInboxMessage): string {
  if (message.timeStampDisplay) {
    return message.timeStampDisplay.replace('|', '•').trim();
  }

  if (message.timeStampIso) {
    const parsed = new Date(message.timeStampIso);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  }

  if (message.timestamp) {
    return message.timestamp.replace('|', '•').trim();
  }

  return 'No date';
}

function stripHtml(value: string): string {
  return value.replace(/<\/?[a-z][^>]*>/gi, ' ');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function sanitizeAthleteName(raw?: string | null): string | null {
  if (!raw) return null;
  const stripped = decodeHtmlEntities(stripHtml(raw));
  const normalized = stripped.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const splitOnDash = normalized.split(' - ')[0]?.trim();
  return splitOnDash || normalized;
}

function extractFirstName(raw?: string | null): string {
  const cleaned = sanitizeAthleteName(raw);
  if (!cleaned) return '';
  return cleaned.split(/\s+/)[0] || '';
}

function normalizeMessageContent(raw: string): string {
  if (!raw) return raw;
  const stripped = decodeHtmlEntities(stripHtml(raw))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const withLinkBreaks = stripped.replace(/(https?:\/\/\S+)/g, '\n\n$1\n\n');
  return withLinkBreaks.replace(/\n{3,}/g, '\n\n').trim();
}

function appendQueryParams(url: string, params: Record<string, string>): string {
  const keys = Object.keys(params).filter((key) => params[key]);
  if (keys.length === 0) return url;
  const separator = url.includes('?') ? '&' : '?';
  const query = keys.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join('&');
  return `${url}${separator}${query}`;
}

/**
 * Extract athlete_id (contact_id) from message.
 * athlete_id == contact_id (same value, different field names across endpoints)
 */
function resolveAthleteIdentifiers(message: NPIDInboxMessage): {
  athleteId: string | null;
  contactId: string | null;
  athleteMainId: string | null;
} {
  // contact_id is extracted from message detail response (athlete_profile_link HTML)
  const athleteId = message.contact_id ? String(message.contact_id) : null;

  return {
    athleteId,
    contactId: athleteId, // Same value as athleteId
    athleteMainId: message.athleteMainId ? String(message.athleteMainId) : null,
  };
}

// UpdateStageForm Component - Allows updating video stage and status from inbox
function UpdateStageForm({
  athleteId,
  videoMsgId,
  athleteName,
  onBack,
}: {
  athleteId: string;
  videoMsgId: string;
  athleteName: string;
  onBack: () => void;
}) {
  const [stage, setStage] = useState<string>('in_queue');
  const [status, setStatus] = useState<string>('hudl');

  async function handleSubmit() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: 'Updating video progress...',
    });

    try {
      // Update stage (include mailbox context)
      const stageResp = await apiFetch(`/video/${encodeURIComponent(videoMsgId)}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: videoMsgId, stage, is_from_video_mail_box: true }),
      });
      if (!stageResp.ok) {
        const err = await stageResp.json().catch(() => ({})) as any;
        throw new Error(err.detail || `Stage update failed: ${stageResp.status}`);
      }

      // Update status (include mailbox context)
      const statusResp = await apiFetch(`/video/${encodeURIComponent(videoMsgId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: videoMsgId, status, is_from_video_mail_box: true }),
      });
      if (!statusResp.ok) {
        const err = await statusResp.json().catch(() => ({})) as any;
        throw new Error(err.detail || `Status update failed: ${statusResp.status}`);
      }

      toast.style = Toast.Style.Success;
      toast.title = 'Video progress updated';
      toast.message = `${athleteName}: ${stage} / ${status}`;
      onBack();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Update failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  return (
    <Form
      navigationTitle={`Update Video: ${athleteName}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Update Progress" onSubmit={handleSubmit} icon={Icon.Check} />
          <Action title="Cancel" onAction={onBack} icon={Icon.XMarkCircle} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Athlete: ${athleteName}\nVideo ID: ${videoMsgId}`} />

      <Form.Dropdown id="stage" title="Video Stage" value={stage} onChange={setStage}>
        <Form.Dropdown.Item value="on_hold" title="On Hold" />
        <Form.Dropdown.Item value="awaiting_client" title="Awaiting Client" />
        <Form.Dropdown.Item value="in_queue" title="In Queue" />
        <Form.Dropdown.Item value="done" title="Done" />
      </Form.Dropdown>

      <Form.Dropdown id="status" title="Video Status" value={status} onChange={setStatus}>
        <Form.Dropdown.Item value="revisions" title="Revisions" />
        <Form.Dropdown.Item value="hudl" title="HUDL" />
        <Form.Dropdown.Item value="dropbox" title="Dropbox" />
        <Form.Dropdown.Item value="external_links" title="External Links" />
        <Form.Dropdown.Item value="not_approved" title="Not Approved" />
      </Form.Dropdown>
    </Form>
  );
}

// UploadVideoForm Component - Allows uploading videos with auto-email from inbox
function UploadVideoForm({
  athleteId,
  athleteMainId,
  athleteName,
  videoMsgId,
  sportAlias,
  onBack,
}: {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  videoMsgId: string;
  sportAlias: string;
  onBack: () => void;
}) {
  const [youtubeLink, setYoutubeLink] = useState('');
  const [videoType, setVideoType] = useState('');
  const [season, setSeason] = useState('');
  const [seasons, setSeasons] = useState<{ value: string; title: string }[]>([]);
  const [isFetchingSeasons, setIsFetchingSeasons] = useState(false);

  // Fetch seasons when video type changes
  useEffect(() => {
    if (!videoType || !athleteId || !athleteMainId) {
      setSeasons([]);
      setSeason('');
      return;
    }

    const fetchSeasons = async () => {
      setIsFetchingSeasons(true);
      try {
        const response = await apiFetch(
          `/video/seasons?athlete_id=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(athleteMainId)}&video_type=${encodeURIComponent(videoType)}&sport=${encodeURIComponent(sportAlias || '')}`,
          { method: 'GET' }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch seasons: ${response.status}`);
        }

        const data = await response.json() as any;
        const seasonOptions = data.seasons || [];
        setSeasons(seasonOptions);

        // Auto-select first season if available
        if (seasonOptions.length > 0) {
          setSeason(seasonOptions[0].value);
        }
      } catch (error) {
        console.error('Failed to fetch seasons:', error);
        await showToast({
          style: Toast.Style.Failure,
          title: 'Failed to fetch seasons',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        setSeasons([]);
      } finally {
        setIsFetchingSeasons(false);
      }
    };

    fetchSeasons();
  }, [videoType, athleteId, athleteMainId, sportAlias]);

  async function handleSubmit() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: 'Uploading video...',
    });

    try {
      // Submit video
      const response = await apiFetch('/video/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athlete_id: athleteId,
          athlete_main_id: athleteMainId,
          video_url: youtubeLink,
          video_type: videoType,
          season: season,
          source: 'youtube',
          auto_approve: true,
          sport: sportAlias,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as any;
        throw new Error(err.detail || `Upload failed: ${response.status}`);
      }

      toast.style = Toast.Style.Success;
      toast.title = 'Video uploaded!';

      // Run post-upload automation (send email template 172 + update stage to done)
      try {
        await runPostUploadActions({
          athleteId,
          athleteMainId,
          athleteName,
          videoMsgId,
        });
      } catch (automationError) {
        console.error('Post-upload automation failed:', automationError);
        await showToast({
          style: Toast.Style.Failure,
          title: 'Video uploaded, but automation failed',
          message: automationError instanceof Error ? automationError.message : 'Unknown error',
        });
      }

      onBack();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Upload failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  return (
    <Form
      navigationTitle={`Upload Video: ${athleteName}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Upload Video" onSubmit={handleSubmit} icon={Icon.Upload} />
          <Action title="Cancel" onAction={onBack} icon={Icon.XMarkCircle} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Athlete: ${athleteName}\nID: ${athleteId} | Main ID: ${athleteMainId}`} />

      <Form.TextField
        id="youtubeLink"
        title="YouTube Link"
        placeholder="https://www.youtube.com/watch?v=..."
        value={youtubeLink}
        onChange={setYoutubeLink}
      />

      <Form.Dropdown
        id="videoType"
        title="Video Type"
        value={videoType}
        onChange={setVideoType}
        isLoading={!youtubeLink}
      >
        <Form.Dropdown.Item value="" title="-- Select Video Type --" />
        <Form.Dropdown.Item value="Full Season Highlight" title="Full Season Highlight" />
        <Form.Dropdown.Item value="Partial Season Highlight" title="Partial Season Highlight" />
        <Form.Dropdown.Item value="Single Game Highlight" title="Single Game Highlight" />
        <Form.Dropdown.Item value="Skills/Training Video" title="Skills/Training Video" />
      </Form.Dropdown>

      <Form.Dropdown
        id="season"
        title="Season/Team"
        value={season}
        onChange={setSeason}
        isLoading={isFetchingSeasons}
      >
        {seasons.length === 0 ? (
          <Form.Dropdown.Item value="" title={isFetchingSeasons ? '-- Loading Seasons --' : '-- Select Video Type First --'} />
        ) : (
          seasons.map((s) => (
            <Form.Dropdown.Item key={s.value} value={s.value} title={s.title} />
          ))
        )}
      </Form.Dropdown>
    </Form>
  );
}

// Post-upload automation: Send email template 172 + update stage to done
async function runPostUploadActions({
  athleteId,
  athleteMainId,
  athleteName,
  videoMsgId,
}: {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  videoMsgId: string;
}) {
  try {
    console.log('🤖 Post-upload automation start', { athleteId, videoMsgId });

    // Fetch template 172 (Editing Done)
    const templatesResp = await apiFetch(`/email/templates?athlete_id=${encodeURIComponent(athleteId)}`);
    if (!templatesResp.ok) {
      throw new Error('Failed to fetch email templates');
    }

    const templates = await templatesResp.json() as any;
    const template172 = templates.find((t: any) => t.value === '172') || templates[0];

    if (!template172) {
      console.warn('⚠️ Template 172 not found, skipping email');
      return;
    }

    // Fetch template data
    const dataResp = await apiFetch(
      `/email/template-data?template_id=${encodeURIComponent(template172.value)}&athlete_id=${encodeURIComponent(athleteId)}`
    );
    if (!dataResp.ok) {
      throw new Error('Failed to fetch template data');
    }

    const data = await dataResp.json() as any;

    // Fetch recipients
    const recipientsResp = await apiFetch(`/email/recipients?athlete_id=${encodeURIComponent(athleteId)}`);
    if (!recipientsResp.ok) {
      throw new Error('Failed to fetch recipients');
    }

    const recipientsData = await recipientsResp.json() as any;
    const parentIds = (recipientsData.parents || [])
      .filter((p: any) => p?.id)
      .map((p: any) => String(p.id));

    // Send email to athlete + parents + jholcomb
    const emailResp = await apiFetch('/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete_id: athleteId,
        template_id: template172.value,
        sender_name: data.sender_name || 'Prospect ID Video',
        sender_email: data.sender_email || 'videoteam@prospectid.com',
        subject: data.subject || '',
        message: data.message || '',
        include_athlete: true,
        parent_ids: parentIds,
        other_email: 'jholcomb@prospectid.com',
      }),
    });

    if (!emailResp.ok) {
      throw new Error('Failed to send email');
    }

    console.log('✅ Email sent (template 172)');

    // Update stage to done
    if (videoMsgId) {
      const stageResp = await apiFetch(`/video/${encodeURIComponent(videoMsgId)}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: videoMsgId, stage: 'done' }),
      });

      if (stageResp.ok) {
        console.log('✅ Stage updated to done');
      } else {
        console.warn('⚠️ Failed to update stage to done');
      }
    }
  } catch (error) {
    console.error('⚠️ Post-upload automation failed', error);
    throw error;
  }
}

const INBOX_PAGE_SIZE = 50;

function formatInboxPageRange(pageStartNumber: number): string {
  const start = pageStartNumber === 1 ? 1 : (pageStartNumber - 1) * INBOX_PAGE_SIZE;
  const end = pageStartNumber * INBOX_PAGE_SIZE;
  return `${start}-${end}`;
}

export default function InboxCheck() {
  const [messages, setMessages] = useState<NPIDInboxMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageStartNumber, setPageStartNumber] = useState(1);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState(false);
  const { push, pop } = useNavigation();
  const cache = useMemo(() => new Cache(), []);
  const requestId = useRef(0);

  const handleSearch = (query: string) => {
    setMessages([]);  // Clear messages immediately when search starts
    setSearchQuery(query);
    setIsSearching(true);
    setPageStartNumber(1);
    pop();
  };

  const handleClearSearch = () => {
    setMessages([]);  // Clear messages when exiting search mode
    setSearchQuery('');
    setIsSearching(false);
    setPageStartNumber(1);
  };

  const loadInboxMessages = useCallback(async () => {
    try {
      setIsLoading(true);
      // Increment request ID to invalidate any in-flight requests
      requestId.current += 1;
      const currentRequestId = requestId.current;

      // Bump version when thread schema/ID parsing changes to avoid stale cached threads.
      const CACHE_KEY_THREADS = `assigned_inbox_threads_v3_page_${pageStartNumber}_search_${searchQuery}`;
      const CACHE_KEY_THREADS_TIME = `assigned_inbox_threads_time_v3_page_${pageStartNumber}_search_${searchQuery}`;

      // When searching, skip cache and fetch fresh to avoid stale results
      if (isSearching) {
        console.log('🔍 SEARCH MODE: Skipping cache, fetching fresh results');
        setMessages([]);
        await reloadFromServer(false, currentRequestId);
        return;
      }

      // Load from cache immediately if available (non-search mode only)
      const cached = cache.get(CACHE_KEY_THREADS);
      if (cached) {
        const cachedMessages = JSON.parse(cached) as NPIDInboxMessage[];
        console.log('📦 CACHE HIT:', {
          cacheKey: CACHE_KEY_THREADS,
          page: pageStartNumber,
          search: searchQuery,
          count: cachedMessages.length,
          firstId: cachedMessages[0]?.id,
          firstSubject: cachedMessages[0]?.subject
        });
        setMessages(cachedMessages);
        console.log('🔍 READ INBOX: Loaded from cache:', cachedMessages.length, 'page', pageStartNumber);
      } else {
        console.log('📦 CACHE MISS:', { cacheKey: CACHE_KEY_THREADS, page: pageStartNumber });
        setMessages([]);
      }

      // Then fetch fresh data in background
      await reloadFromServer(Boolean(cached), currentRequestId);
    } catch (error) {
      console.error('🔍 READ INBOX: Error loading inbox:', error);
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to load inbox',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      setIsLoading(false);
    }
  }, [pageStartNumber, searchQuery, isSearching]);

  const reloadFromServer = useCallback(async (silent = false, expectedRequestId?: number) => {
    const CACHE_KEY_THREADS = `assigned_inbox_threads_v3_page_${pageStartNumber}_search_${searchQuery}`;
    const CACHE_KEY_THREADS_TIME = `assigned_inbox_threads_time_v3_page_${pageStartNumber}_search_${searchQuery}`;

    const pageRangeLabel = isSearching
      ? `Search: "${searchQuery}"`
      : formatInboxPageRange(pageStartNumber);
    const toast = silent
      ? null
      : await showToast({
        style: Toast.Style.Animated,
        title: `Fetching ${isSearching ? 'search results' : 'assigned messages'} (${pageRangeLabel})…`,
      });

    try {
      if (!silent) setIsLoading(true);

      // When searching, always use page 1 and pass search query
      const page = isSearching ? 1 : pageStartNumber;
      console.log('🌐 FETCH START:', {
        page,
        pageStartNumber,
        isSearching,
        searchQuery,
        cacheKey: CACHE_KEY_THREADS,
        requestId: expectedRequestId
      });
      const threads = await fetchInboxThreads(100, 'assigned', page, false, searchQuery);

      // Check if this request is stale (user started a new search/navigation while this was in-flight)
      if (expectedRequestId !== undefined && expectedRequestId !== requestId.current) {
        console.log('⚠️ STALE REQUEST IGNORED:', {
          expectedRequestId,
          currentRequestId: requestId.current,
          count: threads.length
        });
        return;
      }

      console.log('🌐 FETCH RESPONSE:', {
        page,
        count: threads.length,
        firstId: threads[0]?.id,
        firstSubject: threads[0]?.subject,
        lastId: threads[threads.length - 1]?.id,
        lastSubject: threads[threads.length - 1]?.subject,
        requestId: expectedRequestId
      });
      // Resolve contact_id from inbox href parsing; athlete_main_id is resolved on-demand per action.

      const hydrated = await hydrateThreadTimestamps(threads);

      // Save to cache
      cache.set(CACHE_KEY_THREADS, JSON.stringify(hydrated));
      cache.set(CACHE_KEY_THREADS_TIME, Date.now().toString());
      console.log('💾 CACHE SAVED:', {
        cacheKey: CACHE_KEY_THREADS,
        count: hydrated.length,
        firstId: hydrated[0]?.id
      });

      console.log('🔍 READ INBOX:', isSearching ? 'Search results' : 'Assigned threads', hydrated.length);
      console.log('🎯 SET MESSAGES (FRESH):', {
        page: pageStartNumber,
        count: hydrated.length,
        firstId: hydrated[0]?.id,
        firstSubject: hydrated[0]?.subject,
        lastId: hydrated[hydrated.length - 1]?.id,
        lastSubject: hydrated[hydrated.length - 1]?.subject
      });

      // Force complete state replacement
      setMessages(() => hydrated);

      if (toast) {
        toast.style = threads.length > 0 ? Toast.Style.Success : Toast.Style.Failure;
        toast.title = threads.length > 0
          ? `Found ${threads.length} ${isSearching ? 'results' : 'assigned messages'}`
          : isSearching ? 'No results found' : 'No assigned threads';
        toast.message = threads.length === 0 && !isSearching ? 'Inbox Zero! 🎉' : 'Fresh from server';
      }
    } catch (error) {
      console.error('🔍 READ INBOX: Error reloading inbox:', error);
      if (toast) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Failed to reload inbox';
        toast.message = error instanceof Error ? error.message : 'Unknown error';
      } else {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Failed to reload inbox',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [pageStartNumber, searchQuery, isSearching]);

  useEffect(() => {
    loadInboxMessages();
  }, [loadInboxMessages]);

  console.log('🖼️ RENDER:', {
    page: pageStartNumber,
    messagesCount: messages.length,
    firstId: messages[0]?.id,
    firstSubject: messages[0]?.subject,
    lastId: messages[messages.length - 1]?.id,
    lastSubject: messages[messages.length - 1]?.subject
  });

  return (
    <List
      isLoading={isLoading}
      navigationTitle={
        isSearching
          ? `Inbox Search: "${searchQuery}"`
          : `Read Videoteam Inbox (${formatInboxPageRange(pageStartNumber)})`
      }
    >
      {messages.map((message) => {
        const hasAttachments = message.attachments && message.attachments.length > 0;
        const downloadableCount =
          message.attachments?.filter((att) => att.downloadable && att.url)?.length || 0;

        return (
          <List.Item
            key={message.id}
            title={message.name || 'Unknown Sender'}
            accessories={[
              { text: formatTimestamp(message) },
              { icon: Icon.CheckCircle, tooltip: 'Assigned' },
              ...(hasAttachments
                ? [
                  {
                    icon: Icon.Paperclip,
                    tooltip: `${message.attachments?.length} attachment(s), ${downloadableCount} downloadable`,
                  },
                ]
                : []),
            ]}
            keywords={[message.subject, message.preview, message.email, message.name]}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  <Action
                    title="View Email Content"
                    icon={Icon.Eye}
                    onAction={() => push(<EmailContentDetail message={message} onBack={pop} onReply={(msg) => push(<ReplyForm message={msg} onBack={pop} />)} />)}
                  />
                  <Action
                    title="Reply to Email"
                    icon={Icon.Reply}
                    onAction={() => push(<ReplyForm message={message} onBack={pop} />)}
                  />
                </ActionPanel.Section>

                {downloadableCount > 0 && (
                  <ActionPanel.Section title="📎 Quick Download">
                    {message.attachments
                      ?.filter((att) => att.downloadable && att.url)
                      .map((attachment) => (
                        <Action.OpenInBrowser
                          key={attachment.url}
                          title={`Download ${attachment.fileName}`}
                          url={attachment.url!}
                          icon={Icon.Download}
                        />
                      ))}
                  </ActionPanel.Section>
                )}

                <ActionPanel.Section>
                  <Action.CopyToClipboard title="Copy Player Name" content={message.name} />
                  <Action.CopyToClipboard title="Copy Email" content={message.email} />
                  <Action.CopyToClipboard title="Copy Message ID" content={message.id} />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  {!isSearching && (
                    <Action
                      title="Search Inbox"
                      icon={Icon.MagnifyingGlass}
                      onAction={() => push(<SearchInboxForm onSearch={handleSearch} onCancel={pop} />)}
                      shortcut={{ modifiers: ['cmd'], key: 'f' }}
                    />
                  )}
                  {isSearching && (
                    <Action
                      title="Clear Search"
                      icon={Icon.XMarkCircle}
                      onAction={handleClearSearch}
                      shortcut={{ modifiers: ['cmd'], key: 'x' }}
                    />
                  )}
                  <Action
                    title="Reload from Server"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ['cmd'], key: 'r' }}
                    onAction={() => reloadFromServer()}
                  />
                  {/* Hide pagination during search */}
                  {!isSearching && pageStartNumber === 1 ? (
                    <Action
                      title={`Next Page (${formatInboxPageRange(pageStartNumber + 1)})`}
                      icon={Icon.ChevronRight}
                      onAction={() => setPageStartNumber(pageStartNumber + 1)}
                    />
                  ) : !isSearching ? (
                    <>
                      <Action
                        title={`Next Page (${formatInboxPageRange(pageStartNumber + 1)})`}
                        icon={Icon.ChevronRight}
                        onAction={() => setPageStartNumber(pageStartNumber + 1)}
                      />
                      <Action
                        title={`Back to Page 1 (${formatInboxPageRange(1)})`}
                        icon={Icon.ChevronLeft}
                        onAction={() => setPageStartNumber(1)}
                      />
                    </>
                  ) : null}
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
