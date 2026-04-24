import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from '@raycast/api';
import { useState } from 'react';
import type {
  ConfirmationFollowUpVariant,
  VoicemailFollowUpVariant,
} from '../lib/scout-follow-up-templates';

type VoicemailRecipient = {
  id: string;
  label: string;
  name: string;
};

type VoicemailFollowUpFormValues = {
  recipientId: string;
  variant: VoicemailFollowUpVariant;
};

type ConfirmationReminderFormValues = {
  variant: ConfirmationFollowUpVariant;
};

type ConfirmationSubmitMode = 'messages' | 'messages_and_contact';

export function VoicemailFollowUpMessageForm(props: {
  navigationTitle: string;
  recipients: VoicemailRecipient[];
  defaultRecipientId?: string;
  defaultVariant: VoicemailFollowUpVariant;
  onSubmit: (values: VoicemailFollowUpFormValues) => Promise<void>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: VoicemailFollowUpFormValues) {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await props.onSubmit(values);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to build follow-up text',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      navigationTitle={props.navigationTitle}
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isSubmitting ? 'Sending…' : 'Send Message'}
            onSubmit={(values) => void handleSubmit(values as VoicemailFollowUpFormValues)}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="recipientId"
        title="Who Did You Call?"
        defaultValue={props.defaultRecipientId || props.recipients[0]?.id}
      >
        {props.recipients.map((recipient) => (
          <Form.Dropdown.Item
            key={recipient.id}
            value={recipient.id}
            title={`${recipient.label}: ${recipient.name}`}
          />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="variant" title="Follow-Up Type" defaultValue={props.defaultVariant}>
        <Form.Dropdown.Item value="call_attempt_1" title="Attempt 1" />
        <Form.Dropdown.Item value="call_attempt_2" title="Attempt 2" />
        <Form.Dropdown.Item value="call_attempt_3" title="Attempt 3" />
        <Form.Dropdown.Item value="no_show" title="No Show" />
      </Form.Dropdown>
    </Form>
  );
}

export function ConfirmationReminderMessageForm(props: {
  navigationTitle: string;
  defaultVariant: ConfirmationFollowUpVariant;
  onSubmit: (
    values: ConfirmationReminderFormValues,
    mode: ConfirmationSubmitMode,
  ) => Promise<void>;
  secondarySubmitTitle?: string;
}) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: ConfirmationReminderFormValues, mode: ConfirmationSubmitMode) {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await props.onSubmit(values, mode);
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Draft failed',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      navigationTitle={props.navigationTitle}
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isSubmitting ? 'Opening…' : 'Messages'}
            onSubmit={(values) =>
              void handleSubmit(values as ConfirmationReminderFormValues, 'messages')
            }
          />
          {props.secondarySubmitTitle ? (
            <Action.SubmitForm
              title={isSubmitting ? 'Opening…' : props.secondarySubmitTitle}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'enter' }}
              onSubmit={(values) =>
                void handleSubmit(values as ConfirmationReminderFormValues, 'messages_and_contact')
              }
            />
          ) : null}
        </ActionPanel>
      }
    >
      <Form.Dropdown id="variant" title="Reminder Type" defaultValue={props.defaultVariant}>
        <Form.Dropdown.Item value="confirmation_1" title="Confirmation 1" />
        <Form.Dropdown.Item value="confirmation_2" title="Confirmation 2" />
      </Form.Dropdown>
    </Form>
  );
}
