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

type ConfirmationSubmitMode = 'messages_and_contact' | 'copy_message';

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
        <Form.Dropdown.Item value="send_cal_link" title="Send Cal Link" />
      </Form.Dropdown>
    </Form>
  );
}

export function ConfirmationReminderMessageForm(props: {
  navigationTitle: string;
  defaultVariant: ConfirmationFollowUpVariant;
  onSubmit: (values: ConfirmationReminderFormValues, mode: ConfirmationSubmitMode) => Promise<void>;
}) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<ConfirmationFollowUpVariant>(
    props.defaultVariant,
  );
  const primaryActionTitle = selectedVariant === 'confirmation_2' ? 'Msg Only' : 'Msg + Card';

  async function handleSubmit(
    values: ConfirmationReminderFormValues,
    mode: ConfirmationSubmitMode,
  ) {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await props.onSubmit(values, mode);
      if (mode !== 'copy_message') {
        pop();
      }
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: mode === 'copy_message' ? 'Copy failed' : 'Draft failed',
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
            title={isSubmitting ? 'Opening…' : primaryActionTitle}
            onSubmit={(values) =>
              void handleSubmit(values as ConfirmationReminderFormValues, 'messages_and_contact')
            }
          />
          <Action.SubmitForm
            title={isSubmitting ? 'Copying…' : 'Copy Message'}
            onSubmit={(values) =>
              void handleSubmit(values as ConfirmationReminderFormValues, 'copy_message')
            }
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="variant"
        title="Reminder Type"
        value={selectedVariant}
        onChange={(value) => setSelectedVariant(value as ConfirmationFollowUpVariant)}
      >
        <Form.Dropdown.Item value="confirmation_1" title="Confirmation 1" />
        <Form.Dropdown.Item value="confirmation_2" title="Confirmation 2" />
      </Form.Dropdown>
    </Form>
  );
}
