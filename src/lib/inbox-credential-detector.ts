export type HudlCredentialTier = "high" | "medium" | "low" | "none";

export interface HudlCredentialDetection {
  tier: HudlCredentialTier;
  emailOrUsername?: string;
  password?: string;
}

const LABELED_EMAIL_RE =
  /\bemail(?:\s+is)?\s*[-:]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const LABELED_LOGIN_RE =
  /\b(?:username|user|login|hudl(?:\s+email)?)\b(?:\s+is)?\s*[-:]?\s*([^\s]+)/gi;
const PASSWORD_LABEL_RE = /\b(?:password|pass|pw)(?:\s+is)?\s*[-:]?\s*([^\s]+)/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const GENERIC_LOGIN_WORDS = new Set([
  "hudl",
  "login",
  "information",
  "info",
  "credentials",
  "credential",
  "details",
]);

function normalizeCredentialToken(value: string): string {
  return value.trim().replace(/[>,.;:)}\]]+$/, "").replace(/^[[(<{]+/, "");
}

function looksLikePassword(value: string): boolean {
  if (!value || value.length < 6) return false;
  const hasLetter = /[A-Za-z]/.test(value);
  const hasDigitOrSymbol = /[\d@$!%*#?&._-]/.test(value);
  return hasLetter && hasDigitOrSymbol;
}

function isRealEmail(value?: string): value is string {
  return !!value && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
}

function collectMatches(regex: RegExp, content: string): string[] {
  const values: string[] = [];
  for (const match of content.matchAll(regex)) {
    const token = normalizeCredentialToken(match[1] ?? match[0] ?? "");
    if (token) {
      values.push(token);
    }
  }
  return values;
}

function findFirstLabeledEmail(content: string): string | undefined {
  const labeledEmails = collectMatches(LABELED_EMAIL_RE, content);
  return labeledEmails.find(isRealEmail);
}

function findFirstGenericLoginEmail(content: string): string | undefined {
  const loginMatches = collectMatches(LABELED_LOGIN_RE, content);
  return loginMatches.find((value) => {
    if (!isRealEmail(value)) return false;
    return !GENERIC_LOGIN_WORDS.has(value.toLowerCase());
  });
}

function findFirstVisibleEmail(content: string): string | undefined {
  const emails = Array.from(content.matchAll(EMAIL_RE))
    .map((match) => normalizeCredentialToken(match[0]))
    .filter(isRealEmail);
  return emails[0];
}

function findFirstPassword(content: string): string | undefined {
  const passwords = collectMatches(PASSWORD_LABEL_RE, content).filter(looksLikePassword);
  return passwords[0];
}

export function detectHudlCredentials(content: string): HudlCredentialDetection {
  if (!content) {
    return { tier: "none" };
  }

  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const labeledEmail = findFirstLabeledEmail(normalized);
  const genericLoginEmail = findFirstGenericLoginEmail(normalized);
  const visibleEmail = labeledEmail || genericLoginEmail || findFirstVisibleEmail(normalized);
  const password = findFirstPassword(normalized);

  if (!visibleEmail || !password) {
    return { tier: "none" };
  }

  if (labeledEmail && password) {
    return {
      tier: "high",
      emailOrUsername: visibleEmail,
      password,
    };
  }

  return {
    tier: "medium",
    emailOrUsername: visibleEmail,
    password,
  };
}
