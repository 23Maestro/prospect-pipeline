import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Form,
  LaunchProps,
  LocalStorage,
  List,
  Toast,
  LaunchType,
  launchCommand,
  open,
  popToRoot,
  showHUD,
  showToast,
  useNavigation,
} from '@raycast/api';
import { useForm, usePromise } from '@raycast/utils';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';

import {
  buildDefaultReminderDate,
  buildReminderDraft,
  createReminder,
  resolveClientReminderTarget,
  type ReminderContactOption,
} from './lib/reminders';
import { createAppleCalendarFollowUpEvent } from './lib/apple-calendar-follow-ups';
import { createCalFollowUpBooking } from './lib/cal-follow-ups';
import {
  type ClientInboxChat,
  type ClientThreadMessage,
  buildClientInboxThreadEvidenceReceipt,
  buildClientReplyThemeReviewSnapshotForChats,
  getClientThreadMessages,
  sendVerifiedClientMessage,
  useClientInboxChats,
} from './lib/client-message-sandbox';
import {
  buildClientMessageActionProposal,
  buildClientMessageActionProposalEvidenceJson,
  buildClientMessageActionProposalMarkdown,
  buildClientMessageActionProposalVisualUrl,
  clientMessageOperatorActionLabel,
  clientMessageOperatorActionTagTone,
} from './lib/client-message-action-proposals';
import { completeScoutPrepTaskAfterVoicemail } from './lib/scout-prep';
import {
  buildClientReplyThemeRunReceipt,
  buildClientReplyThemeThreadMarkdown,
  clientReplyThemeReviewBucketLabel,
  clientReplyThemeReviewDisplayName,
  clientReplyThemeReviewReasonTagLabel,
  clientReplyThemeReviewToneLabel,
  clientReplyThemeReviewToneTagColor,
  writeCachedClientReplyThemeReviewSnapshot,
  type ClientReplyThemeReviewBucketKey,
  type ClientReplyThemeNearMissRow,
  type ClientReplyThemeReviewRow,
} from './lib/client-message-reply-themes';
import {
  buildRescheduleRecoverySlotPlan,
  type RescheduleRecoverySlotOption,
} from './lib/reschedule-recovery-context';
import { openMessagesServiceClientInbox } from './lib/messages-service';
import { buildVoicemailFollowUpMessage } from './lib/scout-follow-up-templates';

const TAG_COLORS = [Color.Blue, Color.Green, Color.Magenta, Color.Orange, Color.Purple, Color.Red];
const TIME_TAG_COLORS = [
  Color.Blue,
  Color.Green,
  Color.Orange,
  Color.Purple,
  Color.Red,
  Color.Magenta,
  Color.Yellow,
];

type ClientMessageLaunchContext = {
  searchText?: string;
  source?: string;
};

function tagColorFor(value?: string | null): Color {
  const normalized = String(value || '').trim();
  const total = normalized.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return TAG_COLORS[total % TAG_COLORS.length];
}

function timeTagColorFor(value?: string | null): Color {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  const timeKey = normalized.match(/\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/)?.[0] || normalized;
  const total = timeKey.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return TIME_TAG_COLORS[total % TIME_TAG_COLORS.length];
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

type ClientMessageContactOption = {
  id: string;
  name: string;
  label: string;
  phone: string;
};

function buildClientMessageContactOptions(chat: ClientInboxChat): ClientMessageContactOption[] {
  const contacts: ClientMessageContactOption[] = [];
  const seenPhones = new Set<string>();
  const addContact = (contact: ClientMessageContactOption) => {
    const phone = String(contact.phone || '')
      .replace(/\D/g, '')
      .trim();
    if (!phone || seenPhones.has(phone)) return;
    seenPhones.add(phone);
    contacts.push({ ...contact, phone });
  };

  for (const contact of chat.clientMatch.associatedClients || []) {
    addContact({
      id: contact.role,
      label: contact.relationshipLabel,
      name: contact.name || contact.relationshipLabel,
      phone: contact.normalizedPhoneNumber,
    });
  }

  for (const [index, phone] of chat.matchedPhones.entries()) {
    addContact({
      id: `matched:${index}:${phone}`,
      label: 'Matched client',
      name: chat.displayName,
      phone,
    });
  }

  if (!chat.is_group) {
    addContact({
      id: `thread:${chat.chat_identifier}`,
      label: 'Thread',
      name: chat.displayName,
      phone: chat.chat_identifier,
    });
  }

  return contacts;
}

async function completeClientMessageTaskIfAvailable(chat: ClientInboxChat): Promise<string | null> {
  const athleteId = String(chat.clientMatch.contactId || '').trim();
  const athleteMainId = String(chat.clientMatch.athleteMainId || '').trim();
  const taskTitle = String(
    chat.clientMatch.currentTaskTitle || chat.clientMatch.taskStatus || '',
  ).trim();
  if (!athleteId || !athleteMainId || !taskTitle) {
    return null;
  }

  const result = await completeScoutPrepTaskAfterVoicemail({
    athleteId,
    athleteMainId,
    athleteName: chat.clientMatch.athleteName || chat.displayName,
    contactTask: athleteId,
    taskId: chat.clientMatch.currentTaskId || null,
    crmStage: chat.clientMatch.crmStage || null,
    taskTitle,
    description: taskTitle,
  });

  return result.task_id ? `Task #${result.task_id}` : 'Task completed';
}

function ClientMessageSendForm({
  chat,
  initialMessage = '',
  title = 'Send Follow-Up',
  onSent,
}: {
  chat: ClientInboxChat;
  initialMessage?: string;
  title?: string;
  onSent?: () => void;
}) {
  const { pop } = useNavigation();
  const contactOptions = buildClientMessageContactOptions(chat);
  const [contactId, setContactId] = useState(contactOptions[0]?.id || '');
  const { itemProps, handleSubmit } = useForm<{ message: string }>({
    initialValues: {
      message: initialMessage,
    },
    async onSubmit(values) {
      const selectedContact =
        contactOptions.find((contact) => contact.id === contactId) || contactOptions[0];
      if (!selectedContact?.phone) {
        throw new Error('No client phone selected.');
      }

      await sendVerifiedClientMessage({
        address: selectedContact.phone,
        text: values.message,
        serviceName: chat.service_name,
      });

      let completionMessage: string | null = null;
      let completionError: string | null = null;
      try {
        completionMessage = await completeClientMessageTaskIfAvailable(chat);
      } catch (error) {
        completionError = error instanceof Error ? error.message : String(error);
      }

      await showToast({
        style: completionError ? Toast.Style.Failure : Toast.Style.Success,
        title: 'Sent',
        message: completionError
          ? `Task not completed: ${completionError}`
          : completionMessage || `${selectedContact.name} • No task completed`,
      });
      onSent?.();
      pop();
    },
  });

  return (
    <Form
      navigationTitle={`${title} • ${chat.displayName}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Message" icon="💬" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Client"
        text={[chat.clientMatch.athleteName, chat.displayName].filter(Boolean).join(' • ')}
      />
      <Form.Dropdown id="contactId" title="Recipient" value={contactId} onChange={setContactId}>
        {contactOptions.map((contact) => (
          <Form.Dropdown.Item
            key={contact.id}
            value={contact.id}
            title={`${contact.label}: ${contact.name} • ${contact.phone}`}
          />
        ))}
      </Form.Dropdown>
      <Form.TextArea {...itemProps.message} title="Message" placeholder="Write the follow-up." />
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
            icon={includeDuration ? '📆' : '🔔'}
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
            title={option.name}
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
          title="Duration Minutes"
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
      await sendVerifiedClientMessage({
        address: message.sender,
        text: values.reply,
        serviceName: message.service,
      });
      onSent();
      pop();
    },
  });

  return (
    <Form
      navigationTitle={`Replying to ${message.senderName}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Reply" icon="↩️" onSubmit={handleSubmit} />
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
              <ActionPanel.Section title="Workflow">
                <Action
                  title="Reply"
                  icon="↩️"
                  onAction={() => push(<ReplyForm message={message} onSent={revalidate} />)}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title="Navigation">
                <Action.Open title="Open in Messages" icon="💬" target={getMessagesUrl(chat)} />
              </ActionPanel.Section>
              <ActionPanel.Section title="Source">
                <Action title="Refresh Thread" icon="🔄" onAction={revalidate} />
              </ActionPanel.Section>
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

const clientReplyThemeReviewStorage = {
  getItem: (key: string) => LocalStorage.getItem<string>(key),
  setItem: (key: string, value: string) => LocalStorage.setItem(key, value),
};

function themeLabel(theme: ClientReplyThemeReviewRow['theme']): string {
  if (theme === 'reschedule_request') return 'Reschedule';
  return 'Call Back';
}

function reviewToneColor(bucket: ClientReplyThemeReviewBucketKey): Color {
  const color = clientReplyThemeReviewToneTagColor(bucket);
  if (color === 'red') return Color.Red;
  if (color === 'blue') return Color.Blue;
  return Color.SecondaryText;
}

function operatorActionToneColor(
  action: ReturnType<typeof buildClientReplyThemeRunReceipt>['operatorAction'],
): Color {
  const tone = clientMessageOperatorActionTagTone(action);
  if (tone === 'urgent') return Color.Red;
  if (tone === 'warning') return Color.Orange;
  return Color.SecondaryText;
}

function firstName(value?: string | null): string {
  return (
    String(value || '')
      .trim()
      .split(/\s+/)[0] || ''
  );
}

type ClientReviewRescheduleSlotOption = RescheduleRecoverySlotOption;

function ClientThreadMarkdown({ chat }: { chat: ClientInboxChat }) {
  const { data: messages, isLoading } = usePromise(getClientThreadMessages, [
    chat.guid,
    chat.displayName,
  ]);
  const title = chat.displayName || chat.clientMatch.athleteName || 'Client Thread';

  return (
    <Detail
      navigationTitle={title}
      isLoading={isLoading}
      markdown={buildClientReplyThemeThreadMarkdown({
        clientName: title,
        timeZone: chat.clientMatch.timezone,
        timezoneLabel: chat.clientMatch.timezoneLabel,
        messages: messages || [],
      })}
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Navigation">
            <Action.Open title="Open in Messages" icon="💬" target={getMessagesUrl(chat)} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function ClientReviewEvidenceDetail({
  chat,
  row,
}: {
  chat: ClientInboxChat;
  row: ClientReplyThemeReviewRow;
}) {
  const { data: messages = [], isLoading } = usePromise(getClientThreadMessages, [
    chat.guid,
    chat.displayName,
  ]);
  const threadReceipt = buildClientInboxThreadEvidenceReceipt(chat, messages);
  const classifierReceipt = buildClientReplyThemeRunReceipt(row);
  const proposal = buildClientMessageActionProposal({
    threadReceipt,
    classifierReceipt,
  });
  const markdown = buildClientMessageActionProposalMarkdown({
    title: clientReplyThemeReviewDisplayName(row),
    threadReceipt,
    classifierReceipt,
    proposal,
  });
  const evidenceJson = buildClientMessageActionProposalEvidenceJson({
    title: clientReplyThemeReviewDisplayName(row),
    threadReceipt,
    classifierReceipt,
    proposal,
  });

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle="10x Evidence"
      markdown={markdown}
      actions={
        isLoading ? null : (
          <ActionPanel>
            <ActionPanel.Section title="Evidence">
              <Action.CopyToClipboard
                title="Copy Evidence JSON"
                icon="📋"
                content={evidenceJson}
                concealed
              />
            </ActionPanel.Section>
            <ActionPanel.Section title="Navigation">
              <Action.Open title="Open in Messages" icon="💬" target={getMessagesUrl(chat)} />
            </ActionPanel.Section>
          </ActionPanel>
        )
      }
    />
  );
}

async function openClientReviewEvidenceVisual(args: {
  chat: ClientInboxChat;
  row: ClientReplyThemeReviewRow;
}) {
  const title = clientReplyThemeReviewDisplayName(args.row);
  const messages = await getClientThreadMessages(args.chat.guid, args.chat.displayName);
  const threadReceipt = buildClientInboxThreadEvidenceReceipt(args.chat, messages);
  const classifierReceipt = buildClientReplyThemeRunReceipt(args.row);
  const proposal = buildClientMessageActionProposal({
    threadReceipt,
    classifierReceipt,
  });
  await open(
    buildClientMessageActionProposalVisualUrl({
      title,
      threadReceipt,
      classifierReceipt,
      proposal,
    }),
  );
}

function ClientReviewRescheduleSlotList({
  chat,
  row,
}: {
  chat: ClientInboxChat;
  row: ClientReplyThemeReviewRow;
}) {
  const { push } = useNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previousHeadScoutName, setPreviousHeadScoutName] = useState<string | null>(null);
  const [previousMeetingText, setPreviousMeetingText] = useState<string | null>(null);
  const [slots, setSlots] = useState<ClientReviewRescheduleSlotOption[]>([]);
  const [slot1, setSlot1] = useState<ClientReviewRescheduleSlotOption | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekLabel, setWeekLabel] = useState<string | null>(null);
  const [clientTimezoneLabel, setClientTimezoneLabel] = useState<string | null>(
    row.timezoneLabel || chat.clientMatch.timezoneLabel || null,
  );

  useEffect(() => {
    let isMounted = true;
    async function loadSlots() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const athleteId = String(row.contactId || chat.clientMatch.contactId || '').trim();
        const athleteMainId = String(
          row.athleteMainId || chat.clientMatch.athleteMainId || '',
        ).trim();
        const plan = await buildRescheduleRecoverySlotPlan({
          identity: {
            athleteId,
            athleteMainId,
            fallbackTimezone: row.timezone || chat.clientMatch.timezone,
            fallbackTimezoneLabel: row.timezoneLabel || chat.clientMatch.timezoneLabel,
            fallbackHeadScoutName: chat.clientMatch.displayName,
          },
          requirePreviousMeeting: true,
          weekOffsets: weekOffset > 0 ? [weekOffset] : [0, 1],
        });
        if (!isMounted) return;

        setPreviousHeadScoutName(plan.previousHeadScoutName);
        setClientTimezoneLabel(plan.clientTimezoneLabel);
        setPreviousMeetingText(plan.previousMeetingText);
        setSlots(plan.slots);
        setWeekLabel(plan.weekLabel);
      } catch (error) {
        if (!isMounted) return;
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setPreviousMeetingText(null);
        setSlots([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadSlots();
    return () => {
      isMounted = false;
    };
  }, [chat, reloadKey, row, weekOffset]);

  function openRescheduleMessage(selectedSlots: ClientReviewRescheduleSlotOption[]) {
    const contactName = clientReplyThemeReviewDisplayName(row);
    const body = buildVoicemailFollowUpMessage({
      variant: 'reschedule_1',
      greeting: `Good morning ${firstName(contactName) || 'there'},`,
      athleteName: row.athleteName || chat.clientMatch.athleteName || contactName,
      previousHeadScoutName:
        selectedSlots[0]?.scoutName || previousHeadScoutName || chat.clientMatch.displayName,
      rescheduleSlots: selectedSlots.map((slot) => slot.messageLabel),
      rescheduleWeekLabel: selectedSlots[0]?.weekLabel || null,
    });
    push(
      <ClientMessageSendForm
        chat={chat}
        initialMessage={body}
        title={`Send Reschedule • ${contactName}`}
      />,
    );
  }

  const sectionTitle = slot1
    ? `Slot 1: ${slot1.messageLabel}`
    : previousHeadScoutName
      ? `${previousHeadScoutName} first`
      : 'Openings';
  const sectionSubtitle = [
    weekLabel,
    clientTimezoneLabel ? `Client timezone: ${clientTimezoneLabel}` : null,
    previousMeetingText ? `Previous: ${previousMeetingText}` : null,
  ]
    .filter(Boolean)
    .join(' • ');
  const canGoBack = weekOffset > 0;

  function showPreviousWeek() {
    if (!canGoBack) return;
    setSlot1(null);
    setWeekOffset((value) => Math.max(0, value - 1));
  }

  function showNextWeek() {
    setSlot1(null);
    setWeekOffset((value) => value + 1);
  }

  const weekActions = (
    <>
      <Action
        title="Next Week"
        icon="➡️"
        shortcut={{ modifiers: ['cmd', 'shift'], key: 'enter' }}
        onAction={showNextWeek}
      />
      {canGoBack ? (
        <Action
          title="This Week"
          icon="⬅️"
          shortcut={{ modifiers: ['cmd', 'shift'], key: 'arrowLeft' }}
          onAction={showPreviousWeek}
        />
      ) : null}
    </>
  );

  return (
    <List
      navigationTitle={`Reschedule • ${clientReplyThemeReviewDisplayName(row)}`}
      isLoading={isLoading}
      searchBarPlaceholder="Filter openings"
    >
      <List.Section title={sectionTitle} subtitle={sectionSubtitle || undefined}>
        {slots.map((slot, index) => (
          <List.Item
            key={`${slot.id}:${index}`}
            title={`${index + 1}. ${slot.dateLabel}`}
            icon={slot.isPreviousScout ? '⭐' : '📅'}
            subtitle={slot.scoutName}
            keywords={[slot.scoutName, slot.messageLabel]}
            accessories={[
              { tag: { value: slot.timeLabel, color: timeTagColorFor(slot.timeLabel) } },
              ...(slot.isPreviousScout ? [{ text: 'Previous scout' }] : []),
            ]}
            actions={
              <ActionPanel>
                <ActionPanel.Section title="Workflow">
                  {!slot1 ? (
                    <Action title="Use as Slot 1" icon="1️⃣" onAction={() => setSlot1(slot)} />
                  ) : (
                    <Action
                      title="Use as Slot 2"
                      icon="2️⃣"
                      onAction={() => openRescheduleMessage([slot1, slot])}
                    />
                  )}
                  {slot1 ? (
                    <Action title="Change Slot 1" icon="↩️" onAction={() => setSlot1(null)} />
                  ) : null}
                </ActionPanel.Section>
                <ActionPanel.Section title="Source">
                  <Action
                    title="Refresh Openings"
                    icon="🔄"
                    shortcut={{ modifiers: ['cmd'], key: 'r' }}
                    onAction={() => setReloadKey((value) => value + 1)}
                  />
                  {weekActions}
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      {!isLoading && !slots.length ? (
        <List.EmptyView
          title="No openings"
          description={errorMessage || `No openings found${weekLabel ? ` for ${weekLabel}` : ''}.`}
          actions={
            <ActionPanel>
              <ActionPanel.Section title="Source">
                <Action
                  title="Refresh Openings"
                  icon="🔄"
                  onAction={() => setReloadKey((value) => value + 1)}
                />
                {weekActions}
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}

async function buildAndCacheReplyThemeReview(chats: ClientInboxChat[]) {
  const snapshot = await buildClientReplyThemeReviewSnapshotForChats(chats);
  await writeCachedClientReplyThemeReviewSnapshot(clientReplyThemeReviewStorage, snapshot);
  return snapshot;
}

function ClientReplyThemeReview({ chats }: { chats: ClientInboxChat[] }) {
  const { push } = useNavigation();
  const {
    data: snapshot,
    isLoading,
    revalidate,
  } = usePromise(buildAndCacheReplyThemeReview, [chats]);

  function chatForRow(row: ClientReplyThemeReviewRow) {
    return chats.find((chat) => chat.guid === row.chatGuid);
  }

  async function handleCreateReminder(chat: ClientInboxChat) {
    const { options, immediateOption } = resolveClientReminderTarget({
      isGroup: chat.is_group,
      matchedPhones: chat.matchedPhones,
      associatedClients: chat.clientMatch.associatedClients || [],
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
        title: 'No contact',
      });
      return;
    }

    const createForOption = async (option: ReminderContactOption, remindAt?: Date) => {
      if (!remindAt) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Pick a time',
        });
        return;
      }

      await createReminder(
        buildReminderDraft({
          mode: 'text',
          athleteName: chat.clientMatch.athleteName || chat.displayName,
          contactName: option.name,
          phone: option.phone,
          contactId: String(chat.clientMatch.contactId || '').trim(),
          athleteMainId: String(chat.clientMatch.athleteMainId || '').trim(),
          remindAt,
        }),
      );
      await showHUD(`Reminder: ${option.name}`);
      await popToRoot({ clearSearchBar: true });
    };

    push(
      <ReminderRecipientForm
        navigationTitle={`Reminder • ${chat.displayName}`}
        options={immediateOption ? [immediateOption] : options}
        actionTitle="Create Reminder"
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

  function renderRow(
    row: ClientReplyThemeReviewRow | ClientReplyThemeNearMissRow,
    bucket: ClientReplyThemeReviewBucketKey,
  ) {
    const chat = chatForRow(row);
    const isTripleCheck = bucket === 'ignoredHandled';
    const reasonLabel = clientReplyThemeReviewReasonTagLabel(
      bucket,
      isTripleCheck ? 'replied_after' : 'no_operator_reply',
    );
    const canReschedule = bucket === 'rows' && row.theme === 'reschedule_request';
    const operatorAction = buildClientReplyThemeRunReceipt(row).operatorAction;
    return (
      <List.Item
        key={`${bucket}:${row.id}`}
        title={clientReplyThemeReviewDisplayName(row)}
        subtitle={row.messageBody}
        accessories={[
          {
            tag: {
              value: clientReplyThemeReviewToneLabel(bucket),
              color: reviewToneColor(bucket),
            },
          },
          {
            tag: {
              value: clientMessageOperatorActionLabel(operatorAction),
              color: operatorActionToneColor(operatorAction),
            },
          },
          ...(reasonLabel ? [{ tag: { value: reasonLabel, color: Color.Orange } }] : []),
          { tag: { value: themeLabel(row.theme), color: Color.Purple } },
          ...(row.athleteName
            ? row.athleteName === clientReplyThemeReviewDisplayName(row)
              ? []
              : [{ tag: { value: row.athleteName, color: tagColorFor(row.athleteName) } }]
            : []),
          ...(row.messageDate
            ? [
                {
                  date: new Date(row.messageDate),
                  tooltip: format(new Date(row.messageDate), 'PPpp'),
                },
              ]
            : []),
        ]}
        actions={
          <ActionPanel>
            {chat && !isTripleCheck ? (
              <>
                <ActionPanel.Section title="Workflow">
                  {canReschedule ? (
                    <Action.Push
                      title="Choose Reschedule Slots"
                      icon="📅"
                      target={<ClientReviewRescheduleSlotList chat={chat} row={row} />}
                    />
                  ) : null}
                  <Action
                    title="Create Reminder"
                    icon="🔔"
                    onAction={() => void handleCreateReminder(chat)}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section title="Navigation">
                  <Action
                    title="Open Evidence Visual"
                    icon="🧾"
                    shortcut={{ modifiers: ['cmd'], key: 'e' }}
                    onAction={async () => {
                      try {
                        await openClientReviewEvidenceVisual({ chat, row });
                      } catch (error) {
                        await showToast({
                          style: Toast.Style.Failure,
                          title: 'Evidence failed',
                          message: error instanceof Error ? error.message : String(error),
                        });
                      }
                    }}
                  />
                  <Action.Push
                    title="Open Thread"
                    icon="💬"
                    target={<ClientThreadMarkdown chat={chat} />}
                  />
                  <Action
                    title="Open Scout Prep"
                    icon="📋"
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
                    onAction={() => void openScoutPrepFromClientMessage(chat)}
                  />
                </ActionPanel.Section>
              </>
            ) : chat ? (
              <ActionPanel.Section title="Navigation">
                <Action
                  title="Open Evidence Visual"
                  icon="🧾"
                  shortcut={{ modifiers: ['cmd'], key: 'e' }}
                  onAction={async () => {
                    try {
                      await openClientReviewEvidenceVisual({ chat, row });
                    } catch (error) {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: 'Evidence failed',
                        message: error instanceof Error ? error.message : String(error),
                      });
                    }
                  }}
                />
                <Action.Push
                  title="Open Thread"
                  icon="💬"
                  target={<ClientThreadMarkdown chat={chat} />}
                />
              </ActionPanel.Section>
            ) : null}
            <ActionPanel.Section title="Source">
              <Action title="Refresh Review" icon="🔄" onAction={revalidate} />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List
      navigationTitle="Review Follow Ups"
      isLoading={isLoading}
      searchBarPlaceholder="Search reply themes..."
    >
      <List.Section
        title={`Review Follow Ups: ${clientReplyThemeReviewBucketLabel('rows')} (${snapshot?.rows.length || 0})`}
      >
        {(snapshot?.rows || []).map((row) => renderRow(row, 'rows'))}
      </List.Section>
      <List.Section
        title={`Review Follow Ups: ${clientReplyThemeReviewBucketLabel('nearMisses')} (${snapshot?.nearMisses.length || 0})`}
      >
        {(snapshot?.nearMisses || []).map((row) => renderRow(row, 'nearMisses'))}
      </List.Section>
      <List.Section
        title={`Review Follow Ups: ${clientReplyThemeReviewBucketLabel('ignoredHandled')} (${snapshot?.ignoredHandled.length || 0})`}
      >
        {(snapshot?.ignoredHandled || []).map((row) => renderRow(row, 'ignoredHandled'))}
      </List.Section>
      <List.EmptyView
        title="No reply themes found"
        description={
          snapshot
            ? `Reviewed ${snapshot.totalMessagesReviewed} messages across ${snapshot.totalChatsReviewed} cache-matched chats. Snapshot cached ${snapshot.generatedAt}.`
            : 'Run the review to cache actionable reply themes.'
        }
        actions={
          <ActionPanel>
            <ActionPanel.Section title="Source">
              <Action title="Refresh Review" icon="🔄" onAction={revalidate} />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    </List>
  );
}

async function openScoutPrepFromClientMessage(chat: ClientInboxChat) {
  const athleteName = String(chat.clientMatch.athleteName || chat.displayName || '').trim();
  await launchCommand({
    name: 'scout-prep',
    type: LaunchType.UserInitiated,
    context: {
      initialFilter: 'all',
      searchText: athleteName,
      source: 'client-message-inbox',
    },
  });
}

export default function ClientMessageInboxCommand(
  props: LaunchProps<{ launchContext?: ClientMessageLaunchContext }> = {} as LaunchProps<{
    launchContext?: ClientMessageLaunchContext;
  }>,
) {
  const launchContext = props.launchContext;
  const initialSearchText = String(launchContext?.searchText || '').trim();
  const [searchText, setSearchText] = useState(initialSearchText);
  const { push } = useNavigation();
  const {
    data: chats,
    isLoading,
    permissionView,
    revalidateDirectory,
    directory,
    directoryError,
  } = useClientInboxChats(searchText);

  if (permissionView) {
    return permissionView;
  }

  async function handleCreateCalFollowUp(chat: ClientInboxChat) {
    const { options, immediateOption } = resolveClientReminderTarget({
      isGroup: chat.is_group,
      matchedPhones: chat.matchedPhones,
      associatedClients: chat.clientMatch.associatedClients || [],
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
      associatedClients: chat.clientMatch.associatedClients || [],
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
            ...(chat.clientMatch.ambiguity === 'multiple_athletes'
              ? [{ tag: { value: 'Review', color: Color.Red } }]
              : []),
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
              <ActionPanel.Section title="Navigation">
                <Action.Push title="Open Thread" icon="💬" target={<ClientThread chat={chat} />} />
                <Action
                  title="Open in Messages Service"
                  icon="💬"
                  onAction={() =>
                    openMessagesServiceClientInbox({
                      chatIdentifier: chat.chat_identifier,
                      openThread: true,
                    })
                  }
                />
                {chat.is_group ? (
                  <Action.Open title="Open in Messages" icon="💬" target={getMessagesUrl(chat)} />
                ) : null}
                <Action
                  title="Open Scout Prep"
                  icon="📋"
                  shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
                  onAction={() => void openScoutPrepFromClientMessage(chat)}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title="Workflow">
                <Action
                  title="Book Cal Follow-Up"
                  icon="📞"
                  shortcut={{ modifiers: ['cmd'], key: '3' }}
                  onAction={() => void handleCreateCalFollowUp(chat)}
                />
                <Action
                  title="Create Calendar Follow-Up"
                  icon="📆"
                  shortcut={{ modifiers: ['cmd'], key: '4' }}
                  onAction={() => void handleCreateAppleCalendarFollowUp(chat)}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title="Review">
                <Action.Push
                  title="Review Follow Ups"
                  icon="👀"
                  target={<ClientReplyThemeReview chats={chats || []} />}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title="Source">
                <Action title="Refresh Source" icon="🔄" onAction={revalidateDirectory} />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}

      <List.EmptyView
        title={directoryError ? 'Client Messages source failed' : 'No client chats found'}
        description={
          directoryError
            ? directoryError.message
            : directory?.generatedAt
              ? `Existing ID Client threads are loaded first. Export enrichment updated ${directory.generatedAt}.`
              : 'No cache-admitted Client Message threads found yet.'
        }
        actions={
          <ActionPanel>
            <ActionPanel.Section title="Review">
              <Action.Push
                title="Review Follow Ups"
                icon="👀"
                target={<ClientReplyThemeReview chats={chats || []} />}
              />
            </ActionPanel.Section>
            <ActionPanel.Section title="Source">
              <Action title="Refresh Source" icon="🔄" onAction={revalidateDirectory} />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    </List>
  );
}
