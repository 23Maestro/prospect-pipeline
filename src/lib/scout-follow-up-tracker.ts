import { getPreferenceValues } from '@raycast/api';
import { normalizeNotionId, notionRequest } from './notion-call-scripts';
import { stripMoveThisTaskPrefix } from './scout-prep';

const NOTION_FOLLOW_UP_DATABASE_ID = '3434c8bd-6c26-8022-a875-e8c99007628e';

type Preferences = {
  notionToken?: string;
};

type TrackerPage = {
  id: string;
  url?: string;
};

export type LightweightFollowUpTrackerEntry = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  parent1Name?: string | null;
  parent2Name?: string | null;
  stage?: string | null;
  dueDate?: string | null;
  adminUrl: string;
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

function urlProperty(value: string) {
  const url = String(value || '').trim();
  return { url: url || null };
}

function dateProperty(value?: string | null) {
  const start = toNotionDate(value);
  return { date: start ? { start } : null };
}

function toNotionDate(value?: string | null): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const directDateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (directDateMatch) {
    return raw;
  }

  const legacyMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (legacyMatch) {
    return `${legacyMatch[3]}-${legacyMatch[1]}-${legacyMatch[2]}`;
  }

  const legacyTaskMatch = raw.match(
    /^(?:[A-Za-z]{3}\s+)?(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+\d{1,2}:\d{2}\s*[AP]M)?$/i,
  );
  if (legacyTaskMatch) {
    const year = legacyTaskMatch[3].length === 2 ? `20${legacyTaskMatch[3]}` : legacyTaskMatch[3];
    return `${year}-${legacyTaskMatch[1]}-${legacyTaskMatch[2]}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildRaycastKey(entry: LightweightFollowUpTrackerEntry): string {
  return `follow-up:${entry.athleteId.trim()}:${entry.athleteMainId.trim()}`;
}

function buildStage(entry: LightweightFollowUpTrackerEntry): string {
  return stripMoveThisTaskPrefix(entry.stage) || String(entry.stage || '').trim() || 'Pending follow-up';
}

function buildProperties(entry: LightweightFollowUpTrackerEntry) {
  return {
    Name: titleProperty(entry.athleteName),
    Status: selectProperty('Open'),
    'Parent 1': richTextProperty(entry.parent1Name),
    'Parent 2': richTextProperty(entry.parent2Name),
    Stage: richTextProperty(buildStage(entry)),
    'Due At': dateProperty(entry.dueDate),
    'Admin URL': urlProperty(entry.adminUrl),
    'Raycast Key': richTextProperty(buildRaycastKey(entry)),
  };
}

async function findExistingPage(token: string, raycastKey: string): Promise<TrackerPage | null> {
  const payload = await notionRequest<{ results?: TrackerPage[] }>(
    token,
    `/databases/${normalizeNotionId(NOTION_FOLLOW_UP_DATABASE_ID)}/query`,
    {
      method: 'POST',
      body: JSON.stringify({
        page_size: 1,
        filter: {
          property: 'Raycast Key',
          rich_text: {
            equals: raycastKey,
          },
        },
      }),
    },
  );
  return Array.isArray(payload.results) ? payload.results[0] || null : null;
}

export async function upsertScoutFollowUpTrackerEntry(
  entry: LightweightFollowUpTrackerEntry,
): Promise<{ pageId: string; pageUrl: string }> {
  const token = getNotionToken();
  const raycastKey = buildRaycastKey(entry);
  const existing = await findExistingPage(token, raycastKey);
  const properties = buildProperties(entry);

  if (existing?.id) {
    const updated = await notionRequest<TrackerPage>(token, `/pages/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
    return {
      pageId: existing.id,
      pageUrl: String(updated.url || existing.url || '').trim(),
    };
  }

  const created = await notionRequest<TrackerPage>(token, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: normalizeNotionId(NOTION_FOLLOW_UP_DATABASE_ID) },
      properties,
    }),
  });
  return {
    pageId: created.id,
    pageUrl: String(created.url || '').trim(),
  };
}
