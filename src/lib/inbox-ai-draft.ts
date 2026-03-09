import { AI, environment } from '@raycast/api';
import { NPIDInboxMessage } from '../types/video-team';
import { detectHudlCredentials } from './inbox-credential-detector';
import { inboxLogger } from './logger';

const FEATURE = 'read-videoteam-inbox.ai-draft';

type DraftResult = {
  category: string;
  reply: string;
  raw: string;
};

function logInfo(event: string, step: string, context?: Record<string, unknown>) {
  inboxLogger.info(event, {
    event,
    step,
    status: 'start',
    feature: FEATURE,
    context: context || {},
  });
}

function logSuccess(event: string, step: string, context?: Record<string, unknown>) {
  inboxLogger.info(event, {
    event,
    step,
    status: 'success',
    feature: FEATURE,
    context: context || {},
  });
}

function logFailure(event: string, step: string, error: string, context?: Record<string, unknown>) {
  inboxLogger.error(event, {
    event,
    step,
    status: 'failure',
    feature: FEATURE,
    error,
    context: context || {},
  });
}

function clean(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\r\n/g, '\n').trim();
  return normalized || null;
}

function buildPrompt(message: NPIDInboxMessage): string {
  const inboundEmail =
    clean(message.content) || clean(message.preview) || '(no inbound email provided)';
  const athleteName = clean(message.name);
  const stage = clean(message.stage);
  const videoStatus = clean(message.videoStatus);
  const hudlDetection = detectHudlCredentials(inboundEmail);
  const hudlReady = hudlDetection.tier === 'high' || hudlDetection.tier === 'medium';

  const systemStateLines = [
    athleteName ? `athlete_name: ${athleteName}` : null,
    stage ? `stage: ${stage}` : null,
    videoStatus ? `video_status: ${videoStatus}` : null,
    `hudl_credentials_detected: ${hudlReady ? 'true' : 'false'}`,
  ].filter(Boolean);

  return `You are a concise email drafting helper for Prospect ID operations.

Your job is NOT to automate email sending.
Your job is to help prepare a short, accurate draft reply based on:
1. the inbound email
2. the known Prospect ID workflow quirks
3. any provided athlete/system state

You must prioritize operational clarity over friendliness.
You must never invent system state.
You must never overexplain.
You must never sound robotic.

-----------------------------------
CORE CONTEXT: PROSPECT ID QUIRKS
-----------------------------------

Prospect ID has several recurring communication issues:

1. Families often confuse "highlighted" with "starred"
- They may believe they completed the task when they have not
- They may say they "highlighted 35 videos" when the system actually requires starring clips or another specific action

2. Automated reminder emails continue until the updated video is fully approved
- This can happen even when the family already submitted everything correctly
- Families may think the reminder means something is still missing
- Do not blame the family
- Do not explain technical backend details
- Clarify whether action is actually required

3. Parent and athlete communication can be messy
- Messages may mix parent actions and athlete actions
- There has been historical confusion between contacts
- If the email is messy, focus on the true next step, not the confusion

4. Many inbound emails are not really asking broad questions
- They are usually one of:
  - status check
  - confusion about reminders
  - confusion about starring/selecting clips
  - login/access confusion
  - revision or edit expectations
  - payment/status confusion
  - frustrated parent escalation

5. The real job of these replies is:
- state correction
- stage clarification
- expectation setting
- reducing back and forth

-----------------------------------
TONE + STYLE RULES
-----------------------------------

- Be concise
- Be direct
- Be calm
- Be operational
- No fluff
- No filler
- No hype
- No exclamation marks
- No bullet points in the final reply
- No signature
- No subject line
- Max 4 sentences
- Prefer 2 to 3 sentences when possible
- Always include a blank line after the greeting

Do not use:
- "underway"
- "no worries"
- "kindly"
- "please note"
- "sorry for the inconvenience"
- "thanks for your patience"

Do not:
- apologize for system behavior
- explain backend architecture
- over-soften
- sound defensive
- blame the family
- repeat the entire inbound message back to them

-----------------------------------
GREETING RULES
-----------------------------------

Default greeting:
Hi {Student Athlete} and family,

If the message is clearly from or for a disgruntled parent and a last name is available:
Mr. {Last Name},
or
Ms. {Last Name},

Do not use "and family" for disgruntled parent replies.

-----------------------------------
DECISION RULES
-----------------------------------

Your first task is to determine the likely email category.

Allowed categories:
- MISSING_SELECTION
- STAR_VS_HIGHLIGHT_CONFUSION
- AUTOMATED_REMINDER_CONFUSION
- LOGIN_CONFUSION
- PAYMENT_PENDING
- REVISION_REQUEST
- STATUS_CHECK
- DISGRUNTLED_PARENT

Category guidance:
- If they mention reminders but claim they already submitted something, likely AUTOMATED_REMINDER_CONFUSION
- If they talk about highlighted clips, starred clips, or selecting top plays, likely STAR_VS_HIGHLIGHT_CONFUSION or MISSING_SELECTION
- If they mention email/password, login, or credentials, likely LOGIN_CONFUSION
- If they are asking where things stand, likely STATUS_CHECK
- If they are upset, accusatory, or sharp in tone, likely DISGRUNTLED_PARENT
- If unclear, default to STATUS_CHECK

-----------------------------------
ACTION RULES
-----------------------------------

Every drafted reply must make 3 things clear:

1. What is true right now
- based on provided system state if available
- if no system state is available, only state what can be safely inferred

2. Whether action is required
- say clearly if they need to do something
- say clearly if no action is needed right now

3. What happens next
- what you will review
- what they should send
- what will stop the reminders
- when they will hear back, if appropriate

If the family believes they completed the task but the system state says otherwise:
- do not accuse them
- state the missing step clearly
- keep it brief

If reminders are still going out but the submission is already received:
- explain that the reminder is automated
- explain that it continues until final approval
- state whether they need to do anything

If they ask about number of highlights:
- a few more than 35 is okay
- do not recommend more than 40
- best plays should come first because coaches usually evaluate quickly

If they ask about stats at the end of a reel:
- yes, stats can be added at the end
- ask them to include or send the stats if needed
- if relevant, ask for the reel name and login credentials in a simple way

If Hudl credentials are present and there is enough information to proceed:
- treat the thread as ready unless provided system state clearly says a required step is still missing
- do not default to star-vs-highlight correction just because clips are mentioned
- extra context from the family does not override the ready state
- use this standard queue-confirmation reply pattern:
  Hi {Student Athlete} and family,

  Thank you for submitting your videos. They’ve been added to our editing queue. Projects are typically completed within 7–10 business days. Please let us know if you have any questions or additional requests.

-----------------------------------
OUTPUT FORMAT
-----------------------------------

Return ONLY this structure:

CATEGORY: <ONE_ALLOWED_CATEGORY>

SUGGESTED_REPLY:
<final email body only>

-----------------------------------
INPUTS
-----------------------------------

inbound_email:
${inboundEmail}

${systemStateLines.length ? `${systemStateLines.join('\n')}\n` : ''}`;
}

function normalizeReplyFormatting(reply: string): string {
  const normalized = reply.replace(/\r\n/g, '\n').trim();
  return normalized.replace(/^(Hi [^\n]+,)\n(?!\n)/, '$1\n\n');
}

function parseDraft(raw: string): DraftResult {
  const normalized = raw.trim();
  const categoryMatch = normalized.match(/CATEGORY:\s*([A-Z_]+)/);
  const replyMatch = normalized.match(/SUGGESTED_REPLY:\s*([\s\S]*)$/);
  const category = categoryMatch?.[1]?.trim() || 'STATUS_CHECK';
  const reply = normalizeReplyFormatting(replyMatch?.[1]?.trim() || normalized);
  return { category, reply, raw: normalized };
}

export async function generateInboxReplyDraft(message: NPIDInboxMessage): Promise<DraftResult> {
  if (!environment.canAccess(AI)) {
    throw new Error('Raycast AI is not available in this environment');
  }

  const prompt = buildPrompt(message);
  logInfo('INBOX_AI_DRAFT_REQUEST', 'ask', {
    messageId: message.id,
    itemCode: message.itemCode || null,
    subjectPreview: message.subject?.slice(0, 120) || null,
    inboundLength: (message.content || message.preview || '').length,
    hasStage: Boolean(message.stage),
    hasVideoStatus: Boolean(message.videoStatus),
  });

  try {
    const raw = await AI.ask(prompt, {
      creativity: 'low',
      model: AI.Model.Anthropic_Claude_Haiku,
    });
    const parsed = parseDraft(raw);
    logSuccess('INBOX_AI_DRAFT_REQUEST', 'ask', {
      messageId: message.id,
      category: parsed.category,
      replyLength: parsed.reply.length,
    });
    return parsed;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Unknown AI draft error';
    logFailure('INBOX_AI_DRAFT_REQUEST', 'ask', messageText, {
      messageId: message.id,
    });
    throw error;
  }
}
