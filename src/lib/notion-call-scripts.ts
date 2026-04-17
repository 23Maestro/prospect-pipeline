import { getPreferenceValues } from '@raycast/api';
import { searchLogger } from './logger';

const FEATURE = 'notion-call-scripts';
const NOTION_VERSION = '2022-06-28';
const MAX_APPEND_BLOCKS = 100;

type NotionCallScriptPreferences = {
  notionToken?: string;
  notionCurrentCallScriptsPageId?: string;
  notionScriptToggleTitle?: string;
  notionVoicemailToggleTitle?: string;
};

type RichText = {
  type: 'text';
  text: {
    content: string;
  };
  annotations?: {
    bold?: boolean;
  };
};

export type NotionBlock = {
  object?: 'block';
  id?: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

type NotionChildrenResponse = {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
};

type SyncTarget = 'script' | 'voicemail';

export type NotionCallScriptConfig = {
  token: string;
  pageId: string;
  toggleTitle: string;
};

function logInfo(
  event: string,
  step: string,
  status: 'start' | 'success',
  context?: Record<string, unknown>,
) {
  searchLogger.info(event, {
    event,
    step,
    status,
    feature: FEATURE,
    context: context || {},
  });
}

function logFailure(event: string, step: string, error: string, context?: Record<string, unknown>) {
  searchLogger.error(event, {
    event,
    step,
    status: 'failure',
    feature: FEATURE,
    error,
    context: context || {},
  });
}

export function normalizeNotionId(value: string): string {
  const trimmed = value.trim();
  const hyphenated = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (hyphenated) {
    return hyphenated[0];
  }

  const compact = trimmed.match(/[0-9a-f]{32}/i);
  if (compact) {
    return compact[0].replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  }
  return trimmed;
}

function getConfig(target: SyncTarget): NotionCallScriptConfig {
  const prefs = getPreferenceValues<NotionCallScriptPreferences>();
  const token = String(prefs.notionToken || '').trim();
  const pageId = normalizeNotionId(String(prefs.notionCurrentCallScriptsPageId || ''));
  const toggleTitle =
    target === 'script'
      ? String(prefs.notionScriptToggleTitle || 'Script').trim()
      : String(prefs.notionVoicemailToggleTitle || 'Voice Mail').trim();

  if (!token) {
    throw new Error('Set Notion API Token in Raycast preferences.');
  }
  if (!pageId) {
    throw new Error('Set Current Call Scripts Page ID in Raycast preferences.');
  }
  if (!toggleTitle) {
    throw new Error('Set Notion toggle title in Raycast preferences.');
  }

  return { token, pageId, toggleTitle };
}

export async function notionRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 404 && path.includes('/blocks/')) {
      throw new Error(
        'Notion could not find the Current Call Prep page/block. Share that Notion page with the integration used by your API token, then try again.',
      );
    }
    throw new Error(`Notion HTTP ${response.status}: ${text.slice(0, 180)}`);
  }

  return (await response.json()) as T;
}

export async function listChildren(token: string, blockId: string): Promise<NotionBlock[]> {
  const children: NotionBlock[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) {
      params.set('start_cursor', cursor);
    }
    const payload = await notionRequest<NotionChildrenResponse>(
      token,
      `/blocks/${blockId}/children?${params.toString()}`,
    );
    children.push(...payload.results);
    cursor = payload.has_more ? payload.next_cursor : null;
  } while (cursor);

  return children;
}

function blockPlainText(block: NotionBlock): string {
  const value = block[block.type] as { rich_text?: RichText[] } | undefined;
  return (value?.rich_text || [])
    .map((item) => item.text.content)
    .join('')
    .trim();
}

async function findToggleBlockId(
  token: string,
  rootBlockId: string,
  title: string,
): Promise<string | null> {
  const expected = title.trim().toLowerCase();
  const children = await listChildren(token, rootBlockId);

  for (const child of children) {
    if (
      child.id &&
      child.type === 'toggle' &&
      blockPlainText(child).trim().toLowerCase() === expected
    ) {
      return child.id;
    }
  }

  return null;
}

export async function archiveBlock(token: string, blockId: string): Promise<void> {
  await notionRequest<NotionBlock>(token, `/blocks/${blockId}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  });
}

export async function appendChildren(token: string, blockId: string, blocks: NotionBlock[]) {
  for (let index = 0; index < blocks.length; index += MAX_APPEND_BLOCKS) {
    const chunk = blocks.slice(index, index + MAX_APPEND_BLOCKS);
    await notionRequest(token, `/blocks/${blockId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: chunk }),
    });
  }
}

function richText(content: string, bold = false): RichText[] {
  return [
    {
      type: 'text',
      text: {
        content: content.slice(0, 2000),
      },
      annotations: bold ? { bold: true } : undefined,
    },
  ];
}

function paragraphBlock(content: string): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: richText(content) },
  };
}

function toggleBlock(title: string, children: NotionBlock[]): NotionBlock {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: richText(title, true),
      children,
    },
  };
}

function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  for (let index = 0; index < text.length; index += 1900) {
    paragraphs.push(text.slice(index, index + 1900));
  }
  return paragraphs;
}

export function scoutPrepMarkdownToNotionBlocks(markdown: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  let inCodeFence = false;

  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();

    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (!line) {
      continue;
    }

    if (!inCodeFence) {
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const type =
          heading[1].length === 1
            ? 'heading_1'
            : heading[1].length === 2
              ? 'heading_2'
              : 'heading_3';
        blocks.push({
          object: 'block',
          type,
          [type]: { rich_text: richText(cleanInlineMarkdown(heading[2]), true) },
        });
        continue;
      }

      const bullet = line.match(/^[-*+]\s+(.+)$/);
      if (bullet) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: richText(cleanInlineMarkdown(bullet[1])) },
        });
        continue;
      }

      const quote = line.match(/^>\s?(.+)$/);
      if (quote) {
        blocks.push({
          object: 'block',
          type: 'quote',
          quote: { rich_text: richText(cleanInlineMarkdown(quote[1])) },
        });
        continue;
      }
    }

    for (const paragraph of splitParagraphs(cleanInlineMarkdown(line))) {
      blocks.push(paragraphBlock(paragraph));
    }
  }

  return blocks.length ? blocks : [paragraphBlock('No content generated.')];
}

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .trim();
}

export async function syncCallScriptToggleToNotion(args: {
  target: SyncTarget;
  markdown: string;
}): Promise<{ toggleTitle: string; archivedCount: number; appendedCount: number }> {
  return syncCallScriptToggleToNotionWithConfig(args, getConfig(args.target));
}

export async function syncCallScriptToggleToNotionWithConfig(
  args: {
    target: SyncTarget;
    markdown: string;
  },
  config: NotionCallScriptConfig,
): Promise<{ toggleTitle: string; archivedCount: number; appendedCount: number }> {
  const { token, pageId, toggleTitle } = {
    ...config,
    pageId: normalizeNotionId(config.pageId),
  };
  const blocks = scoutPrepMarkdownToNotionBlocks(args.markdown);

  logInfo('NOTION_CALL_SCRIPT_SYNC', 'replace-toggle', 'start', {
    target: args.target,
    pageId,
    toggleTitle,
    blockCount: blocks.length,
  });

  try {
    const toggleBlockId = await findToggleBlockId(token, pageId, toggleTitle);
    if (toggleBlockId) {
      await archiveBlock(token, toggleBlockId);
    }

    await appendChildren(token, pageId, [toggleBlock(toggleTitle, blocks)]);

    logInfo('NOTION_CALL_SCRIPT_SYNC', 'replace-toggle', 'success', {
      target: args.target,
      toggleTitle,
      archivedCount: toggleBlockId ? 1 : 0,
      appendedCount: blocks.length,
    });

    return { toggleTitle, archivedCount: toggleBlockId ? 1 : 0, appendedCount: blocks.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logFailure('NOTION_CALL_SCRIPT_SYNC', 'replace-toggle', message, {
      target: args.target,
      toggleTitle,
    });
    throw error;
  }
}
