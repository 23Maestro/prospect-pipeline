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
  getPreferenceValues,
} from '@raycast/api';
import { format } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { Client } from '@notionhq/client';
import {
  AssignVideoTeamPayload,
  assignVideoTeamMessage,
  fetchAssignmentDefaults,
  fetchAssignmentModal,
  fetchInboxThreads,
  fetchMessageDetail,
  resolveContactsForAssignment,
} from './lib/npid-mcp-adapter';
import { supabase } from './lib/supabase-client';
import { callVPSBroker } from './lib/vps-broker-adapter';
import { callPythonServer } from './lib/python-server-client';
import {
  NPIDInboxMessage,
  VideoTeamAssignmentModal,
  VideoTeamContact,
  VideoTeamSearchCategory,
} from './types/video-team';
import { TaskStage, TaskStatus } from './types/workflow';

/**
 * Sync assignment to Notion database after successful assignment
 * Uses video progress data to update or create Notion entry
 */
async function syncToNotionAfterAssignment(
  athleteName: string,
  athleteId: string,
  ownerName: string
): Promise<void> {
  try {
    const preferences = getPreferenceValues<{ notionToken: string; notionDatabaseId?: string }>();
    if (!preferences.notionToken) {
      console.log('No Notion token configured, skipping sync');
      return;
    }

    // Fetch video progress data for this athlete
    const videoProgress = await callVPSBroker<Array<any>>(
      'get_video_progress',
      { filters: { athlete_name: athleteName } }
    );

    if (!videoProgress || videoProgress.length === 0) {
      console.log('No video progress data found for athlete');
      return;
    }

    // Get the first matching record
    const athleteData = videoProgress[0];

    // Initialize Notion client
    const notion = new Client({ auth: preferences.notionToken });

    // Get the database ID - this should be configurable or from the Notion API
    // For now, use the one from video-updates.tsx pattern
    const databaseId = preferences.notionDatabaseId || '19f4c8bd6c26805b9929dfa8eb290a86';

    // Query existing pages to check if athlete already exists
    const existingPages = await notion.databases.query({
      database_id: databaseId,
    });

    // Two-tier matching to prevent duplicates:
    // Priority 1: Match by PlayerID (if present)
    // Priority 2: Fall back to Name match (case-insensitive)
    let existingPage = null;

    // PRIORITY 1: Try to match by PlayerID URL if athlete_id is available
    if (athleteData.athlete_id) {
      const playerIdUrl = `https://dashboard.nationalpid.com/profile/contacts/${athleteData.athlete_id}`;
      existingPage = existingPages.results.find((page: any) => {
        const pagePlayerId = page.properties?.['PlayerID']?.url || '';
        return pagePlayerId === playerIdUrl;
      });

      if (existingPage) {
        console.log(`Found existing athlete by PlayerID: ${athleteData.athlete_id}`);
      }
    }

    // PRIORITY 2: Fall back to Name match (case-insensitive) if no PlayerID match
    if (!existingPage) {
      existingPage = existingPages.results.find((page: any) => {
        const name = page.properties?.['Athlete Name']?.title?.[0]?.plain_text || '';
        return name.toLowerCase() === athleteName.toLowerCase();
      });

      if (existingPage) {
        console.log(`Found existing athlete by Name: ${athleteName}`);
      }
    }

    // Build properties object with ALL fields from video progress
    const properties: Record<string, any> = {
      // Core Info - use "Athlete Name" for consistency with sync-notion-backfill.tsx
      'Athlete Name': { title: [{ text: { content: athleteData.athletename || athleteName } }] },
      'Athlete ID': { rich_text: [{ text: { content: String(athleteData.athlete_id || athleteId) } }] },
    };

    // Add PlayerID URL if athlete_id is available
    if (athleteData.athlete_id) {
      properties['PlayerID'] = {
        url: `https://dashboard.nationalpid.com/profile/contacts/${athleteData.athlete_id}`
      };
    }

    // Add remaining properties
    Object.assign(properties, {
      // Positions
      'Primary Position': { rich_text: [{ text: { content: athleteData.primaryposition || 'NA' } }] },
      'Secondary Position': { rich_text: [{ text: { content: athleteData.secondaryposition || 'NA' } }] },
      'Third Position': { rich_text: [{ text: { content: athleteData.thirdposition || 'NA' } }] },

      // Progress Tracking
      'Video Progress': { status: { name: athleteData.video_progress || 'In Progress' } },
      Stage: { status: { name: athleteData.stage || 'In Queue' } },
      Status: { status: { name: athleteData.video_progress_status || 'HUDL' } },

      // Timeline
      'Due Date': athleteData.video_due_date
        ? { rich_text: [{ text: { content: athleteData.video_due_date } }] }
        : { rich_text: [{ text: { content: 'N/A' } }] },
      'Assigned Date': { rich_text: [{ text: { content: athleteData.assigned_date || 'N/A' } }] },

      // School/Location
      Sport: { rich_text: [{ text: { content: athleteData.sport_name || 'N/A' } }] },
      School: { rich_text: [{ text: { content: athleteData.high_school || 'N/A' } }] },
      City: { rich_text: [{ text: { content: athleteData.high_school_city || 'N/A' } }] },
      State: { rich_text: [{ text: { content: athleteData.high_school_state || 'N/A' } }] },

      // Class Info
      'Grad Year': { rich_text: [{ text: { content: String(athleteData.grad_year || 'N/A') } }] },

      // Payment/Status
      'Payment Status': { rich_text: [{ text: { content: athleteData.paid_status || 'N/A' } }] },

      // Assignment
      'Video Editor': { rich_text: [{ text: { content: athleteData.assignedvideoeditor || ownerName } }] },
    });

    const pageData = { properties };

    if (existingPage) {
      // Update existing page
      await notion.pages.update({
        page_id: existingPage.id,
        properties: pageData.properties,
      });
      console.log(`Updated Notion page for ${athleteName}`);
    } else {
      // Create new page
      await notion.pages.create({
        parent: { database_id: databaseId },
        ...pageData,
      });
      console.log(`Created Notion page for ${athleteName}`);
    }
  } catch (error) {
    // Log error but don't fail the assignment
    console.error('Failed to sync to Notion:', error);
  }
}

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

function EmailContentDetail({
  message,
  onBack,
  onAssign,
}: {
  message: NPIDInboxMessage;
  onBack: () => void;
  onAssign: (message: NPIDInboxMessage) => void;
}) {
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadFullMessage = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const details = await fetchMessageDetail(message.id, message.itemCode || message.id);

        if (details && details.content) {
          setFullContent(details.content);
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

  const contentToDisplay = isLoading
    ? 'Loading full message...'
    : fullContent || message.preview || 'No content available';

  const markdown = `# ${message.subject}\n\n**From:** ${message.name} (${message.email})\n\n**Date:** ${message.timestamp}\n\n---\n\n${contentToDisplay}${
    error ? `\n\n> ⚠️ ${error}` : ''
  }`;

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
  const cache = new Cache();

  useEffect(() => {
    void loadInboxMessages();
  }, []);

  const loadInboxMessages = async () => {
    try {
      setIsLoading(true);

      // Check cache first (5 minute TTL)
      const cached = cache.get('inbox_threads');
      const cacheTime = cache.get('inbox_threads_time');
      const now = Date.now();
      const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

      if (cached && cacheTime && (now - parseInt(cacheTime)) < CACHE_TTL) {
        const threads = JSON.parse(cached) as NPIDInboxMessage[];
        setMessages(threads);
        setIsLoading(false);
        await showToast({
          style: Toast.Style.Success,
          title: `Loaded ${threads.length} cached messages`,
          message: 'From cache (refresh in settings)',
        });
        return;
      }

      // Fetch ONLY unassigned threads
      const threads = await fetchInboxThreads(15, 'unassigned');

      // Update cache
      cache.set('inbox_threads', JSON.stringify(threads));
      cache.set('inbox_threads_time', now.toString());

      await showToast({
        style: threads.length > 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: `Found ${threads.length} assignable messages`,
        message: threads.length === 0 ? 'All threads are assigned' : 'Ready to assign',
      });

      setMessages(threads);
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

              await assignVideoTeamMessage(payload);
              const ownerName =
                modalData.owners.find((owner) => owner.value === resolvedOwnerId)?.label ??
                'Jerami Singleton';

              assigningToast.style = Toast.Style.Success;
              assigningToast.title = 'Assigned to Video Team';
              assigningToast.message = `${message.name} → ${ownerName}`;

              // Sync to Notion after successful assignment
              try {
                await syncToNotionAfterAssignment(message.name, message.id, ownerName);
              } catch (notionError) {
                console.error('Notion sync failed:', notionError);
                // Don't show error to user - this is optional
              }

              pop();
              await new Promise(resolve => setTimeout(resolve, 2000));
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
            icon={{ source: Icon.Plus, tintColor: Color.Green }}
            title={`${message.name || 'Unknown Sender'} • ${message.subject}`}
            subtitle={message.preview || 'No preview available'}
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
