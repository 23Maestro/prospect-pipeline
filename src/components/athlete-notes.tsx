import { Action, ActionPanel, Clipboard, Form, List, Toast, showToast } from '@raycast/api';
import { useEffect, useMemo, useState } from 'react';
import { AthleteNote } from '../types/video-team';
import { fetchAthleteNotes, addAthleteNote } from '../lib/npid-mcp-adapter';
import { notesLogger } from '../lib/logger';

interface AthleteNotesListProps {
  athleteId: string;
  athleteMainId: string;
  athleteName?: string;
}

type NoteCredentialCandidate = {
  email?: string;
  password?: string;
  sourceTitle?: string;
};

export function AthleteNotesList({ athleteId, athleteMainId, athleteName }: AthleteNotesListProps) {
  const [notes, setNotes] = useState<AthleteNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const credentialCandidate = useMemo(() => resolveHudlCredentialCandidate(notes), [notes]);

  const handlePasteEmail = async () => {
    if (!credentialCandidate.email) {
      notesLogger.warn('NOTES_CREDENTIAL_PASTE_MISSING', {
        event: 'NOTES_CREDENTIAL_PASTE_MISSING',
        step: 'paste_email',
        status: 'failure',
        feature: 'athlete-notes.credentials',
        error: 'email_not_found',
        athleteId,
        athleteMainId,
        sourceTitlePreview: credentialCandidate.sourceTitle?.slice(0, 80) || '',
      });
      await showToast({
        style: Toast.Style.Failure,
        title: 'No email found in notes',
      });
      return;
    }

    notesLogger.info('NOTES_CREDENTIAL_PASTE', {
      event: 'NOTES_CREDENTIAL_PASTE',
      step: 'paste_email',
      status: 'success',
      feature: 'athlete-notes.credentials',
      athleteId,
      athleteMainId,
      sourceTitlePreview: credentialCandidate.sourceTitle?.slice(0, 80) || '',
    });
    await Clipboard.paste(credentialCandidate.email);
  };

  const handlePastePassword = async () => {
    if (!credentialCandidate.password) {
      notesLogger.warn('NOTES_CREDENTIAL_PASTE_MISSING', {
        event: 'NOTES_CREDENTIAL_PASTE_MISSING',
        step: 'paste_password',
        status: 'failure',
        feature: 'athlete-notes.credentials',
        error: 'password_not_found',
        athleteId,
        athleteMainId,
        sourceTitlePreview: credentialCandidate.sourceTitle?.slice(0, 80) || '',
      });
      await showToast({
        style: Toast.Style.Failure,
        title: 'No password found in notes',
      });
      return;
    }

    notesLogger.info('NOTES_CREDENTIAL_PASTE', {
      event: 'NOTES_CREDENTIAL_PASTE',
      step: 'paste_password',
      status: 'success',
      feature: 'athlete-notes.credentials',
      athleteId,
      athleteMainId,
      sourceTitlePreview: credentialCandidate.sourceTitle?.slice(0, 80) || '',
    });
    await Clipboard.paste(credentialCandidate.password);
  };

  useEffect(() => {
    const load = async () => {
      notesLogger.info('NOTES_LIST_LOAD_START', { athleteId, athleteMainId, athleteName });
      setIsLoading(true);
      try {
        const data = await fetchAthleteNotes(athleteId, athleteMainId);
        const resolvedCredentials = resolveHudlCredentialCandidate(data);
        notesLogger.info('NOTES_LIST_LOAD_SUCCESS', {
          event: 'NOTES_LIST_LOAD_SUCCESS',
          step: 'load_notes',
          status: 'success',
          feature: 'athlete-notes.credentials',
          count: data.length,
          athleteId,
          athleteMainId,
          credentialCandidateResolved: Boolean(
            resolvedCredentials.email || resolvedCredentials.password,
          ),
          emailFound: Boolean(resolvedCredentials.email),
          passwordFound: Boolean(resolvedCredentials.password),
          sourceTitlePreview: resolvedCredentials.sourceTitle?.slice(0, 80) || '',
        });
        setNotes(data);
      } catch (error) {
        notesLogger.error('NOTES_LIST_LOAD_FAILURE', {
          athleteId,
          athleteMainId,
          error: error instanceof Error ? error.message : String(error),
        });
        await showToast({
          style: Toast.Style.Failure,
          title: 'Failed to load notes',
          message: error instanceof Error ? error.message : JSON.stringify(error),
        });
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [athleteId, athleteMainId]);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      navigationTitle={`Athlete Notes • ${athleteName ?? athleteId}`}
      searchBarPlaceholder="Search notes..."
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Credentials">
            <Action
              title="Paste Email"
              onAction={handlePasteEmail}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'e' }}
            />
            <Action
              title="Paste Password"
              onAction={handlePastePassword}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      {notes.length === 0 ? (
        <List.EmptyView title="No notes found" description="Add a note from the previous screen." />
      ) : (
        notes.map((note, index) => (
          <AthleteNoteItem
            key={`${note.title}-${index}`}
            note={note}
            index={index}
            onPasteEmail={handlePasteEmail}
            onPastePassword={handlePastePassword}
          />
        ))
      )}
    </List>
  );
}

function AthleteNoteItem({
  note,
  index,
  onPasteEmail,
  onPastePassword,
}: {
  note: AthleteNote;
  index: number;
  onPasteEmail: () => Promise<void>;
  onPastePassword: () => Promise<void>;
}) {
  return (
    <List.Item
      key={`${note.title}-${index}`}
      title={note.title || `Note ${index + 1}`}
      subtitle={note.created_by ? `By ${note.created_by}` : undefined}
      accessories={
        [
          note.created_at ? { text: formatDate(note.created_at) } : undefined,
          note.metadata ? { text: note.metadata } : undefined,
        ].filter(Boolean) as { text: string }[]
      }
      detail={
        <List.Item.Detail
          markdown={note.description || '_No description provided_'}
          metadata={
            <List.Item.Detail.Metadata>
              {note.created_by && (
                <List.Item.Detail.Metadata.Label title="Created By" text={note.created_by} />
              )}
              {note.created_at && (
                <List.Item.Detail.Metadata.Label
                  title="Created At"
                  text={formatDate(note.created_at)}
                />
              )}
              {note.metadata && (
                <List.Item.Detail.Metadata.Label title="Info" text={note.metadata} />
              )}
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Credentials">
            <Action
              title="Paste Email"
              onAction={onPasteEmail}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'e' }}
            />
            <Action
              title="Paste Password"
              onAction={onPastePassword}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

interface AddAthleteNoteFormProps {
  athleteId: string;
  athleteMainId: string;
  athleteName?: string;
  initialTitle?: string;
  initialDescription?: string;
  onComplete?: () => void;
}

export function AddAthleteNoteForm({
  athleteId,
  athleteMainId,
  athleteName,
  initialTitle,
  initialDescription,
  onComplete,
}: AddAthleteNoteFormProps) {
  const [title, setTitle] = useState(initialTitle ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing fields',
        message: 'Please enter both a title and description.',
      });
      return;
    }

    notesLogger.info('NOTES_ADD_SUBMIT_START', {
      athleteId,
      athleteMainId,
      titlePreview: title.slice(0, 100),
      descriptionLength: description.length,
    });
    setIsSubmitting(true);
    try {
      await addAthleteNote({
        athleteId,
        athleteMainId,
        title: title.trim(),
        description: description.trim(),
      });
      notesLogger.info('NOTES_ADD_SUBMIT_SUCCESS', { athleteId, athleteMainId });
      await showToast({
        style: Toast.Style.Success,
        title: 'Note added',
        message: `${athleteName ?? athleteId}`,
      });
      onComplete?.();
    } catch (error) {
      notesLogger.error('NOTES_ADD_SUBMIT_FAILURE', {
        athleteId,
        athleteMainId,
        error: error instanceof Error ? error.message : String(error),
      });
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to add note',
        message: error instanceof Error ? error.message : JSON.stringify(error),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form
      isLoading={isSubmitting}
      navigationTitle={`Add Note • ${athleteName ?? athleteId}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Note" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Adding note for ${athleteName ?? `athlete ${athleteId}`}`} />
      <Form.TextField
        id="title"
        title="Title"
        value={title}
        onChange={setTitle}
        placeholder="Quick summary"
      />
      <Form.TextArea
        id="description"
        title="Description"
        value={description}
        onChange={setDescription}
        placeholder="Detailed note..."
      />
    </Form>
  );
}

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseHudlNote(note: AthleteNote): NoteCredentialCandidate | null {
  const lines = (note.description || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const normalizedTitle = (note.title || '').trim().toLowerCase();
  const normalizedMetadata = (note.metadata || '').trim().toLowerCase();
  const isHudlLike =
    normalizedTitle.includes('hudl') ||
    normalizedMetadata.includes('hudl') ||
    normalizedMetadata.includes('hudl login');

  if (!isHudlLike) {
    return null;
  }

  const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
  const labeledEmailRegex = /^(?:email|username|login|hudl email)\s*[:\-]?\s*(.+)$/i;
  const labeledPasswordRegex = /^(?:password|pass|pw)\s*[:\-]?\s*(.+)$/i;

  let email = '';
  let password = '';

  for (const line of lines) {
    if (!email) {
      const labeledEmail = line.match(labeledEmailRegex);
      if (labeledEmail && emailRegex.test((labeledEmail[1] || '').trim())) {
        email = labeledEmail[1].trim();
        continue;
      }
      if (emailRegex.test(line)) {
        email = line;
        continue;
      }
    }

    if (!password) {
      const labeledPassword = line.match(labeledPasswordRegex);
      if (labeledPassword && labeledPassword[1]?.trim()) {
        password = labeledPassword[1].trim();
        continue;
      }
    }
  }

  if ((!email || !password) && lines.length >= 2) {
    const first = lines[0] || '';
    const second = lines[1] || '';
    if (!email && emailRegex.test(first)) {
      email = first;
    }
    if (!password && second.trim()) {
      password = second.trim();
    }
  }

  if (!email && !password) {
    return null;
  }

  return {
    email,
    password,
    sourceTitle: note.title || note.metadata || 'Hudl',
  };
}

function resolveHudlCredentialCandidate(notes: AthleteNote[]): NoteCredentialCandidate {
  let bestCandidate: NoteCredentialCandidate = {};

  for (const note of notes) {
    const candidate = parseHudlNote(note);
    if (!candidate) continue;

    const next = {
      email: bestCandidate.email || candidate.email,
      password: bestCandidate.password || candidate.password,
      sourceTitle: bestCandidate.sourceTitle || candidate.sourceTitle,
    };

    bestCandidate = next;

    if (bestCandidate.email && bestCandidate.password) {
      return bestCandidate;
    }
  }

  return bestCandidate;
}
