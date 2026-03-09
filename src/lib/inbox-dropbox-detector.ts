export interface DropboxRequestDetection {
  detected: boolean;
  signals: string[];
}

const REQUEST_PATTERNS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: 'dropbox', pattern: /\bdropbox\b/i },
  { signal: 'folder', pattern: /\bfolder\b/i },
  { signal: 'upload', pattern: /\bupload(?:ed|ing)?\b/i },
  { signal: 'video files', pattern: /\bvideo files?\b/i },
  { signal: 'video clips', pattern: /\b(?:we\s+have\s+)?video clips?\b/i },
  { signal: 'send files', pattern: /\bsend(?:ing)?\s+(?:the\s+)?files?\b/i },
  { signal: 'need folder', pattern: /\bneed\s+(?:a\s+)?folder\b/i },
  { signal: 'need link', pattern: /\bneed\s+(?:a\s+)?link\b/i },
  { signal: 'where upload', pattern: /\bwhere\s+(?:do|to)\s+i\s+upload\b/i },
];

export function detectDropboxRequest(content: string): DropboxRequestDetection {
  if (!content) {
    return { detected: false, signals: [] };
  }

  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const signals = REQUEST_PATTERNS.filter(({ pattern }) => pattern.test(normalized)).map(
    ({ signal }) => signal,
  );

  return {
    detected: signals.length > 0,
    signals,
  };
}
