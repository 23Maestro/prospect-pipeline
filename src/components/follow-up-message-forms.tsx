import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from '@raycast/api';
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

export function VoicemailFollowUpMessageForm(props: {
  navigationTitle: string;
  recipients: VoicemailRecipient[];
  defaultRecipientId?: string;
  defaultVariant: VoicemailFollowUpVariant;
  onSubmit: (values: VoicemailFollowUpFormValues) => Promise<void>;
}) {
  async function handleSubmit(values: VoicemailFollowUpFormValues) {
    try {
      await props.onSubmit(values);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to build follow-up text',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <Form
      navigationTitle={props.navigationTitle}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send Message"
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
        <Form.Dropdown.Item value="no_show" title="No Show" />
      </Form.Dropdown>
    </Form>
  );
}

export function ConfirmationReminderMessageForm(props: {
  navigationTitle: string;
  defaultVariant: ConfirmationFollowUpVariant;
  onSubmit: (values: ConfirmationReminderFormValues) => Promise<void>;
}) {
  const { pop } = useNavigation();

  async function handleSubmit(values: ConfirmationReminderFormValues) {
    try {
      await props.onSubmit(values);
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to build confirmation text',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <Form
      navigationTitle={props.navigationTitle}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Open in Messages"
            onSubmit={(values) => void handleSubmit(values as ConfirmationReminderFormValues)}
          />
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
