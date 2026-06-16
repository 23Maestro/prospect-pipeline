import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMissingHighSchoolMaxPrepsSearchLabel,
  buildMaxPrepsSearchLabel,
  extractMaxPrepsUrlFromSearchMarkdown,
  maxPrepsSportSlugCandidates,
  normalizeMaxPrepsTeamUrl,
  parseMaxPrepsTeamHtml,
  resolveMaxPrepsScoutContext,
} from './maxpreps-scout-context';

test('buildMaxPrepsSearchLabel: formats the KM placeholder search string', () => {
  assert.equal(
    buildMaxPrepsSearchLabel({
      highSchool: ' Lorena   High School ',
      state: 'TX',
      sport: "Men's Soccer",
    }),
    "Lorena High School Texas Men's Soccer Team",
  );
});

test('buildMissingHighSchoolMaxPrepsSearchLabel: formats the KM fallback search string', () => {
  assert.equal(
    buildMissingHighSchoolMaxPrepsSearchLabel({
      state: 'New York',
      sport: 'Softball',
    }),
    'softball high school NY',
  );
});

test('maxPrepsSportSlugCandidates: maps soccer labels to MaxPreps URL slugs', () => {
  assert.deepEqual(maxPrepsSportSlugCandidates("Men's Soccer"), ['soccer', 'boys-soccer']);
  assert.deepEqual(maxPrepsSportSlugCandidates("Women's Soccer"), ['soccer', 'girls-soccer']);
});

test('extractMaxPrepsUrlFromSearchMarkdown: prefers a sport-matching MaxPreps result', () => {
  const markdown = [
    'https://www.maxpreps.com/tx/lorena/lorena-leopards/basketball/',
    'https://www.maxpreps.com/tx/lorena/lorena-leopards/soccer/',
  ].join('\n');

  assert.equal(
    extractMaxPrepsUrlFromSearchMarkdown(markdown, "Men's Soccer"),
    'https://www.maxpreps.com/tx/lorena/lorena-leopards/soccer/',
  );
});

test('normalizeMaxPrepsTeamUrl: normalizes athlete URLs and rejects school-only URLs', () => {
  assert.equal(
    normalizeMaxPrepsTeamUrl(
      'https://www.maxpreps.com/tx/lorena/lorena-leopards/athletes/noah-hardin/soccer/stats/',
    ),
    'https://www.maxpreps.com/tx/lorena/lorena-leopards/soccer/',
  );
  assert.equal(
    normalizeMaxPrepsTeamUrl('https://www.maxpreps.com/tx/lorena/lorena-leopards/'),
    null,
  );
});

test('normalizeMaxPrepsTeamUrl: preserves seasonal sport team URLs', () => {
  assert.equal(
    normalizeMaxPrepsTeamUrl('https://www.maxpreps.com/tx/lorena/lorena-leopards/soccer/winter/'),
    'https://www.maxpreps.com/tx/lorena/lorena-leopards/soccer/winter/',
  );
});

test('parseMaxPrepsTeamHtml: keeps mascot when rank is unavailable', () => {
  const result = parseMaxPrepsTeamHtml(
    '<html><head><meta name="description" content="See the Republic Tigers&#x27;s football schedule, roster, rankings." /></head></html>',
    'https://www.maxpreps.com/mo/republic/republic-tigers/football/',
  );

  assert.equal(result?.mascot, 'Republic Tigers');
  assert.equal(result?.state_rank, '');
});

test('resolveMaxPrepsScoutContext: skips a 404 candidate and resolves the next search result', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const requestUrl = String(url);
    calls.push(requestUrl);

    if (requestUrl.startsWith('https://r.jina.ai/')) {
      return new Response(
        [
          'https://www.maxpreps.com/tx/lorena/stale-lorena-leopards/soccer/',
          'https://www.maxpreps.com/tx/lorena/lorena-leopards/soccer/',
        ].join('\n'),
        { status: 200 },
      );
    }

    if (requestUrl === 'https://www.maxpreps.com/tx/lorena/stale-lorena-leopards/soccer/') {
      return new Response('<html><head><title>404 - Not Found</title></head></html>', {
        status: 404,
      });
    }

    if (requestUrl === 'https://www.maxpreps.com/tx/lorena/lorena-leopards/soccer/') {
      return new Response(
        [
          '<html><head><meta name="description" content="See the Lorena Leopards\'s soccer schedule, roster, rankings." /></head>',
          '<body><h4>TX Rank</h4><div>#24</div></body></html>',
        ].join(''),
        { status: 200 },
      );
    }

    if (requestUrl === 'https://www.maxpreps.com/tx/lorena/lorena-leopards/soccer/roster/') {
      return new Response('<html><body></body></html>', { status: 200 });
    }

    return new Response('', { status: 404 });
  }) as typeof fetch;

  try {
    const result = await resolveMaxPrepsScoutContext({
      athleteName: 'Noah Hardin',
      highSchool: 'Lorena High School',
      state: 'Texas',
      sport: 'Soccer',
      searchLabel: "Lorena High School Texas Men's Soccer Team",
    });

    assert.equal(result?.url, 'https://www.maxpreps.com/tx/lorena/lorena-leopards/soccer/');
    assert.equal(result?.mascot, 'Lorena Leopards');
    assert.equal(result?.state_rank, 'TX Rank 24');
    assert.ok(calls.includes('https://www.maxpreps.com/tx/lorena/stale-lorena-leopards/soccer/'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveMaxPrepsScoutContext: searches before using a saved MaxPreps URL', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const requestUrl = String(url);
    calls.push(requestUrl);

    if (requestUrl.startsWith('https://r.jina.ai/')) {
      return new Response('https://www.maxpreps.com/mo/republic/republic-tigers/football/', {
        status: 200,
      });
    }

    if (requestUrl === 'https://www.maxpreps.com/mo/republic/republic-tigers/football/') {
      return new Response(
        [
          '<html><head><meta name="description" content="See the Republic Tigers\'s football schedule, roster, rankings." /></head>',
          '<body><h4>MO Rank</h4><div>#24</div></body></html>',
        ].join(''),
        { status: 200 },
      );
    }

    if (requestUrl === 'https://www.maxpreps.com/mo/republic/old-tigers/football/') {
      return new Response('<html><head><title>404 - Not Found</title></head></html>', {
        status: 404,
      });
    }

    if (requestUrl === 'https://www.maxpreps.com/mo/republic/republic-tigers/football/roster/') {
      return new Response('<html><body></body></html>', { status: 200 });
    }

    return new Response('', { status: 404 });
  }) as typeof fetch;

  try {
    const result = await resolveMaxPrepsScoutContext({
      athleteName: 'Jance Mercado',
      highSchool: 'Republic High School',
      state: 'Missouri',
      sport: 'Football',
      maxPrepsUrl: 'https://www.maxpreps.com/mo/republic/old-tigers/football/',
      searchLabel: 'Republic High School Missouri Football Team',
    });

    assert.equal(result?.url, 'https://www.maxpreps.com/mo/republic/republic-tigers/football/');
    assert.equal(calls[0]?.startsWith('https://r.jina.ai/'), true);
    assert.equal(calls.includes('https://www.maxpreps.com/mo/republic/old-tigers/football/'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
