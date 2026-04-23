import {
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  Toast,
  showToast,
  useNavigation,
} from '@raycast/api';
import { useForm, usePromise } from '@raycast/utils';
import { format } from 'date-fns';
import { useState } from 'react';

import ExportClientMessageInboxCommand from './export-client-message-inbox';
import {
  type ClientInboxChat,
  type ClientThreadMessage,
  getClientThreadMessages,
  sendClientMessage,
  useClientInboxChats,
} from './lib/client-message-sandbox';
import { openMessagesServiceClientInbox } from './lib/messages-service';

function getMessagesUrl(
  chat: Pick<ClientInboxChat, 'chat_identifier' | 'group_participants' | 'is_group'>,
  body?: string,
): string {
  const addresses = chat.is_group
    ? chat.group_participants || chat.chat_identifier
    : chat.chat_identifier;
  const encodedBody = body ? `&body=${encodeURIComponent(body)}` : '';
  return `sms://open?addresses=${addresses}${encodedBody}`;
}

function FollowUpDraftForm({ chat }: { chat: ClientInboxChat }) {
  const { pop } = useNavigation();
  const { itemProps, handleSubmit } = useForm<{ message: string }>({
    initialValues: {
      message: '',
    },
    async onSubmit(values) {
      await openMessagesServiceClientInbox({
        chatIdentifier: chat.chat_identifier,
        draftMessage: values.message,
        openThread: false,
      });
      await showToast({
        style: Toast.Style.Success,
        title: 'Opened in Messages service',
        message: `Draft ready for ${chat.displayName}`,
      });
      pop();
    },
  });

  return (
    <Form
      navigationTitle={`Send Follow-Up • ${chat.displayName}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Open in Messages Service"
            icon={Icon.Message}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Client"
        text={[chat.clientMatch.athleteName, chat.clientMatch.associateLabel]
          .filter(Boolean)
          .join(' • ')}
      />
      <Form.TextArea
        {...itemProps.message}
        title="Follow-Up"
        placeholder="Write the follow-up, then continue in the Messages service UI."
      />
    </Form>
  );
}

function ReplyForm({ message, onSent }: { message: ClientThreadMessage; onSent: () => void }) {
  const { pop } = useNavigation();
  const { itemProps, handleSubmit } = useForm<{ reply: string }>({
    initialValues: {
      reply: '',
    },
    async onSubmit(values) {
      const result = await sendClientMessage({
        address: message.sender,
        text: values.reply,
        serviceName: message.service,
      });
      if (result !== 'Success') {
        throw new Error(result);
      }
      onSent();
      pop();
    },
  });

  return (
    <Form
      navigationTitle={`Replying to ${message.senderName}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Reply" icon={Icon.Reply} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description title="Message" text={message.body} />
      <Form.TextArea {...itemProps.reply} title="Reply" />
    </Form>
  );
}

function ClientThread({ chat }: { chat: ClientInboxChat }) {
  const [searchText, setSearchText] = useState('');
  const { push } = useNavigation();
  const {
    data: messages,
    isLoading,
    revalidate,
  } = usePromise(getClientThreadMessages, [chat.guid, chat.displayName, searchText]);

  return (
    <List
      navigationTitle={chat.displayName}
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      throttle
      searchBarPlaceholder="Search this thread..."
    >
      {(messages || []).map((message) => (
        <List.Item
          key={message.guid}
          title={message.senderName}
          subtitle={message.body}
          accessories={[
            { date: new Date(message.date), tooltip: format(new Date(message.date), 'PPpp') },
          ]}
          actions={
            <ActionPanel>
              <Action
                title="Reply"
                icon={Icon.Reply}
                onAction={() => push(<ReplyForm message={message} onSent={revalidate} />)}
              />
              <Action.Open
                title="Open in Messages"
                icon={Icon.Message}
                target={getMessagesUrl(chat)}
              />
              <Action title="Refresh Thread" icon={Icon.ArrowClockwise} onAction={revalidate} />
            </ActionPanel>
          }
        />
      ))}
      <List.EmptyView
        title="No messages found"
        description="This thread did not return any local Messages rows yet."
      />
    </List>
  );
}

export default function ClientMessageInboxCommand() {
  const [searchText, setSearchText] = useState('');
  const { push } = useNavigation();
  const {
    data: chats,
    isLoading,
    permissionView,
    revalidateDirectory,
    directory,
  } = useClientInboxChats(searchText);

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
          subtitle={chat.clientMatch.currentTaskTitle || chat.clientMatch.taskStatus || ''}
          accessories={[
            ...(chat.clientMatch.athleteName
              ? [{ tag: { value: chat.clientMatch.athleteName } }]
              : []),
            ...(chat.is_group ? [{ tag: { value: 'Group' } }] : []),
            {
              date: new Date(chat.last_message_date),
              tooltip: format(new Date(chat.last_message_date), 'PPpp'),
            },
          ]}
          actions={
            <ActionPanel>
              <Action
                title="Open Client Thread"
                icon={Icon.Message}
                onAction={() => push(<ClientThread chat={chat} />)}
              />
              <Action
                title="Send Follow-Up"
                icon={Icon.PaperPlane}
                onAction={() => push(<FollowUpDraftForm chat={chat} />)}
              />
              {chat.is_group ? (
                <Action.Open
                  title="Open in Messages"
                  icon={Icon.Bubble}
                  target={getMessagesUrl(chat)}
                />
              ) : (
                <Action
                  title="Open in Messages Service"
                  icon={Icon.Bubble}
                  onAction={() =>
                    openMessagesServiceClientInbox({
                      chatIdentifier: chat.chat_identifier,
                      openThread: true,
                    })
                  }
                />
              )}
              <ActionPanel.Section>
                <Action.Push
                  title="Export Client Message Inbox"
                  icon={Icon.Upload}
                  target={<ExportClientMessageInboxCommand />}
                />
                <Action
                  title="Refresh Client Source"
                  icon={Icon.ArrowClockwise}
                  onAction={revalidateDirectory}
                />
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
            <Action.Push
              title="Export Client Message Inbox"
              icon={Icon.Upload}
              target={<ExportClientMessageInboxCommand />}
            />
            <Action
              title="Refresh Client Source"
              icon={Icon.ArrowClockwise}
              onAction={revalidateDirectory}
            />
          </ActionPanel>
        }
      />
    </List>
  );
}
