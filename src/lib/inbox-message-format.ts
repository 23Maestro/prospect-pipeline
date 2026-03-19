function stripHtml(value: string): string {
  return value.replace(/<\/?[a-z][^>]*>/gi, ' ');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function sanitizeAthleteName(raw?: string | null): string | null {
  if (!raw) return null;
  const stripped = decodeHtmlEntities(stripHtml(raw));
  const normalized = stripped.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const splitOnDash = normalized.split(' - ')[0]?.trim();
  return splitOnDash || normalized;
}

export function extractFirstName(raw?: string | null): string {
  const cleaned = sanitizeAthleteName(raw);
  if (!cleaned) return '';
  return cleaned.split(/\s+/)[0] || '';
}

export function normalizeInboxDisplayBody(raw: string): string {
  if (!raw) return raw;
  const stripped = decodeHtmlEntities(stripHtml(raw)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const compactedReplyHeaders = stripped
    .replace(/[ \t]*\n[ \t]*(wrote:)/gi, ' $1')
    .replace(
      /(^|\n)(>+\s*)?(On\s+[A-Za-z]{3,9},?\s+[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}(?:\s+at|,)\s+)(.+?)(\s+wrote:)/gi,
      (_match, prefix, quotePrefix, intro, middle, suffix) =>
        `${prefix}${quotePrefix || ''}${intro}${String(middle).replace(/\s+/g, ' ').trim()}${suffix}`,
    );

  const firstReplyHeaderMatch = compactedReplyHeaders.match(
    /(^|\n| )>?\s*On\s+(?:[A-Za-z]{3,9},\s+)?[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}(?:,\s+at|\s+at|,)\s+\d{1,2}:\d{2}\s*[AP]M,?\s+.+?\s+wrote:/i,
  );
  const replyTrimmed = firstReplyHeaderMatch
    ? compactedReplyHeaders.slice(0, firstReplyHeaderMatch.index).trimEnd()
    : compactedReplyHeaders;

  const shouldDropLine = (line: string) => {
    if (!line) return false;
    if (/^Yahoo Mail:/i.test(line)) return true;
    if (/^National Prospect ID#yiv\d+/i.test(line)) return true;
    if (/#yiv\d+/i.test(line)) return true;
    if (/^@media only screen/i.test(line)) return true;
    if (line.includes('{') && line.includes('}') && line.includes(':')) return true;
    if (/^\|+\s*$/.test(line)) return true;
    return false;
  };

  const isSignatureStart = (line: string) => {
    return (
      /^Connect With Us$/i.test(line) ||
      /^NATIONAL PROSPECT ID\b/i.test(line) ||
      /^National Prospect ID\b/i.test(line) ||
      /^About Us\s*\|/i.test(line) ||
      /Unsubscribe/i.test(line) ||
      /Private Policy/i.test(line) ||
      /Terms/i.test(line)
    );
  };

  const cleanedLines: string[] = [];
  for (const rawLine of replyTrimmed.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      cleanedLines.push('');
      continue;
    }
    if (shouldDropLine(line)) {
      continue;
    }
    if (isSignatureStart(line)) {
      break;
    }
    cleanedLines.push(line);
  }

  const cleaned = cleanedLines.join('\n');
  const withLinkBreaks = cleaned.replace(/(https?:\/\/\S+)/g, '\n\n$1\n\n');
  return withLinkBreaks.replace(/\n{3,}/g, '\n\n').trim();
}

export function formatAssignedReplyHeaderLabel(content: string): string {
  if (!content) return content;

  const replyHeaderPattern =
    />?\s*On\s+((?:[A-Za-z]{3,9},\s+)?[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}(?:\s+at|,)\s+\d{1,2}:\d{2}\s*[AP]M)\s+.+?\s+wrote:/gi;

  const withHeaderBoundaries = content
    .replace(/[ \t]*\n[ \t]*(wrote:)/gi, ' $1')
    .replace(/([^\n])(\s+>?\s*On\s+(?:[A-Za-z]{3,9},\s+)?[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}(?:\s+at|,)\s+\d{1,2}:\d{2}\s*[AP]M\s+.+?\s+wrote:)/gi, '$1\n\n$2\n\n');

  const matches = Array.from(withHeaderBoundaries.matchAll(replyHeaderPattern));
  if (matches.length === 0) {
    return withHeaderBoundaries;
  }

  const maxReplyHeaders = 2;
  const visibleMatches = matches.slice(0, maxReplyHeaders);
  const cutoffIndex = matches.length > maxReplyHeaders ? matches[maxReplyHeaders].index : undefined;
  const source = cutoffIndex !== undefined ? withHeaderBoundaries.slice(0, cutoffIndex).trimEnd() : withHeaderBoundaries;

  let formatted = '';
  let cursor = 0;

  for (const match of visibleMatches) {
    const start = match.index ?? 0;
    const header = match[0] ?? '';
    const date = (match[1] ?? '').trim();
    const before = source.slice(cursor, start).replace(/[ \t]+$/g, '');

    formatted += before;
    if (formatted && !formatted.endsWith('\n\n')) {
      formatted += '\n\n';
    }
    formatted += `**Reply** - *${date}*\n\n`;
    cursor = start + header.length;
  }

  formatted += source.slice(cursor).replace(/^[ \t]+/g, '');
  return formatted.replace(/\n\n[ \t]+/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Backward-compatible aliases while inbox workflows migrate to clearer names.
export const normalizeMessageContent = normalizeInboxDisplayBody;
export const formatReplyHeaderLabel = formatAssignedReplyHeaderLabel;
