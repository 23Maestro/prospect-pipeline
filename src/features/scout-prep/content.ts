import type {
  ScoutPrepAIOutput,
  ScoutPrepContext,
  ScoutPrepFormValues,
  ScoutPrepGrade,
  ScoutPrepMicroEnrichment,
} from './types';

type ScoutPrepCardDiagnostics = {
  anchorCount: number;
  snapshotFieldCount: number;
  deficitGrade: ScoutPrepGrade;
  rapportSource: 'ai' | 'fallback';
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
type QuestionBlock = {
  title: string;
  anchor: string;
  questions: string[];
  reminder?: string;
};

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

function athleteFirstName(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  return (
    firstName(context?.contactInfo.studentAthlete.name || values.athleteName) || values.athleteName
  );
}

function sportLabel(values: ScoutPrepFormValues, context?: ScoutPrepContext): string {
  return titleCase(context?.resolved.sport || values.sport) || 'their sport';
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
  const sport = getSportFamily(context?.resolved.sport || values.sport);
  const state = titleCase(context?.resolved.state);
  const cityState = formatCityState(context?.resolved.city, context?.resolved.state);
  const school = String(context?.resolved.high_school || '').trim();
  const gpa = String(context?.resolved.gpa || '').trim();
  const gpaBand = getGpaBand(context?.resolved.gpa);

  const localCue =
    sport === 'football' && state
      ? `${state} football is serious football country.`
      : sport === 'basketball' && state
        ? `${state} hoops culture gives you an easy way into the conversation.`
        : sport === 'baseball' && cityState
          ? `${cityState} is a clean way to open before you get into baseball development.`
          : school
            ? `${school} gives you a clean local tie-in right away.`
            : cityState
              ? `${cityState} gives you an easy local opener.`
              : `Use ${sportLabel(values, context)} as the easy entry point before you qualify him.`;

  const academicsCue =
    gpaBand === 'high' && gpa
      ? `And with a ${gpa} GPA, it sounds like he is doing his part in the classroom too.`
      : gpaBand === 'low'
        ? `Academics may need a little more support, so keep that part encouraging and direct.`
        : school
          ? `Reference ${school} early so the call feels tied to his real school world.`
          : `Keep the opener human and simple before you start qualifying him.`;

  return [localCue, academicsCue].slice(0, 2);
}

function lineOrFallback(value: string | null | undefined, fallback: string): string {
  const cleaned = String(value || '').trim();
  return cleaned || fallback;
}

function buildRapportQuestions(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const sport = getSportFamily(context?.resolved.sport || values.sport);
  const first = athleteFirstName(values, context);
  const gpaBand = getGpaBand(context?.resolved.gpa);
  const gpa = String(context?.resolved.gpa || '').trim();

  const sportQuestion =
    sport === 'football'
      ? 'How big of a deal is football around your area once the season gets going?'
      : sport === 'basketball'
        ? 'Is basketball pretty much year-round for him at this point between school ball and everything else?'
        : sport === 'baseball'
          ? 'Is travel baseball a big part of the picture for him right now, or mostly school ball?'
          : `What has ${first} enjoyed most about ${sportLabel(values, context)} so far?`;

  const academicsQuestion =
    gpaBand === 'high' && gpa
      ? `With that ${gpa} GPA, has school discipline always come pretty naturally for ${first}?`
      : gpaBand === 'low'
        ? `How is ${first} doing balancing school with everything else right now?`
        : `How has ${first} handled the school side while trying to take this seriously?`;

  return [sportQuestion, academicsQuestion];
}

function buildCurrentLevelBlock(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
): QuestionBlock {
  const sport = getSportFamily(context?.resolved.sport || values.sport);

  if (sport === 'baseball') {
    return {
      title: 'Current Level',
      anchor: 'With baseball, school role and travel role both matter.',
      questions: [
        'Is he on varsity right now, JV, or still working into that role?',
        'Where has he really carved out innings or opportunities so far?',
      ],
    };
  }

  return {
    title: 'Current Level',
    anchor: 'You want to understand his real role right now before you jump into upside.',
    questions: [
      'Is he on varsity right now, JV, or a mix of both?',
      'Where has he really carved out his role so far?',
    ],
  };
}

function buildVarsityExperienceBlock(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
): QuestionBlock {
  const first = athleteFirstName(values, context);

  if (values.gradYear === 'Freshman' || values.gradYear === 'Sophomore') {
    return {
      title: 'Varsity Experience',
      anchor: 'At this stage, the goal is to learn how fast he is growing into varsity-level ball.',
      questions: [
        `How much varsity experience has ${first} had so far?`,
        'Has that level come pretty naturally, or has he really had to grow into it?',
      ],
    };
  }

  return {
    title: 'Varsity Experience',
    anchor:
      'By this stage, coaches are going to care about real varsity track record, not just upside.',
    questions: [
      `How much varsity experience does ${first} really have at this point?`,
      'When he is at that level, what has he shown he can consistently do?',
    ],
  };
}

function buildSportSpecificBlock(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
  enrichment?: ScoutPrepMicroEnrichment | null,
): QuestionBlock {
  const sport = getSportFamily(context?.resolved.sport || values.sport);

  if (sport === 'football') {
    return {
      title: 'Sport-Specific / Position',
      anchor: lineOrFallback(
        enrichment?.sportPromptBias,
        'Football recruiting gets clearer once you know role, position fit, and what jumps off the film.',
      ),
      questions: [
        'What position is he playing the most right now?',
        'What do you feel coaches would notice first about him on the field?',
      ],
    };
  }

  if (sport === 'basketball') {
    return {
      title: 'Sport-Specific / Position',
      anchor: lineOrFallback(
        enrichment?.sportPromptBias,
        'Basketball recruiting gets sharper once you know role, level, and what separates him.',
      ),
      questions: [
        'Is he mostly a guard, forward, or a little bit of both right now?',
        'What do you feel really separates him when people watch him play?',
      ],
    };
  }

  if (sport === 'baseball') {
    return {
      title: 'Sport-Specific / Position',
      anchor: lineOrFallback(
        enrichment?.sportPromptBias,
        'Baseball recruiting gets clearer once you know position fit and which tools really carry him.',
      ),
      questions: [
        'What position is he playing the most right now?',
        'What tools or traits do you feel stand out first when coaches watch him?',
      ],
    };
  }

  return {
    title: 'Sport-Specific / Position',
    anchor: lineOrFallback(
      enrichment?.sportPromptBias,
      'You want a clean picture of role and what coaches would notice first.',
    ),
    questions: [
      'What role is he playing the most right now?',
      'What do you feel coaches would notice first about him?',
    ],
  };
}

function buildMeasurablesBlock(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
): QuestionBlock {
  const sport = getSportFamily(context?.resolved.sport || values.sport);

  if (sport === 'football') {
    return {
      title: 'Measurables / Numbers',
      anchor: 'Football coaches react quickly to clean measurables and testing numbers.',
      questions: [
        'Are there any numbers that really stand out about him right now?',
        'Height, weight, 40, anything like that you feel coaches usually react to?',
      ],
    };
  }

  if (sport === 'basketball') {
    return {
      title: 'Measurables / Numbers',
      anchor: 'With basketball, size, length, and athletic tools help frame the player fast.',
      questions: [
        'What measurables do you feel stand out the most right now?',
        'Height, length, vertical, anything coaches usually respond to?',
      ],
    };
  }

  if (sport === 'baseball') {
    return {
      title: 'Measurables / Numbers',
      anchor: 'With baseball, coaches usually want a clean tool-based snapshot pretty fast.',
      questions: [
        'Are there any numbers that really stand out right now?',
        'Velocity, pop time, 60, anything coaches usually react to?',
      ],
    };
  }

  return {
    title: 'Measurables / Numbers',
    anchor: 'Useful numbers help coaches place the athlete faster.',
    questions: [
      'Are there any numbers that really stand out right now?',
      'What measurables do coaches usually react to first?',
    ],
  };
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

function buildCallPathLines(
  values: ScoutPrepFormValues,
  context?: ScoutPrepContext,
  enrichment?: ScoutPrepMicroEnrichment | null,
): string[] {
  const athleteFirst = athleteFirstName(values, context);
  const parent1First =
    firstName(context?.contactInfo.parent1?.name || values.parent1Name) || 'Parent';
  const parent2First = firstName(context?.contactInfo.parent2?.name || values.parent2Name);
  const sport = sportLabel(values, context);
  const position = cleanPositions(context?.resolved.positions);
  const gpa = String(context?.resolved.gpa || '').trim();
  const gradeLabel = values.gradYear.toLowerCase();
  const fallbackRapportCues = buildDeterministicRapportCues(values, context);
  const rapportCues = [
    lineOrFallback(enrichment?.rapportAnchor, fallbackRapportCues[0] || ''),
    lineOrFallback(enrichment?.suggestedLiveRapportLane, fallbackRapportCues[1] || ''),
  ].filter(Boolean);
  const rapportQuestions = buildRapportQuestions(values, context);
  const currentLevelBlock = buildCurrentLevelBlock(values, context);
  const varsityBlock = buildVarsityExperienceBlock(values, context);
  const sportBlock = buildSportSpecificBlock(values, context, enrichment);
  const measurableBlock = buildMeasurablesBlock(values, context);
  const commitmentNames = [parent1First, parent2First, athleteFirst].filter(Boolean).join(', ');

  return [
    `1. **Open / Connect Dots**\n“Hi ${parent1First}, this is Jerami, I’m a ${sport} scout with Prospect ID. The reason I’m calling is ${athleteFirst} filled out some info about playing in college. Did they mention that to you?”`,
    [
      '2. **Rapport / Open**',
      `#### **Anchor: ${rapportCues[0] || `Use ${sport} as the easiest way into the conversation.`}**`,
      rapportCues[1] ? `> ${rapportCues[1]}` : null,
      `- Q1: ${rapportQuestions[0] || `What has ${athleteFirst} enjoyed most about ${sportLabel(values, context).toLowerCase()} so far?`}`,
      `- Q2: ${rapportQuestions[1] || `How has ${athleteFirst} handled the school side while trying to take this seriously?`}`,
    ]
      .filter(Boolean)
      .join('\n'),
    [
      '3. **Open Them Up**',
      `- What kind of kid is ${athleteFirst}? Any hobbies or interests that have him thinking about his major?`,
      gpa
        ? `- ${lineOrFallback(enrichment?.gpaToneLine, `You must be proud. It’s not easy to excel on and off the field, has school discipline always come pretty naturally for ${athleteFirst}?`)}`
        : `- What has stood out most to you about how ${athleteFirst} handles school and ${sport.toLowerCase()}?`,
    ].join('\n'),
    [
      '4. **Qualify + Build Up**',
      `> We work with what we call our Top 500 team, meaning we only work with 500 ${sport} athletes per grad class.`,
      `> And I want to see if ${athleteFirst} qualifies.`,
      '',
      `**${currentLevelBlock.title}**`,
      '',
      `- Q1: ${position ? `I see ${athleteFirst} plays ${position}. What’s his favorite position?` : currentLevelBlock.questions[0]}`,
      '- Q2: What were his stats like?',
      '',
      `**${varsityBlock.title.replace('Varsity', 'JV/Varsity')}**`,
      '',
      `- Q1: ${varsityBlock.questions[0]}`,
      '',
      `**${sportBlock.title}**`,
      '',
      `- ${sportBlock.anchor}`,
      '',
      `**${measurableBlock.title}**`,
      '',
      `- Q1: ${measurableBlock.questions[0]}`,
      `- Q2: ${measurableBlock.questions[1]}`,
    ].join('\n'),
    [
      '5. **Summarize Them Back**',
      buildSummaryLine(values, context),
      '',
      `He’s going to have a real chance to play in college. If you wait too long, it gets difficult to get caught up in the process, because coaches have already built relationships with other athletes.`,
    ].join('\n'),
    [
      '6. **Deficit**',
      `#### **${lineOrFallback(enrichment?.deficitEmphasis, `For ${gradeLabel}s, the big thing is just getting ${athleteFirst} on the map.`)}** I’m surprised there’s not more interest yet. What do you think is going on?`,
    ].join('\n'),
    [
      '7. **Closing Handoff**',
      `> “So the next step, ${parent1First}, is we gotta get you on the phone with one of our scouts, okay? Let me take a look at who’s available. What’s your availability looking like this weekend, or maybe Monday?”`,
    ].join('\n'),
    [
      '8. **Lock the Commitment**',
      `“But here’s the thing, ${parent1First}, he’s one of the best scouts in the nation, in the entire industry, okay? So if I book you for him, you guys have to show up. Can you make it for sure${commitmentNames ? `, ${commitmentNames}` : ''}?”`,
    ].join('\n'),
    [
      '9. **Meeting Requirements**',
      '“Number one, like I said, you have to have all three of you guys on the phone together, okay? The Head Scout is going to walk you through a 45 minute Zoom meeting, so make sure you have internet and Zoom pulled up when he calls.”',
    ].join('\n'),
    [
      '10. **Final Confirmation**',
      '“I’m also going to send you an email with the details about the meeting, so you can read through everything, okay? He’s going to be calling from a [area code] phone number, so watch out for his number.”',
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
  const callPathLines = buildCallPathLines(values, context, ai?.microEnrichment);

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
      rapportSource: ai?.rapportSource || 'fallback',
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
