export type ClientMessageBodySource = 'attributedBody' | 'text' | 'empty';
export type ClientMessageEmptyReason =
  | 'none'
  | 'attachment'
  | 'summary'
  | 'payload'
  | 'no_body_fields';

export type ClientMessageBodyDecodeResult = {
  body: string;
  bodySource: ClientMessageBodySource;
  emptyReason: ClientMessageEmptyReason;
  decodedAttributedBody: boolean;
};

export function decodeHexString(hexString: string): string {
  const startPattern: number[] = [0x01, 0x2b];
  const endPattern: number[] = [0x86, 0x84];
  const bytes = hexString.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [];

  let startIndex = -1;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === startPattern[0] && bytes[i + 1] === startPattern[1]) {
      startIndex = i + 2;
      break;
    }
  }
  if (startIndex === -1) return '';

  let endIndex = -1;
  for (let i = startIndex; i < bytes.length - 1; i++) {
    if (bytes[i] === endPattern[0] && bytes[i + 1] === endPattern[1]) {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) return '';

  const relevantBytes = bytes.slice(startIndex, endIndex);
  let result: string;
  try {
    result = new TextDecoder().decode(new Uint8Array(relevantBytes));
  } catch {
    result = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(relevantBytes));
  }

  return result.charCodeAt(0) < 128 ? result.slice(1) : result.slice(3);
}

export function decodeClientMessageBody(message: {
  body?: string | null;
  text?: string | null;
  cache_has_attachments?: boolean | number | null;
  has_attachments?: boolean | number | null;
  has_message_summary?: boolean | number | null;
  has_payload_data?: boolean | number | null;
  associated_message_type?: boolean | number | string | null;
}): ClientMessageBodyDecodeResult {
  const attributedBody = decodeHexString(message.body || '').trim();
  if (attributedBody) {
    return {
      body: attributedBody,
      bodySource: 'attributedBody',
      emptyReason: 'none',
      decodedAttributedBody: true,
    };
  }
  const textBody = String(message.text || '').trim();
  if (textBody) {
    return {
      body: textBody,
      bodySource: 'text',
      emptyReason: 'none',
      decodedAttributedBody: false,
    };
  }
  const emptyReason: ClientMessageEmptyReason =
    message.cache_has_attachments || message.has_attachments
      ? 'attachment'
      : message.has_message_summary
        ? 'summary'
        : message.has_payload_data || message.associated_message_type
          ? 'payload'
          : 'no_body_fields';
  return { body: '', bodySource: 'empty', emptyReason, decodedAttributedBody: false };
}
