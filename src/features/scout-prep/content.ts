import type { ScoutPrepFormValues, ScoutPrepGrade } from './types';

const DIGITAL_RECRUIT_VOICEMAIL_TEMPLATE = [
  'Hi {{parentName}}, this is Jerami Singleton college football scout with National Prospect ID.',
  'The reason why I’m calling is because I had some information come across my desk today about your son/daughter {{athleteName}}.',
  'I had some questions I wanted to ask you about his desire to play college football, and as well as, I wanted to learn more about his academics and football talent.',
  'Please give me a call back today, my number here is… (407 . . .). Thanks {{parentName}}, talk to you soon. Bye, Bye.',
];

const DEFICIT_BY_GRADE: Record<ScoutPrepGrade, string[]> = {
  Freshman: [
    'Day 1 Freshman Year: All D3 and NAIA coaches can call.',
    '85% of Division 1 Prospects are identified by sophomore year. Freshman and Sophomore need to be on the map.',
  ],
  Sophomore: [
    'January 1st during sophomore year: All Division 1 Men’s Ice Hockey coaches can call.',
    'June 15th after sophomore year: All Division 1 coaches can call in All Sports except: Baseball, Softball, M/W Lacrosse, W Basketball and Football.',
    'All Division 2 coaches can call in All Sports.',
  ],
  Junior: [
    'September 1st beginning of Junior year: All Division 1 Baseball, Softball, M/W Lacrosse and W Basketball coaches can call.',
    'September 1st beginning of Junior year: All Division 1 coaches (every sport) can write handwritten letters, text and other private communication.',
    'Use this deficit for any sport but especially for Football.',
    'April 15th – May 31st end of Junior year: All Division 1 Football coaches can call.',
  ],
  Senior: [
    '2nd Wednesday of November: Division 1 - early Signing Period for Men’s and Women’s Basketball – 1 week long.',
    '2nd Wednesday of November: Division 1 and Division 2 – Signing Period for All Sports except Football and Division 1 M/W Basketball – Lasts until August 1st. (Division 2 M/W Basketball can start signing in this period).',
    '3rd Wednesday of December: Division 1 - early Signing Period for Football. - 3 days long.',
    '1st Wednesday of February: Division 1 and Division 2 - regular Signing Period – Football – Lasts until April 1st for Division 1 and August 1st for Division 2.',
    '2nd Wednesday of April: Division 1 - regular Signing Period – Men’s and Women’s Basketball – Lasts until May 15th.',
  ],
};

const GENERAL_DEFICIT_LADDER = [
  '“I don’t have anything going on” - (Starting point of deficit)',
  '“I have a ton of letters and emails” – That’s great, how many phone calls do you have?',
  '“I have a ton of phone calls” – Wonderful, how many offers do you have?',
  '“I have a ton of offers” – Fantastic, are you going to be accepting an offer? Why not?',
];

const QUICK_CALL_REMINDERS = [
  'get the parent involved',
  'connect the dots before moving forward',
  'qualify the athlete',
  'create urgency',
  'set the meeting clearly',
];

const SOPHOMORE_JUNE_EXCLUDED_SPORTS = new Set([
  'football',
  'baseball',
  'softball',
  'mens lacrosse',
  'men lacrosse',
  "men's lacrosse",
  'womens lacrosse',
  'women lacrosse',
  "women's lacrosse",
  'womens basketball',
  'women basketball',
  "women's basketball",
]);

const JUNIOR_SEPTEMBER_1_SPORTS = new Set([
  'baseball',
  'softball',
  'mens lacrosse',
  'men lacrosse',
  "men's lacrosse",
  'womens lacrosse',
  'women lacrosse',
  "women's lacrosse",
  'womens basketball',
  'women basketball',
  "women's basketball",
]);

const SENIOR_ALL_SPORTS_SIGNING_ALLOWED = new Set([
  'baseball',
  'softball',
  'mens lacrosse',
  'men lacrosse',
  "men's lacrosse",
  'womens lacrosse',
  'women lacrosse',
  "women's lacrosse",
  'mens ice hockey',
  'men ice hockey',
  "men's ice hockey",
]);

const SENIOR_BASKETBALL_SPORTS = new Set([
  'mens basketball',
  'men basketball',
  "men's basketball",
  'womens basketball',
  'women basketball',
  "women's basketball",
]);

function normalizeSport(value: string): string {
  return value.trim().toLowerCase();
}

function applyTokens(template: string, values: ScoutPrepFormValues): string {
  let rendered = template;
  rendered = rendered.split('{{athleteName}}').join(values.athleteName);
  rendered = rendered.split('{{parentName}}').join(values.parent1Name);
  rendered = rendered.split('{{sport}}').join(values.sport);
  return rendered;
}

function buildBulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function buildQuotedParagraphs(items: string[]): string {
  return items.map((item) => `> ${item}`).join('\n>\n');
}

function buildNumberedDeficit(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function buildEmphasizedReminders(items: string[]): string {
  return items
    .map((item) => {
      const [firstWord, ...rest] = item.split(' ');
      if (!firstWord) return `- ${item}`;
      return `- **${firstWord.charAt(0).toUpperCase()}${firstWord.slice(1)}** ${rest.join(' ')}`.trim();
    })
    .join('\n');
}

function getDeficitItems(values: ScoutPrepFormValues): string[] {
  const sport = normalizeSport(values.sport);

  if (values.gradYear === 'Freshman') {
    return DEFICIT_BY_GRADE.Freshman;
  }

  if (values.gradYear === 'Sophomore') {
    const items: string[] = [];

    if (sport === 'mens ice hockey' || sport === 'men ice hockey' || sport === "men's ice hockey") {
      items.push(DEFICIT_BY_GRADE.Sophomore[0]);
    }

    if (!SOPHOMORE_JUNE_EXCLUDED_SPORTS.has(sport)) {
      items.push(DEFICIT_BY_GRADE.Sophomore[1]);
    }

    items.push(DEFICIT_BY_GRADE.Sophomore[2]);
    return items;
  }

  if (values.gradYear === 'Junior') {
    const items: string[] = [];

    if (JUNIOR_SEPTEMBER_1_SPORTS.has(sport)) {
      items.push(DEFICIT_BY_GRADE.Junior[0]);
    }

    items.push(DEFICIT_BY_GRADE.Junior[1]);

    if (sport === 'football') {
      items.push(DEFICIT_BY_GRADE.Junior[2]);
      items.push(DEFICIT_BY_GRADE.Junior[3]);
    }

    return items;
  }

  if (values.gradYear === 'Senior') {
    if (sport === 'football') {
      return [DEFICIT_BY_GRADE.Senior[2], DEFICIT_BY_GRADE.Senior[3]];
    }

    if (SENIOR_BASKETBALL_SPORTS.has(sport)) {
      return [DEFICIT_BY_GRADE.Senior[0], DEFICIT_BY_GRADE.Senior[4]];
    }

    if (SENIOR_ALL_SPORTS_SIGNING_ALLOWED.has(sport)) {
      return [DEFICIT_BY_GRADE.Senior[1]];
    }

    return [DEFICIT_BY_GRADE.Senior[1]];
  }

  return DEFICIT_BY_GRADE[values.gradYear];
}

export function buildScoutPrepMarkdown(values: ScoutPrepFormValues): string {
  const voicemail = buildQuotedParagraphs(
    DIGITAL_RECRUIT_VOICEMAIL_TEMPLATE.map((paragraph) => applyTokens(paragraph, values)),
  );
  const deficit = buildNumberedDeficit(getDeficitItems(values));
  const ladder = buildBulletList(GENERAL_DEFICIT_LADDER);
  const reminders = buildEmphasizedReminders(QUICK_CALL_REMINDERS);

  return [
    `# Scout Prep`,
    `**${values.athleteName}** · *${values.gradYear} ${values.sport}*`,
    '',
    '---',
    '## 1. Voicemail',
    '*Digital Recruit only*',
    voicemail,
    '---',
    `## 2. Deficit`,
    `**Focus Grade:** ${values.gradYear}`,
    deficit,
    '',
    '### Always Build More Deficit',
    '*Use these pressure-build follow-ups when the call stalls or the family says they already have interest.*',
    ladder,
    '---',
    '## 3. Quick Call Reminders',
    reminders,
  ].join('\n\n');
}
