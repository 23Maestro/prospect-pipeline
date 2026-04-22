import { environment, open } from '@raycast/api';

type MessagesClientInboxLaunchContext = {
  chatIdentifier?: string;
  draftMessage?: string;
  openThread?: boolean;
  searchText?: string;
};

function getRaycastProtocol() {
  return environment.raycastVersion.includes('alpha') ? 'raycastinternal://' : 'raycast://';
}

function normalizePhoneForMessagesTarget(raw?: string | null): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

export async function openMessagesServiceClientInbox(context: MessagesClientInboxLaunchContext = {}) {
  const normalizedPhone = normalizePhoneForMessagesTarget(context.chatIdentifier);

  if (context.draftMessage && normalizedPhone) {
    await open(
      `${getRaycastProtocol()}extensions/thomaslombart/messages/send-message?launchContext=${encodeURIComponent(
        JSON.stringify({
          normalizedPhone,
          text: context.draftMessage,
          clientOnly: true,
        }),
      )}`,
    );
    return;
  }

  if (context.openThread && normalizedPhone) {
    await open(
      `${getRaycastProtocol()}extensions/thomaslombart/messages/my-messages?launchContext=${encodeURIComponent(
        JSON.stringify({
          normalizedPhone,
          clientOnly: true,
          searchText: normalizedPhone,
        }),
      )}`,
    );
    return;
  }

  await open(
    `${getRaycastProtocol()}extensions/thomaslombart/messages/my-messages?launchContext=${encodeURIComponent(
      JSON.stringify({
        normalizedPhone,
        clientOnly: true,
        searchText: context.searchText || context.chatIdentifier || '',
      }),
    )}`,
  );
}
