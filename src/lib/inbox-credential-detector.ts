export type HudlCredentialTier = "high" | "medium" | "low" | "none";

export interface HudlCredentialDetection {
  tier: HudlCredentialTier;
  emailOrUsername?: string;
  password?: string;
}

const USER_LABEL_RE =
  /\b(?:email|username|user|login|hudl(?:\s+email)?)(?:\s+is)?\s*[-:]?\s*([^\s]+)/gi;
const PASSWORD_LABEL_RE = /\b(?:password|pass|pw)(?:\s+is)?\s*[-:]?\s*([^\s]+)/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function normalizeCredentialToken(value: string): string {
  return value.trim().replace(/[>,.;:)}\]]+$/, "").replace(/^[[(<{]+/, "");
}

function findLabeledValue(regex: RegExp, content: string): string | undefined {
  const match = regex.exec(content);
  regex.lastIndex = 0;
  return match?.[1] ? normalizeCredentialToken(match[1]) : undefined;
}

function looksLikePassword(value: string): boolean {
  if (!value || value.length < 6) return false;
  const hasLetter = /[A-Za-z]/.test(value);
  const hasDigitOrSymbol = /[\d@$!%*#?&._-]/.test(value);
  return hasLetter && hasDigitOrSymbol;
}

export function detectHudlCredentials(content: string): HudlCredentialDetection {
  if (!content) {
    return { tier: "none" };
  }

  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const labeledUser = findLabeledValue(USER_LABEL_RE, normalized);
  const labeledPassword = findLabeledValue(PASSWORD_LABEL_RE, normalized);
  if (labeledUser && labeledPassword) {
    return {
      tier: "high",
      emailOrUsername: labeledUser,
      password: labeledPassword,
    };
  }

  const emailMatch = normalized.match(EMAIL_RE)?.[0];
  if (emailMatch && labeledPassword) {
    return {
      tier: "medium",
      emailOrUsername: normalizeCredentialToken(emailMatch),
      password: labeledPassword,
    };
  }

  if (labeledUser) {
    const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
    const labeledLineIndex = lines.findIndex((line) => line.toLowerCase().includes(labeledUser.toLowerCase()));
    if (labeledLineIndex >= 0) {
      const nearby = lines.slice(labeledLineIndex, labeledLineIndex + 3).join(" ");
      const passwordCandidate = nearby.match(
        /\b(?:password|pass|pw)?\s*[-:]?\s*([^\s]+)/i,
      )?.[1];
      const cleanedCandidate = passwordCandidate ? normalizeCredentialToken(passwordCandidate) : "";
      if (cleanedCandidate && cleanedCandidate.toLowerCase() !== labeledUser.toLowerCase() && looksLikePassword(cleanedCandidate)) {
        return {
          tier: "medium",
          emailOrUsername: labeledUser,
          password: cleanedCandidate,
        };
      }
    }
  }

  return { tier: "none" };
}
