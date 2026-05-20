import * as cheerio from 'cheerio';
import { searchLogger } from './logger';

export type MaxPrepsScoutContextInput = {
  athleteName?: string | null;
  highSchool?: string | null;
  city?: string | null;
  state?: string | null;
  sport?: string | null;
  maxPrepsUrl?: string | null;
};

export type MaxPrepsScoutContext = {
  mascot: string;
  state_rank: string;
  url: string;
  athlete_context?: string | null;
};

const FEATURE = 'maxpreps.scout-context';

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

function clean(value?: string | null): string {
  return String(value || '').trim();
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isMaxPrepsUrl(value: string): boolean {
  try {
    return new URL(value).hostname.replace(/^www\./, '') === 'maxpreps.com';
  } catch {
    return false;
  }
}

function decodeDuckDuckGoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const encoded = url.searchParams.get('uddg');
    return encoded ? decodeURIComponent(encoded) : value;
  } catch {
    return value || null;
  }
}

export function normalizeMaxPrepsTeamUrl(value?: string | null): string | null {
  const rawUrl = clean(value);
  if (!rawUrl) {
    return null;
  }

  const decoded = decodeDuckDuckGoUrl(rawUrl);
  if (!decoded || !isMaxPrepsUrl(decoded)) {
    return null;
  }

  const url = new URL(decoded);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 3) {
    return null;
  }

  const athleteIndex = parts.indexOf('athletes');
  if (athleteIndex >= 3) {
    const sport = parts[athleteIndex + 2] || '';
    if (sport) {
      return `https://www.maxpreps.com/${parts.slice(0, 3).join('/')}/${sport}/`;
    }
  }

  return `https://www.maxpreps.com/${parts.slice(0, 4).join('/')}/`;
}

export function extractMaxPrepsUrlFromSearchMarkdown(markdown: string, sport?: string | null) {
  const preferredSport = clean(sport).toLowerCase();
  const urls = Array.from(
    markdown.matchAll(
      /https%3A%2F%2Fwww\.maxpreps\.com%2F[^)&\s]+|https:\/\/www\.maxpreps\.com\/[^)\s]+/gi,
    ),
  )
    .map((match) => decodeURIComponent(match[0]))
    .map((url) => normalizeMaxPrepsTeamUrl(url))
    .filter((url): url is string => Boolean(url));

  const uniqueUrls = Array.from(new Set(urls));
  return (
    uniqueUrls.find((url) =>
      preferredSport ? url.toLowerCase().includes(`/${preferredSport}/`) : true,
    ) ||
    uniqueUrls[0] ||
    null
  );
}

function buildSearchQuery(input: MaxPrepsScoutContextInput): string {
  return [
    clean(input.highSchool),
    clean(input.state),
    clean(input.sport),
    'Team',
  ]
    .filter(Boolean)
    .join(' ');
}

async function findMaxPrepsUrl(input: MaxPrepsScoutContextInput): Promise<string | null> {
  const directUrl = normalizeMaxPrepsTeamUrl(input.maxPrepsUrl);
  if (directUrl) {
    return directUrl;
  }

  const query = buildSearchQuery(input);
  if (!query || !clean(input.highSchool) || !clean(input.state) || !clean(input.sport)) {
    return null;
  }

  const searchUrl = `https://r.jina.ai/http://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  logInfo('MAXPREPS_LOOKUP', 'search', 'start', {
    query,
  });
  const response = await fetch(searchUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0',
    },
  });
  const markdown = await response.text();
  if (!response.ok) {
    throw new Error(markdown.slice(0, 200) || `Search HTTP ${response.status}`);
  }

  const url = extractMaxPrepsUrlFromSearchMarkdown(markdown, input.sport);
  logInfo('MAXPREPS_LOOKUP', 'search', 'success', {
    found: Boolean(url),
    url,
  });
  return url;
}

export function parseMaxPrepsTeamHtml(html: string, url: string): MaxPrepsScoutContext | null {
  const $ = cheerio.load(html);
  const description = clean($('meta[name="description"]').attr('content'));
  const mascotMatch = description.match(/See the\s+(.+?)'s/i);
  const mascot = clean(mascotMatch?.[1]);
  const stateRankBlock = $('h4')
    .toArray()
    .find((heading) => /^([A-Z]{2})\s*Rank$/i.test($(heading).text().trim()));
  const stateRankLabel = stateRankBlock ? compactWhitespace($(stateRankBlock).text()) : '';
  const stateRankValue = stateRankBlock
    ? compactWhitespace($(stateRankBlock).next().text()).replace(/^#/, '')
    : '';

  if (!mascot || !stateRankLabel || !stateRankValue) {
    return null;
  }

  return {
    mascot,
    state_rank: `${stateRankLabel} ${stateRankValue}`,
    url,
  };
}

export function parseMaxPrepsRosterHtml(html: string, athleteName?: string | null): string | null {
  const athlete = clean(athleteName);
  if (!athlete) {
    return null;
  }

  const $ = cheerio.load(html);
  const row = $('tr')
    .toArray()
    .map((element) => compactWhitespace($(element).text()))
    .find((text) => text.toLowerCase().includes(athlete.toLowerCase()));
  if (!row) {
    return null;
  }

  const match = row.match(/^(\d+)?\s*(.+?)(Fr\.|So\.|Jr\.|Sr\.)\s*([A-Z0-9/ -]+)?$/);
  if (!match) {
    return row;
  }

  const [, jersey, name, grade, position] = match;
  const cleanedPosition = clean(position).replace(/-+$/, '');
  return [jersey ? `#${jersey}` : null, clean(name), grade, cleanedPosition]
    .filter(Boolean)
    .join(' ');
}

export async function resolveMaxPrepsScoutContext(
  input: MaxPrepsScoutContextInput,
): Promise<MaxPrepsScoutContext | null> {
  const url = await findMaxPrepsUrl(input);
  if (!url) {
    return null;
  }

  logInfo('MAXPREPS_LOOKUP', 'team_page', 'start', { url });
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
    },
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(html.slice(0, 200) || `MaxPreps HTTP ${response.status}`);
  }

  const parsed = parseMaxPrepsTeamHtml(html, url);
  if (!parsed) {
    logFailure('MAXPREPS_LOOKUP', 'team_page', 'Could not parse MaxPreps team context', { url });
    return null;
  }

  const rosterUrl = `${url.replace(/\/$/, '')}/roster/`;
  const rosterResponse = await fetch(rosterUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0',
    },
  }).catch(() => null);
  const rosterHtml = rosterResponse?.ok ? await rosterResponse.text() : '';
  const athleteContext = rosterHtml ? parseMaxPrepsRosterHtml(rosterHtml, input.athleteName) : null;

  logInfo('MAXPREPS_LOOKUP', 'team_page', 'success', {
    mascot: parsed.mascot,
    stateRank: parsed.state_rank,
    hasAthleteContext: Boolean(athleteContext),
  });

  return {
    ...parsed,
    athlete_context: athleteContext,
  };
}
