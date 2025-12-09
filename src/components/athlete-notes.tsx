import { Action, ActionPanel, Form, List, Toast, showToast } from '@raycast/api';
import { useEffect, useState } from 'react';
import { AthleteNote } from '../types/video-team';
import { fetchAthleteNotes, addAthleteNote } from '../lib/npid-mcp-adapter';

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
      setIsLoading(true);
      try {
        const data = await fetchAthleteNotes(athleteId, athleteMainId);
        setNotes(data);
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Failed to load notes',
          message: error instanceof Error ? error.message : 'Unknown error',
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
      navigationTitle={`Athlete Notes • ${athleteName ?? athleteId}`}
      searchBarPlaceholder="Search notes..."
    >
      {notes.length === 0 ? (
        <List.EmptyView title="No notes found" description="Add a note from the previous screen." />
      ) : (
        notes.map((note, index) => (
          <List.Item
            key={`${note.title}-${index}`}
            title={note.title || `Note ${index + 1}`}
            subtitle={note.created_by ? `By ${note.created_by}` : undefined}
            accessories={[
              note.created_at ? { text: formatDate(note.created_at) } : undefined,
              note.metadata ? { text: note.metadata } : undefined,
            ].filter(Boolean) as { text: string }[]}
            detail={
              <List.Item.Detail
                markdown={note.description || '_No description provided_'}
              />
            }
          />
        ))
      )}
    </List>
  );
}

interface AddAthleteNoteFormProps {
  athleteId: string;
  athleteMainId: string;
  athleteName?: string;
  onComplete?: () => void;
}

export function AddAthleteNoteForm({
  athleteId,
  athleteMainId,
  athleteName,
  onComplete,
}: AddAthleteNoteFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
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

    setIsSubmitting(true);
    try {
      await addAthleteNote({
        athleteId,
        athleteMainId,
        title: title.trim(),
        description: description.trim(),
      });
      await showToast({
        style: Toast.Style.Success,
        title: 'Note added',
        message: `${athleteName ?? athleteId}`,
      });
      onComplete?.();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to add note',
        message: error instanceof Error ? error.message : 'Unknown error',
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
      <Form.Description
        text={`Adding note for ${athleteName ?? `athlete ${athleteId}`}`}
      />
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
