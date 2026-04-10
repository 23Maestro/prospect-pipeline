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
  rapportSource: 'ai' | 'fallback';
  hasLocalTime: boolean;
  hasMascotCue: boolean;
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

function buildOpenThemUpLines(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const first = athleteFirstName(values, context);
  return [
    `What kind of kid is ${first}?`,
    `How serious is ${first} really about playing in college?`,
    `What’s your read on where ${first} is at right now?`,
  ];
}

function buildAcademicsBlock(values: ScoutPrepFormValues, context?: ScoutPrepContext): QuestionBlock {
  const gpa = String(context?.resolved.gpa || '').trim();
  const gpaBand = getGpaBand(context?.resolved.gpa);
  const first = athleteFirstName(values, context);

  if (gpaBand === 'high' && gpa) {
    return {
      title: 'Academics / Major',
      anchor: `${gpa} GPA is impressive.`,
      questions: [
        `Has ${first} started to get a feel for what he may want to study in college?`,
        `Has school discipline always come pretty naturally for ${first}?`,
      ],
    };
  }

  if (gpaBand === 'low') {
    return {
      title: 'Academics / Major',
      anchor: 'Academics do not have to be perfect, but the plan around them has to be honest.',
      questions: [
        `Where do things stand for ${first} academically right now?`,
        `Does he need more support on the school side, or is it more about consistency?`,
      ],
    };
  }

  if (gpaBand === 'medium' && gpa) {
    return {
      title: 'Academics / Major',
      anchor: `${gpa} gives you a real academic base to work from.`,
      questions: [
        `Has ${first} started to get a feel for what he may want to study in college?`,
        `How has he handled balancing school with everything else?`,
      ],
    };
  }

  return {
    title: 'Academics / Major',
    anchor: 'Academics are still part of the recruiting picture, even if you do not have the number yet.',
    questions: [
      `How is ${first} doing in school right now?`,
      `Has he started thinking about what he may want to study in college?`,
    ],
  };
}

function buildCurrentLevelBlock(values: ScoutPrepFormValues, context?: ScoutPrepContext): QuestionBlock {
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
    anchor: 'By this stage, coaches are going to care about real varsity track record, not just upside.',
    questions: [
      `How much varsity experience does ${first} really have at this point?`,
      'When he is at that level, what has he shown he can consistently do?',
    ],
  };
}

function buildSportSpecificBlock(values: ScoutPrepFormValues, context?: ScoutPrepContext): QuestionBlock {
  const sport = getSportFamily(context?.resolved.sport || values.sport);

  if (sport === 'football') {
    return {
      title: 'Sport-Specific / Position',
      anchor:
        'Football recruiting gets clearer once you know role, position fit, and what jumps off the film.',
      questions: [
        'What position is he playing the most right now?',
        'What do you feel coaches would notice first about him on the field?',
      ],
    };
  }

  if (sport === 'basketball') {
    return {
      title: 'Sport-Specific / Position',
      anchor: 'Basketball recruiting gets sharper once you know role, level, and what separates him.',
      questions: [
        'Is he mostly a guard, forward, or a little bit of both right now?',
        'What do you feel really separates him when people watch him play?',
      ],
    };
  }

  if (sport === 'baseball') {
    return {
      title: 'Sport-Specific / Position',
      anchor: 'Baseball recruiting gets clearer once you know position fit and which tools really carry him.',
      questions: [
        'What position is he playing the most right now?',
        'What tools or traits do you feel stand out first when coaches watch him?',
      ],
    };
  }

  return {
    title: 'Sport-Specific / Position',
    anchor: 'You want a clean picture of role and what coaches would notice first.',
    questions: [
      'What role is he playing the most right now?',
      'What do you feel coaches would notice first about him?',
    ],
  };
}

function buildExposureBlock(values: ScoutPrepFormValues, context?: ScoutPrepContext): QuestionBlock {
  const first = athleteFirstName(values, context);

  if (values.gradYear === 'Freshman' || values.gradYear === 'Sophomore') {
    return {
      title: 'Exposure / Deficit',
      anchor: `For ${values.gradYear.toLowerCase()}s, the big thing is just getting ${first} on the map.`,
      questions: [
        'What kind of exposure has he had so far?',
        'Has anybody reached out yet from the college side, or are you guys still pretty early in that process?',
      ],
      reminder: 'If there is no real coach contact yet, the gap is exposure more than ability.',
    };
  }

  if (values.gradYear === 'Junior') {
    return {
      title: 'Exposure / Deficit',
      anchor: `At the junior stage, coaches should already be starting to know who ${first} is.`,
      questions: [
        'What kind of outreach or coach interest has there been so far?',
        'Does it feel like the right schools are actually seeing him yet?',
      ],
      reminder: 'If coach interest is still light now, visibility is probably lagging behind the ability.',
    };
  }

  return {
    title: 'Exposure / Deficit',
    anchor: `At the senior stage, the conversation has to be about where things stand right now for ${first}.`,
    questions: [
      'What real options or conversations are active right now?',
      'Where do you feel things still need to move quickly?',
    ],
    reminder: 'At this stage, the gap is urgency and clarity, not waiting around for things to happen.',
  };
}

function buildMeasurablesBlock(values: ScoutPrepFormValues, context?: ScoutPrepContext): QuestionBlock {
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

function buildDeficitLines(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const first = athleteFirstName(values, context);

  if (values.gradYear === 'Freshman' || values.gradYear === 'Sophomore') {
    return [
      `For ${values.gradYear.toLowerCase()}s, the big thing is just getting ${first} on the map.`,
      'I’m surprised there’s not more interest yet. What do you think is going on?',
      'At this stage, if coaches are not starting to know who he is, it usually means he is a little behind in exposure. That is fixable, it just needs a plan.',
    ];
  }

  if (values.gradYear === 'Junior') {
    return [
      `At the junior stage, coaches should already be starting to know who ${first} is.`,
      'I’m surprised there’s not more interest yet. What do you think is going on?',
      'If coach contact is still light right now, it usually means visibility is behind where it should be. That is fixable, it just needs a plan.',
    ];
  }

  return [
    `At the senior stage, the conversation has to be about where things stand right now for ${first}.`,
    'I’m surprised there’s not more traction yet. What do you think is going on?',
    'At this point, if things are still loose, the gap is urgency and clarity more than anything else.',
  ];
}

function buildCloseSetBullets(): string[] {
  return [
    'It’ll be about 40 to 45 minutes over Zoom.',
    'I’ll send over the Head Scout’s info so you know exactly who you’ll be speaking with.',
    'I’ll follow up with a quick text before the meeting.',
    'Coach will call from [area code], and if anything changes just text or call me.',
  ];
}

function buildDeficitReminderBullets(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const sport = getSportFamily(context?.resolved.sport || values.sport);
  const gpaBand = getGpaBand(context?.resolved.gpa);
  const bullets: string[] = [];

  if (values.gradYear === 'Freshman' || values.gradYear === 'Sophomore') {
    bullets.push(
      sport === 'football'
        ? `${values.gradYear} football: gotta get him on the map.`
        : `${values.gradYear}: exposure needs to start now, not later.`,
    );
  } else if (values.gradYear === 'Junior') {
    bullets.push(
      sport === 'football'
        ? 'Junior football: coaches should already be starting to know who he is.'
        : 'Junior year: coaches should already be starting to know who he is.',
    );
  } else {
    bullets.push('Senior year: the conversation has to be about where things stand right now.');
  }

  if (gpaBand === 'high') {
    bullets.push('Strong GPA: academics are helping him, now exposure has to catch up.');
  } else if (gpaBand === 'low') {
    bullets.push('Academics may need support, so the recruiting plan has to stay honest and organized.');
  } else if (gpaBand === 'unknown') {
    bullets.push('If GPA is unclear, make sure you get the academic picture early.');
  }

  if (values.gradYear === 'Senior') {
    bullets.push('If things are still loose right now, the gap is urgency and clarity.');
  } else {
    bullets.push('If no real coach contact yet: behind in visibility, not necessarily ability.');
  }

  return bullets.slice(0, 3);
}

function renderQuestionBlock(block: QuestionBlock): string {
  return [
    `**${block.title}**`,
    '',
    `- Anchor: ${block.anchor}`,
    ...block.questions.slice(0, 2).map((question, index) => `- Q${index + 1}: ${question}`),
    block.reminder ? `- Reminder: ${block.reminder}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildCallPathLines(values: ScoutPrepFormValues, context?: ScoutPrepContext): string[] {
  const athleteName = context?.contactInfo.studentAthlete.name || values.athleteName;
  const athleteFirst = athleteFirstName(values, context);
  const parent1First =
    firstName(context?.contactInfo.parent1?.name || values.parent1Name) || 'Parent';
  const rapportCues = buildDeterministicRapportCues(values, context);
  const rapportQuestions = buildRapportQuestions(values, context);
  const qualifyBlocks = [
    buildAcademicsBlock(values, context),
    buildCurrentLevelBlock(values, context),
    buildVarsityExperienceBlock(values, context),
    buildSportSpecificBlock(values, context),
    buildExposureBlock(values, context),
    buildMeasurablesBlock(values, context),
  ];

  return [
    `1. **Open / Connect Dots**\n“Hi ${parent1First}, this is Jerami, National college scout with Prospect ID. The reason I’m calling is ${athleteName} filled out some info about playing in college. Did they mention that to you?”`,
    [
      '2. **Rapport / Open**',
      `- Anchor: ${rapportCues[0] || `Use ${sportLabel(values, context)} as the easiest way into the conversation.`}`,
      `- Q1: ${rapportQuestions[0] || `What has ${athleteFirst} enjoyed most about ${sportLabel(values, context).toLowerCase()} so far?`}`,
      `- Q2: ${rapportQuestions[1] || `How has ${athleteFirst} handled the school side while trying to take this seriously?`}`,
    ].join('\n'),
    [
      '3. **Open Them Up**',
      ...buildOpenThemUpLines(values, context).map((question, index) => `- Q${index + 1}: ${question}`),
    ].join('\n'),
    ['4. **Qualify + Build Up**', ...qualifyBlocks.map(renderQuestionBlock)].join('\n\n'),
    `5. **Summarize Them Back**\n${buildSummaryLine(values, context)}`,
    ['6. **Deficit**', ...buildDeficitLines(values, context).map((line) => `- ${line}`)].join('\n'),
    [
      '7. **Close / Set**',
      '“What I’d like to do is get you guys set up with one of our Head Scouts to build out a plan.”',
      '“We just need you, the athlete, and mom or dad. Would [day] or [day] work better?”',
      ...buildCloseSetBullets().map((line) => `- ${line}`),
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
  const deficitReminder = buildDeficitReminderBullets(values, context);

  const markdown = [
    '# Scout Prep Card',
    `**${context?.contactInfo.studentAthlete.name || values.athleteName}**`,
    ai?.localTimeLabel ? `> ${ai.localTimeLabel}` : null,
    '',
    '## Athlete Snapshot',
    snapshotLines.join('\n'),
    '',
    '## Call Path',
    callPathLines.join('\n\n'),
    '',
    '## Deficit Reminder',
    ...deficitReminder.map((line) => `- ${line}`),
  ].filter(Boolean).join('\n');

  return {
    markdown,
    diagnostics: {
      anchorCount: anchors.length,
      snapshotFieldCount: snapshotLines.length,
      deficitGrade: values.gradYear,
      rapportSource: ai?.rapportSource || 'fallback',
      hasLocalTime: Boolean(ai?.localTimeLabel),
      hasMascotCue: false,
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
