import {
  Action,
  ActionPanel,
  Icon,
  List,
  Toast,
  showToast,
  useNavigation,
  Detail,
} from '@raycast/api';
import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { fetchInboxThreads, enrichMessagesWithDetails } from './lib/npid-mcp';
import { NPIDInboxMessage } from './types/video-team';

// Email Content Detail Component - Enhanced with Attachments
function EmailContentDetail({
  message,
  onBack,
}: {
  message: NPIDInboxMessage;
  onBack: () => void;
}) {
  const hasAttachments = message.attachments && message.attachments.length > 0;
  const downloadableAttachments =
    message.attachments?.filter((att) => att.downloadable && att.url) || [];

  const markdownContent = `# ${message.subject}\n\n**From:** ${message.name} (${message.email})\n\n---\n\n${message.content}${
    hasAttachments
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
      actions={
        <ActionPanel>
          <ActionPanel.Section>
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

      // Fetch all threads using the same HTML parsing system
      const basicThreads = await fetchInboxThreads();
      const withDetails = await enrichMessagesWithDetails(basicThreads);

      // Filter for ASSIGNED messages (opposite of assign command)
      const assignedMessages = withDetails.filter((message) => message.status === 'assigned');

      setMessages(assignedMessages);
      console.log('🔍 READ INBOX: Setting messages in UI:', assignedMessages.length);
      console.log('🔍 READ INBOX: First message:', assignedMessages[0]);

      await showToast({
        style: Toast.Style.Success,
        title: `Found ${assignedMessages.length} assigned messages`,
        message: 'Ready to view and reply',
      });
    } catch (error) {
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
            title={message.name}
            subtitle={message.subject}
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
                    onAction={() => push(<EmailContentDetail message={message} onBack={pop} />)}
                  />
                  <Action
                    title="Reply to Email"
                    icon={Icon.Reply}
                    onAction={() => {
                      // TODO: Implement reply functionality
                      showToast({ style: Toast.Style.Success, title: 'Reply feature coming soon' });
                    }}
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
