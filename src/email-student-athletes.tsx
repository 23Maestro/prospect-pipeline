import React, { useEffect, useState } from 'react';
import { Form, ActionPanel, Action, showToast, Toast, LaunchProps } from '@raycast/api';
import { useForm, FormValidation } from '@raycast/utils';
import { apiFetch } from './lib/python-server-client';
import * as fs from 'fs';

const LOG_FILE = '/Users/singleton23/raycast_logs/console.log';
function log(...args: any[]) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}`;
  try {
    fs.appendFileSync(LOG_FILE, message + '\n');
  } catch {
    // swallow logging errors to avoid recursion
  }
}

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

interface EmailTemplateOption {
  title: string;
  value: string;
}

interface EmailRecipients {
  athlete: { email?: string | null; checked?: boolean };
  parents: { id: string; email?: string | null; checked?: boolean }[];
  other_email?: string | null;
}
interface EmailRecipients {
  athlete: { email?: string | null; checked?: boolean };
  parents: { id: string; email?: string | null; checked?: boolean }[];
  other_email?: string | null;
}

async function searchVideoProgressPlayer(query: string): Promise<NPIDPlayer[]> {
  const nameParts = query.split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  log('🔍 email searchVideoProgressPlayer called with:', query);
  try {
    const response = await apiFetch('/video/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
      }),
    });

    if (!response.ok) {
      console.error('Video progress search failed with status', response.status);
      log('⚠️ email video progress search failed', response.status);
      return [];
    }

    const data = (await response.json()) as any;
    const results = data.tasks || [];
    log('✅ email search returned', results.length, 'results');

    return results.map((player: any) => ({
      name: player.athletename || player.name,
      player_id: player.athlete_id?.toString(),
      grad_year: player.grad_year,
      high_school: player.high_school,
      athlete_main_id: player.athlete_main_id,
    }));
  } catch (err) {
    console.error('FastAPI video search error:', err);
    log('⚠️ email search error', err);
    return [];
  }
}

async function fetchEmailTemplates(athleteId: string): Promise<EmailTemplateOption[]> {
  log('📧 fetching email templates for athlete', athleteId);
  const response = await apiFetch(`/email/templates/${athleteId}`);
  if (!response.ok) {
    log('⚠️ email templates fetch failed', { status: response.status });
    throw new Error(`Failed to load templates (HTTP ${response.status})`);
  }

  const payload = await response.json();
  const templates = (payload.templates || []) as { label?: string; value?: string }[];
  log('✅ fetched email templates', templates.length);

  return templates
    .filter((template) => template.value)
    .map((template) => ({
      title: template.label || template.value || 'Unknown Template',
      value: template.value as string,
    }));
}

async function fetchRecipients(athleteId: string): Promise<EmailRecipients | null> {
  try {
    log('📧 fetching recipients for athlete', athleteId);
    const resp = await apiFetch(`/email/recipients/${encodeURIComponent(athleteId)}`);
    const json = await resp.json().catch(() => ({})) as any;
    if (!resp.ok) {
      log('⚠️ recipients fetch failed', { status: resp.status, json });
      return null;
    }
    log('✅ recipients fetched', json.recipients);
    return json.recipients as EmailRecipients;
  } catch (err) {
    log('⚠️ recipients fetch error', err);
    return null;
  }
}

async function fetchTemplateData(templateId: string, athleteId: string) {
  log('📄 fetching template data', { templateId, athleteId });
  const response = await apiFetch('/email/template-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template_id: templateId,
      athlete_id: athleteId,
    }),
  });

  if (!response.ok) {
    log('⚠️ template data fetch failed', response.status);
    throw new Error(`Failed to fetch template data (HTTP ${response.status})`);
  }

  const result = (await response.json()) as {
    sender_name: string;
    sender_email: string;
    subject: string;
    message: string;
  };
  log('✅ template data fetched', { hasSubject: Boolean(result.subject), hasMessage: Boolean(result.message) });
  return result;
}

async function sendEmailViaAPI(params: {
  athleteId: string;
  templateId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  message: string;
  parentIds?: string[];
  otherEmail?: string;
}) {
  const response = await apiFetch('/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: params.athleteId,
      template_id: params.templateId,
      notification_from: params.senderName,
      notification_from_email: params.senderEmail,
      notification_subject: params.subject,
      notification_message: params.message,
      include_athlete: true,
      parent_ids: params.parentIds,
      other_email: params.otherEmail,
    }),
  });

  if (!response.ok) {
    log('⚠️ email send failed', response.status);
    throw new Error(`Failed to send email (HTTP ${response.status})`);
  }

  const result = await response.json();
  if (!result?.success) {
    log('⚠️ email send returned non-success', result);
    throw new Error(result?.message || 'Send email request failed');
  }
  log('✅ email send success', { athleteId: params.athleteId, templateId: params.templateId });
}

export default function EmailStudentAthletesCommand(
  props: LaunchProps<{ draftValues: EmailFormValues }>,
) {
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplateOption[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<NPIDPlayer | null>(null);
  const [recipients, setRecipients] = useState<EmailRecipients | null>(null);

  const { handleSubmit, itemProps, reset, setValue } = useForm<EmailFormValues>({
    async onSubmit(formValues) {
      if (!selectedPlayer?.player_id) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'No athlete selected',
          message: 'Search for a student athlete before sending an email.',
        });
        return;
      }

      if (!formValues.emailTemplate) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'No template selected',
          message: 'Choose an email template before sending.',
        });
        return;
      }

      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Sending email...',
      });

      try {
        toast.title = 'Fetching template data...';
        const templateData = await fetchTemplateData(formValues.emailTemplate, selectedPlayer.player_id);

        toast.title = 'Sending email via FastAPI...';
        toast.message = `Template ID: ${formValues.emailTemplate}`;

        await sendEmailViaAPI({
          athleteId: selectedPlayer.player_id,
          templateId: formValues.emailTemplate,
          senderName: templateData.sender_name || 'Prospect ID Video',
          senderEmail: templateData.sender_email || 'videoteam@prospectid.com',
          subject: templateData.subject || '',
          message: templateData.message || '',
          parentIds: (recipients?.parents || []).filter((p) => p.checked !== false).map((p) => p.id),
          otherEmail: recipients?.other_email || 'jholcomb@prospectid.com',
        });

        toast.style = Toast.Style.Success;
        toast.title = 'Email sent';
        toast.message = `Sent template to ${selectedPlayer.name}`;
        reset();
        setSelectedPlayer(null);
        setEmailTemplates([]);
        setValue('emailTemplate', '');
        setRecipients(null);
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
      emailTemplate: '',
    },
  });

  // Mirror video-updates.tsx: search dynamically on athlete name change and auto-select first result
  useEffect(() => {
    const searchPlayers = async () => {
      if (itemProps.athleteName.value && itemProps.athleteName.value.length > 2) {
        setIsSearching(true);
        try {
          log('🔎 email command starting search for', itemProps.athleteName.value);
          const results = await searchVideoProgressPlayer(itemProps.athleteName.value);
          if (results.length > 0) {
            setSelectedPlayer(results[0]);
            log('✅ email command auto-selected', results[0].name, results[0].player_id);
          } else {
            setSelectedPlayer(null);
            log('⚠️ email command no search results');
          }
        } catch (error) {
          console.error('Search error:', error);
          log('⚠️ email command search error', error);
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

  useEffect(() => {
    let isCancelled = false;

    const loadTemplates = async () => {
      if (!selectedPlayer?.player_id) {
        setEmailTemplates([]);
        setValue('emailTemplate', '');
        setRecipients(null);
        return;
      }

      setIsLoadingTemplates(true);
      try {
        log('📧 email command loading templates for', selectedPlayer.player_id);
        const templates = await fetchEmailTemplates(selectedPlayer.player_id);
        const rec = await fetchRecipients(selectedPlayer.player_id);
        if (isCancelled) {
          return;
        }

        setEmailTemplates(templates);
        setRecipients(rec);
        if (templates.length > 0) {
          setValue('emailTemplate', templates[0].value);
        } else {
          setValue('emailTemplate', '');
        }
      } catch (error) {
        console.error('Failed to fetch templates:', error);
        log('⚠️ email command failed to fetch templates', error);
        if (!isCancelled) {
          setEmailTemplates([]);
          setValue('emailTemplate', '');
          await showToast({
            style: Toast.Style.Failure,
            title: 'Failed to load templates',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingTemplates(false);
        }
      }
    };

    void loadTemplates();

    return () => {
      isCancelled = true;
    };
  }, [selectedPlayer?.player_id, setValue]);

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

      <Form.Dropdown
        title="Email Template"
        {...itemProps.emailTemplate}
        isLoading={isLoadingTemplates}
      >
        {emailTemplates.length === 0 ? (
          <Form.Dropdown.Item
            value=""
            title={selectedPlayer ? 'No templates available' : 'Search for an athlete to load templates'}
          />
        ) : (
          emailTemplates.map((template) => (
            <Form.Dropdown.Item key={template.value} value={template.value} title={template.title} />
          ))
        )}
      </Form.Dropdown>
    </Form>
  );
}
