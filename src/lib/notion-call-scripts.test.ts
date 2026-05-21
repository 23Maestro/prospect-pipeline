import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callNotesMarkdownToNotionBlocks,
  syncCallNotesPageToNotionWithConfig,
} from './notion-call-scripts.js';

function paragraphText(block: any) {
  return block.paragraph?.rich_text?.[0]?.text.content;
}

test('callNotesMarkdownToNotionBlocks: adds free block before main number without MaxPreps URL', () => {
  const blocks = callNotesMarkdownToNotionBlocks('Main Number: (662) 214-2634');

  assert.equal(blocks[0]?.type, 'paragraph');
  assert.deepEqual((blocks[0] as any)?.paragraph, { rich_text: [] });
  assert.equal(blocks[1]?.type, 'paragraph');
  assert.equal(paragraphText(blocks[1]), 'Main Number: (662) 214-2634');
});

test('callNotesMarkdownToNotionBlocks: keeps MaxPreps URL as first block when present', () => {
  const blocks = callNotesMarkdownToNotionBlocks(
    'https://www.maxpreps.com/ms/oxford/oxford-chargers/football/\n\nMain Number: (662) 214-2634',
  );

  assert.equal(blocks[0]?.type, 'paragraph');
  assert.equal(
    paragraphText(blocks[0]),
    'https://www.maxpreps.com/ms/oxford/oxford-chargers/football/',
  );
  assert.equal(paragraphText(blocks[1]), 'Main Number: (662) 214-2634');
});

test('syncCallNotesPageToNotionWithConfig: replaces existing toggle heading with athlete title', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });

    if (String(url).includes('/blocks/page-id/children?')) {
      return new Response(
        JSON.stringify({
          results: [
            {
              object: 'block',
              id: 'old-toggle-heading',
              type: 'heading_1',
              heading_1: {
                rich_text: [{ type: 'text', text: { content: 'Student Athlete' } }],
                is_toggleable: true,
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ object: 'block', id: 'ok' }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await syncCallNotesPageToNotionWithConfig(
      {
        markdown: 'Main Number: (662) 214-2634',
        toggleTitle: 'Myles OConnor',
      },
      { token: 'token', pageId: 'page-id' },
    );

    assert.equal(result.replacedCount, 1);
    assert.equal(requests[1]?.url, 'https://api.notion.com/v1/blocks/old-toggle-heading');
    assert.equal(requests[1]?.init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), { archived: true });

    const appended = JSON.parse(String(requests[2]?.init?.body));
    assert.equal(appended.children[0].type, 'heading_1');
    assert.equal(appended.children[0].heading_1.is_toggleable, true);
    assert.equal(appended.children[0].heading_1.rich_text[0].text.content, 'Myles OConnor');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
