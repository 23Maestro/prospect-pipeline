import React, { useEffect, useState } from 'react';
import { Form, ActionPanel, Action, showToast, Toast, LaunchProps } from '@raycast/api';
import { useForm, FormValidation } from '@raycast/utils';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { callVPSBroker } from './lib/vps-broker-adapter';

const execAsync = promisify(exec);

interface EmailFormValues {
  athleteName: string;
  contactId?: string;
  emailTemplate: string;
}

interface EmailTemplate {
  value: string;
  label: string;
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

  // Fetch email templates from VPS broker on component mount
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        setIsLoadingTemplates(true);
        // Fetch templates for a generic contact (templates are usually the same)
        // If contactId is not available, use a default or fetch from all contacts
        const templates = await callVPSBroker<EmailTemplate[]>('get_email_templates', { contact_id: '' });
        if (templates && templates.length > 0) {
          const formattedTemplates = templates.map((t: any) => ({
            title: t.label || t.value || 'Unknown Template',
            value: t.value || t.label || 'Unknown',
          }));
          setEmailTemplates(formattedTemplates);
        }
      } catch (error) {
        console.log('Failed to load email templates from VPS broker, using defaults:', error);
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
        title: 'Processing email automation...',
      });

      try {
        const pythonInterpreter = 'python3';
        // Updated to use current workspace scripts directory
        const workspaceDir = process.cwd();
        const scriptPath = path.join(workspaceDir, 'scripts', 'email_automation.py');

        const escapeShellArg = (str: string) => `"${str.replace(/"/g, '\\"')}"`;

        const command = `${escapeShellArg(pythonInterpreter)} ${escapeShellArg(scriptPath)} --athlete_name ${escapeShellArg(formValues.athleteName)} --template_value ${escapeShellArg(formValues.emailTemplate)}`;

        await toast.show();
        toast.title = 'Running Python email automation...';
        toast.message = 'Opening browser to send email. This may take a moment...';

        console.log('Executing command:', command);
        const { stdout, stderr } = await execAsync(command);

        console.log('Python script stdout:', stdout);

        if (stderr && stderr.includes('ERROR')) {
          console.error('Python script stderr:', stderr);
          toast.style = Toast.Style.Failure;
          toast.title = 'Email Automation Error';
          toast.message = stderr.substring(0, 200) + (stderr.length > 200 ? '...' : '');
          return;
        }

        // Check for a success message from the Python script
        if (stdout.includes('--- Email Process Attempted')) {
          toast.style = Toast.Style.Success;
          toast.title = 'Email Automation Successful';
          toast.message = `Email process attempted for ${formValues.athleteName} with template ${formValues.emailTemplate}.`;
          reset();
        } else {
          toast.style = Toast.Style.Failure;
          toast.title = 'Email Automation May Have Failed';
          toast.message =
            'Script finished, but success message not found. Check console logs for details.';
        }
      } catch (error: unknown) {
        console.error('Execution error:', error);
        toast.style = Toast.Style.Failure;
        toast.title = 'Failed to Run Email Automation';
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
      emailTemplate: emailTemplateOptions[0].value, // Default to the first option
    },
  });

  return (
    <Form
      enableDrafts
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Run Email Automation" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Enter athlete details and select an email template. The browser will open to perform the automation." />
      <Form.Separator />

      <Form.TextField
        title="Student Athlete's Name"
        placeholder="Enter full name"
        {...itemProps.athleteName}
        autoFocus
      />

      <Form.Dropdown title="Email Template" {...itemProps.emailTemplate} isLoading={isLoadingTemplates}>
        {emailTemplates.map((template) => (
          <Form.Dropdown.Item key={template.value} value={template.value} title={template.title} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}
