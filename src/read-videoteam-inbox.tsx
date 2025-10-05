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

// Direct call to Python server with proper timeout handling
async function callPythonServer(method: string, args: any = {}, timeoutMs: number = 30000) {
  const { spawn } = await import('child_process');
  
  return new Promise((resolve, reject) => {
    const python = spawn('python3', [
      '/Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native/npid_simple_server.py'
    ]);
    
    let output = '';
    let errorOutput = '';
    let timeoutHandle: NodeJS.Timeout;
    let responseReceived = false;
    
    // Set timeout for the entire operation
    timeoutHandle = setTimeout(() => {
      if (!responseReceived) {
        python.kill();
        reject(new Error(`Python server timeout after ${timeoutMs}ms. Error log: ${errorOutput}`));
      }
    }, timeoutMs);
    
    python.stdout.on('data', (data) => {
      output += data.toString();
      
      // Try to parse as soon as we have a complete JSON response
      try {
        const lines = output.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            const result = JSON.parse(line);
            if (result.id === 1) {
              responseReceived = true;
              clearTimeout(timeoutHandle);
              python.kill();
              resolve(result);
              return;
            }
          }
        }
      } catch (e) {
        // Not a complete JSON yet, keep waiting
      }
    });
    
    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
      // Log stderr but don't fail on it (Python server logs to stderr)
      console.log('[Python stderr]:', data.toString());
    });
    
    python.on('error', (err) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Failed to start Python process: ${err.message}`));
    });
    
    python.on('close', (code) => {
      clearTimeout(timeoutHandle);
      if (!responseReceived) {
        if (code !== 0) {
          reject(new Error(`Python process exited with code ${code}. Error: ${errorOutput}`));
        } else {
          reject(new Error(`Python process closed without response. Output: ${output}`));
        }
      }
    });
    
    // Send the request
    const request = JSON.stringify({
      id: 1,
      method: method,
      arguments: args
    }) + '\n';
    
    python.stdin.write(request);
    python.stdin.end();
  });
}

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

      // Call Python server directly to get threads with assignment status
      const result = await callPythonServer('get_inbox_threads', { limit: 50 }) as any;
      
      if (result.status !== 'ok') {
        throw new Error(result.message || 'Failed to fetch threads');
      }

      // Filter for ASSIGNED messages (status === 'assigned')
      const assignedMessages = result.threads.filter((thread: any) => thread.status === 'assigned');

      // Convert to NPIDInboxMessage format
      const messages: NPIDInboxMessage[] = assignedMessages.map((thread: any) => ({
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
