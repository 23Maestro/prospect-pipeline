import type {
  ScoutPrepAIOutput,
  ScoutPrepContext,
  ScoutPrepFormValues,
  ScoutPrepGrade,
} from './types';

type ScoutPrepCardDiagnostics = {
  anchorCount: number;
  snapshotFieldCount: number;
  deficitGrade: ScoutPrepGrade;
  rapportSource: 'deterministic';
  hasLocalTime: boolean;
  hasState: boolean;
  hasCity: boolean;
  hasSchool: boolean;
  hasSport: boolean;
  hasParent1: boolean;
};

type ScoutPrepCardResult = {
  markdown: string;
  diagnostics: ScoutPrepCardDiagnostics;
};

type GpaBand = 'high' | 'medium' | 'low' | 'unknown';
type SportFamily = 'football' | 'basketball' | 'baseball' | 'generic';
type FootballPositionGroup = 'ol_dl' | 'skill' | 'qb' | 'lb_db' | 'generic';
type AthletePronouns = {
  subject: 'he' | 'she';
  object: 'him' | 'her';
  possessive: 'his' | 'her';
};

type RecruitingTimelineReference = {
  patterns: RegExp[];
  label: string;
  coachContactDate: string;
  contactMonth: number;
  contactDay: number;
  contactDateLabel: string;
};

type PositionQuestionRule = {
  sportPatterns: RegExp[];
  positionPatterns: RegExp[];
  buildQuestion: (athleteFirst: string, position: string) => string;
};

const DEFAULT_RECRUITING_TIMELINE: RecruitingTimelineReference = {
  patterns: [],
  label: 'this sport',
  coachContactDate: 'June 15 after sophomore year',
  contactMonth: 6,
  contactDay: 15,
  contactDateLabel: 'June 15',
};

const RECRUITING_TIMELINE_REFERENCES: RecruitingTimelineReference[] = [
  {
    patterns: [/\bfootball\b/],
    label: 'football',
    coachContactDate: 'June 15 after sophomore year',
    contactMonth: 6,
    contactDay: 15,
    contactDateLabel: 'June 15',
  },
  {
    patterns: [/\bmen'?s?\b.*\bbasketball\b|\bbasketball\b.*\bmen'?s?\b/],
    label: "men's basketball",
    coachContactDate: 'June 15 after sophomore year',
    contactMonth: 6,
    contactDay: 15,
    contactDateLabel: 'June 15',
  },
  {
    patterns: [/\bwomen'?s?\b.*\bbasketball\b|\bbasketball\b.*\bwomen'?s?\b/],
    label: "women's basketball",
    coachContactDate: 'June 1 after sophomore year',
    contactMonth: 6,
    contactDay: 1,
    contactDateLabel: 'June 1',
  },
  {
    patterns: [/\bbaseball\b/],
    label: 'baseball',
    coachContactDate: 'August 1 of junior year',
    contactMonth: 8,
    contactDay: 1,
    contactDateLabel: 'August 1',
  },
  {
    patterns: [/\bsoftball\b/],
    label: 'softball',
    coachContactDate: 'September 1 of junior year',
    contactMonth: 9,
    contactDay: 1,
    contactDateLabel: 'September 1',
  },
  {
    patterns: [/\blacrosse\b/],
    label: 'lacrosse',
    coachContactDate: 'September 1 of junior year',
    contactMonth: 9,
    contactDay: 1,
    contactDateLabel: 'September 1',
  },
  {
    patterns: [/\bmen'?s?\b.*\bice hockey\b|\bice hockey\b.*\bmen'?s?\b/],
    label: "men's ice hockey",
    coachContactDate: 'January 1 of sophomore year',
    contactMonth: 1,
    contactDay: 1,
    contactDateLabel: 'January 1',
  },
];

const POSITION_QUESTION_RULES: PositionQuestionRule[] = [
  {
    sportPatterns: [/\bfootball\b/],
    positionPatterns: [/\bqb\b|\bquarterback\b/],
    buildQuestion: (athleteFirst) =>
      `At quarterback, is ${athleteFirst}'s separator arm talent, decision-making, leadership, or production?`,
  },
  {
    sportPatterns: [/\bfootball\b/],
    positionPatterns: [
      /\brb\b|\brunning back\b|\bwr\b|\bwide receiver\b|\bte\b|\btight end\b|\bret\b|\breturner\b/,
    ],
    buildQuestion: (athleteFirst) =>
      `Is ${athleteFirst}'s separator speed, production, ball skills, or what he does after contact?`,
  },
  {
    sportPatterns: [/\bfootball\b/],
    positionPatterns: [
      /\bot\b|\bog\b|\bol\b|\boffensive tackle\b|\boffensive guard\b|\boffensive line\b|\bls\b|\blong snapper\b/,
    ],
    buildQuestion: (athleteFirst) =>
      `On the line, is ${athleteFirst}'s separator size, strength, feet, or how physical he is?`,
  },
  {
    sportPatterns: [/\bfootball\b/],
    positionPatterns: [
      /\bde\b|\bdt\b|\bdl\b|\bdefensive end\b|\bdefensive tackle\b|\bdefensive line\b/,
    ],
    buildQuestion: (athleteFirst) =>
      `Up front defensively, is ${athleteFirst}'s separator get-off, strength, motor, or production?`,
  },
  {
    sportPatterns: [/\bfootball\b/],
    positionPatterns: [
      /\bolb\b|\bilb\b|\blb\b|\boutside linebacker\b|\binside linebacker\b|\blinebacker\b/,
    ],
    buildQuestion: (athleteFirst) =>
      `At linebacker, is ${athleteFirst}'s separator instincts, physicality, coverage, or sideline-to-sideline speed?`,
  },
  {
    sportPatterns: [/\bfootball\b/],
    positionPatterns: [/\bcb\b|\bs\b|\bdb\b|\bcornerback\b|\bsafety\b|\bdefensive back\b/],
    buildQuestion: (athleteFirst) =>
      `In the secondary, is ${athleteFirst}'s separator coverage, ball skills, speed, or tackling?`,
  },
  {
    sportPatterns: [/\bfootball\b/],
    positionPatterns: [/\bk\b|\bkicker\b|\bp\b|\bpunter\b/],
    buildQuestion: (athleteFirst) =>
      `Special teams-wise, what are ${athleteFirst}'s best verified numbers and game-pressure results?`,
  },
  {
    sportPatterns: [/\bfootball\b/],
    positionPatterns: [/\bath\b|\bathlete\b/],
    buildQuestion: (athleteFirst) =>
      `As an athlete, is ${athleteFirst}'s separator speed, versatility, physicality, or production?`,
  },
  {
    sportPatterns: [/\bbaseball\b/],
    positionPatterns: [/\bss\b|\bshortstop\b/],
    buildQuestion: (athleteFirst) =>
      `At shortstop, is ${athleteFirst} more of a defensive anchor, bat-first, or both?`,
  },
  {
    sportPatterns: [/\bbaseball\b/],
    positionPatterns: [/\bp\b|\bpitcher\b|\brhp\b|\blhp\b/],
    buildQuestion: (athleteFirst) =>
      `On the mound, what does ${athleteFirst} usually sit velocity-wise, and what is his best secondary pitch?`,
  },
  {
    sportPatterns: [/\bbaseball\b/],
    positionPatterns: [/\bc\b|\bcatcher\b/],
    buildQuestion: (athleteFirst) =>
      `Behind the plate, how is ${athleteFirst}'s arm strength, receiving, and ability to control the game?`,
  },
  {
    sportPatterns: [/\bbaseball\b/],
    positionPatterns: [/\b1b\b|\bfirst base\b|\b3b\b|\bthird base\b/],
    buildQuestion: (athleteFirst) =>
      `At the corner, is ${athleteFirst} more power bat, run producer, glove, or arm?`,
  },
  {
    sportPatterns: [/\bbaseball\b/],
    positionPatterns: [/\b2b\b|\bsecond base\b/],
    buildQuestion: (athleteFirst) =>
      `At second base, is ${athleteFirst}'s separator glove, bat-to-ball, speed, or baseball IQ?`,
  },
  {
    sportPatterns: [/\bbaseball\b/],
    positionPatterns: [/\bof\b|\boutfield\b|\bcf\b|\blf\b|\brf\b/],
    buildQuestion: (athleteFirst) =>
      `In the outfield, is ${athleteFirst}'s separator speed, arm strength, reads, or the bat?`,
  },
  {
    sportPatterns: [/\bbaseball\b/],
    positionPatterns: [/\bdh\b|\bdesignated hitter\b|\butil\b|\butility\b/],
    buildQuestion: (athleteFirst) =>
      `Is ${athleteFirst}'s biggest baseball value the bat, versatility, athleticism, or a specific defensive spot?`,
  },
  {
    sportPatterns: [/\bbasketball\b/],
    positionPatterns: [/\bpg\b|\bpoint guard\b/],
    buildQuestion: (athleteFirst) =>
      `At point guard, is ${athleteFirst}'s separator handle, decision-making, shooting, or ability to defend?`,
  },
  {
    sportPatterns: [/\bbasketball\b/],
    positionPatterns: [/\bsg\b|\bshooting guard\b|\bguard\b/],
    buildQuestion: (athleteFirst) =>
      `At guard, is ${athleteFirst}'s separator shooting, handle, downhill ability, or defense?`,
  },
  {
    sportPatterns: [/\bbasketball\b/],
    positionPatterns: [/\bsf\b|\bsmall forward\b|\bwing\b/],
    buildQuestion: (athleteFirst) =>
      `On the wing, is ${athleteFirst}'s separator shooting, slashing, defense, or versatility?`,
  },
  {
    sportPatterns: [/\bbasketball\b/],
    positionPatterns: [/\bpf\b|\bpower forward\b|\bpost\b/],
    buildQuestion: (athleteFirst) =>
      `In the frontcourt, is ${athleteFirst}'s separator size, rebounding, skill, or defensive versatility?`,
  },
  {
    sportPatterns: [/\bbasketball\b/],
    positionPatterns: [/\bc\b|\bcenter\b/],
    buildQuestion: (athleteFirst) =>
      `At center, is ${athleteFirst}'s separator size, rim protection, rebounding, touch, or mobility?`,
  },
];

function normalizeSport(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function firstName(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] || null;
}

function titleCase(value?: string | null): string {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function cleanPositions(value?: string | null): string | null {
  if (!value) return null;
  const withoutPrefix = String(value)
    .replace(/^Positions?/i, '')
    .replace(/^[:\-\s]+/, '')
    .trim();
  const tokens = withoutPrefix
    .split(/\||,|\/|•/)
    .map((token) => token.replace(/^Positions?/i, '').trim())
    .filter(Boolean);
  const cleaned = tokens.length ? tokens.join(' | ') : withoutPrefix;
  return cleaned || null;
}

function formatCityState(city?: string | null, state?: string | null): string | null {
  const cityValue = titleCase(city);
  const stateValue = titleCase(state);
  const parts = [cityValue, stateValue].filter(Boolean);
  if (!parts.length) {
    return null;
  }
  if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
    return parts[0];
  }
  return parts.join(', ');
}

function parseGpa(value?: string | null): number | null {
  const parsed = Number.parseFloat(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function getGpaBand(value?: string | null): GpaBand {
  const gpa = parseGpa(value);
  if (gpa === null) return 'unknown';
  if (gpa >= 3.5) return 'high';
  if (gpa < 2.8) return 'low';
  return 'medium';
}

function getSportFamily(value?: string | null): SportFamily {
  const sport = normalizeSport(value);
  if (sport.includes('football')) return 'football';
  if (sport.includes('basketball')) return 'basketball';
  if (sport.includes('baseball')) return 'baseball';
  return 'generic';
}

function resolveAthletePronouns(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
): AthletePronouns {
  const sport = normalizeSport(context?.resolved.sport || values.sport)
    .replace(/[’']/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ');

  const isFemaleSport =
    /\b(womens|women|girls|female)\b/.test(sport) ||
    /\b(softball|volleyball|field hockey|gymnastics|cheer|dance)\b/.test(sport);
  if (isFemaleSport) {
    return { subject: 'she', object: 'her', possessive: 'her' };
  }

  return { subject: 'he', object: 'him', possessive: 'his' };
}

function getFootballPositionGroup(value?: string | null): FootballPositionGroup {
  const normalized = String(value || '')
    .toUpperCase()
    .replace(/\bWIDE RECEIVER\b/g, 'WR')
    .replace(/\bRUNNING BACK\b/g, 'RB')
    .replace(/\bTIGHT END\b/g, 'TE')
    .replace(/\bOFFENSIVE LINE\b/g, 'OL')
    .replace(/\bDEFENSIVE LINE\b/g, 'DL')
    .replace(/\bLINEBACKER\b/g, 'LB')
    .replace(/\bDEFENSIVE BACK\b/g, 'DB')
    .replace(/\bCORNERBACK\b/g, 'CB')
    .replace(/\bSAFETY\b/g, 'S');

  const tokens = new Set(
    normalized
      .split(/[^A-Z0-9]+/)
      .map((token) => token.trim())
      .filter(Boolean),
  );

  if (tokens.has('QB')) return 'qb';
  if (['OL', 'OT', 'OG', 'C', 'DL', 'DT', 'DE', 'NT'].some((token) => tokens.has(token))) {
    return 'ol_dl';
  }
  if (['WR', 'RB', 'TE', 'ATH'].some((token) => tokens.has(token))) return 'skill';
  if (['LB', 'MLB', 'OLB', 'ILB', 'DB', 'CB', 'S', 'FS', 'SS'].some((token) => tokens.has(token))) {
    return 'lb_db';
  }
  return 'generic';
}

function athleteFirstName(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  return (
    firstName(context?.contactInfo.studentAthlete.name || values.athleteName) || values.athleteName
  );
}

function sportLabel(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  return titleCase(context?.resolved.sport || values.sport) || 'their sport';
}

function collegeSportLabel(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  return `college ${sportLabel(values, context).toLowerCase()}`;
}

function resolvedMaxPrepsMascot(context?: ScoutPrepContext): string | null {
  return (
    String(context?.resolved.maxpreps?.mascot || context?.resolved.maxpreps_mascot || '').trim() ||
    null
  );
}

function resolvedMaxPrepsStateRank(context?: ScoutPrepContext): string | null {
  const rawRank = String(
    context?.resolved.maxpreps?.state_rank || context?.resolved.maxpreps_state_rank || '',
  ).trim();
  if (!rawRank) {
    return null;
  }

  const state = String(context?.resolved.state || '')
    .trim()
    .toUpperCase();
  if (/rank/i.test(rawRank)) {
    return rawRank;
  }
  return state ? `${state} Rank ${rawRank.replace(/^#/, '')}` : `Rank ${rawRank.replace(/^#/, '')}`;
}

function buildMaxPrepsSnapshotLine(context?: ScoutPrepContext): string | null {
  const mascot = resolvedMaxPrepsMascot(context);
  const stateRank = resolvedMaxPrepsStateRank(context);
  if (!mascot) {
    return null;
  }

  return [mascot, stateRank].filter(Boolean).join(' • ');
}

function buildSnapshotLines(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const snapshot: Array<[string, string | null | undefined]> = [
    ['Athlete', context?.contactInfo.studentAthlete.name || values.athleteName],
    ['Parent 1', context?.contactInfo.parent1?.name || values.parent1Name],
    ['Parent 2', context?.contactInfo.parent2?.name || values.parent2Name],
    ['Sport', context?.resolved.sport || values.sport],
    ['Grad Year', values.gradYear],
    ['GPA', context?.resolved.gpa],
    [
      'Height / Weight',
      [context?.resolved.height, context?.resolved.weight].filter(Boolean).join(' / ') || null,
    ],
    ['Position', cleanPositions(context?.resolved.positions)],
    ['School', context?.resolved.high_school],
    ['City / State', formatCityState(context?.resolved.city, context?.resolved.state)],
    ['Maxpreps', buildMaxPrepsSnapshotLine(context)],
  ];

  return snapshot
    .filter(([, value]) => Boolean(String(value || '').trim()))
    .map(([label, value]) => `- **${label}:** ${String(value).trim()}`);
}

export function buildDeterministicRapportCues(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
): string[] {
  const state = titleCase(context?.resolved.state);
  const cityState = formatCityState(context?.resolved.city, context?.resolved.state);
  const athleteFirst = athleteFirstName(values, context);
  const sport = getSportFamily(context?.resolved.sport || values.sport);
  const pronouns = resolveAthletePronouns(values, context);

  if (state) {
    const followUp =
      sport === 'football'
        ? `What about ${athleteFirst}, is ${pronouns.subject} big into following football too?`
        : `Is ${athleteFirst} pretty locked in on ${sportLabel(values, context).toLowerCase()} right now?`;
    return [`You guys are up in ${state}, right?`, followUp];
  }
  if (cityState) {
    return [`You guys are in ${cityState}, right?`];
  }
  return [
    `Is ${athleteFirst} pretty locked in on ${sportLabel(values, context).toLowerCase()} right now?`,
  ];
}

function buildRapportQuestions(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const first = athleteFirstName(values, context);
  const state = titleCase(context?.resolved.state);
  const sport = getSportFamily(context?.resolved.sport || values.sport);
  const pronouns = resolveAthletePronouns(values, context);

  if (sport === 'football') {
    return [
      state ? `You guys are up in ${state}, right?` : 'Is football pretty big around your area?',
      `What about ${first}, is ${pronouns.subject} big into following football too?`,
    ].slice(0, state ? 2 : 1);
  }

  return [
    state
      ? `You guys are up in ${state}, right?`
      : `Is ${sportLabel(values, context).toLowerCase()} pretty big for ${pronouns.object} right now?`,
  ];
}

function buildGpaToneLine(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  const athleteFirst = athleteFirstName(values, context);
  const gpa = String(context?.resolved.gpa || '').trim();
  if (!gpa) {
    return `How is ${athleteFirst} doing in the classroom right now?`;
  }

  const band = getGpaBand(gpa);
  if (band === 'high') {
    return `With a ${gpa}, academics can be a real strength in the recruiting conversation.`;
  }
  if (band === 'medium') {
    return `A ${gpa} gives coaches something solid to work with academically.`;
  }
  if (parseGpa(gpa) !== null && Number.parseFloat(gpa) >= 2.3) {
    return `Academically, we just want to make sure ${athleteFirst} stays eligible and nothing gets in the way.`;
  }
  return 'Academically, that is something we need to look at carefully because eligibility can become a real blocker.';
}

function buildPositionSpecificPrompts(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
): string[] {
  const sport = getSportFamily(context?.resolved.sport || values.sport);
  const position = cleanPositions(context?.resolved.positions);
  const positionQuestion = findPositionQuestion(values, context);
  const pronouns = resolveAthletePronouns(values, context);

  if (positionQuestion) {
    return [
      positionQuestion,
      `What do coaches usually notice first when they watch ${pronouns.object}?`,
    ];
  }

  if (sport !== 'football') {
    return [
      buildSportRoleQuestion(values, context),
      `What do coaches usually notice first when they watch ${pronouns.object}?`,
    ];
  }

  const prefix = position ? `I see ${athleteFirstName(values, context)} plays ${position}.` : '';
  const group = getFootballPositionGroup(position);
  if (group === 'ol_dl') {
    return [
      `${prefix} What’s ${pronouns.possessive} size and frame looking like right now?`.trim(),
      `Where is ${pronouns.subject} strength-wise: squat, bench, or anything coaches ask about?`,
      `How quick is ${pronouns.subject} off the ball, and what kind of varsity role does ${pronouns.subject} have?`,
    ];
  }
  if (group === 'skill') {
    return [
      `${prefix} What kind of production did ${pronouns.subject} have this season?`.trim(),
      `What are ${pronouns.possessive} speed numbers, and how explosive does ${pronouns.subject} look in space?`,
      `Is ${pronouns.subject} a main option, rotation player, returner, or used in multiple roles?`,
    ];
  }
  if (group === 'qb') {
    return [
      `${prefix} How does ${pronouns.subject} lead the group when things get tight?`.trim(),
      `How would you describe ${pronouns.possessive} arm talent, accuracy, and decision-making?`,
      `What does ${pronouns.possessive} coach say ${pronouns.subject} does best as a quarterback?`,
    ];
  }
  if (group === 'lb_db') {
    return [
      `${prefix} What kind of production does ${pronouns.subject} have: tackles, coverage plays, turnovers?`.trim(),
      `How is ${pronouns.possessive} speed, instincts, and ability to play in space?`,
      `Can ${pronouns.subject} play multiple spots, or is ${pronouns.subject} locked into one role?`,
    ];
  }
  return [
    position
      ? `I see ${athleteFirstName(values, context)} plays ${position}. What does ${pronouns.subject} do best there?`
      : `What position is ${pronouns.subject} playing the most right now?`,
    `What do you feel coaches would notice first about ${pronouns.object} on the field?`,
  ];
}

function buildSummaryLine(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  const sport = sportLabel(values, context);
  const first = athleteFirstName(values, context);
  const gpaBand = getGpaBand(context?.resolved.gpa);
  const pronouns = resolveAthletePronouns(values, context);

  if (gpaBand === 'high') {
    return `“So from what I’m hearing, you’ve got a high-academic kid, serious about ${sport.toLowerCase()}, and now it’s about making sure the right coaches actually know who ${pronouns.subject} is.”`;
  }

  if (values.gradYear === 'Senior') {
    return `“So from what I’m hearing, ${first} is serious about ${sport.toLowerCase()}, and now it’s about getting clear on what is real right now.”`;
  }

  return `“So from what I’m hearing, ${first} is serious about ${sport.toLowerCase()}, and now it’s about making sure the right coaches actually know who ${pronouns.subject} is.”`;
}

function isSportMatch(sport: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(sport));
}

function findPositionQuestion(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
): string | null {
  const sport = sportLabel(values, context).toLowerCase();
  const position = cleanPositions(context?.resolved.positions);
  if (!position) return null;

  const normalizedPosition = position.toLowerCase();
  const rule = POSITION_QUESTION_RULES.find(
    (candidate) =>
      isSportMatch(sport, candidate.sportPatterns) &&
      isSportMatch(normalizedPosition, candidate.positionPatterns),
  );

  return rule?.buildQuestion(athleteFirstName(values, context), position) || null;
}

function buildSportRoleQuestion(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  const sport = getSportFamily(context?.resolved.sport || values.sport);
  const athleteFirst = athleteFirstName(values, context);
  const position = cleanPositions(context?.resolved.positions);
  const pronouns = resolveAthletePronouns(values, context);

  if (sport === 'baseball') {
    return position
      ? `Where does ${athleteFirst} project best long-term in baseball: ${position}, another spot, or more as a bat?`
      : `What is ${athleteFirst}'s main baseball role right now: position, bat, arm, or overall athlete?`;
  }

  if (sport === 'basketball') {
    return position
      ? `How is ${athleteFirst} being used right now, and what does that position ask him to do best?`
      : `What role is ${athleteFirst} playing most right now: primary ball-handler, scorer, defender, shooter, or inside presence?`;
  }

  return position
    ? `I see ${athleteFirst} plays ${position}. What does ${pronouns.subject} do best there?`
    : `What role is ${athleteFirst} playing the most right now?`;
}

function resolveRecruitingTimelineReference(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
): RecruitingTimelineReference {
  const sport = sportLabel(values, context).toLowerCase();
  return (
    RECRUITING_TIMELINE_REFERENCES.find((reference) => isSportMatch(sport, reference.patterns)) || {
      ...DEFAULT_RECRUITING_TIMELINE,
      label: sport || DEFAULT_RECRUITING_TIMELINE.label,
    }
  );
}

function hasCoachContactWindowOpened(
  reference: RecruitingTimelineReference,
  now = new Date(),
): boolean {
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  if (currentMonth > reference.contactMonth) return true;
  if (currentMonth < reference.contactMonth) return false;
  return currentDay >= reference.contactDay;
}

function recruitingTimelineLine(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  const athleteFirst = athleteFirstName(values, context);
  const reference = resolveRecruitingTimelineReference(values, context);
  const sport = reference.label;
  const date = reference.coachContactDate;
  const dateLabel = reference.contactDateLabel;
  const windowOpened = hasCoachContactWindowOpened(reference);

  if (values.gradYear === 'Freshman') {
    return `For ${sport}, the coach-call window is ${date}, but the athletes who win that window are usually on the map before it opens.`;
  }

  if (values.gradYear === 'Sophomore') {
    return `For ${sport}, ${date} is the date to be ready for; if ${athleteFirst} is not already on lists, you end up playing catch-up.`;
  }

  if (values.gradYear === 'Junior') {
    if (windowOpened) {
      return `For ${sport}, ${dateLabel} is the coach-call window; if the phone is quiet now, the plan needs work.`;
    }
    return `For ${sport}, ${dateLabel} is when coaches can start calling juniors; that date only matters if ${athleteFirst} is already on their radar.`;
  }

  return 'At senior year, the intro window is behind you; this is about real coach contact, offers, and right-fit roster spots now.';
}

function buildDeficitLines(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const athleteFirst = athleteFirstName(values, context);
  const reference = resolveRecruitingTimelineReference(values, context);
  const sport = reference.label;
  const contactDateLine = recruitingTimelineLine(values, context);
  const pronouns = resolveAthletePronouns(values, context);

  if (values.gradYear === 'Junior') {
    if (!hasCoachContactWindowOpened(reference)) {
      return [
        contactDateLine,
        `The goal is to use this window before ${reference.contactDateLabel} to make sure the right coaches know who ${pronouns.subject} is.`,
      ];
    }
    return [
      contactDateLine,
      `If ${athleteFirst} is not getting personal coach contact for ${sport}, we need to catch him up.`,
    ];
  }

  if (values.gradYear === 'Freshman') {
    return [
      contactDateLine,
      `Early does not mean rushed; it means coaches know who ${pronouns.subject} is before everyone else catches up.`,
    ];
  }

  if (values.gradYear === 'Sophomore') {
    return [
      contactDateLine,
      `For ${sport}, this is the year ${athleteFirst} should move from profile to real coach conversations.`,
    ];
  }

  return [
    'Signing windows are active now, so we need to know what is real and what is just noise.',
    `If ${athleteFirst} has interest but no right-fit offer, the family needs a clear plan immediately.`,
  ];
}

function buildMeasurablePrompts(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const sport = getSportFamily(context?.resolved.sport || values.sport);
  const pronouns = resolveAthletePronouns(values, context);
  if (sport === 'football') {
    return [
      'Height, weight, 40, shuttle, anything like that you feel coaches usually react to?',
      'Any updated strength numbers or offseason testing numbers?',
    ];
  }
  if (sport === 'baseball') {
    return [
      'Any 60 time or arm strength numbers?',
      'Any recent stats, varsity role, travel ball level, or coach feedback that stands out?',
    ];
  }
  if (sport === 'basketball') {
    return [
      `What proof does ${pronouns.subject} have right now: varsity role, AAU level, production, shooting, handle, defense, or coach feedback?`,
      'Any stats, film moments, or coach feedback that usually gets people interested?',
    ];
  }
  return [
    'Are there any numbers that really stand out right now?',
    'What measurables do coaches usually react to first?',
  ];
}

function buildAcademicScoutNote(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  const gpaTone = buildGpaToneLine(values, context);
  const pronouns = resolveAthletePronouns(values, context);
  if (String(context?.resolved.gpa || '').trim()) {
    return `${gpaTone} Does ${athleteFirstName(values, context)} know what ${pronouns.subject} may want to major in?`;
  }
  return `${gpaTone} Does ${pronouns.subject} know what ${pronouns.subject} may want to major in?`;
}

function buildMaxPrepsLevelPrompt(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
): string | null {
  const mascot = resolvedMaxPrepsMascot(context);
  if (!mascot) {
    return null;
  }

  const athleteFirst = athleteFirstName(values, context);
  return `What level was ${athleteFirst} playing at as a ${values.gradYear.toLowerCase()} for the ${mascot}?`;
}

function selectSinglePrompt(prompts: string[]): string | null {
  return prompts.find((prompt) => prompt.trim().length > 0) || null;
}

function selectStrongestDeficitLines(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
): string[] {
  return buildDeficitLines(values, context)
    .slice(0, 2)
    .map((line) => line.replace(/^“|”$/g, ''));
}

function blockQuote(lines: string[]): string {
  return lines.map((line, index) => `> ${line}${index < lines.length - 1 ? '  ' : ''}`).join('\n');
}

function buildCallPathLines(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const athleteFirst = athleteFirstName(values, context);
  const parent1First =
    firstName(context?.contactInfo.parent1?.name || values.parent1Name) || 'Parent';
  const position = cleanPositions(context?.resolved.positions);
  const collegeSport = collegeSportLabel(values, context);
  const positionPrompt =
    selectSinglePrompt(buildPositionSpecificPrompts(values, context)) ||
    (position
      ? `What does ${athleteFirst} do best at ${position}?`
      : `What does ${athleteFirst} do best in ${collegeSport}?`);
  const measurablePrompt =
    selectSinglePrompt(buildMeasurablePrompts(values, context)) ||
    'What do coaches usually react to first?';
  const maxPrepsLevelPrompt = buildMaxPrepsLevelPrompt(values, context);

  return [
    [
      '### Greeting / Reason',
      '',
      blockQuote([
        `Hi ${parent1First}, I’m Jerami Singleton with Prospect ID. How are you today?`,
        `I’m following up on ${athleteFirst}. ${athleteFirst} made a profile to connect with college coaches and is showing clear interest in playing ${collegeSport}. Did ${athleteFirst} mention this to you, or is this kind of a blindside?`,
      ]),
      '',
      '**If Unaware, Say:**',
      blockQuote([
        'No problem, let me take a few steps back.',
        'Prospect ID is a recruiting platform where student-athletes can create an online recruiting resume to help streamline getting connected with college coaches.',
        `We ONLY work with what we call our Top 500: the athletes we choose to work with in each grad year and sport. Some athletes do not make the cut, whether it is grades, character, talent, or fit, so this call is really to see if ${athleteFirst} belongs in that group.`,
      ]),
    ].join('\n'),
    [
      '### Confirm Interest',
      '',
      `- Are you comfortable with ${athleteFirst} taking steps to get in front of college coaches?`,
    ].join('\n'),
    [
      '### Scout Notes',
      '',
      `- ${buildAcademicScoutNote(values, context)}`,
      maxPrepsLevelPrompt ? `- ${maxPrepsLevelPrompt}` : null,
      `- ${positionPrompt}`,
      `- ${measurablePrompt}`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
    [
      '### Summary / Deficit',
      '',
      buildSummaryLine(values, context),
      '',
      ...selectStrongestDeficitLines(values, context).map((line) => `- ${line}`),
    ].join('\n'),
    [
      '### Set Meeting',
      '',
      blockQuote([
        `So the next step is getting you, ${athleteFirst}, and mom on a Zoom with one of our scouts so they can evaluate where ${athleteFirst} is and what needs to happen next.`,
        'They have [Day/Time Option 1] or [Day/Time Option 2]. Which works better?',
      ]),
    ].join('\n'),
    [
      '### Meeting Requirements',
      '',
      `Real quick, ${parent1First}: Coach is holding that time specifically for your family, so I want to make sure everyone can be there and ready so it’s a productive meeting for everybody.`,
      '',
      '- Full family on the call: parent, athlete, and mom/dad.',
      '- Be on a laptop/tablet or have Zoom ready.',
      '- Scout will call your cell with the Zoom code.',
    ].join('\n'),
  ];
}

export function buildScoutPrepCard(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
  ai?: ScoutPrepAIOutput,
): ScoutPrepCardResult {
  const anchors = buildDeterministicRapportCues(values, context);
  const snapshotLines = buildSnapshotLines(values, context);
  const callPathLines = buildCallPathLines(values, context);

  const markdown = [
    '# Scout Prep Card',
    `**${context?.contactInfo.studentAthlete.name || values.athleteName}**`,
    ai?.localTimeInsight ? `> ${ai.localTimeInsight}` : null,
    '',
    '## Athlete Snapshot',
    snapshotLines.join('\n'),
    '',
    '## Call Path',
    callPathLines.join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    markdown,
    diagnostics: {
      anchorCount: anchors.length,
      snapshotFieldCount: snapshotLines.length,
      deficitGrade: values.gradYear,
      rapportSource: ai?.rapportSource || 'deterministic',
      hasLocalTime: Boolean(ai?.localTimeInsight),
      hasState: Boolean(String(context?.resolved.state || '').trim()),
      hasCity: Boolean(String(context?.resolved.city || '').trim()),
      hasSchool: Boolean(String(context?.resolved.high_school || '').trim()),
      hasSport: Boolean(String(context?.resolved.sport || values.sport || '').trim()),
      hasParent1: Boolean(
        String(context?.contactInfo.parent1?.name || values.parent1Name || '').trim(),
      ),
    },
  };
}

export function buildScoutPrepMarkdown(values: ScoutPrepFormValues): string {
  return buildScoutPrepCard(values).markdown;
}
