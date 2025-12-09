import {
  Action,
  ActionPanel,
  Cache,
  Color,
  Detail,
  Form,
  Icon,
  List,
  Toast,
  showToast,
  useNavigation,
} from '@raycast/api';
import { useEffect, useMemo, useState } from 'react';
import {
  assignVideoTeamMessage,
  fetchAssignmentDefaults,
  fetchAssignmentModal,
  fetchInboxThreads,
  fetchMessageDetail,
  resolveContactsForAssignment,
  sendInboxReply,
} from './lib/npid-mcp-adapter';
import { hydrateThreadTimestamps } from './lib/inbox-timestamps';
import {
  AssignVideoTeamPayload,
  NPIDInboxMessage,
  VideoTeamAssignmentModal,
  VideoTeamContact,
  VideoTeamSearchCategory,
} from './types/video-team';
import { TaskStage, TaskStatus } from './types/workflow';

function formatTimestamp(message: NPIDInboxMessage): string {
  if (message.timeStampDisplay) {
    return message.timeStampDisplay.replace('|', '•').trim();
  }

  if (message.timeStampIso) {
    const parsed = new Date(message.timeStampIso);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  }

  if (message.timestamp) {
    return message.timestamp.replace('|', '•').trim();
  }

  return 'Unknown time';
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
    () => modalData.defaultOwner?.value ?? modalData.owners[0]?.value ?? '1408164',
    [modalData.defaultOwner, modalData.owners],
  );

  const initialContactId = useMemo(
    () => modalData.contactTask || contacts[0]?.contactId || '',
    [modalData.contactTask, contacts],
  );

  const initialStage = useMemo(() => {
    return (modalData.stages[0]?.value as TaskStage) || '';
  }, [modalData.stages]);

  const initialStatus = useMemo(() => {
    return (modalData.videoStatuses[0]?.value as TaskStatus) || '';
  }, [modalData.videoStatuses]);

  const [ownerId, setOwnerId] = useState<string>(initialOwnerId);
  const [contactId, setContactId] = useState<string>(initialContactId);
  const [stage, setStage] = useState<TaskStage>(initialStage);
  const [status, setStatus] = useState<TaskStatus>(initialStatus);
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false);

  const contactLookup = useMemo(
    () => new Map(contacts.map((contact) => [contact.contactId, contact])),
    [contacts],
  );

  useEffect(() => {
    const selected = contactLookup.get(contactId);

    // Reset to modal defaults while we load overrides for this contact
    const fallbackStage = (modalData.stages[0]?.value as TaskStage) || ('' as TaskStage);
    const fallbackStatus = (modalData.videoStatuses[0]?.value as TaskStatus) || ('' as TaskStatus);
    setStage(fallbackStage);
    setStatus(fallbackStatus);

    const athleteId = selected?.athleteMainId ?? modalData.athleteMainId ?? null;
    if (!selected || !athleteId) {
      return;
    }

    const currentContactId = selected.contactId;
    setIsLoadingDefaults(true);
    fetchAssignmentDefaults(selected.contactId)
      .then((defaults) => {
        if (currentContactId !== contactId) {
          return;
        }
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
  }, [contactId, contactLookup, modalData.athleteMainId, modalData.stages, modalData.videoStatuses]);

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
            icon="✅"
            onSubmit={handleAssignment}
          />
          <Action title="Cancel" icon="❌" onAction={onCancel} />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Contact type"
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
            title={contact.name || contact.email || contact.contactId}
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
      await sendInboxReply(message.id, message.itemCode || message.id, replyText.trim());
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
            <Action title="Cancel" onAction={onBack} icon={Icon.XMarkCircle} />
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



function EmailContentDetail({
  message,
  onBack,
  onAssign,
  onReply,
}: {
  message: NPIDInboxMessage;
  onBack: () => void;
  onAssign: (message: NPIDInboxMessage) => void;
  onReply: (message: NPIDInboxMessage) => void;
}) {
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailedTimestamp, setDetailedTimestamp] = useState<string>('');

  useEffect(() => {
    const loadFullMessage = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const details = await fetchMessageDetail(message.id, message.itemCode || message.id);

        if (details && details.content) {
          setFullContent(details.content);
          if (details.timestamp) {
            setDetailedTimestamp(details.timestamp);
          }
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

  const received = formatTimestamp(message);
  const displayTimestamp = detailedTimestamp || received;

  const metadata = (
    <Detail.Metadata>
      <Detail.Metadata.Label title="Name" text={message.name || 'Unknown'} />
      <Detail.Metadata.Label title="Email" text={message.email || 'No email'} />
      <Detail.Metadata.Separator />
      <Detail.Metadata.Label title="Received" text={displayTimestamp} />
      {message.stage && (
        <Detail.Metadata.Label title="Stage" text={message.stage} />
      )}
      {message.videoStatus && (
        <Detail.Metadata.Label title="Status" text={message.videoStatus} />
      )}
      {message.attachments && message.attachments.length > 0 && (
        <Detail.Metadata.Label
          title="Attachments"
          text={message.attachments.map((attachment) => attachment.fileName).join(', ')}
        />
      )}
    </Detail.Metadata>
  );

  const contentToDisplay = isLoading
    ? 'Loading full message...'
    : fullContent || message.preview || 'No content available';

  // Clean markdown - email details are in the metadata sidebar
  const markdown = `# ${message.subject}\n\n---\n\n${contentToDisplay}${error ? `\n\n> ⚠️ ${error}` : ''}`;

  return (
    <Detail
      navigationTitle={message.subject}
      markdown={markdown}
      metadata={metadata}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action
              title="Assign to Video Team"
              icon="✅"
              onAction={() => onAssign(message)}
            />
            <Action
              title="Reply to Email"
              icon="📧"
              onAction={() => onReply(message)}
              shortcut={{ modifiers: ['cmd'], key: 'return' }}
            />
            <Action title="Back to Inbox" icon="⬅️" onAction={onBack} />
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
  const cache = new Cache();

  useEffect(() => {
    void loadInboxMessages();
  }, []);

  const loadInboxMessages = async () => {
    try {
      setIsLoading(true);

      const cached = cache.get('inbox_threads');
      if (cached) {
        setMessages(JSON.parse(cached) as NPIDInboxMessage[]);
      }

      await reloadFromServer(Boolean(cached));
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to load inbox',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      setIsLoading(false);
    }
  };

  const reloadFromServer = async (silent = false) => {
    const toast = silent
      ? null
      : await showToast({ style: Toast.Style.Animated, title: 'Fetching inbox…' });
    try {
      setIsLoading(true);

      const threads = await fetchInboxThreads(15, 'unassigned');
      const hydrated = await hydrateThreadTimestamps(threads);

      const now = Date.now();
      cache.set('inbox_threads', JSON.stringify(hydrated));
      cache.set('inbox_threads_time', now.toString());

      if (toast) {
        toast.style = hydrated.length > 0 ? Toast.Style.Success : Toast.Style.Failure;
        toast.title = hydrated.length > 0 ? `Found ${hydrated.length} assignable messages` : 'Inbox empty';
        toast.message = hydrated.length === 0 ? 'Inbox Zero! 🎉' : 'Fresh from server';
      }

      setMessages(hydrated);
    } catch (error) {
      if (toast) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Failed to reload inbox';
        toast.message = error instanceof Error ? error.message : 'Unknown error';
      } else {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Failed to reload inbox',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssignTask = async (message: NPIDInboxMessage) => {
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Preparing assignment…' });

    try {
      const { modal: modalData, contacts: preloadedContacts } = await fetchAssignmentModal(
        message.id,
        message.itemCode,
      );

      if (!modalData) {
        throw new Error('Failed to load assignment modal data');
      }

      const searchValue = modalData.contactSearchValue || message.email || message.name;
      const { contacts, searchForUsed } = await resolveContactsForAssignment(
        searchValue,
        modalData.defaultSearchFor,
      );

      const usedSearchResults = contacts.length > 0;
      let contactPool = usedSearchResults ? contacts : preloadedContacts;

      const fallbackContact: VideoTeamContact | null =
        modalData.contactTask && (modalData.athleteMainId || message.athleteMainId)
          ? {
            contactId: modalData.contactTask,
            athleteMainId: modalData.athleteMainId ?? message.athleteMainId ?? null,
            name: message.name || message.email || modalData.contactTask,
            sport: null,
            gradYear: null,
            state: null,
            top500: null,
            videoEditor: null,
            email: message.email,
          }
          : null;

      if (
        fallbackContact &&
        !contactPool.some((contactOption) => contactOption.contactId === fallbackContact.contactId)
      ) {
        contactPool = [...contactPool, fallbackContact];
      }

      // EDGE CASE: Parent email with NO database match
      // Open browser for manual parent search
      if (contactPool.length === 0) {
        const assignUrl = `https://dashboard.nationalpid.com/rulestemplates/template/assignemailtovideoteam?message_id=${message.id}`;

        toast.style = Toast.Style.Failure;
        toast.title = 'No contacts found';
        toast.message = 'Opening browser - select Parent and click Search';

        // Open browser directly
        const { exec } = require('child_process');
        exec(`open "${assignUrl}"`);
        return;
      }

      const effectiveSearchFor = usedSearchResults ? searchForUsed : modalData.contactFor;

      toast.hide();

      push(
        <AssignmentModal
          message={message}
          modalData={modalData}
          contacts={contactPool}
          searchFor={effectiveSearchFor}
          onAssign={async ({ ownerId, stage, status, contact, searchFor }) => {
            const assigningToast = await showToast({
              style: Toast.Style.Animated,
              title: 'Assigning…',
            });

            try {
              const resolvedOwnerId = ownerId || '1408164';

              const payload: AssignVideoTeamPayload = {
                messageId: message.id,
                contactId: contact.contactId,
                contact_id: contact.contactId,
                athleteMainId:
                  contact.athleteMainId ??
                  modalData.athleteMainId ??
                  (message as NPIDInboxMessage & { athleteMainId: string | null }).athleteMainId ??
                  null,
                ownerId: resolvedOwnerId,
                stage: (stage || ('' as TaskStage)) as TaskStage,
                status: (status || ('' as TaskStatus)) as TaskStatus,
                searchFor,
                formToken: modalData.formToken,
                contact: contact.email ?? message.email,
              };

              const result = await assignVideoTeamMessage(payload);

              // Store athlete_main_id in SQLite cache if available
              if (result.contact_id && result.athlete_main_id) {
                const { cacheAthleteMainId } = await import('./lib/video-progress-cache');
                await cacheAthleteMainId(parseInt(result.contact_id), result.athlete_main_id);
              }

              const ownerName =
                modalData.owners.find((owner) => owner.value === resolvedOwnerId)?.label ??
                'Jerami Singleton';

              assigningToast.style = Toast.Style.Success;
              assigningToast.title = 'Assigned to Video Team';
              assigningToast.message = `${message.name} → ${ownerName}`;

              pop();
              await reloadFromServer();
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
    push(
      <EmailContentDetail
        message={message}
        onBack={pop}
        onAssign={handleAssignTask}
        onReply={(msg) => push(<ReplyForm message={msg} onBack={pop} />)}
      />,
    );
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
                icon: '📎',
                tooltip: `${message.attachments?.length} attachment(s), ${downloadableCount} downloadable`,
              },
            ]
            : []),
        ];

        return (
          <List.Item
            key={message.id}
            icon={{ source: Icon.Plus, tintColor: Color.Green }}
            title={message.name || 'Unknown Sender'}
            accessories={accessories}
            keywords={[message.subject, message.preview, message.email, message.name]}
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
                    icon='/Users/singleton23/Raycast/prospect-pipeline/assets/add-video-task.png'
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
                          icon='📥'
                        />
                      ))}
                  </ActionPanel.Section>
                )}

                <ActionPanel.Section>
                  <Action
                    title="🔄 Refresh (Quick)"
                    icon={Icon.RotateClockwise}
                    shortcut={{ modifiers: ['cmd'], key: 'r' }}
                    onAction={() => void loadInboxMessages()}
                  />
                  <Action
                    title="🌐 Reload from Server"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
                    onAction={() => void reloadFromServer()}
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
