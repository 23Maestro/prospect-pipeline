import {
  Action,
  ActionPanel,
  Icon,
  List,
  Toast,
  showToast,
  useNavigation,
  Detail,
  Form,
} from '@raycast/api';
import { useEffect, useState } from 'react';
import { NPIDInboxMessage } from './types/video-team';
import {
  fetchInboxThreads,
  fetchMessageDetail,
  sendEmailToAthlete,
  sendInboxReply,
  bulkResolveAthleteMainIds,
} from './lib/npid-mcp-adapter';
import { hydrateThreadTimestamps } from './lib/inbox-timestamps';
import { AthleteNotesList, AddAthleteNoteForm } from './components/athlete-notes';
import { ensureAthleteIds } from './lib/athlete-id-resolver';
import { cacheAthleteMainId } from './lib/video-progress-cache';

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
  const { athleteId, contactId } = resolveAthleteIdentifiers(message);
  const [canShowNotes, setCanShowNotes] = useState(false);
  const [resolvedMainId, setResolvedMainId] = useState<string | null>(null);

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

  // Lazy-resolve athlete_main_id for notes
  useEffect(() => {
    const resolveIds = async () => {
      console.log('🔍 NOTES: Resolving IDs for message:', {
        messageId: message.id,
        athleteId,
        contactId,
        athleteMainId: message.athleteMainId,
        rawContactId: (message as any).contact_id,
        rawContactid: (message as any).contactid
      });

      if (athleteId) {
        const ids = await ensureAthleteIds(athleteId, message.athleteMainId);
        console.log('🔍 NOTES: ensureAthleteIds result:', ids);
        if (ids) {
          setResolvedMainId(ids.athleteMainId);
          setCanShowNotes(true);
        }
      } else {
        console.log('❌ NOTES: No athleteId found, cannot show notes');
      }
    };
    resolveIds();
  }, [athleteId, message.athleteMainId]);

  const contentToDisplay = isLoading
    ? 'Loading full message...'
    : fullContent || message.preview || 'No content available';

  // Use detailed timestamp if available, otherwise raw or unknown
  const displayTimestamp = detailedTimestamp || message.timestamp || 'Unknown';

  const metadata = (
    <Detail.Metadata>
      <Detail.Metadata.Label title="Name" text={message.name || 'Unknown'} />
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

  const markdownContent = `# ${message.subject}\n\n---\n\n${contentToDisplay}${error ? `\n\n> ⚠️ ${error}` : ''}`;

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

          {canShowNotes && athleteId && resolvedMainId && (
            <ActionPanel.Section title="Athlete Notes">
              <Action.Push
                title="View Notes"
                icon={Icon.Clipboard}
                target={
                  <AthleteNotesList
                    athleteId={athleteId}
                    athleteMainId={resolvedMainId}
                    athleteName={message.name}
                  />
                }
              />
              <Action.Push
                title="Add Note"
                icon={Icon.Plus}
                target={
                  <AddAthleteNoteForm
                    athleteId={athleteId}
                    athleteMainId={resolvedMainId}
                    athleteName={message.name}
                    onComplete={pop}
                  />
                }
              />
            </ActionPanel.Section>
          )}

          {contactId && (
            <Action.OpenInBrowser
              title="Athlete Notes Tab"
              icon={Icon.Globe}
              url={`https://dashboard.nationalpid.com/admin/athletes?contactid=${contactId}&notestab=1`}
            />
          )}

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

/**
 * Extract athlete_id (contact_id) from message.
 * athlete_id == contact_id (same value, different field names across endpoints)
 */
function resolveAthleteIdentifiers(message: NPIDInboxMessage): {
  athleteId: string | null;
  contactId: string | null;
} {
  // contact_id and athlete_id are the SAME value (aliases)
  const athleteId =
    message.contact_id ||
    message.player_id ||
    message.thread_id ||
    (message as any).contactId ||
    null;

  return {
    athleteId: athleteId ? String(athleteId) : null,
    contactId: athleteId ? String(athleteId) : null, // Same value as athleteId
  };
}


export default function InboxCheck() {
  const [messages, setMessages] = useState<NPIDInboxMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { push, pop } = useNavigation();

  useEffect(() => {
    loadInboxMessages();
  }, []);

  const loadInboxMessages = async () => {
    try {
      setIsLoading(true);

      // Fetch ONLY assigned threads (filter on API side)
      // This will fetch across multiple pages (up to 100 threads total)
      const threads = await fetchInboxThreads(100, 'assigned');
      const hydrated = await hydrateThreadTimestamps(threads);

      console.log('🔍 READ INBOX: Total assigned threads from REST API:', hydrated.length);

      // Proactively resolve athlete_main_ids for all threads
      // This ensures "Athlete Notes" and other features work immediately
      const resolvedMap = await bulkResolveAthleteMainIds(hydrated);

      // Merge resolved IDs into messages
      const mergedMessages = hydrated.map(msg => ({
        ...msg,
        athleteMainId: msg.athleteMainId || resolvedMap.get(
          msg.contact_id || msg.player_id || msg.thread_id || (msg as any).contactId || ''
        ) || null
      }));

      setMessages(mergedMessages);

      await showToast({
        style: threads.length > 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: `Found ${threads.length} assigned messages`,
        message: threads.length === 0 ? 'No assigned threads' : 'Ready to view and reply',
      });
    } catch (error) {
      console.error('🔍 READ INBOX: Error loading inbox:', error);
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to load inbox',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <List isLoading={isLoading} navigationTitle="Read Videoteam Inbox">
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
                  <Action
                    title="Reload Inbox"
                    icon={Icon.ArrowClockwise}
                    onAction={loadInboxMessages}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
