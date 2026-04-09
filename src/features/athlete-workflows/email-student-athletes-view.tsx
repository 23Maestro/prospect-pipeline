import React, { useEffect, useState } from 'react';
import { Form, ActionPanel, Action, showToast, Toast, LaunchProps } from '@raycast/api';
import { useForm, FormValidation } from '@raycast/utils';
import * as fs from 'fs';
import {
  buildEditingDoneRecipientPayload,
  DEFAULT_SENDER_EMAIL,
  DEFAULT_SENDER_NAME,
  fetchEmailRecipients,
  fetchEmailTemplateData,
  fetchEmailTemplates,
  sendEmailViaAPI,
} from '../../lib/email-workflow';
import { searchVideoProgressPlayers } from '../../lib/video-progress-player-search';
import type {
  EmailRecipients,
  EmailTemplateOption,
  NPIDVideoProgressPlayer,
} from '../../types/athlete-workflows';

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

export interface EmailStudentAthletesFormValues {
  athleteName: string;
  contactId?: string;
  emailTemplate: string;
}

export type EmailStudentAthletesViewProps = {
  draftValues?: EmailStudentAthletesFormValues;
};

export default function EmailStudentAthletesView(
  props:
    | LaunchProps<{ draftValues: EmailStudentAthletesFormValues }>
    | EmailStudentAthletesViewProps,
) {
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplateOption[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<NPIDVideoProgressPlayer | null>(null);
  const [recipients, setRecipients] = useState<EmailRecipients | null>(null);

  const { handleSubmit, itemProps, reset, setValue } = useForm<EmailStudentAthletesFormValues>({
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
        const templateData = await fetchEmailTemplateData(
          formValues.emailTemplate,
          selectedPlayer.player_id,
        );

        toast.title = 'Sending email via FastAPI...';
        toast.message = `Template ID: ${formValues.emailTemplate}`;

        const recipientPayload = buildEditingDoneRecipientPayload(recipients, {
          respectCheckedParents: true,
        });

        await sendEmailViaAPI({
          athleteId: selectedPlayer.player_id,
          templateId: formValues.emailTemplate,
          senderName: templateData.sender_name || DEFAULT_SENDER_NAME,
          senderEmail: templateData.sender_email || DEFAULT_SENDER_EMAIL,
          subject: templateData.subject || '',
          message: templateData.message || '',
          includeAthlete: recipientPayload.includeAthlete,
          parentIds: recipientPayload.parentIds,
          otherEmail: recipientPayload.otherEmail,
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
          const results = await searchVideoProgressPlayers(itemProps.athleteName.value);
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
        const rec = await fetchEmailRecipients(selectedPlayer.player_id);
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

      {isSearching && <Form.Description text="🔍 Searching NPID database..." />}

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
            title={
              selectedPlayer ? 'No templates available' : 'Search for an athlete to load templates'
            }
          />
        ) : (
          emailTemplates.map((template) => (
            <Form.Dropdown.Item
              key={template.value}
              value={template.value}
              title={template.title}
            />
          ))
        )}
      </Form.Dropdown>
    </Form>
  );
}
