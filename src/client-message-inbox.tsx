import { Action, ActionPanel, Icon, List, useNavigation } from '@raycast/api';
import { format } from 'date-fns';
import { useState } from 'react';

import { ClientComposeForm, ClientThreadView } from './components/client-message-ui';
import ExportClientMessageInboxCommand from './export-client-message-inbox';
import {
  type ClientInboxChat,
  useClientInboxChats,
} from './lib/client-message-sandbox';

export default function ClientMessageInboxCommand() {
  const [searchText, setSearchText] = useState('');
  const { push } = useNavigation();
  const { data: chats, isLoading, permissionView, revalidateDirectory, directory } = useClientInboxChats(searchText);

  if (permissionView) {
    return permissionView;
  }

  return (
    <List
      navigationTitle="Client Message Inbox"
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      throttle
      searchBarPlaceholder="Search client chats..."
    >
      {(chats || []).map((chat) => (
        <List.Item
          key={chat.guid}
          title={chat.displayName}
          subtitle={[
            chat.clientMatch.athleteName && chat.clientMatch.athleteName !== chat.displayName
              ? `${chat.clientMatch.athleteName} • ${chat.clientMatch.associateLabel || 'Associated Client'}`
              : chat.clientMatch.associateLabel || null,
            chat.clientMatch.currentTaskTitle || chat.clientMatch.taskStatus || null,
          ]
            .filter(Boolean)
            .join(' | ')}
          accessories={[
            { tag: { value: chat.clientMatch.segment === 'client' ? 'Client' : 'Pending' } },
            ...(chat.clientMatch.crmStage ? [{ text: chat.clientMatch.crmStage }] : []),
            { date: new Date(chat.last_message_date), tooltip: format(new Date(chat.last_message_date), 'PPpp') },
          ]}
          actions={
            <ActionPanel>
              <Action title="Open Client Thread" icon={Icon.Message} onAction={() => push(<ClientThreadView chat={chat} />)} />
              <Action
                title="Send Follow-Up"
                icon={Icon.Message}
                onAction={() =>
                  push(
                    <ClientComposeForm
                      initialNormalizedPhone={chat.clientMatch.normalizedPhone}
                      navigationTitle={`Send Follow-Up • ${chat.displayName}`}
                    />,
                  )
                }
              />
              <ActionPanel.Section>
                <Action.Push title="Export Client Message Inbox" icon={Icon.Upload} target={<ExportClientMessageInboxCommand />} />
                <Action title="Refresh Client Source" icon={Icon.ArrowClockwise} onAction={revalidateDirectory} />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}

      <List.EmptyView
        title="No client chats found"
        description={
          directory?.generatedAt
            ? `Existing ID Client threads are loaded first. Export enrichment updated ${directory.generatedAt}.`
            : `No matching ID Client threads found yet. Export path: ${directory?.exportPath || ''}`
        }
        actions={
          <ActionPanel>
            <Action.Push title="Export Client Message Inbox" icon={Icon.Upload} target={<ExportClientMessageInboxCommand />} />
            <Action title="Refresh Client Source" icon={Icon.ArrowClockwise} onAction={revalidateDirectory} />
          </ActionPanel>
        }
      />
    </List>
  );
}
