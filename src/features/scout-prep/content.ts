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

  if (state) {
    const followUp =
      sport === 'football'
        ? `What about ${athleteFirst}, is he big into following football too?`
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

  if (sport === 'football') {
    return [
      state ? `You guys are up in ${state}, right?` : 'Is football pretty big around your area?',
      `What about ${first}, is he big into following football too?`,
    ].slice(0, state ? 2 : 1);
  }

  return [
    state
      ? `You guys are up in ${state}, right?`
      : `Is ${sportLabel(values, context).toLowerCase()} pretty big for him right now?`,
  ];
}

function buildGpaToneLine(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  const gpa = String(context?.resolved.gpa || '').trim();
  if (!gpa) {
    return `How is ${athleteFirstName(values, context)} doing in the classroom right now?`;
  }

  const band = getGpaBand(gpa);
  if (band === 'high') {
    return `With a ${gpa}, it sounds like he’s doing his part in the classroom too.`;
  }
  if (band === 'medium') {
    return `He can get into college with a ${gpa}.`;
  }
  return 'Academically, that’s something we’ll want to keep improving, but it doesn’t mean options are gone.';
}

function buildPositionSpecificPrompts(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
): string[] {
  const sport = getSportFamily(context?.resolved.sport || values.sport);
  const position = cleanPositions(context?.resolved.positions);

  if (sport !== 'football') {
    return [
      position
        ? `I see ${athleteFirstName(values, context)} plays ${position}. Where does he fit best right now?`
        : 'What role is he playing the most right now?',
      'What do coaches usually notice first when they watch him?',
    ];
  }

  const prefix = position ? `I see ${athleteFirstName(values, context)} plays ${position}.` : '';
  const group = getFootballPositionGroup(position);
  if (group === 'ol_dl') {
    return [
      `${prefix} What’s his size and frame looking like right now?`.trim(),
      'Where is he strength-wise: squat, bench, or anything coaches ask about?',
      'How quick is he off the ball, and what kind of varsity role does he have?',
    ];
  }
  if (group === 'skill') {
    return [
      `${prefix} What kind of production did he have this season?`.trim(),
      'What are his speed numbers, and how explosive does he look in space?',
      'Is he a main option, rotation guy, returner, or used in multiple roles?',
    ];
  }
  if (group === 'qb') {
    return [
      `${prefix} How does he lead the group when things get tight?`.trim(),
      'How would you describe his arm talent, accuracy, and decision-making?',
      'What does his coach say he does best as a quarterback?',
    ];
  }
  if (group === 'lb_db') {
    return [
      `${prefix} What kind of production does he have: tackles, coverage plays, turnovers?`.trim(),
      'How is his speed, instincts, and ability to play in space?',
      'Can he play multiple spots, or is he locked into one role?',
    ];
  }
  return [
    position
      ? `I see ${athleteFirstName(values, context)} plays ${position}. What does he do best there?`
      : 'What position is he playing the most right now?',
    'What do you feel coaches would notice first about him on the field?',
  ];
}

function buildSummaryLine(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  const sport = sportLabel(values, context);
  const first = athleteFirstName(values, context);
  const gpaBand = getGpaBand(context?.resolved.gpa);

  if (gpaBand === 'high') {
    return `“So from what I’m hearing, you’ve got a high-academic kid, serious about ${sport.toLowerCase()}, and now it’s about making sure the right coaches actually know who he is.”`;
  }

  if (values.gradYear === 'Senior') {
    return `“So from what I’m hearing, ${first} is serious about ${sport.toLowerCase()}, and now it’s about getting clear on what is real right now.”`;
  }

  return `“So from what I’m hearing, ${first} is serious about ${sport.toLowerCase()}, and now it’s about making sure the right coaches actually know who he is.”`;
}

function buildDeficitLines(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const athleteFirst = athleteFirstName(values, context);
  const heightWeight = [context?.resolved.height, context?.resolved.weight]
    .filter(Boolean)
    .join('/');

  if (values.gradYear === 'Junior') {
    return [
      '“You’re behind in recruiting, we gotta get him caught up.”',
      '“There’s other kids his age that have phone calls, for sure.”',
      heightWeight
        ? `“Being ${heightWeight}, we just gotta get him caught up.”`
        : '“If you want to get your son caught up in recruiting, be ready for this call.”',
    ];
  }

  if (values.gradYear === 'Freshman' || values.gradYear === 'Sophomore') {
    return [
      `“For sophomores, the big thing is just getting ${athleteFirst} on the map.”`,
      '“If he’s not getting calls at that point, he’s behind in recruiting.”',
    ];
  }

  return [
    `“With seniors, the question is where do things stand right now for ${athleteFirst}?”`,
    '“We need to know what is real, what is still open, and what needs to happen next.”',
  ];
}

function buildMeasurablePrompts(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const sport = getSportFamily(context?.resolved.sport || values.sport);
  if (sport === 'football') {
    return [
      'Height, weight, 40, shuttle, anything like that you feel coaches usually react to?',
      'Any updated strength numbers or offseason testing numbers?',
    ];
  }
  return [
    'Are there any numbers that really stand out right now?',
    'What measurables do coaches usually react to first?',
  ];
}

function blockQuote(lines: string[]): string {
  return lines.map((line) => `> ${line}`).join('\n>\n');
}

function buildCallPathLines(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const athleteFirst = athleteFirstName(values, context);
  const parent1First =
    firstName(context?.contactInfo.parent1?.name || values.parent1Name) || 'Parent';
  const position = cleanPositions(context?.resolved.positions);
  const gpa = String(context?.resolved.gpa || '').trim();
  const sport = sportLabel(values, context);
  const collegeSport = collegeSportLabel(values, context);
  const rapportQuestions = buildRapportQuestions(values, context);
  const positionPrompts = buildPositionSpecificPrompts(values, context);
  const measurablePrompts = buildMeasurablePrompts(values, context);
  const parent2Name = context?.contactInfo.parent2?.name || values.parent2Name || 'Mom';

  return [
    [
      '### Greeting',
      '',
      blockQuote([
        `Hi ${parent1First}, I’m Jerami Singleton, ${collegeSport} scout with Prospect ID. How are you today?`,
        `The reason I’m calling is ${athleteFirst} created a profile for connecting with college coaches and is showing an interest in playing in college. Did he happen to mention that to you?`,
      ]),
    ].join('\n'),
    [
      '### Connect the Dots',
      '',
      '**If Unaware, Say:**',
      blockQuote([
        'Let me take a step back and explain.',
        'It looks like your son filled out some information with us online about playing in college.',
        `Do you support ${athleteFirst} taking this step? Is ${athleteFirst} looking to play ${collegeSport}?`,
        'My job is to follow up with you and learn a little bit more about him as a student and as an athlete.',
        'We help families understand where they’re at in the recruiting process and what needs to happen next.',
        'I just want to make sure you understand who we are and why I’m calling before we move forward.',
      ]),
      '',
      '**If Aware, Proceed Here:**',
      blockQuote([
        `What we do is help athletes connect directly to college coaches, and because we only work with 500 athletes per grad year for ${sport.toLowerCase()}, we’re pretty selective on who we bring on board. So I’ve got a few questions for you about ${athleteFirst}.`,
      ]),
    ].join('\n'),
    [
      '### Qualify',
      '',
      '**Small rapport**',
      ...rapportQuestions.map((question) => `- ${question}`),
      '',
      '**Athlete intent / parent support**',
      `- Do you support ${athleteFirst} taking this step?`,
      `- Is ${athleteFirst} looking to play ${collegeSport}?`,
      '',
      '**Academics**',
      `- ${buildGpaToneLine(values, context)}`,
      gpa
        ? '- Is that about where he is right now, or has it moved recently?'
        : '- Do you know where his GPA is sitting?',
      '',
      '**Current level**',
      '- Is he on varsity right now, JV, or a mix of both?',
      position
        ? `- I see ${athleteFirst} plays ${position}. Where has he really carved out his role?`
        : '- Where has he really carved out his role so far?',
      '',
      '**Offseason / development**',
      '- What is he doing this offseason to get better?',
      '- Is he training, lifting, doing camps, or working with a position coach?',
      '',
      '**Position-specific prompts**',
      ...positionPrompts.map((question) => `- ${question}`),
      '',
      '**Measurables**',
      ...measurablePrompts.map((question) => `- ${question}`),
      '',
      '**Coach feedback / eye test**',
      '- What has his coach said about him?',
      '- When someone watches him, what do you think jumps out first?',
    ].join('\n'),
    [
      '### Summary → Deficit',
      '',
      buildSummaryLine(values, context),
      '',
      '**Deficit**',
      ...buildDeficitLines(values, context).map((line) => `- ${line.replace(/^“|”$/g, '')}`),
    ].join('\n'),
    [
      '### Introduce Scout',
      '',
      blockQuote([
        `So the next step, ${parent1First}, is we’ve gotta get you on the phone with one of our top scouts.`,
        'I’m gonna schedule you with [Scout Name]. He’s one of the best scouts in the entire industry.',
        'If I book you with [Scout Name], you guys have to be ready for the call.',
        'Let me check the calendar.',
      ]),
    ].join('\n'),
    [
      '### Set Meeting',
      '',
      blockQuote([
        'He’s got two openings.',
        'He’s got one [Day/Time Option 1]. Or [Day/Time Option 2].',
        'He’s got a couple requirements for that meeting.',
        `Number one, he needs to have the full family there, so that means yourself, ${athleteFirst}, and ${athleteFirst}’s mom. What’s mom’s name again?`,
      ]),
      parent2Name !== 'Mom' ? `> Mom: ${parent2Name}` : null,
      '',
      blockQuote([
        'Number two, he’s gonna walk you through a Zoom meeting, so make sure you have internet and Zoom ready when he calls.',
        'We don’t want to waste your time, and we don’t want to waste [Scout Name]’s time either.',
        'I’m gonna send you an email with the details about the meeting, so you can read through the details, okay?',
        'He’s gonna be calling from a [Area Code] phone number, so watch out for his number.',
      ]),
    ].join('\n'),
  ].map((section) => section.replace(/\nnull\b/g, ''));
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
