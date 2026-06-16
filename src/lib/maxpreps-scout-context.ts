import * as cheerio from 'cheerio';
import { searchLogger } from './logger';

export type MaxPrepsScoutContextInput = {
  athleteName?: string | null;
  highSchool?: string | null;
  city?: string | null;
  state?: string | null;
  sport?: string | null;
  maxPrepsUrl?: string | null;
  searchLabel?: string | null;
};

export type MaxPrepsScoutContext = {
  mascot: string;
  state_rank: string;
  url: string;
  athlete_context?: string | null;
};

const FEATURE = 'maxpreps.scout-context';
const STATE_NAMES_BY_ABBREVIATION: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};
const STATE_ABBREVIATIONS_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES_BY_ABBREVIATION).map(([abbreviation, name]) => [
    name.toLowerCase(),
    abbreviation,
  ]),
);

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

function titleCaseWords(value?: string | null): string {
  return clean(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function cleanSearchLabelPart(value?: string | null): string {
  return compactWhitespace(String(value || ''));
}

function formatSearchState(state?: string | null): string | null {
  const rawState = clean(state);
  if (!rawState) {
    return null;
  }

  const normalized = rawState.toUpperCase();
  return STATE_NAMES_BY_ABBREVIATION[normalized] || titleCaseWords(rawState);
}

function formatSearchStateAbbreviation(state?: string | null): string | null {
  const rawState = clean(state);
  if (!rawState) {
    return null;
  }

  const normalized = rawState.toUpperCase();
  if (STATE_NAMES_BY_ABBREVIATION[normalized]) {
    return normalized;
  }

  return STATE_ABBREVIATIONS_BY_NAME[rawState.toLowerCase()] || normalized;
}

export function buildMaxPrepsSearchLabel(input: {
  highSchool?: string | null;
  state?: string | null;
  sport?: string | null;
}): string | null {
  const highSchool = cleanSearchLabelPart(input.highSchool);
  if (!highSchool) {
    return null;
  }

  const state = cleanSearchLabelPart(formatSearchState(input.state));
  const sport = cleanSearchLabelPart(titleCaseWords(input.sport));
  const sportTeam = sport ? (/\bteam$/i.test(sport) ? sport : `${sport} Team`) : null;
  return [highSchool, state, sportTeam].filter(Boolean).join(' ');
}

export function buildMissingHighSchoolMaxPrepsSearchLabel(input: {
  state?: string | null;
  sport?: string | null;
}): string | null {
  const sport = cleanSearchLabelPart(input.sport).toLowerCase();
  const state = cleanSearchLabelPart(formatSearchStateAbbreviation(input.state));
  if (!sport || !state) {
    return null;
  }

  return `${sport} high school ${state}`;
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

function isMaxPrepsSeasonSlug(value?: string | null): boolean {
  return /^(fall|winter|spring|summer)$/i.test(clean(value));
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

  if (parts.length < 4) {
    return null;
  }

  const teamParts = parts.slice(0, 4);
  if (isMaxPrepsSeasonSlug(parts[4])) {
    teamParts.push(parts[4]);
  }

  return `https://www.maxpreps.com/${teamParts.join('/')}/`;
}

export function maxPrepsSportSlugCandidates(sport?: string | null): string[] {
  const normalized = clean(sport)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return [];
  }

  if (/^(mens|men|boys|boy)\s+soccer$/.test(normalized)) {
    return ['soccer', 'boys-soccer'];
  }

  if (/^(womens|women|girls|girl)\s+soccer$/.test(normalized)) {
    return ['soccer', 'girls-soccer'];
  }

  if (normalized === 'soccer') {
    return ['soccer', 'boys-soccer', 'girls-soccer'];
  }

  const slug = normalized
    .replace(/^(mens|men|womens|women|boys|boy|girls|girl)\s+/, '')
    .replace(/\s+/g, '-');
  return Array.from(new Set([slug].filter(Boolean)));
}

function urlIncludesSportSlug(url: string, slug: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().split('/').filter(Boolean).includes(slug);
  } catch {
    return false;
  }
}

function extractMaxPrepsUrlsFromSearchMarkdown(markdown: string, sport?: string | null): string[] {
  const sportSlugs = maxPrepsSportSlugCandidates(sport);
  const urls = Array.from(
    markdown.matchAll(
      /https%3A%2F%2Fwww\.maxpreps\.com%2F[^)&\s]+|https:\/\/www\.maxpreps\.com\/[^)\s]+/gi,
    ),
  )
    .map((match) => decodeURIComponent(match[0]))
    .map((url) => normalizeMaxPrepsTeamUrl(url))
    .filter((url): url is string => Boolean(url));

  const uniqueUrls = Array.from(new Set(urls));
  const preferredUrls = sportSlugs.flatMap((slug) =>
    uniqueUrls.filter((url) => urlIncludesSportSlug(url, slug)),
  );
  return Array.from(new Set([...preferredUrls, ...uniqueUrls]));
}

export function extractMaxPrepsUrlFromSearchMarkdown(markdown: string, sport?: string | null) {
  return extractMaxPrepsUrlsFromSearchMarkdown(markdown, sport)[0] || null;
}

function buildSearchQuery(input: MaxPrepsScoutContextInput): string {
  const searchLabel = clean(input.searchLabel);
  if (searchLabel) {
    return searchLabel;
  }

  return buildMaxPrepsSearchLabel(input) || '';
}

async function searchMaxPrepsUrls(input: MaxPrepsScoutContextInput): Promise<string[]> {
  const query = buildSearchQuery(input);
  if (!query || !clean(input.highSchool) || !clean(input.state) || !clean(input.sport)) {
    return [];
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

  const urls = extractMaxPrepsUrlsFromSearchMarkdown(markdown, input.sport);
  logInfo('MAXPREPS_LOOKUP', 'search', 'success', {
    found: urls.length > 0,
    url: urls[0] || null,
    candidates: urls.slice(0, 3),
  });
  return urls;
}

async function findMaxPrepsUrls(input: MaxPrepsScoutContextInput): Promise<string[]> {
  const searchUrls = await searchMaxPrepsUrls(input);
  const directUrl = normalizeMaxPrepsTeamUrl(input.maxPrepsUrl);
  return Array.from(new Set([...searchUrls, ...(directUrl ? [directUrl] : [])]));
}

export function parseMaxPrepsTeamHtml(html: string, url: string): MaxPrepsScoutContext | null {
  const $ = cheerio.load(html);
  const description = clean($('meta[name="description"]').attr('content')).replace(
    /&#x27;|&#39;|&apos;/gi,
    "'",
  );
  const mascotMatch = description.match(/See the\s+(.+?)'s/i);
  const mascot = clean(mascotMatch?.[1]);
  const stateRankBlock = $('h4')
    .toArray()
    .find((heading) => /^([A-Z]{2})\s*Rank$/i.test($(heading).text().trim()));
  const stateRankLabel = stateRankBlock ? compactWhitespace($(stateRankBlock).text()) : '';
  const stateRankValue = stateRankBlock
    ? compactWhitespace($(stateRankBlock).next().text()).replace(/^#/, '')
    : '';

  if (!mascot) {
    return null;
  }

  return {
    mascot,
    state_rank: stateRankLabel && stateRankValue ? `${stateRankLabel} ${stateRankValue}` : '',
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
  const urls = await findMaxPrepsUrls(input);
  if (!urls.length) {
    return null;
  }

  for (const url of urls.slice(0, 2)) {
    const parsed = await resolveMaxPrepsTeamPage(url, input.athleteName);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

async function resolveMaxPrepsTeamPage(
  url: string,
  athleteName?: string | null,
): Promise<MaxPrepsScoutContext | null> {
  logInfo('MAXPREPS_LOOKUP', 'team_page', 'start', { url });
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
    },
  });
  const html = await response.text();
  if (!response.ok) {
    logFailure('MAXPREPS_LOOKUP', 'team_page', `MaxPreps HTTP ${response.status}`, {
      url,
      html: html.slice(0, 500),
    });
    return null;
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
  const athleteContext = rosterHtml ? parseMaxPrepsRosterHtml(rosterHtml, athleteName) : null;

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
