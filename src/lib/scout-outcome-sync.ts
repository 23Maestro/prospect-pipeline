import { getPreferenceValues } from '@raycast/api';
import { normalizeNotionId, notionRequest } from './notion-call-scripts';
import {
  upsertScoutFollowUpTrackerEntry,
  type LightweightFollowUpTrackerEntry,
} from './scout-follow-up-tracker';
import { resolveSalesLifecycle } from './sales-lifecycle';

const NOTION_CALL_LOG_DATABASE_ID = '11c30e2c-0e8f-40a5-b5a2-48b42fa0820a';

type Preferences = {
  notionToken?: string;
};

type CallLogPage = {
  id: string;
  url?: string;
};

type CallLogOutcome = {
  callResult: 'No Answer' | 'Left VM' | 'Spoke' | 'Follow Up' | 'Meeting Set' | 'Not Interested';
  spoke: boolean;
  meetingSet: boolean;
  trackerStage: string;
};

type SyncScoutOutcomeArgs = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  parent1Name?: string | null;
  parent2Name?: string | null;
  stage: string;
  currentTask?: string | null;
  dueDate?: string | null;
  adminUrl: string;
  taskId?: string | null;
};

type SyncScoutOutcomeResult = {
  trackerPageId: string;
  trackerPageUrl: string;
  callLogPageId?: string | null;
  callLogPageUrl?: string | null;
  loggedCallOutcome: boolean;
  trackerStage: string;
  callResult?: string | null;
};

function getNotionToken(): string {
  const prefs = getPreferenceValues<Preferences>();
  const token = String(prefs.notionToken || '').trim();
  if (!token) {
    throw new Error('Set Notion API Token in Raycast preferences.');
  }
  return token;
}

function titleProperty(value: string) {
  return {
    title: [{ type: 'text', text: { content: value.trim().slice(0, 2000) } }],
  };
}

function richTextProperty(value?: string | null) {
  const content = String(value || '').trim();
  return {
    rich_text: content ? [{ type: 'text', text: { content: content.slice(0, 2000) } }] : [],
  };
}

function selectProperty(value: string) {
  return { select: { name: value } };
}

function checkboxProperty(value: boolean) {
  return { checkbox: value };
}

function normalizeStage(value?: string | null): string {
  return String(value || '').trim();
}

function normalizeTrackerStage(stage: string): string {
  const normalized = normalizeStage(stage);
  if (!normalized) return 'Pending follow-up';
  const lifecycle = resolveSalesLifecycle(normalized);

  if (/^left voice mail 1$/i.test(normalized)) return 'Call Attempt 1';
  if (/^left voice mail 2$/i.test(normalized)) return 'Call Attempt 2';
  if (/called\s*-\s*unable to leave vm/i.test(normalized)) return 'Unable to leave VM';
  if (/confirmation call/i.test(normalized)) return 'Confirmation Call';
  if (lifecycle.normalizedStage === 'meeting_set') return 'Meeting Set';
  if (lifecycle.normalizedStage === 'meeting_follow_up') return 'Spoke To - Follow Up';
  if (lifecycle.normalizedStage === 'closed_lost') return 'Not Interested';
  return normalized;
}

function mapStageToCallLogOutcome(stage: string): CallLogOutcome | null {
  const normalized = normalizeStage(stage);
  if (!normalized) return null;
  const lifecycle = resolveSalesLifecycle(normalized);

  if (lifecycle.normalizedStage === 'meeting_set') {
    return {
      callResult: 'Meeting Set',
      spoke: true,
      meetingSet: true,
      trackerStage: 'Meeting Set',
    };
  }

  if (/left voice mail 1/i.test(normalized)) {
    return {
      callResult: 'Left VM',
      spoke: false,
      meetingSet: false,
      trackerStage: 'Call Attempt 1',
    };
  }

  if (/left voice mail 2/i.test(normalized)) {
    return {
      callResult: 'Left VM',
      spoke: false,
      meetingSet: false,
      trackerStage: 'Call Attempt 2',
    };
  }

  if (/called\s*-\s*unable to leave vm/i.test(normalized) || /unable to leave vm/i.test(normalized)) {
    return {
      callResult: 'No Answer',
      spoke: false,
      meetingSet: false,
      trackerStage: 'Unable to leave VM',
    };
  }

  if (lifecycle.normalizedStage === 'meeting_follow_up') {
    return {
      callResult: 'Follow Up',
      spoke: true,
      meetingSet: false,
      trackerStage: 'Spoke To - Follow Up',
    };
  }

  if (lifecycle.normalizedStage === 'closed_lost') {
    return {
      callResult: 'Not Interested',
      spoke: true,
      meetingSet: false,
      trackerStage: 'Not Interested',
    };
  }

  return null;
}

function buildCallLogKey(args: SyncScoutOutcomeArgs, trackerStage: string): string {
  const athleteId = args.athleteId.trim();
  const athleteMainId = args.athleteMainId.trim();
  const stageKey = trackerStage.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `sync:${athleteId}:${athleteMainId}:${stageKey}`;
}

function buildCallLogName(args: SyncScoutOutcomeArgs, trackerStage: string): string {
  return `${args.athleteName.trim()} • ${trackerStage}`;
}

function buildCallLogNotes(args: SyncScoutOutcomeArgs, trackerStage: string): string {
  const lines = [
    buildCallLogKey(args, trackerStage),
    `Website Stage: ${normalizeStage(args.stage) || trackerStage}`,
  ];
  const taskId = String(args.taskId || '').trim();
  if (taskId) {
    lines.push(`Legacy Task ID: ${taskId}`);
  }
  return lines.join('\n');
}

async function findExistingCallLogPage(
  token: string,
  trackerPageId: string,
  callResult: CallLogOutcome['callResult'],
  notesKey: string,
): Promise<CallLogPage | null> {
  const payload = await notionRequest<{ results?: CallLogPage[] }>(
    token,
    `/databases/${normalizeNotionId(NOTION_CALL_LOG_DATABASE_ID)}/query`,
    {
      method: 'POST',
      body: JSON.stringify({
        page_size: 1,
        filter: {
          and: [
            {
              property: 'Lead',
              relation: {
                contains: trackerPageId,
              },
            },
            {
              property: 'Call Result',
              select: {
                equals: callResult,
              },
            },
            {
              property: 'Notes',
              rich_text: {
                contains: notesKey,
              },
            },
          ],
        },
      }),
    },
  );

  return Array.isArray(payload.results) ? payload.results[0] || null : null;
}

async function upsertCallLogPage(
  token: string,
  trackerPageId: string,
  args: SyncScoutOutcomeArgs,
  outcome: CallLogOutcome,
): Promise<{ pageId: string; pageUrl: string }> {
  const notes = buildCallLogNotes(args, outcome.trackerStage);
  const notesKey = buildCallLogKey(args, outcome.trackerStage);
  const existing = await findExistingCallLogPage(token, trackerPageId, outcome.callResult, notesKey);

  const properties = {
    Name: titleProperty(buildCallLogName(args, outcome.trackerStage)),
    'Call Result': selectProperty(outcome.callResult),
    Lead: {
      relation: [{ id: trackerPageId }],
    },
    'Meeting Set?': checkboxProperty(outcome.meetingSet),
    'Spoke?': checkboxProperty(outcome.spoke),
    Notes: richTextProperty(notes),
  };

  if (existing?.id) {
    const updated = await notionRequest<CallLogPage>(token, `/pages/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
    return {
      pageId: existing.id,
      pageUrl: String(updated.url || existing.url || '').trim(),
    };
  }

  const created = await notionRequest<CallLogPage>(token, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: normalizeNotionId(NOTION_CALL_LOG_DATABASE_ID) },
      properties,
    }),
  });

  return {
    pageId: created.id,
    pageUrl: String(created.url || '').trim(),
  };
}

export async function syncScoutOutcomeToNotion(
  args: SyncScoutOutcomeArgs,
): Promise<SyncScoutOutcomeResult> {
  const outcome = mapStageToCallLogOutcome(args.stage);
  const trackerStage = outcome?.trackerStage || normalizeTrackerStage(args.stage);

  const trackerEntry: LightweightFollowUpTrackerEntry = {
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName,
    parent1Name: args.parent1Name,
    parent2Name: args.parent2Name,
    stage: trackerStage,
    currentTask: args.currentTask,
    dueDate: args.dueDate,
    adminUrl: args.adminUrl,
  };

  const trackerResult = await upsertScoutFollowUpTrackerEntry(trackerEntry);

  if (!outcome) {
    return {
      trackerPageId: trackerResult.pageId,
      trackerPageUrl: trackerResult.pageUrl,
      callLogPageId: null,
      callLogPageUrl: null,
      loggedCallOutcome: false,
      trackerStage,
      callResult: null,
    };
  }

  const token = getNotionToken();
  const callLogResult = await upsertCallLogPage(token, trackerResult.pageId, args, outcome);

  return {
    trackerPageId: trackerResult.pageId,
    trackerPageUrl: trackerResult.pageUrl,
    callLogPageId: callLogResult.pageId,
    callLogPageUrl: callLogResult.pageUrl,
    loggedCallOutcome: true,
    trackerStage,
    callResult: outcome.callResult,
  };
}
