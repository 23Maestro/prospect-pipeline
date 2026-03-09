import { Action, ActionPanel, Clipboard, Form, List, Toast, showToast } from '@raycast/api';
import { useEffect, useState } from 'react';
import { AthleteNote } from '../types/video-team';
import { fetchAthleteNotes, addAthleteNote } from '../lib/npid-mcp-adapter';
import { notesLogger } from '../lib/logger';

interface AthleteNotesListProps {
  athleteId: string;
  athleteMainId: string;
  athleteName?: string;
}

export function AthleteNotesList({ athleteId, athleteMainId, athleteName }: AthleteNotesListProps) {
  const [notes, setNotes] = useState<AthleteNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      notesLogger.info('NOTES_LIST_LOAD_START', { athleteId, athleteMainId, athleteName });
      setIsLoading(true);
      try {
        const data = await fetchAthleteNotes(athleteId, athleteMainId);
        notesLogger.info('NOTES_LIST_LOAD_SUCCESS', {
          count: data.length,
          athleteId,
          athleteMainId,
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
    >
      {notes.length === 0 ? (
        <List.EmptyView title="No notes found" description="Add a note from the previous screen." />
      ) : (
        notes.map((note, index) => (
          <AthleteNoteItem key={`${note.title}-${index}`} note={note} index={index} />
        ))
      )}
    </List>
  );
}

function AthleteNoteItem({ note, index }: { note: AthleteNote; index: number }) {
  const hudlCredentials = parseHudlNote(note);

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
          {hudlCredentials && (
            <ActionPanel.Section title="Hudl">
              <Action
                title="Paste Email"
                onAction={async () => {
                  await Clipboard.paste(hudlCredentials.email);
                }}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'e' }}
              />
              <Action
                title="Paste Password"
                onAction={async () => {
                  await Clipboard.paste(hudlCredentials.password);
                }}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
              />
            </ActionPanel.Section>
          )}
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

function parseHudlNote(note: AthleteNote): { email: string; password: string } | null {
  if ((note.title || '').trim().toLowerCase() !== 'hudl') {
    return null;
  }

  const lines = (note.description || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return null;
  }

  const [email, password] = lines;
  const isEmail = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email);
  if (!isEmail || !password) {
    return null;
  }

  return { email, password };
}
