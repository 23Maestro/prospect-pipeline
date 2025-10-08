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
import { NPIDInboxMessage } from './types/video-team';
import { supabase } from './lib/supabase-client';
import { callPythonServer } from './lib/python-server-client';

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

      // Call Python server to get live inbox threads from NPID
      const result = await callPythonServer('get_inbox_threads', { limit: 50 });
      
      if (result.status !== 'ok') {
        throw new Error(result.message || 'Failed to fetch inbox from NPID');
      }

      const threads = result.data || [];

      // Convert to NPIDInboxMessage format, filter for assigned only
      const messages: NPIDInboxMessage[] = threads
        .filter((thread: any) => thread.status === 'assigned')
        .map((thread: any) => ({
          id: thread.id,
          itemCode: thread.itemcode || thread.id,
          thread_id: thread.id,
          player_id: '',
          contactid: '',
          name: thread.name,
          email: thread.email,
          subject: thread.subject || '',
          content: '',
          preview: thread.subject || '',
          status: 'assigned',
          timestamp: thread.timestamp,
          timeStampDisplay: null,
          timeStampIso: null,
          is_reply_with_signature: false,
          isUnread: false,
          stage: undefined,
          videoStatus: undefined,
          canAssign: false,
          attachments: [],
          athleteLinks: undefined,
        }));

      setMessages(messages);
      console.log('🔍 READ INBOX: Setting messages in UI:', messages.length);
      console.log('🔍 READ INBOX: First message:', messages[0]);

      await showToast({
        style: Toast.Style.Success,
        title: `Found ${messages.length} assigned messages`,
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
