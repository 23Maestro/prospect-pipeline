import React from 'react';
import { Form, ActionPanel, Action, showToast, Toast, LaunchProps } from '@raycast/api';
import { useForm, FormValidation } from '@raycast/utils';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

interface VideoUpdateFormValues {
  athleteName: string;
  youtubeLink: string;
  season: string;
  videoType: string;
}

export default function VideoUpdatesCommand(
  props: LaunchProps<{ draftValues: VideoUpdateFormValues }>,
) {
  const { handleSubmit, itemProps, reset, focus } = useForm<VideoUpdateFormValues>({
    async onSubmit(formValues) {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Processing video update...',
      });

      try {
        const pythonInterpreter = '/usr/local/bin/python3';
        // Use absolute path to the script since we know exactly where it is
        const scriptPath = '/Users/singleton23/Raycast/scout-singleton/scripts/video_updates.py';
        
        // Debug logging
        console.log('Script path:', scriptPath);

        const escapeShellArg = (str: string) => `"${str.replace(/"/g, '\\"')}"`;

        const command = `${escapeShellArg(pythonInterpreter)} ${escapeShellArg(scriptPath)} --athlete_name ${escapeShellArg(formValues.athleteName)} --youtube_link ${escapeShellArg(formValues.youtubeLink)} --season ${escapeShellArg(formValues.season)} --video_type ${escapeShellArg(formValues.videoType)}`;

        await toast.show();
        toast.title = 'Running Python automation...';
        toast.message = 'Opening browser to update profile. This may take a moment...';

        console.log('Executing command:', command);
        const { stdout, stderr } = await execAsync(command);

        console.log('Python script stdout:', stdout);

        if (stderr && stderr.includes('ERROR')) {
          console.error('Python script stderr:', stderr);
          toast.style = Toast.Style.Failure;
          toast.title = 'Automation Error';
          toast.message = stderr.substring(0, 200) + (stderr.length > 200 ? '...' : '');
          return;
        }

        if (stdout.includes('--- VIDEO UPDATE AND EMAIL AUTOMATION COMPLETED SUCCESSFULLY ---')) {
          toast.style = Toast.Style.Success;
          toast.title = 'Video Updated & Email Sent';
          toast.message =
            "The video has been added to the athlete's profile and 'Editing Done' email has been sent.";
          reset();
        } else if (stdout.includes('--- VIDEO UPDATE SUCCESSFUL BUT EMAIL AUTOMATION FAILED ---')) {
          toast.style = Toast.Style.Success;
          toast.title = 'Video Updated';
          toast.message =
            'Video added successfully, but email automation failed. Check logs for details.';
          reset();
        } else if (
          stdout.includes('--- Video Update Script Finished') ||
          stdout.includes('--- VIDEO UPDATE PROCESS COMPLETED SUCCESSFULLY ---')
        ) {
          toast.style = Toast.Style.Success;
          toast.title = 'Video Updated Successfully';
          toast.message = "The video has been added to the athlete's profile.";
          reset();
        } else {
          toast.style = Toast.Style.Failure;
          toast.title = 'Video Update May Have Failed';
          toast.message = 'Check the console logs for details.';
        }
      } catch (error: unknown) {
        console.error('Execution error:', error);
        toast.style = Toast.Style.Failure;
        toast.title = 'Failed to Run Automation';
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
      youtubeLink: (value) => {
        if (!value) return 'The item is required';
        if (
          !value.startsWith('https://www.youtube.com/') &&
          !value.startsWith('https://youtu.be/')
        ) {
          return 'Please enter a valid YouTube link (e.g., https://www.youtube.com/watch?v=... or https://youtu.be/...)';
        }
        return undefined;
      },
      season: FormValidation.Required,
      videoType: FormValidation.Required,
    },
    initialValues: props.draftValues || {
      athleteName: '',
      youtubeLink: '',
      season: 'Junior Season',
      videoType: 'Highlights',
    },
  });

  return (
    <Form
      enableDrafts
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Submit and Run Automation" onSubmit={handleSubmit} />
          <Action
            title="Focus Athlete Name"
            onAction={() => focus('athleteName')}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'a' }}
          />
          <Action
            title="Focus Youtube Link"
            onAction={() => focus('youtubeLink')}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'y' }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Enter the athlete's details to update their video profile and automatically send an 'Editing Done' email. The browser will open automatically to complete both processes." />
      <Form.Separator />

      <Form.TextField
        title="Student Athlete's Name"
        placeholder="Enter full name"
        {...itemProps.athleteName}
        autoFocus
      />
      <Form.TextField
        title="YouTube Link"
        placeholder="e.g., https://www.youtube.com/watch?v=..."
        {...itemProps.youtubeLink}
      />

      <Form.Dropdown title="Season" {...itemProps.season}>
        <Form.Dropdown.Item value="7th Grade Season" title="7th Grade Season" />
        <Form.Dropdown.Item value="8th Grade Season" title="8th Grade Season" />
        <Form.Dropdown.Item value="Freshman Season" title="Freshman Season" />
        <Form.Dropdown.Item value="Sophomore Season" title="Sophomore Season" />
        <Form.Dropdown.Item value="Junior Season" title="Junior Season" />
        <Form.Dropdown.Item value="Senior Season" title="Senior Season" />
      </Form.Dropdown>

      <Form.Dropdown title="Video Type" {...itemProps.videoType}>
        <Form.Dropdown.Item value="Highlights" title="Highlights" />
        <Form.Dropdown.Item value="Skills" title="Skills" />
        <Form.Dropdown.Item value="Highlights | Skills" title="Highlights | Skills" />
      </Form.Dropdown>
    </Form>
  );
}
