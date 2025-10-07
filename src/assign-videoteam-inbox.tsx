import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Form,
  Icon,
  List,
  Toast,
  showToast,
  useNavigation,
} from '@raycast/api';
import { format } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import {
  AssignVideoTeamPayload,
  assignVideoTeamMessage,
  fetchAssignmentDefaults,
  fetchAssignmentModal,
  resolveContactsForAssignment,
} from './lib/npid-mcp-adapter';
import { callPythonServer } from './lib/python-server-client';
import {
  NPIDInboxMessage,
  VideoTeamAssignmentModal,
  VideoTeamContact,
  VideoTeamSearchCategory,
} from './types/video-team';
import { TaskStage, TaskStatus } from './types/workflow';

function formatTimestamp(message: NPIDInboxMessage): string {
  if (message.timeStampIso) {
    try {
      return format(new Date(message.timeStampIso), 'MMM d • h:mm a');
    } catch {
      /* no-op */
    }
  }
  return message.timestamp || 'Unknown time';
}

interface AssignmentModalProps {
  message: NPIDInboxMessage;
  modalData: VideoTeamAssignmentModal;
  contacts: VideoTeamContact[];
  searchFor: VideoTeamSearchCategory;
  onAssign: (params: {
    ownerId: string;
    stage: TaskStage;
    status: TaskStatus;
    contact: VideoTeamContact;
    searchFor: VideoTeamSearchCategory;
  }) => Promise<void>;
  onCancel: () => void;
}

function AssignmentModal({
  message,
  modalData,
  contacts,
  searchFor,
  onAssign,
  onCancel,
}: AssignmentModalProps) {
  const initialOwnerId = useMemo(
    () => modalData.defaultOwner?.value ?? modalData.owners[0]?.value ?? '',
    [modalData.defaultOwner, modalData.owners],
  );

  const initialStage = useMemo(() => {
    if (message.stage && modalData.stages.some((option) => option.value === message.stage)) {
      return message.stage as TaskStage;
    }
    return (modalData.stages[0]?.value as TaskStage) ?? 'In Queue';
  }, [message.stage, modalData.stages]);

  const initialStatus = useMemo(() => {
    if (
      message.videoStatus &&
      modalData.videoStatuses.some((option) => option.value === message.videoStatus)
    ) {
      return message.videoStatus as TaskStatus;
    }
    return (modalData.videoStatuses[0]?.value as TaskStatus) ?? 'Revisions';
  }, [message.videoStatus, modalData.videoStatuses]);

  const [ownerId, setOwnerId] = useState<string>(initialOwnerId);
  const [contactId, setContactId] = useState<string>(contacts[0]?.contactId ?? '');
  const [stage, setStage] = useState<TaskStage>(initialStage);
  const [status, setStatus] = useState<TaskStatus>(initialStatus);
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false);

  const contactLookup = useMemo(
    () => new Map(contacts.map((contact) => [contact.contactId, contact])),
    [contacts],
  );

  useEffect(() => {
    const selected = contactLookup.get(contactId);

    if (!selected || searchFor !== 'athlete') {
      return;
    }

    setIsLoadingDefaults(true);
    fetchAssignmentDefaults(selected.contactId)
      .then((defaults) => {
        if (defaults.stage && modalData.stages.some((option) => option.value === defaults.stage)) {
          setStage(defaults.stage as TaskStage);
        }
        if (
          defaults.status &&
          modalData.videoStatuses.some((option) => option.value === defaults.status)
        ) {
          setStatus(defaults.status as TaskStatus);
        }
      })
      .finally(() => setIsLoadingDefaults(false));
  }, [contactId, contactLookup, modalData.stages, modalData.videoStatuses, searchFor]);

  const handleAssignment = async () => {
    const selectedContact = contactLookup.get(contactId);
    if (!selectedContact) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Select a contact before assigning',
      });
      return;
    }

    await onAssign({ ownerId, stage, status, contact: selectedContact, searchFor });
  };

  return (
    <Form
      navigationTitle={`Assign • ${message.name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Assign to Video Team"
            icon={Icon.Checkmark}
            onSubmit={handleAssignment}
          />
          <Action title="Cancel" icon={Icon.XMarkCircle} onAction={onCancel} />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Auto-detected contact type"
        text={
          searchFor === modalData.defaultSearchFor
            ? searchFor.toUpperCase()
            : `${searchFor.toUpperCase()} (auto-selected because no ${modalData.defaultSearchFor.toUpperCase()} match was found)`
        }
      />
      <Form.Dropdown id="owner" title="Assigned Owner" value={ownerId} onChange={setOwnerId}>
        {modalData.owners.map((owner) => (
          <Form.Dropdown.Item key={owner.value} value={owner.value} title={owner.label} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="contact" title="Contact" value={contactId} onChange={setContactId}>
        {contacts.map((contact) => (
          <Form.Dropdown.Item
            key={contact.contactId}
            value={contact.contactId}
            title={contact.name}
            subtitle={[contact.sport, contact.gradYear, contact.state].filter(Boolean).join(' • ')}
          />
        ))}
      </Form.Dropdown>
      {isLoadingDefaults && <Form.Description title="" text="Loading recommended stage/status…" />}
      <Form.Dropdown
        id="stage"
        title="Video Stage"
        value={stage}
        onChange={(value) => setStage(value as TaskStage)}
      >
        {modalData.stages.map((option) => (
          <Form.Dropdown.Item key={option.value} value={option.value} title={option.label} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="status"
        title="Video Status"
        value={status}
        onChange={(value) => setStatus(value as TaskStatus)}
      >
        {modalData.videoStatuses.map((option) => (
          <Form.Dropdown.Item key={option.value} value={option.value} title={option.label} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

function EmailContentDetail({
  message,
  onBack,
  onAssign,
}: {
  message: NPIDInboxMessage;
  onBack: () => void;
  onAssign: (message: NPIDInboxMessage) => void;
}) {
  const received = formatTimestamp(message);

  const metadata = (
    <Detail.Metadata>
      <Detail.Metadata.Label
        title="From"
        text={`${message.name} (${message.email || 'No email'})`}
      />
      <Detail.Metadata.Label title="Received" text={received} />
      {message.stage && (
        <Detail.Metadata.TagList title="Stage">
          <Detail.Metadata.Tag text={message.stage} color={Color.Orange} />
        </Detail.Metadata.TagList>
      )}
      {message.videoStatus && (
        <Detail.Metadata.TagList title="Status">
          <Detail.Metadata.Tag text={message.videoStatus} color={Color.Blue} />
        </Detail.Metadata.TagList>
      )}
      {message.attachments && message.attachments.length > 0 && (
        <Detail.Metadata.Label
          title="Attachments"
          text={message.attachments.map((attachment) => attachment.fileName).join(', ')}
        />
      )}
    </Detail.Metadata>
  );

  const markdown = `# ${message.subject}\n\n${message.content || message.preview}`;

  return (
    <Detail
      navigationTitle={message.subject}
      markdown={markdown}
      metadata={metadata}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action
              title="Assign to Video Team"
              icon={Icon.PersonCircle}
              onAction={() => onAssign(message)}
            />
            <Action title="Back to Inbox" icon={Icon.ArrowLeft} onAction={onBack} />
          </ActionPanel.Section>

          {message.attachments && message.attachments.length > 0 && (
            <ActionPanel.Section title="📎 Attachments">
              {message.attachments
                .filter((attachment) => attachment.url)
                .map((attachment) => (
                  <Action.OpenInBrowser
                    key={attachment.url}
                    title={`${attachment.downloadable ? 'Download' : 'View'} ${attachment.fileName}`}
                    url={attachment.url!}
                    icon={attachment.downloadable ? Icon.Download : Icon.Eye}
                  />
                ))}
            </ActionPanel.Section>
          )}
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
    void loadInboxMessages();
  }, []);

  const loadInboxMessages = async () => {
    try {
      setIsLoading(true);

      // Call Python server directly to get threads with assignment status
      const result = await callPythonServer('get_inbox_threads', { limit: 50 }) as any;
      
      if (result.status !== 'ok') {
        throw new Error(result.message || 'Failed to fetch threads');
      }

      // Filter for UNASSIGNED messages (can_assign === true)
      const unassignedMessages = result.threads.filter((thread: any) => thread.can_assign === true);

      // Convert to NPIDInboxMessage format
      const messages: NPIDInboxMessage[] = unassignedMessages.map((thread: any) => ({
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
        status: 'unassigned',
        timestamp: thread.timestamp,
        timeStampDisplay: null,
        timeStampIso: null,
        is_reply_with_signature: false,
        isUnread: true,
        stage: undefined,
        videoStatus: undefined,
        canAssign: true,
        attachments: [],
        athleteLinks: undefined,
      }));

      await showToast({
        style: messages.length > 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: `Found ${messages.length} assignable messages`,
        message: messages.length === 0 ? 'All threads are assigned' : 'Ready to assign',
      });

      setMessages(messages);
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

  const handleAssignTask = async (message: NPIDInboxMessage) => {
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Preparing assignment…' });

    try {
      const { modal: modalData, contacts: preloadedContacts } = await fetchAssignmentModal(
        message.id,
      );
      const searchValue = modalData.contactSearchValue || message.email || message.name;
      const { contacts, searchForUsed } = await resolveContactsForAssignment(
        searchValue,
        modalData.defaultSearchFor,
      );

      const contactPool = contacts.length > 0 ? contacts : preloadedContacts;

      if (contactPool.length === 0) {
        toast.style = Toast.Style.Failure;
        toast.title = 'No contacts found';
        toast.message = 'Try searching manually on the website.';
        return;
      }

      toast.hide();

      push(
        <AssignmentModal
          message={message}
          modalData={modalData}
          contacts={contactPool}
          searchFor={searchForUsed}
          onAssign={async ({ ownerId, stage, status, contact, searchFor }) => {
            const assigningToast = await showToast({
              style: Toast.Style.Animated,
              title: 'Assigning…',
            });

            try {
              const payload: AssignVideoTeamPayload = {
                messageId: message.id,
                contactId: contact.contactId,
                athleteMainId: contact.athleteMainId,
                ownerId,
                stage,
                status,
                searchFor,
                formToken: modalData.formToken,
                contact: message.email,
              };

              await assignVideoTeamMessage(payload);
              const ownerName =
                modalData.owners.find((owner) => owner.value === ownerId)?.label ??
                'Jerami Singleton';

              assigningToast.style = Toast.Style.Success;
              assigningToast.title = 'Assigned to Video Team';
              assigningToast.message = `${message.name} → ${ownerName}`;

              pop();
              await loadInboxMessages();
            } catch (error) {
              assigningToast.style = Toast.Style.Failure;
              assigningToast.title = 'Assignment failed';
              assigningToast.message = error instanceof Error ? error.message : 'Unknown error';
            }
          }}
          onCancel={pop}
        />,
      );
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Unable to load assignment modal';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
    }
  };

  const handleViewMessage = (message: NPIDInboxMessage) => {
    push(<EmailContentDetail message={message} onBack={pop} onAssign={handleAssignTask} />);
  };

  return (
    <List
      isLoading={isLoading}
      navigationTitle="NPID Inbox (Unassigned)"
      searchBarPlaceholder="Search subject or contact"
    >
      {messages.map((message) => {
        const hasAttachments = message.attachments && message.attachments.length > 0;
        const downloadableCount =
          message.attachments?.filter((att) => att.downloadable && att.url).length || 0;

        const accessories = [
          { text: formatTimestamp(message) },
          ...(hasAttachments
            ? [
                {
                  icon: Icon.Paperclip,
                  tooltip: `${message.attachments?.length} attachment(s), ${downloadableCount} downloadable`,
                },
              ]
            : []),
        ];

        return (
          <List.Item
            key={message.id}
            icon={{ source: Icon.Plus, tintColor: Color.Red }}
            title={message.name || 'Unknown Sender'}
            subtitle={message.subject}
            accessories={accessories}
            keywords={[message.subject, message.preview, message.email]}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  <Action
                    title="View Thread"
                    icon={Icon.Eye}
                    onAction={() => handleViewMessage(message)}
                  />
                  <Action
                    title="Assign to Video Team"
                    icon={Icon.PersonCircle}
                    onAction={() => handleAssignTask(message)}
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
                  <Action
                    title="Reload Inbox"
                    icon={Icon.ArrowClockwise}
                    onAction={() => void loadInboxMessages()}
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
