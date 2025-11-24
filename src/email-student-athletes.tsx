import React, { useEffect, useState } from 'react';
import { Form, ActionPanel, Action, showToast, Toast, LaunchProps } from '@raycast/api';
import { useForm, FormValidation } from '@raycast/utils';
import { callPythonServer } from './lib/python-server-client';

interface EmailFormValues {
  athleteName: string;
  contactId?: string;
  emailTemplate: string;
}

interface NPIDPlayer {
  name: string;
  player_id: string;
  grad_year?: number;
  high_school?: string;
  athlete_main_id?: string;
}

async function searchVideoProgressPlayer(query: string): Promise<NPIDPlayer[]> {
  const nameParts = query.split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  try {
    const results = await callPythonServer<any[]>('search_video_progress', { first_name: firstName, last_name: lastName });
    return results.map((player) => ({
      name: player.athletename,
      player_id: player.athlete_id?.toString(),
      grad_year: player.grad_year,
      high_school: player.high_school,
      athlete_main_id: player.athlete_main_id,
    }));
  } catch (err) {
    console.error('NPID video progress search error:', err);
    return [];
  }
}

// Default templates in case API call fails
const DEFAULT_EMAIL_TEMPLATES = [
  { title: 'Editing Done', value: 'Editing Done' },
  { title: 'Video Instructions', value: 'Video Instructions' },
  { title: 'Hudl Login Request', value: 'Hudl Login Request' },
  {
    title: 'Uploading Video Directions to Dropbox',
    value: 'Uploading Video Directions to Dropbox',
  },
  { title: 'Your Video Editing is Underway', value: 'Your Video Editing is Underway' },
  { title: 'Editing Done: Ad Removed', value: 'Editing Done: Ad Removed' },
  { title: 'Video Guidelines', value: 'Video Guidelines' },
  { title: 'Revisions', value: 'Revisions' },
];

export default function EmailStudentAthletesCommand(
  props: LaunchProps<{ draftValues: EmailFormValues }>,
) {
  const [emailTemplates, setEmailTemplates] = useState<Array<{ title: string; value: string }>>(DEFAULT_EMAIL_TEMPLATES);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<NPIDPlayer | null>(null);

  // Fetch email templates from NPID dashboard on component mount
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        setIsLoadingTemplates(true);
        // Fetch templates from NPID client (use empty contact_id to get defaults)
        const templates = await callPythonServer<any[]>('get_email_templates', { contact_id: '' });
        if (templates && templates.length > 0) {
          const formattedTemplates = templates.map((t: any) => ({
            title: t.label || t.value || 'Unknown Template',
            value: t.value || t.label || 'Unknown',
          }));
          setEmailTemplates(formattedTemplates);
        }
      } catch (error) {
        console.log('Failed to load email templates from NPID client, using defaults:', error);
        // Keep default templates if API call fails
      } finally {
        setIsLoadingTemplates(false);
      }
    };

    loadTemplates();
  }, []);

  const { handleSubmit, itemProps, reset } = useForm<EmailFormValues>({
    async onSubmit(formValues) {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Sending email...',
      });

      try {
        await toast.show();
        toast.title = 'Sending email via NPID...';
        toast.message = `Template: ${formValues.emailTemplate}`;

        const result = await callPythonServer<{ success?: boolean; error?: string }>('send_email_to_athlete', {
          athlete_name: formValues.athleteName,
          template_name: formValues.emailTemplate,
        });

        if (result && (result as any).success) {
          toast.style = Toast.Style.Success;
          toast.title = 'Email sent';
          toast.message = `Sent "${formValues.emailTemplate}" to ${formValues.athleteName}`;
          reset();
        } else {
          toast.style = Toast.Style.Failure;
          toast.title = 'Email send failed';
          toast.message = (result as any).error || 'NPID client did not return success';
        }
      } catch (error: unknown) {
        console.error('Execution error:', error);
        toast.style = Toast.Style.Failure;
        toast.title = 'Failed to send email';
        if (error instanceof Error) {
          toast.message = error.message || 'An unexpected error occurred.';
        } else {
          toast.message = 'An unexpected error occurred.';
        }
        if (typeof error === 'object' && error !== null) {
          if ('stdout' in error && (error as { stdout: unknown }).stdout) {
            console.error('Error stdout:', (error as { stdout: unknown }).stdout);
          }
          if ('stderr' in error && (error as { stderr: unknown }).stderr) {
            console.error('Error stderr:', (error as { stderr: unknown }).stderr);
          }
        }
      }
    },
    validation: {
      athleteName: FormValidation.Required,
      emailTemplate: FormValidation.Required,
    },
    initialValues: props.draftValues || {
      athleteName: '',
      emailTemplate: emailTemplates[0].value, // Default to the first option
    },
  });

  // Mirror video-updates.tsx: search dynamically on athlete name change and auto-select first result
  useEffect(() => {
    const searchPlayers = async () => {
      if (itemProps.athleteName.value && itemProps.athleteName.value.length > 2) {
        setIsSearching(true);
        try {
          const results = await searchVideoProgressPlayer(itemProps.athleteName.value);
          if (results.length > 0) {
            setSelectedPlayer(results[0]);
          } else {
            setSelectedPlayer(null);
          }
        } catch (error) {
          console.error('Search error:', error);
          setSelectedPlayer(null);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSelectedPlayer(null);
      }
    };

    const timeoutId = setTimeout(searchPlayers, 500);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemProps.athleteName.value]);

  return (
    <Form
      enableDrafts
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Email" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Enter athlete details and select an email template to send via NPID." />
      <Form.Separator />

      <Form.TextField
        title="Student Athlete's Name"
        placeholder="Enter full name"
        {...itemProps.athleteName}
        autoFocus
      />

      {isSearching && (
        <Form.Description text="🔍 Searching NPID database..." />
      )}

      {selectedPlayer && (
        <Form.Description
          text={`Selected: ${selectedPlayer.name} (${selectedPlayer.grad_year || 'N/A'}) - ${selectedPlayer.high_school || 'N/A'} | ID: ${selectedPlayer.player_id}`}
        />
      )}

      <Form.Dropdown title="Email Template" {...itemProps.emailTemplate} isLoading={isLoadingTemplates}>
        {emailTemplates.map((template) => (
          <Form.Dropdown.Item key={template.value} value={template.value} title={template.title} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}
