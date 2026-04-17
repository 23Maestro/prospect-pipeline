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

type DatabaseProperty = {
  id?: string;
  name?: string;
  type?: string;
  select?: { options?: Array<{ name?: string }> };
  status?: { options?: Array<{ name?: string }> };
};

type DatabaseSchema = Record<string, DatabaseProperty>;

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

function getProperty(schema: DatabaseSchema, name: string): DatabaseProperty | null {
  return schema[name] || null;
}

function getPropertyOptions(property: DatabaseProperty | null): string[] {
  if (!property) return [];
  const raw =
    property.type === 'status'
      ? property.status?.options || []
      : property.type === 'select'
        ? property.select?.options || []
        : [];
  return raw.map((option) => String(option?.name || '').trim()).filter(Boolean);
}

function assignSelectLikeProperty(
  properties: Record<string, unknown>,
  schema: DatabaseSchema,
  name: string,
  candidates: Array<string | null | undefined>,
) {
  const property = getProperty(schema, name);
  if (!property?.type) return;

  const normalizedCandidates = candidates.map((value) => String(value || '').trim()).filter(Boolean);
  if (!normalizedCandidates.length) return;

  if (property.type === 'select' || property.type === 'status') {
    const options = getPropertyOptions(property);
    const match = normalizedCandidates.find((candidate) => options.includes(candidate));
    if (!match) return;
    properties[name] = property.type === 'status' ? { status: { name: match } } : selectProperty(match);
    return;
  }

  if (property.type === 'text' || property.type === 'rich_text') {
    properties[name] = richTextProperty(normalizedCandidates[0]);
  }
}

async function fetchDatabaseSchema(token: string): Promise<DatabaseSchema> {
  const payload = await notionRequest<{ properties?: DatabaseSchema }>(
    token,
    `/databases/${normalizeNotionId(NOTION_FOLLOW_UP_DATABASE_ID)}`,
  );
  return payload.properties || {};
}

function buildProperties(entry: LightweightFollowUpTrackerEntry, schema: DatabaseSchema) {
  const properties: Record<string, unknown> = {};
  const stage = buildStage(entry);

  if (getProperty(schema, 'Name')) {
    properties.Name = titleProperty(entry.athleteName);
  }
  if (getProperty(schema, 'Parent 1')) {
    properties['Parent 1'] = richTextProperty(entry.parent1Name);
  }
  if (getProperty(schema, 'Parent 2')) {
    properties['Parent 2'] = richTextProperty(entry.parent2Name);
  }
  if (getProperty(schema, 'Due At')) {
    properties['Due At'] = dateProperty(entry.dueDate);
  }
  if (getProperty(schema, 'Admin URL')) {
    properties['Admin URL'] = urlProperty(entry.adminUrl);
  }
  if (getProperty(schema, 'Raycast Key')) {
    properties['Raycast Key'] = richTextProperty(buildRaycastKey(entry));
  }

  assignSelectLikeProperty(properties, schema, 'Stage', [
    stage,
    /confirmation/i.test(stage) ? 'Confirmation Call' : null,
  ]);

  assignSelectLikeProperty(properties, schema, 'Status', [
    'Open',
    /call attempt 2/i.test(stage) ? 'Call Attempt 2' : null,
    /call attempt 1/i.test(stage) ? 'Call Attempt 1' : null,
    /confirmation/i.test(stage) ? 'Meeting Set' : null,
  ]);

  return properties;
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
  const schema = await fetchDatabaseSchema(token);
  const raycastKey = buildRaycastKey(entry);
  const existing = await findExistingPage(token, raycastKey);
  const properties = buildProperties(entry, schema);

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
