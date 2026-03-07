import {
  Action,
  ActionPanel,
  Cache,
  Color,
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
import { apiFetch } from './lib/fastapi-client';
import { hydrateThreadTimestamps } from './lib/inbox-timestamps';
import { AthleteNotesList, AddAthleteNoteForm } from './components/athlete-notes';
import { ensureAthleteIds } from './lib/athlete-id-service';
import { detectHudlCredentials } from './lib/inbox-credential-detector';

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
  const [detailResult, setDetailResult] = useState<{
    contact_id?: string;
    athlete_main_id?: string;
    athlete_links?: {
      profile?: string;
      notes?: string;
      search?: string;
      addVideoForm?: string;
    };
  } | null>(null);
  const [detailAttachments, setDetailAttachments] = useState<
    Array<{ fileName: string; url: string; downloadable: boolean }>
  >([]);
  const [resolvedAthleteName, setResolvedAthleteName] = useState<string | null>(null);
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
          setDetailResult(details);
          setFullContent(details.content);
          if (details.timestamp) {
            setDetailedTimestamp(details.timestamp);
          }
          if (details.attachments && details.attachments.length > 0) {
            setDetailAttachments(details.attachments);
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
  const displayContent = detailResult
    ? contentToDisplay
    : normalizeMessageContent(contentToDisplay) || contentToDisplay;
  const formattedContent = detailResult ? formatReplyHeaderLabel(displayContent) : displayContent;
  const hudlDetection =
    detailResult && !isLoading ? detectHudlCredentials(contentToDisplay) : { tier: 'none' as const };

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
            <Detail.Metadata.Link key={idx} title={` `} text={att.fileName} target={att.url} />
          ))}
        </>
      )}
      {hudlDetection.tier !== 'none' && (
        <>
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title="Hudl Detection">
            <Detail.Metadata.TagList.Item
              text={hudlDetection.tier === 'high' ? 'Hudl Tier 1' : 'Hudl Tier 2'}
              color={hudlDetection.tier === 'high' ? Color.Green : Color.Orange}
            />
          </Detail.Metadata.TagList>
        </>
      )}
    </Detail.Metadata>
  );
  const markdownContent = `# ${message.subject}\n\n---\n\n${formattedContent}${error ? `\n\n> ⚠️ ${error}` : ''}`;

  const resolveInboxActionContext = async (): Promise<{
    contactId: string | null;
    athleteMainId: string | null;
  }> => {
    const knownContactId = message.contact_id || detailResult?.contact_id || null;
    const knownAthleteMainId = message.athleteMainId || detailResult?.athlete_main_id || null;

    if (knownContactId) {
      return {
        contactId: String(knownContactId),
        athleteMainId: knownAthleteMainId ? String(knownAthleteMainId) : null,
      };
    }

    try {
      const details = await fetchMessageDetail(message.id, message.itemCode || message.id);
      setDetailResult(details);
      if (details?.athlete_links) {
        setAthleteLinks((prev) => ({ ...prev, ...details.athlete_links }));
      }
      return {
        contactId: details?.contact_id ? String(details.contact_id) : null,
        athleteMainId: details?.athlete_main_id ? String(details.athlete_main_id) : null,
      };
    } catch (err) {
      console.error('Failed to resolve contact_id for action:', err);
      return {
        contactId: null,
        athleteMainId: knownAthleteMainId ? String(knownAthleteMainId) : null,
      };
    }
  };

  const resolveContactId = async (): Promise<string | null> => {
    const context = await resolveInboxActionContext();
    return context.contactId;
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

  const resolveAthleteIdsForMainIdAction = async (): Promise<{
    athleteId: string;
    athleteMainId: string;
  } | null> => {
    const context = await resolveInboxActionContext();
    if (!context.contactId) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing contact_id',
        message: 'Contact ID not found in inbox thread or message link.',
      });
      return null;
    }

    const ids = await ensureAthleteIds(context.contactId, context.athleteMainId || undefined);
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
    extraParams?: Record<string, string>,
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
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'l' }}
              onAction={async () => {
                const ids = await resolveAthleteIdsForMainIdAction();
                if (!ids) return;

                const athleteName =
                  (await resolveAthleteName(ids.athleteId)) || message.name || 'Unknown Athlete';

                push(
                  <AthleteNotesList
                    athleteId={ids.athleteId}
                    athleteMainId={ids.athleteMainId}
                    athleteName={athleteName}
                  />,
                );
              }}
            />
            <Action
              title="Add Note"
              icon={Icon.Plus}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'a' }}
              onAction={async () => {
                const ids = await resolveAthleteIdsForMainIdAction();
                if (!ids) return;

                const athleteName =
                  (await resolveAthleteName(ids.athleteId)) || message.name || 'Unknown Athlete';

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
                  />,
                );
              }}
            />
            {(hudlDetection.tier === 'high' || hudlDetection.tier === 'medium') &&
              hudlDetection.emailOrUsername &&
              hudlDetection.password && (
                <Action
                  title="Add Hudl Note"
                  icon={{ source: Icon.Lock, tintColor: Color.Green }}
                  shortcut={{ modifiers: ['cmd', 'shift'], key: 'h' }}
                  onAction={async () => {
                    const ids = await resolveAthleteIdsForMainIdAction();
                    if (!ids) return;

                    const athleteName =
                      (await resolveAthleteName(ids.athleteId)) || message.name || 'Unknown Athlete';

                    push(
                      <AddAthleteNoteForm
                        athleteId={ids.athleteId}
                        athleteMainId={ids.athleteMainId}
                        athleteName={athleteName}
                        initialTitle="Hudl"
                        initialDescription={`${hudlDetection.emailOrUsername}\n${hudlDetection.password}`}
                        onComplete={() => {
                          pop();
                          showToast({
                            style: Toast.Style.Success,
                            title: 'Hudl note added',
                            message: `Note added for ${athleteName}`,
                          });
                        }}
                      />,
                    );
                  }}
                />
              )}
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
                    message: 'Cannot update stage without video_msg_id',
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
                  />,
                );
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
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
                  firstName ? { firstname: firstName } : undefined,
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
                  (id) => `https://dashboard.nationalpid.com/athlete/profile/${id}`,
                )
              }
              shortcut={{ modifiers: ['cmd'], key: 'o' }}
            />
            <Action
              title="Task: Video Progress ID"
              icon={Icon.Globe}
              onAction={async () => {
                const resolvedContactId = await resolveContactId();
                if (!resolvedContactId) {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: 'Missing contact_id',
                    message: 'Contact ID not found in inbox thread or message link.',
                  });
                  return;
                }
                await open(
                  `https://dashboard.nationalpid.com/videoteammsg/videomailprogress?contactid=${resolvedContactId}`,
                );
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
            />
            <Action
              title="Athlete Notes Tab"
              icon={Icon.Clipboard}
              onAction={() =>
                openAthleteLink(
                  'notes',
                  (id) =>
                    `https://dashboard.nationalpid.com/admin/athletes?contactid=${id}&notestab=1`,
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
function ReplyForm({ message, onBack }: { message: NPIDInboxMessage; onBack: () => void }) {
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
            <Action.SubmitForm
              title="Search Inbox"
              onSubmit={handleSubmit}
              icon={Icon.MagnifyingGlass}
            />
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
  const stripped = decodeHtmlEntities(stripHtml(raw)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const shouldDropLine = (line: string) => {
    if (!line) return false;
    if (/^Yahoo Mail:/i.test(line)) return true;
    if (/^National Prospect ID#yiv\d+/i.test(line)) return true;
    if (/#yiv\d+/i.test(line)) return true;
    if (/@media only screen/i.test(line)) return true;
    if (line.includes('{') && line.includes('}') && line.includes(':')) return true;
    if (/^\|+\s*$/.test(line)) return true;
    return false;
  };

  const isSignatureStart = (line: string) => {
    return (
      /^Connect With Us$/i.test(line) ||
      /^NATIONAL PROSPECT ID\b/i.test(line) ||
      /^National Prospect ID\b/i.test(line) ||
      /^About Us\s*\|/i.test(line) ||
      /Unsubscribe/i.test(line) ||
      /Private Policy/i.test(line) ||
      /Terms/i.test(line)
    );
  };

  const cleanedLines: string[] = [];
  for (const rawLine of stripped.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      cleanedLines.push('');
      continue;
    }
    if (shouldDropLine(line)) {
      continue;
    }
    if (isSignatureStart(line)) {
      break;
    }
    cleanedLines.push(line);
  }

  const cleaned = cleanedLines.join('\n');
  const withLinkBreaks = cleaned.replace(/(https?:\/\/\S+)/g, '\n\n$1\n\n');
  return withLinkBreaks.replace(/\n{3,}/g, '\n\n').trim();
}

function formatReplyHeaderLabel(content: string): string {
  if (!content) return content;

  const replyPatterns: Array<{
    pattern: RegExp;
    format: (match: RegExpMatchArray) => string;
  }> = [
    {
      pattern:
        /(^|\n\n)On\s+([A-Za-z]{3},\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s*[AP]M)\s+.+?\s+wrote:(\n\n|$)/i,
      format: (match) => `${match[1] || ''}**Reply** · *${match[2].trim()}*${match[3] || '\n\n'}`,
    },
    {
      pattern:
        /(^|\n\n)On\s+([A-Za-z]{6,9},\s+[A-Za-z]{5,9}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}\s*[AP]M),\s+.+?\s+wrote:(\n\n|$)/i,
      format: (match) => `${match[1] || ''}**Reply** · *${match[2].trim()}*${match[3] || '\n\n'}`,
    },
    {
      pattern:
        /\s+On\s+([A-Za-z]{3},\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s*[AP]M)\s+.+?\s+wrote:\s+/i,
      format: (match) => `\n\n**Reply** · *${match[1].trim()}*\n\n`,
    },
    {
      pattern:
        /\s+On\s+([A-Za-z]{6,9},\s+[A-Za-z]{5,9}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}\s*[AP]M),\s+.+?\s+wrote:\s+/i,
      format: (match) => `\n\n**Reply** · *${match[1].trim()}*\n\n`,
    },
  ];

  for (const { pattern, format } of replyPatterns) {
    const match = content.match(pattern);
    if (!match) continue;
    return content.replace(pattern, format(match));
  }

  return content;
}

function appendQueryParams(url: string, params: Record<string, string>): string {
  const keys = Object.keys(params).filter((key) => params[key]);
  if (keys.length === 0) return url;
  const separator = url.includes('?') ? '&' : '?';
  const query = keys
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  return `${url}${separator}${query}`;
}

// UpdateStageForm Component - Allows updating video stage and status from inbox
function UpdateStageForm({
  videoMsgId,
  athleteName,
  onBack,
}: {
  videoMsgId: string;
  athleteName: string;
  onBack: () => void;
}) {
  const [stage, setStage] = useState<string>('in_queue');

  async function handleSubmit() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: 'Updating video stage...',
    });

    try {
      const stageResp = await apiFetch(`/video/${encodeURIComponent(videoMsgId)}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: videoMsgId, stage, is_from_video_mail_box: true }),
      });
      if (!stageResp.ok) {
        const err = (await stageResp.json().catch(() => ({}))) as any;
        throw new Error(err.detail || `Stage update failed: ${stageResp.status}`);
      }

      toast.style = Toast.Style.Success;
      toast.title = 'Video stage updated';
      toast.message = `${athleteName}: ${stage}`;
      onBack();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Stage update failed';
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
    </Form>
  );
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
    setMessages([]); // Clear messages immediately when search starts
    setSearchQuery(query);
    setIsSearching(true);
    setPageStartNumber(1);
    pop();
  };

  const handleClearSearch = () => {
    setMessages([]); // Clear messages when exiting search mode
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
          firstSubject: cachedMessages[0]?.subject,
        });
        setMessages(cachedMessages);
        console.log(
          '🔍 READ INBOX: Loaded from cache:',
          cachedMessages.length,
          'page',
          pageStartNumber,
        );
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

  const reloadFromServer = useCallback(
    async (silent = false, expectedRequestId?: number) => {
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
          requestId: expectedRequestId,
        });
        const threads = await fetchInboxThreads(100, 'assigned', page, false, searchQuery);

        // Check if this request is stale (user started a new search/navigation while this was in-flight)
        if (expectedRequestId !== undefined && expectedRequestId !== requestId.current) {
          console.log('⚠️ STALE REQUEST IGNORED:', {
            expectedRequestId,
            currentRequestId: requestId.current,
            count: threads.length,
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
          requestId: expectedRequestId,
        });
        // Resolve contact_id from inbox href parsing; athlete_main_id is resolved on-demand per action.

        const hydrated = await hydrateThreadTimestamps(threads);

        // Save to cache
        cache.set(CACHE_KEY_THREADS, JSON.stringify(hydrated));
        cache.set(CACHE_KEY_THREADS_TIME, Date.now().toString());
        console.log('💾 CACHE SAVED:', {
          cacheKey: CACHE_KEY_THREADS,
          count: hydrated.length,
          firstId: hydrated[0]?.id,
        });

        console.log(
          '🔍 READ INBOX:',
          isSearching ? 'Search results' : 'Assigned threads',
          hydrated.length,
        );
        console.log('🎯 SET MESSAGES (FRESH):', {
          page: pageStartNumber,
          count: hydrated.length,
          firstId: hydrated[0]?.id,
          firstSubject: hydrated[0]?.subject,
          lastId: hydrated[hydrated.length - 1]?.id,
          lastSubject: hydrated[hydrated.length - 1]?.subject,
        });

        // Force complete state replacement
        setMessages(() => hydrated);

        if (toast) {
          toast.style = threads.length > 0 ? Toast.Style.Success : Toast.Style.Failure;
          toast.title =
            threads.length > 0
              ? `Found ${threads.length} ${isSearching ? 'results' : 'assigned messages'}`
              : isSearching
                ? 'No results found'
                : 'No assigned threads';
          toast.message =
            threads.length === 0 && !isSearching ? 'Inbox Zero! 🎉' : 'Fresh from server';
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
    },
    [pageStartNumber, searchQuery, isSearching],
  );

  useEffect(() => {
    loadInboxMessages();
  }, [loadInboxMessages]);

  console.log('🖼️ RENDER:', {
    page: pageStartNumber,
    messagesCount: messages.length,
    firstId: messages[0]?.id,
    firstSubject: messages[0]?.subject,
    lastId: messages[messages.length - 1]?.id,
    lastSubject: messages[messages.length - 1]?.subject,
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
                    onAction={() =>
                      push(
                        <EmailContentDetail
                          message={message}
                          onBack={pop}
                          onReply={(msg) => push(<ReplyForm message={msg} onBack={pop} />)}
                        />,
                      )
                    }
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
                      onAction={() =>
                        push(<SearchInboxForm onSearch={handleSearch} onCancel={pop} />)
                      }
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
