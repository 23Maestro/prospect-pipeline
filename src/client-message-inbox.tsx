import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Form,
  Grid,
  Icon,
  LocalStorage,
  List,
  Toast,
  LaunchType,
  launchCommand,
  popToRoot,
  showHUD,
  showToast,
  useNavigation,
} from '@raycast/api';
import { useForm, usePromise } from '@raycast/utils';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';

import ExportClientMessageInboxCommand from './export-client-message-inbox';
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
  getClientThreadMessages,
  sendClientMessage,
  useClientInboxChats,
} from './lib/client-message-sandbox';
import {
  buildClientReplyThemeReviewSnapshot,
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
  fetchAthleteBookedMeetings,
  fetchHeadScoutSlots,
  filterVisibleHeadScoutSlots,
  formatHeadScoutSlotForTimezone,
  type BookedMeetingEvent,
  type HeadScoutSlot,
} from './lib/head-scout-schedules';
import { openMessagesServiceClientInbox } from './lib/messages-service';
import { buildVoicemailFollowUpMessage } from './lib/scout-follow-up-templates';

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

function firstName(value?: string | null): string {
  return String(value || '')
    .trim()
    .split(/\s+/)[0] || '';
}

function normalizeNameKey(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^coach\s+/i, '')
    .replace(/\s+/g, ' ');
}

function selectPreviousHeadScoutName(events: BookedMeetingEvent[] = []): string | null {
  const sorted = [...events]
    .filter((event) => String(event.assigned_owner || '').trim())
    .sort((left, right) => String(right.start || '').localeCompare(String(left.start || '')));
  return String(sorted[0]?.assigned_owner || '').trim() || null;
}

function buildRescheduleSlotStartLabel(timeRangeLabel: string, zoneLabel: string): string {
  const [startRaw, rest = ''] = timeRangeLabel.split(/\s+-\s+/, 2);
  const period = rest.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase();
  const zone = zoneLabel || rest.match(/\b[A-Z]{2,4}\b$/)?.[0] || '';
  const start = String(startRaw || '').trim();
  return [start, period, zone].filter(Boolean).join(' ');
}

type ClientReviewRescheduleSlotOption = {
  id: string;
  title: string;
  scoutName: string;
  messageLabel: string;
  isPreviousScout: boolean;
};

function buildClientReviewRescheduleSlotOptions(args: {
  slots: Array<HeadScoutSlot & { scout_name: string }>;
  previousHeadScoutName?: string | null;
}): ClientReviewRescheduleSlotOption[] {
  const previousKey = normalizeNameKey(args.previousHeadScoutName);
  return filterVisibleHeadScoutSlots(args.slots)
    .sort((left, right) => {
      const leftPrevious = Boolean(
        previousKey && normalizeNameKey(left.scout_name) === previousKey,
      );
      const rightPrevious = Boolean(
        previousKey && normalizeNameKey(right.scout_name) === previousKey,
      );
      if (leftPrevious !== rightPrevious) return leftPrevious ? -1 : 1;
      return left.start.localeCompare(right.start);
    })
    .map((slot) => {
      const display = formatHeadScoutSlotForTimezone(slot.start, slot.end, null);
      const messageLabel = `${display.dateLabel} ${buildRescheduleSlotStartLabel(display.timeRangeLabel, display.zoneLabel)}`;
      return {
        id: `${slot.scout_name}:${slot.id}`,
        title: messageLabel,
        scoutName: slot.scout_name,
        messageLabel,
        isPreviousScout: Boolean(
          previousKey && normalizeNameKey(slot.scout_name) === previousKey,
        ),
      };
    });
}

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
        messages: messages || [],
      })}
      actions={
        <ActionPanel>
          <Action.Open title="Open in Messages" icon={Icon.Message} target={getMessagesUrl(chat)} />
        </ActionPanel>
      }
    />
  );
}

function ClientReviewRescheduleSlotGrid({
  chat,
  row,
}: {
  chat: ClientInboxChat;
  row: ClientReplyThemeReviewRow;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previousHeadScoutName, setPreviousHeadScoutName] = useState<string | null>(null);
  const [slots, setSlots] = useState<ClientReviewRescheduleSlotOption[]>([]);
  const [slot1, setSlot1] = useState<ClientReviewRescheduleSlotOption | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
        const [meetingResult, slotsResult] = await Promise.allSettled([
          athleteId && athleteMainId
            ? fetchAthleteBookedMeetings({ athleteId, athleteMainId })
            : Promise.resolve(null),
          fetchHeadScoutSlots(0),
        ]);
        if (!isMounted) return;

        const events =
          meetingResult.status === 'fulfilled' && meetingResult.value
            ? meetingResult.value.events || []
            : [];
        const nextPreviousHeadScout = selectPreviousHeadScoutName(events);
        const schedules = slotsResult.status === 'fulfilled' ? slotsResult.value.scouts || [] : [];
        const nextSlots = schedules.flatMap((schedule) =>
          (schedule.slots || []).map((slot) => ({
            ...slot,
            scout_name: slot.scout_name || schedule.scout_name,
          })),
        );
        setPreviousHeadScoutName(nextPreviousHeadScout);
        setSlots(
          buildClientReviewRescheduleSlotOptions({
            slots: nextSlots,
            previousHeadScoutName: nextPreviousHeadScout,
          }),
        );
        if (slotsResult.status === 'rejected') {
          setErrorMessage(
            slotsResult.reason instanceof Error
              ? slotsResult.reason.message
              : String(slotsResult.reason),
          );
        }
      } catch (error) {
        if (!isMounted) return;
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setSlots([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadSlots();
    return () => {
      isMounted = false;
    };
  }, [chat, reloadKey, row]);

  async function openRescheduleDraft(selectedSlots: ClientReviewRescheduleSlotOption[]) {
    const contactName = clientReplyThemeReviewDisplayName(row);
    const body = buildVoicemailFollowUpMessage({
      variant: 'reschedule_1',
      greeting: `Good morning ${firstName(contactName) || 'there'},`,
      athleteName: row.athleteName || chat.clientMatch.athleteName || contactName,
      previousHeadScoutName:
        selectedSlots[0]?.scoutName || previousHeadScoutName || chat.clientMatch.displayName,
      rescheduleSlots: selectedSlots.map((slot) => slot.messageLabel),
    });
    await openMessagesServiceClientInbox({
      chatIdentifier: chat.chat_identifier,
      draftMessage: body,
      openThread: false,
    });
    await showToast({
      style: Toast.Style.Success,
      title: 'Draft ready',
      message: contactName,
    });
  }

  const sectionTitle = slot1
    ? `Slot 1: ${slot1.messageLabel}`
    : previousHeadScoutName
      ? `${previousHeadScoutName} first`
      : 'Openings';

  return (
    <Grid
      navigationTitle={`Reschedule • ${clientReplyThemeReviewDisplayName(row)}`}
      isLoading={isLoading}
      searchBarPlaceholder="Filter openings"
      columns={4}
      aspectRatio="3/2"
      fit={Grid.Fit.Fill}
      inset={Grid.Inset.Medium}
    >
      <Grid.Section title={sectionTitle}>
        {slots.map((slot, index) => (
          <Grid.Item
            key={`${slot.id}:${index}`}
            content={{ value: slot.isPreviousScout ? '⭐' : '📅', tooltip: slot.scoutName }}
            title={`${index + 1}. ${slot.title}`}
            subtitle={slot.scoutName}
            keywords={[slot.scoutName, slot.messageLabel]}
            actions={
              <ActionPanel>
                {!slot1 ? (
                  <Action title="Use as Slot 1" icon="1️⃣" onAction={() => setSlot1(slot)} />
                ) : (
                  <Action
                    title="Use as Slot 2"
                    icon="2️⃣"
                    onAction={() => void openRescheduleDraft([slot1, slot])}
                  />
                )}
                {slot1 ? (
                  <Action title="Change Slot 1" icon="↩️" onAction={() => setSlot1(null)} />
                ) : null}
                <Action
                  title="Refresh Openings"
                  icon="🔄"
                  shortcut={{ modifiers: ['cmd'], key: 'r' }}
                  onAction={() => setReloadKey((value) => value + 1)}
                />
              </ActionPanel>
            }
          />
        ))}
      </Grid.Section>
      {!isLoading && !slots.length ? (
        <Grid.EmptyView
          title="No openings"
          description={errorMessage || 'No future openings found.'}
          actions={
            <ActionPanel>
              <Action
                title="Refresh Openings"
                icon="🔄"
                onAction={() => setReloadKey((value) => value + 1)}
              />
            </ActionPanel>
          }
        />
      ) : null}
    </Grid>
  );
}

async function buildAndCacheReplyThemeReview(chats: ClientInboxChat[]) {
  const messagesByChatGuidEntries = await Promise.all(
    chats.map(async (chat) => {
      const messages = await getClientThreadMessages(chat.guid, chat.displayName).catch(
        () => [] as ClientThreadMessage[],
      );
      return [
        chat.guid,
        messages.map((message) => ({
          guid: message.guid,
          body: message.body,
          date: message.date,
          senderName: message.senderName,
          sender: message.sender,
          isFromMe: message.is_from_me,
        })),
      ] as const;
    }),
  );

  const snapshot = buildClientReplyThemeReviewSnapshot({
    chats: chats.map((chat) => ({
      guid: chat.guid,
      displayName: chat.displayName,
      lastMessageDate: chat.last_message_date,
      athleteName: chat.clientMatch.athleteName,
      contactId: chat.clientMatch.contactId,
      athleteMainId: chat.clientMatch.athleteMainId,
      taskTitle: chat.clientMatch.currentTaskTitle || chat.clientMatch.taskStatus,
      matchedPhones: chat.matchedPhones,
    })),
    messagesByChatGuid: Object.fromEntries(messagesByChatGuidEntries),
  });
  await writeCachedClientReplyThemeReviewSnapshot(clientReplyThemeReviewStorage, snapshot);
  return snapshot;
}

function ClientReplyThemeReview({ chats }: { chats: ClientInboxChat[] }) {
  const { push } = useNavigation();
  const { data: snapshot, isLoading, revalidate } = usePromise(buildAndCacheReplyThemeReview, [
    chats,
  ]);

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
                {canReschedule ? (
                  <>
                    <Action.Push
                      title="Choose Reschedule Slots"
                      icon="📅"
                      target={<ClientReviewRescheduleSlotGrid chat={chat} row={row} />}
                    />
                    <Action
                      title="Create Reminder"
                      icon="🔔"
                      onAction={() => void handleCreateReminder(chat)}
                    />
                  </>
                ) : (
                  <Action
                    title="Create Reminder"
                    icon="🔔"
                    onAction={() => void handleCreateReminder(chat)}
                  />
                )}
                <Action.Push
                  title="Open Thread"
                  icon={Icon.Message}
                  target={
                    bucket === 'rows' ? (
                      <ClientThreadMarkdown chat={chat} />
                    ) : (
                      <ClientThread chat={chat} />
                    )
                  }
                />
                <Action
                  title="Open Scout Prep"
                  icon={Icon.List}
                  onAction={() => void openScoutPrepFromClientMessage(chat)}
                />
              </>
            ) : chat ? (
              <Action.Push
                title="Open Thread"
                icon={Icon.Message}
                target={<ClientThread chat={chat} />}
              />
            ) : null}
            <Action title="Refresh Review" icon={Icon.ArrowClockwise} onAction={revalidate} />
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
            <Action title="Refresh Review" icon={Icon.ArrowClockwise} onAction={revalidate} />
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
              <Action
                title="Open Scout Prep"
                icon={Icon.List}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
                onAction={() => void openScoutPrepFromClientMessage(chat)}
              />
              <Action.Push
                title="Review Follow Ups"
                icon={Icon.Eye}
                target={<ClientReplyThemeReview chats={chats || []} />}
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
            <Action.Push
              title="Review Follow Ups"
              icon={Icon.Eye}
              target={<ClientReplyThemeReview chats={chats || []} />}
            />
          </ActionPanel>
        }
      />
    </List>
  );
}
