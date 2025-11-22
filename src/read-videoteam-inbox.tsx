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
import { fetchInboxThreads, fetchMessageDetail } from './lib/npid-mcp-adapter';
import { callPythonServer } from './lib/python-server-client';

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
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadFullMessage = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const details = await fetchMessageDetail(message.id, message.itemCode || message.id);

        if (details && details.content) {
          setFullContent(details.content);
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

  const hasAttachments = message.attachments && message.attachments.length > 0;
  const downloadableAttachments =
    message.attachments?.filter((att) => att.downloadable && att.url) || [];

  const contentToDisplay = isLoading
    ? 'Loading full message...'
    : fullContent || message.preview || 'No content available';

  const markdownContent = `# ${message.subject}\n\n**From:** ${message.name} (${message.email})\n\n**Date:** ${message.timestamp}\n\n---\n\n${contentToDisplay}${error ? `\n\n> ⚠️ ${error}` : ''
    }${hasAttachments
      ? `\n\n## 📎 Attachments (${message.attachments?.length})\n\n${message.attachments
        ?.map(
          (att) =>
            `- **${att.fileName}** ${att.downloadable ? '✅ Downloadable' : '❌ Not downloadable'}${att.expiresAt ? ` (Expires: ${att.expiresAt})` : ''}`,
        )
        .join('\n')}`
      : ''
    }`;

  return (
    <Detail
      markdown={markdownContent}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action
              title="Reply to Email"
              icon={Icon.Reply}
              onAction={() => onReply(message)}
            />
            <Action title="Back to Inbox" onAction={onBack} icon={Icon.ArrowLeft} />
          </ActionPanel.Section>

          {downloadableAttachments.length > 0 && (
            <ActionPanel.Section title="📎 Downloadable Attachments">
              {downloadableAttachments.map((attachment) => (
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
      await callPythonServer('send_reply', {
        message_id: message.id,
        itemcode: message.itemCode || message.id,
        reply_text: replyText.trim()
      });
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
            <Action title="Cancel" onAction={onBack} icon={Icon.XmarkCircle} />
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

      console.log('🔍 READ INBOX: Total assigned threads from REST API:', threads.length);
      console.log('🔍 READ INBOX: First thread:', threads[0]);

      setMessages(threads);

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
            title={`${message.name} • ${message.subject}`}
            subtitle={message.preview || 'No preview available'}
            accessories={[
              { text: message.timestamp || 'No date' },
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
