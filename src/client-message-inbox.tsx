import {
  Action,
  ActionPanel,
  Color,
  Form,
  Icon,
  List,
  Toast,
  popToRoot,
  showHUD,
  showToast,
  useNavigation,
} from '@raycast/api';
import { useForm, usePromise } from '@raycast/utils';
import { format } from 'date-fns';
import { useState } from 'react';

import ExportClientMessageInboxCommand from './export-client-message-inbox';
import {
  buildDefaultReminderDate,
  resolveClientReminderTarget,
  type ReminderContactOption,
} from './lib/reminders';
import { createAppleCalendarFollowUpEvent } from './lib/apple-calendar-follow-ups';
import { createCalFollowUpBooking } from './lib/cal-follow-ups';
import {
  type ClientInboxChat,
  type ClientThreadMessage,
  getClientThreadMessages,
  sendClientMessage,
  useClientInboxChats,
} from './lib/client-message-sandbox';
import { openMessagesServiceClientInbox } from './lib/messages-service';

const TAG_COLORS = [Color.Blue, Color.Green, Color.Magenta, Color.Orange, Color.Purple, Color.Red];

function tagColorFor(value?: string | null): Color {
  const normalized = String(value || '').trim();
  const total = normalized.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return TAG_COLORS[total % TAG_COLORS.length];
}

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
        text={[chat.clientMatch.athleteName, chat.displayName].filter(Boolean).join(' • ')}
      />
      <Form.TextArea
        {...itemProps.message}
        title="Follow-Up"
        placeholder="Write the follow-up, then continue in the Messages service UI."
      />
    </Form>
  );
}

function ReminderRecipientForm({
  navigationTitle,
  options,
  actionTitle,
  includeDuration = false,
  onSubmit,
}: {
  navigationTitle: string;
  options: ReminderContactOption[];
  actionTitle: string;
  includeDuration?: boolean;
  onSubmit: (values: {
    recipientId?: string;
    remindAt?: Date;
    durationMinutes?: number;
  }) => Promise<void>;
}) {
  const [recipientId, setRecipientId] = useState(options[0]?.id);
  const [remindAt, setRemindAt] = useState<Date | null>(buildDefaultReminderDate());
  const [durationMinutes, setDurationMinutes] = useState('15');
  const selectedOption = options.find((option) => option.id === recipientId) || options[0];

  return (
    <Form
      navigationTitle={navigationTitle}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={actionTitle}
            icon={Icon.Calendar}
            onSubmit={() =>
              onSubmit({
                recipientId,
                remindAt: remindAt ?? undefined,
                durationMinutes: includeDuration ? Number.parseInt(durationMinutes, 10) : undefined,
              })
            }
          />
        </ActionPanel>
      }
    >
      {includeDuration ? (
        <Form.Description title="Title" text={`Follow Up: ${selectedOption?.name || 'Contact'}`} />
      ) : null}
      <Form.Dropdown id="recipientId" title="Contact" value={recipientId} onChange={setRecipientId}>
        {options.map((option) => (
          <Form.Dropdown.Item
            key={`${option.id}-${option.phone}`}
            value={option.id}
            title={`${option.label}: ${option.name}`}
          />
        ))}
      </Form.Dropdown>
      <Form.DatePicker
        id="remindAt"
        title="Follow Up Time"
        type={Form.DatePicker.Type.DateTime}
        value={remindAt}
        onChange={setRemindAt}
      />
      {includeDuration ? (
        <Form.TextField
          id="durationMinutes"
          title="Duration"
          placeholder="15"
          value={durationMinutes}
          onChange={setDurationMinutes}
        />
      ) : null}
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

  async function handleCreateCalFollowUp(chat: ClientInboxChat) {
    const { options, immediateOption } = resolveClientReminderTarget({
      isGroup: chat.is_group,
      matchedPhones: chat.matchedPhones,
      associatedClients: [],
      fallbackContact: {
        id: 'matchedContact',
        label: 'Contact',
        name: chat.displayName,
        phone: chat.matchedPhones[0] || chat.chat_identifier,
      },
    });

    if (!options.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No follow-up contact found',
      });
      return;
    }

    const createForOption = async (
      option: ReminderContactOption,
      remindAt?: Date,
      durationMinutes?: number,
    ) => {
      if (!remindAt) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Pick a follow-up time',
        });
        return;
      }
      if (!Number.isFinite(durationMinutes) || Number(durationMinutes) <= 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Enter duration',
        });
        return;
      }

      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Booking',
        message: `${option.name} • ${chat.clientMatch.athleteName || chat.displayName}`,
      });
      try {
        await createCalFollowUpBooking({
          start: remindAt,
          athleteName: chat.clientMatch.athleteName || chat.displayName,
          contactName: option.name,
          phone: option.phone,
          contactId: String(chat.clientMatch.contactId || '').trim(),
          athleteMainId: String(chat.clientMatch.athleteMainId || '').trim(),
        });
        toast.hide();
        await showHUD(`Follow Up: ${option.name}`);
        await popToRoot({ clearSearchBar: true });
      } catch (error) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Booking failed';
        toast.message = error instanceof Error ? error.message : String(error);
      }
    };

    push(
      <ReminderRecipientForm
        navigationTitle={`Cal Follow Up • ${chat.displayName}`}
        options={immediateOption ? [immediateOption] : options}
        actionTitle="Book Follow Up"
        onSubmit={async (values) => {
          const availableOptions = immediateOption ? [immediateOption] : options;
          const selected =
            availableOptions.find((option) => option.id === values.recipientId) ||
            availableOptions[0];
          await createForOption(selected, values.remindAt);
        }}
      />,
    );
  }

  async function handleCreateAppleCalendarFollowUp(chat: ClientInboxChat) {
    const { options, immediateOption } = resolveClientReminderTarget({
      isGroup: chat.is_group,
      matchedPhones: chat.matchedPhones,
      associatedClients: [],
      fallbackContact: {
        id: 'matchedContact',
        label: 'Contact',
        name: chat.displayName,
        phone: chat.matchedPhones[0] || chat.chat_identifier,
      },
    });

    if (!options.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No follow-up contact found',
      });
      return;
    }

    const createForOption = async (option: ReminderContactOption, remindAt?: Date) => {
      if (!remindAt) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Pick a follow-up time',
        });
        return;
      }

      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Creating event',
        message: `${option.name} • ${chat.clientMatch.athleteName || chat.displayName}`,
      });
      try {
        await createAppleCalendarFollowUpEvent({
          start: remindAt,
          athleteName: chat.clientMatch.athleteName || chat.displayName,
          contactName: option.name,
          phone: option.phone,
          contactId: String(chat.clientMatch.contactId || '').trim(),
          athleteMainId: String(chat.clientMatch.athleteMainId || '').trim(),
          durationMinutes,
        });
        toast.hide();
        await showHUD(`Calendar: ${option.name}`);
        await popToRoot({ clearSearchBar: true });
      } catch (error) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Event failed';
        toast.message = error instanceof Error ? error.message : String(error);
      }
    };

    push(
      <ReminderRecipientForm
        navigationTitle={`Calendar Follow Up • ${chat.displayName}`}
        options={immediateOption ? [immediateOption] : options}
        actionTitle="Create Calendar Event"
        includeDuration
        onSubmit={async (values) => {
          const availableOptions = immediateOption ? [immediateOption] : options;
          const selected =
            availableOptions.find((option) => option.id === values.recipientId) ||
            availableOptions[0];
          await createForOption(selected, values.remindAt, values.durationMinutes);
        }}
      />,
    );
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
              ? [
                  {
                    tag: {
                      value: chat.clientMatch.athleteName,
                      color: tagColorFor(chat.clientMatch.athleteName),
                    },
                  },
                ]
              : []),
            ...(chat.is_group ? [{ tag: { value: 'Group', color: Color.Yellow } }] : []),
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
                icon={Icon.Airplane}
                onAction={() => push(<FollowUpDraftForm chat={chat} />)}
              />
              <Action
                title="Cal Follow-Up"
                icon={Icon.Phone}
                shortcut={{ modifiers: ['cmd'], key: '3' }}
                onAction={() => void handleCreateCalFollowUp(chat)}
              />
              <Action
                title="Calendar Follow-Up"
                icon={Icon.Calendar}
                shortcut={{ modifiers: ['cmd'], key: '4' }}
                onAction={() => void handleCreateAppleCalendarFollowUp(chat)}
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
