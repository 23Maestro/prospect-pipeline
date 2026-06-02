import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const appRoot = process.cwd();
const repoRoot = join(appRoot, '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry === '.next') return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test('prospect-call-tracker and prospect-mobile static assets are served from Vercel public tree', () => {
  [
    'public/prospect-call-tracker/app.js',
    'public/prospect-call-tracker/data-contract.json',
    'public/prospect-call-tracker/weekly-results/index.json',
    'public/prospect-call-tracker/styles.css',
    'public/prospect-meetings/app.js',
    'public/prospect-meetings/styles.css',
    'public/prospect-call-tracker/prospect-pipeline.png',
    'public/prospect-mobile/app.js',
    'public/prospect-mobile/styles.css',
    'public/prospect-mobile/set-meetings-utils.mjs',
    'public/prospect-id-shield.svg',
    'public/prospect-mobile/assets/prospect-pipeline.png',
  ].forEach((path) => assert.equal(existsSync(join(appRoot, path)), true, path));
});

test('server-only env names do not appear in browser-facing files', () => {
  const serverOnly = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'FASTAPI_BASE_URL',
    'TAILSCALE_FASTAPI_BASE_URL',
    'PROSPECT_API_BASE',
    'PROSPECT_API_TOKEN',
    'INTERNAL_API_SECRET',
    'CALL_TRACKER_SYNC_SECRET',
  ];
  const clientFiles = walk(join(appRoot, 'app'))
    .filter((path) => path.endsWith('page.tsx'))
    .concat(walk(join(appRoot, 'public')));

  const offenders = clientFiles.flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    return serverOnly
      .filter((name) => text.includes(name))
      .map((name) => `${relative(appRoot, path)}:${name}`);
  });

  assert.deepEqual(offenders, []);
});

test('Next.js route handlers do not duplicate domain ownership or materialization logic', () => {
  const routeFiles = walk(join(appRoot, 'app', 'api')).filter((path) => path.endsWith('route.ts'));
  const forbidden = [
    'materializationStatus',
    'materialization_reason',
    'owner-resolution',
    'is_related_contact_assigned',
    'Laravel',
    'payload_json',
  ];
  const offenders = routeFiles.flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    return forbidden
      .filter((term) => text.includes(term))
      .map((term) => `${relative(appRoot, path)}:${term}`);
  });

  assert.deepEqual(offenders, []);
});

test('migration changes stay inside Prospect Web and Call Tracker data-contract files', () => {
  const changedFiles = execFileSync('git', ['status', '--short'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);

  const oldStaticPrefix = ['npid-api-layer', 'app', 'static'].join('/');
  const oldConfigWriterPath = [
    'scripts',
    ['write', 'call', 'tracker'].join('-') + '-config.mjs',
  ].join('/');
  const allowedSourceFiles = new Set([
    'npid-api-layer/README.md',
    'npid-api-layer/main.py',
    'npid-api-layer/app/routers/mobile.py',
    'npid-api-layer/test_mobile_booked_meetings.py',
    `${oldStaticPrefix}/app.js`,
    `${oldStaticPrefix}/call-tracker/app.js`,
    `${oldStaticPrefix}/call-tracker/config.example.js`,
    `${oldStaticPrefix}/call-tracker/index.html`,
    `${oldStaticPrefix}/call-tracker/prospect-pipeline.png`,
    `${oldStaticPrefix}/call-tracker/styles.css`,
    `${oldStaticPrefix}/index.html`,
    `${oldStaticPrefix}/prospect-id-logo.png`,
    `${oldStaticPrefix}/styles.css`,
    'src/domain/architecture-contract.test.ts',
    'src/domain/call-tracker-facts.test.ts',
    'src/domain/call-tracker-facts.ts',
    'src/domain/sales-stage-contract.test.ts',
    'src/domain/scout-task-classifier.test.ts',
    'src/domain/scout-task-classifier.ts',
    'src/domain/supabase-persistence.ts',
    'src/lib/scout-follow-up-templates.test.ts',
    'src/lib/sales-lifecycle.test.ts',
    'src/lib/sales-lifecycle.ts',
    'scripts/reconcile-current-sales-stages-to-supabase.mjs',
    'scripts/reconcile-current-sales-stages-to-supabase.test.mjs',
    'scripts/materialize-call-tracker-data-contract.mjs',
    'scripts/materialize-call-tracker-data-contract.test.mjs',
    'scripts/archive-call-tracker-week.mjs',
    'scripts/archive-call-tracker-weekly.sh',
    'scripts/backsync-lifecycle-call-activity-events.mjs',
    'scripts/lifecycle-call-tracker-backsync-core.mjs',
    'scripts/lifecycle-call-tracker-backsync-core.test.mjs',
    'scripts/honest-test-report.mjs',
    'scripts/honest-test-report.test.mjs',
    'scripts/repair-call-event-owner-proof.mjs',
    'scripts/sync-supabase-pipeline.sh',
    'scripts/sync-supabase-pipeline.test.mjs',
    oldConfigWriterPath,
    'scripts/sync-current-pipeline-to-supabase.mjs',
    'scripts/sync-current-pipeline-to-supabase.test.mjs',
    'scripts/sync-booked-meetings-to-supabase.mjs',
    'scripts/sync-booked-meetings-to-supabase.test.mjs',
    'scripts/scriptable/id-command-center.js',
    'scripts/scriptable/id-prospect-search.js',
    'scripts/scriptable/share-prospect-contact-card.js',
    'src/domain/call-tracker-vercel-contract.ts',
    'src/domain/owner-proof-payload.ts',
    'src/domain/owner-resolution.ts',
    'src/domain/owner-resolution.test.ts',
    'src/domain/post-call-action.ts',
    'src/domain/post-call-action.test.ts',
    'src/lib/supabase-lifecycle.ts',
    'src/lib/supabase-lifecycle.test.ts',
    'src/scout-prep.tsx',
    'src/generated/code-index.generated.json',
    'src/domain/set-meeting-reminder-cache.ts',
    'src/domain/set-meeting-reminder-cache.test.ts',
    'src/domain/set-meeting-confirmation-cache.ts',
    'src/domain/set-meeting-confirmation-cache.test.ts',
    'src/domain/athlete-contact-cache.ts',
    'src/domain/athlete-contact-cache.test.ts',
    'src/lib/athlete-contact-cache.ts',
    'src/lib/set-meeting-reminder-cache-sync.ts',
    'src/lib/set-meeting-reminder-cache-sync.test.ts',
    'src/lib/set-meeting-confirmation-cache-sync.ts',
    'src/lib/set-meeting-confirmation-cache-sync.test.ts',
    'src/head-scout-schedules.tsx',
    'src/domain/pending-client-watchlist.ts',
    'src/domain/pending-client-watchlist.test.ts',
    'src/lib/pending-client-watchlist.ts',
    'supabase/migrations/20260510090000_expand_reminders_set_meeting_cache.sql',
    'supabase/migrations/20260515223000_set_meeting_confirmation_cache_table.sql',
    'supabase/migrations/20260515224500_public_set_meeting_confirmation_cache_read.sql',
    'supabase/tests/reminders-set-meeting-cache-columns.test.mjs',
    'supabase/migrations/20260514090000_athlete_contact_cache.sql',
    'supabase/migrations/20260520090000_athlete_contact_cache_search_timezone.sql',
    'supabase/tests/athlete-contact-cache-contract.test.mjs',
    'supabase/migrations/20260503043000_backsync_meeting_set_materialization_contract.sql',
    'supabase/migrations/20260503044000_rename_call_events_to_meeting_events.sql',
    'supabase/migrations/20260503045000_backsync_call_activity_counting_contract.sql',
    'supabase/migrations/20260503030000_call_tracker_counting_contract.sql',
    'supabase/migrations/20260519010000_call_tracker_reporting_clock_source.sql',
    'supabase/migrations/20260519012000_call_tracker_meeting_set_athlete_identity.sql',
    'supabase/migrations/20260519013000_call_tracker_meeting_set_entry_counts.sql',
    'supabase/migrations/20260519014000_call_tracker_owner_context_source_flags.sql',
    'supabase/migrations/20260519015000_repair_rescheduled_meeting_set_flags.sql',
    'supabase/migrations/20260519016000_call_tracker_reschedule_preserves_first_meeting_set.sql',
    'supabase/migrations/20260519017000_call_tracker_restore_reconcile_clock_and_first_reschedule_identity.sql',
    'supabase/migrations/20260529163000_athlete_lifecycle_timeline.sql',
    'supabase/tests/call-activity-materialization-backsync.test.mjs',
    'supabase/tests/call-events-post-meeting-contract.test.mjs',
    'supabase/tests/call-tracker-reporting-clock-source.test.mjs',
    'supabase/tests/call-tracker-counting-contract.test.mjs',
    'supabase/tests/call-tracker-summary-activity-counts.test.mjs',
    'supabase/tests/meeting-set-materialization-backsync.test.mjs',
    'supabase/tests/athlete-lifecycle-timeline-contract.test.mjs',
    'scripts/sync-commissions-to-supabase.mjs',
    'scripts/sync-commissions-to-supabase.test.mjs',
  ]);
  const forbiddenPrefixes = ['npid-api-layer/', 'scripts/', 'supabase/', 'src/'];
  const offenders = changedFiles.filter(
    (path) =>
      forbiddenPrefixes.some((prefix) => path.startsWith(prefix)) && !allowedSourceFiles.has(path),
  );
  assert.deepEqual(offenders, []);
});

test('legacy hosting and FastAPI static web leftovers are purged', () => {
  const legacyHost = 'net' + 'lify';
  const oldMobileDir = 'mobile' + '-web';
  const oldStaticPath = ['npid-api-layer', 'app', 'static'];
  const oldConfigWriter = ['write', 'call', 'tracker'].join('-') + '-config';
  const forbiddenPaths = [
    [`${legacyHost}.toml`],
    [legacyHost, 'functions'],
    [oldMobileDir],
    [`.${legacyHost}`],
    oldStaticPath,
    ['scripts', `${oldConfigWriter}.mjs`],
    ['docs', 'architecture', `${legacyHost}-to-vercel-migration.md`],
    ['docs', 'superpowers', 'plans', '2026-05-02-prospect-web-vercel-adapter.md'],
  ];
  for (const parts of forbiddenPaths) {
    assert.equal(existsSync(join(repoRoot, ...parts)), false, parts.join('/'));
  }

  const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const forbiddenScript = 'sync:' + ['call', 'tracker', 'config'].join('-');
  const forbiddenScriptKeys = Object.keys(rootPackage.scripts || {}).filter(
    (key) => key === forbiddenScript,
  );
  assert.deepEqual(forbiddenScriptKeys, []);

  const forbiddenPattern = new RegExp(
    [
      legacyHost,
      oldMobileDir,
      `${legacyHost}\\.toml`,
      `${legacyHost}/functions`,
      oldStaticPath.join('/'),
      oldConfigWriter,
    ].join('|'),
    'i',
  );
  const scannedFiles = [
    ...walk(join(repoRoot, 'apps', 'prospect-web')),
    ...walk(join(repoRoot, 'docs')),
    ...walk(join(repoRoot, 'npid-api-layer', 'app')),
    ...walk(join(repoRoot, 'src')),
    join(repoRoot, 'package.json'),
  ].filter((path) => !path.includes('/node_modules/') && !path.includes('/.next/'));

  const offenders = scannedFiles.flatMap((path) => {
    const rel = relative(repoRoot, path);
    if (rel === ['apps', 'prospect-web', 'tests', 'static-guards.test.ts'].join('/')) return [];
    const text = readFileSync(path, 'utf8');
    return forbiddenPattern.test(text) ? [rel] : [];
  });
  assert.deepEqual([...new Set(offenders)].sort(), []);
});

test('call tracker public contract documents count flags as the reporting source of truth', () => {
  const contractPath = join(appRoot, 'public/prospect-call-tracker/data-contract.json');
  const contractText = readFileSync(contractPath, 'utf8');
  const contract = JSON.parse(contractText);

  assert.match(contract.purpose, /activity_kind/i);
  assert.match(contract.purpose, /never from activity_kind alone/i);
  assert.match(contract.purpose, /countsAsDial/i);
  assert.match(contract.purpose, /countsAsContact/i);
  assert.match(contract.purpose, /countsAsMeetingSet/i);
  assert.match(contract.purpose, /countsAsPostMeetingOutcome/i);
  assert.equal(contract.generatedFrom, 'src/domain/call-tracker-vercel-contract.ts');
  assert.equal(
    contract.browserContract.eventFeed.supabaseView,
    'call_tracker_events_owner_context',
  );
  assert.equal(contract.browserContract.summaryHelper.supabaseView, 'call_tracker_summary');
  assert.equal(
    contract.browserContract.summaryHelper.deprecatedAliases.total_events,
    'Do not display as Dials. Use dials.',
  );
  assert.equal(
    contract.browserContract.summaryHelper.deprecatedAliases.spoke_with,
    'Do not display as Contacts. Use contacts.',
  );
  assert.ok(contract.browserContract.eventFeed.requiredFields.includes('counts_as_dial'));
  assert.ok(contract.browserContract.eventFeed.requiredFields.includes('counts_as_contact'));
  assert.ok(contract.browserContract.eventFeed.requiredFields.includes('counts_as_meeting_set'));
  assert.ok(
    contract.browserContract.eventFeed.requiredFields.includes('counts_as_post_meeting_outcome'),
  );
  assert.ok(contract.browserContract.eventFeed.requiredFields.includes('materialization_status'));
  assert.ok(
    contract.browserContract.eventFeed.requiredFields.includes('resolved_owner_source_field'),
  );
  assert.equal(contract.liveSupabaseApi.browserUrl, '/api/call-tracker-data');
  assert.equal(contract.liveSupabaseApi.workflowCron, 'scripts/sync-supabase-pipeline.sh');
  assert.ok(contract.data.generatedAt);
  assert.equal(contract.data.supabaseReads.summaryView, 'call_tracker_summary');
  assert.equal(contract.data.supabaseReads.eventView, 'call_tracker_events_owner_context');
  assert.equal(contract.data.supabaseReads.lifecycleSourceTable, 'lifecycle_events');
  assert.equal(typeof contract.data.summary.dials, 'number');
  assert.equal(typeof contract.data.summary.contacts, 'number');
  assert.equal(typeof contract.data.summary.meetings_set, 'number');
  assert.ok(Array.isArray(contract.data.events));
  assert.ok(contract.data.events.length > 0);
  assert.equal(typeof contract.data.ui.summaryCards.dials, 'number');
  assert.equal(typeof contract.data.ui.summaryCards.contacts, 'number');
  assert.equal(typeof contract.data.ui.summaryCards.rawContacts, 'number');
  assert.equal(typeof contract.data.ui.summaryCards.historicalContactsAdjustment, 'number');
  assert.equal(typeof contract.data.ui.manualCorrections.allTimeContactsAdjustment, 'number');
  assert.equal(
    contract.data.ui.summaryCards.contacts,
    contract.data.ui.summaryCards.rawContacts +
      contract.data.ui.summaryCards.historicalContactsAdjustment,
  );
  assert.equal(typeof contract.data.ui.summaryCards.closeRate, 'number');
  assert.equal(typeof contract.data.ui.paycheck.totalCents, 'number');
  assert.equal(typeof contract.data.ui.activePeriod, 'string');
  assert.equal(typeof contract.data.ui.periods[contract.data.ui.activePeriod].dials, 'number');
  assert.equal(typeof contract.data.ui.periods[contract.data.ui.activePeriod].contacts, 'number');
  assert.equal(
    typeof contract.data.ui.periods[contract.data.ui.activePeriod].meetingsSet,
    'number',
  );
  assert.equal(
    typeof contract.data.ui.periods[contract.data.ui.activePeriod].filterCounts.meaningful,
    'number',
  );
  assert.ok('counts_as_dial' in contract.data.events[0]);
  assert.ok('counts_as_contact' in contract.data.events[0]);

  const sourceTables = contract.sourceFamilies.map(
    (source: { sourceTable: string }) => source.sourceTable,
  );
  assert.deepEqual(sourceTables, ['call_activity_events', 'lifecycle_events', 'meeting_events']);

  const totalDials = contract.cardBindings.find(
    (binding: { domId: string }) => binding.domId === 'totalEvents',
  );
  const totalContacts = contract.cardBindings.find(
    (binding: { domId: string }) => binding.domId === 'spokeWith',
  );
  assert.match(totalDials.countRule, /call_tracker_summary\.dials/);
  assert.match(totalContacts.countRule, /data\.ui\.summaryCards\.contacts/);
  assert.match(totalContacts.forbiddenRule, /post-meeting outcomes/i);

  const meetingSet = contract.domainOutcomeRules.find(
    (rule: { domainStatus: string }) => rule.domainStatus === 'meeting_set',
  );
  assert.equal(meetingSet.countsAsDial, true);
  assert.equal(meetingSet.countsAsContact, true);
  assert.equal(meetingSet.countsAsMeetingSet, true);
  assert.equal(meetingSet.countsAsPostMeetingOutcome, false);

  const postMeetingRules = contract.domainOutcomeRules.filter((rule: { domainStatus: string }) =>
    ['closed_won', 'closed_lost', 'reschedule_pending', 'no_show', 'canceled'].includes(
      rule.domainStatus,
    ),
  );
  assert.equal(postMeetingRules.length, 5);
  for (const rule of postMeetingRules) {
    assert.equal(rule.countsAsDial, false, rule.domainStatus);
    assert.equal(rule.countsAsContact, false, rule.domainStatus);
    assert.equal(rule.countsAsPostMeetingOutcome, true, rule.domainStatus);
  }
});

test('Vercel public dashboard assets are tracked in git despite public ignore rule', () => {
  const trackedFiles = execFileSync(
    'git',
    [
      'ls-files',
      'apps/prospect-web/public/prospect-call-tracker/app.js',
      'apps/prospect-web/public/prospect-call-tracker/data-contract.json',
      'apps/prospect-web/public/prospect-call-tracker/prospect-pipeline.png',
      'apps/prospect-web/public/prospect-call-tracker/styles.css',
      'apps/prospect-web/public/prospect-id-shield.svg',
      'apps/prospect-web/public/prospect-mobile/app.js',
      'apps/prospect-web/public/prospect-mobile/assets/prospect-pipeline.png',
      'apps/prospect-web/public/prospect-mobile/set-meetings-utils.mjs',
      'apps/prospect-web/public/prospect-mobile/styles.css',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(trackedFiles, [
    'apps/prospect-web/public/prospect-call-tracker/app.js',
    'apps/prospect-web/public/prospect-call-tracker/data-contract.json',
    'apps/prospect-web/public/prospect-call-tracker/prospect-pipeline.png',
    'apps/prospect-web/public/prospect-call-tracker/styles.css',
    'apps/prospect-web/public/prospect-id-shield.svg',
    'apps/prospect-web/public/prospect-mobile/app.js',
    'apps/prospect-web/public/prospect-mobile/assets/prospect-pipeline.png',
    'apps/prospect-web/public/prospect-mobile/set-meetings-utils.mjs',
    'apps/prospect-web/public/prospect-mobile/styles.css',
  ]);
});

test('call tracker daily cards consume Supabase boolean count fields only', () => {
  const appText = readFileSync(join(appRoot, 'public/prospect-call-tracker/app.js'), 'utf8');
  assert.match(appText, /CONTRACT_URL/);
  assert.match(appText, /const CONTRACT_URL = '\/api\/call-tracker-data'/);
  assert.doesNotMatch(appText, /\/prospect-call-tracker\/data-contract\.json/);
  assert.match(appText, /state\.summary = data\.summary/);
  assert.match(appText, /state\.rows = Array\.isArray\(data\.events\)/);
  assert.match(appText, /state\.ui = data\.ui/);
  assert.match(appText, /state\.ui\?\.summaryCards/);
  assert.match(appText, /state\.ui\?\.periods/);
  assert.match(appText, /state\.ui\?\.paycheck/);
  assert.match(appText, /WEEKLY_INDEX_URL/);
  assert.match(appText, /\/prospect-call-tracker\/weekly-results\/index\.json/);
  assert.match(appText, /activeView: 'live-week'/);
  assert.match(appText, /<option value="live-week">Live<\/option>/);
  assert.match(appText, /state\.activePeriod = currentWeekPeriod\(\)/);
  assert.match(appText, /state\.activePeriod = 'week-total'/);
  assert.match(appText, /archivePeriodDate/);
  assert.match(appText, /metricsFromRows\(scopedActivityRows\(\)\)/);
  assert.match(appText, /button\.disabled = isMonthView\(\)/);
  assert.match(appText, /counts_as_dial/);
  assert.match(appText, /counts_as_contact/);
  assert.match(appText, /counts_as_meeting_set/);
  assert.match(appText, /row\.counts_as_dial === true/);
  assert.match(appText, /row\.counts_as_contact === true/);
  assert.doesNotMatch(appText, /supabaseGet/);
  assert.doesNotMatch(appText, /\/rest\/v1\//);
  assert.doesNotMatch(appText, /call-tracker-sync/);
  assert.doesNotMatch(appText, /CALL_TRACKER_CONFIG/);
  assert.doesNotMatch(
    appText,
    /contactMadeOutcomes|callActivityOutcomes|isDailyCallActivity|isDailyContact/,
  );
});

test('call tracker archive selector is backed by existing weekly-results files', () => {
  const pageText = readFileSync(join(appRoot, 'app/prospect-call-tracker/page.tsx'), 'utf8');
  const appText = readFileSync(join(appRoot, 'public/prospect-call-tracker/app.js'), 'utf8');
  const stylesText = readFileSync(join(appRoot, 'public/prospect-call-tracker/styles.css'), 'utf8');
  const indexPath = join(appRoot, 'public/prospect-call-tracker/weekly-results/index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));

  assert.match(pageText, /id="weekViewSelect"/);
  assert.match(pageText, /SC: Calls/);
  assert.match(pageText, /className="brand-home-link" href="\/" aria-label="Back to Command Center"/);
  assert.match(pageText, /src="\/prospect-id-shield\.svg"/);
  assert.match(pageText, /alt="Prospect ID"/);
  assert.match(stylesText, /--command-bg:[\s\S]*#081120/);
  assert.match(stylesText, /background: var\(--command-bg\)/);
  assert.match(stylesText, /\.topbar \{[\s\S]*border: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
  assert.match(stylesText, /\.topbar::after \{[\s\S]*content: none;/);
  assert.match(stylesText, /\.brand-row strong \{[\s\S]*text-shadow:/);
  assert.match(stylesText, /\.app-mark \{[\s\S]*width: 32px;[\s\S]*height: 32px;/);
  assert.match(stylesText, /\.app-mark \{[\s\S]*drop-shadow\(0 0 24px rgba\(0, 112, 243, 0\.32\)\)/);
  assert.doesNotMatch(pageText, /Health OK/);
  assert.doesNotMatch(pageText, /Sync Complete/);
  assert.doesNotMatch(pageText, /id="payDateLabel"/);
  assert.match(appText, /getWeeklyArchiveIndex/);
  assert.match(appText, /getWeeklyArchiveDetails/);
  assert.match(appText, /selectedArchiveWeek/);
  assert.match(appText, /activeTopCardMetrics/);
  assert.match(appText, /reportingDateKey/);
  assert.match(appText, /dateRangeOptionLabel\(details\?\.week\?\.startDate/);
  assert.match(appText, /selectedArchiveDetails\(\)\?\.events/);
  assert.doesNotMatch(appText, /activeAllTimeSnapshot/);
  assert.doesNotMatch(pageText, /snapshotDials|snapshotContacts|snapshotMeetings|snapshotSetRate/);
  assert.ok(Array.isArray(index.weeks));
  for (const week of index.weeks) {
    assert.equal(typeof week.file, 'string');
    assert.equal(typeof week.dials, 'number');
    assert.equal(typeof week.contacts, 'number');
    assert.equal(typeof week.meetingsSet, 'number');
    assert.equal(typeof week.setRate, 'number');
    assert.equal(typeof week.allTimeAtArchive.dials, 'number');
    assert.equal(typeof week.allTimeAtArchive.contacts, 'number');
    assert.equal(typeof week.allTimeAtArchive.meetingsSet, 'number');
    assert.equal(typeof week.allTimeAtArchive.setRate, 'number');
    assert.equal(
      existsSync(join(appRoot, 'public/prospect-call-tracker/weekly-results', week.file)),
      true,
      week.file,
    );
  }
});

test('call tracker archive writer uses the live browser contract and source-owned reporting clock', () => {
  const archiveText = readFileSync(join(repoRoot, 'scripts/archive-call-tracker-week.mjs'), 'utf8');
  const routeText = readFileSync(join(appRoot, 'app/api/call-tracker-data/route.ts'), 'utf8');
  const migrationText = readFileSync(
    join(repoRoot, 'supabase/migrations/20260519010000_call_tracker_reporting_clock_source.sql'),
    'utf8',
  );

  assert.match(archiveText, /prospect-web\.vercel\.app\/api\/call-tracker-data/);
  assert.match(archiveText, /CALL_TRACKER_ARCHIVE_SOURCE/);
  assert.match(archiveText, /row\.reporting_date_et \|\| localDateKey\(row\.reporting_at \|\| row\.occurred_at\)/);
  assert.doesNotMatch(archiveText, /row\.tracker_outcome === 'meeting_set'/);
  assert.match(routeText, /'reporting_at'/);
  assert.match(routeText, /'reporting_date_et'/);
  assert.doesNotMatch(routeText, /normalizeMeetingSetClocks/);
  assert.match(migrationText, /as reporting_at/);
  assert.match(migrationText, /reporting_date_et/);
  assert.match(migrationText, /source_post' = '\/sales\/meeting-set'/);
});

test('meetings readback page is live, read-only, and server-backed', () => {
  const pageText = readFileSync(join(appRoot, 'app/prospect-meetings/page.tsx'), 'utf8');
  const routeText = readFileSync(join(appRoot, 'app/api/meeting-readback-data/route.ts'), 'utf8');
  const appText = readFileSync(join(appRoot, 'public/prospect-meetings/app.js'), 'utf8');
  const stylesText = readFileSync(join(appRoot, 'public/prospect-meetings/styles.css'), 'utf8');
  const browserText = `${pageText}\n${appText}\n${stylesText}`;
  const newCodeText = `${pageText}\n${routeText}\n${appText}\n${stylesText}`;

  assert.match(routeText, /export const dynamic = 'force-dynamic'/);
  assert.match(routeText, /cache: 'no-store'/);
  assert.match(routeText, /cache-control', 'no-store, max-age=0'/);
  assert.match(appText, /const CONTRACT_URL = '\/api\/meeting-readback-data'/);
  assert.match(pageText, /SC: Meetings/);
  assert.match(pageText, /data-mode="meetings"/);
  assert.match(pageText, /data-mode="lifecycle"/);
  assert.match(pageText, /True Meetings Set/);
  assert.match(pageText, /Show Rate/);
  assert.match(pageText, /Closed Won/);
  assert.match(pageText, /Closed Lost/);
  assert.match(pageText, /Follow Up/);
  assert.match(pageText, /No Show \/ Canceled/);
  assert.doesNotMatch(pageText, /Showed \/ Resulted/);
  assert.doesNotMatch(pageText, /Upcoming \/ Pending/);
  assert.doesNotMatch(pageText, /Needs Review/);
  assert.match(pageText, /id="meetingsBody"/);
  assert.match(pageText, /id="lifecycleBody"/);
  assert.doesNotMatch(pageText, /<th>Proof<\/th>/);
  assert.doesNotMatch(pageText, /Read-only live Supabase check/);
  assert.match(routeText, /active_athlete_meeting_truth/);
  assert.match(routeText, /athlete_lifecycle_timeline/);
  assert.doesNotMatch(routeText, /lifecycle_events\?select/);
  assert.match(routeText, /summaryFor\(sourceSummary, currentMeetings, meetings, generatedAt\)/);
  assert.match(routeText, /sourceSummary\.meetings_set/);
  assert.match(routeText, /countsAsPostMeetingOutcome/);
  assert.match(routeText, /actual_meeting_follow_up/);
  assert.match(routeText, /showRate/);
  assert.match(routeText, /currentMonthRange\(generatedAt\)/);
  assert.match(appText, /function sourceText\(row\)/);
  assert.match(appText, /Current Meeting Truth/);
  assert.match(appText, /Athlete Lifecycle Timeline/);
  assert.doesNotMatch(appText, /Created \$\{row\.createdAtLabel\}/);
  assert.match(stylesText, /\.status-chip\.won/);
  assert.match(stylesText, /\.status-chip\.bad/);
  assert.match(stylesText, /\.status-chip\.pending/);
  assert.match(stylesText, /\.summary-grid \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(stylesText, /\.summary-grid \{[\s\S]*overflow-x: auto/);
  assert.match(pageText, /href="\/prospect-call-tracker"/);
  assert.match(readFileSync(join(appRoot, 'app/prospect-call-tracker/page.tsx'), 'utf8'), /href="\/prospect-meetings"/);
  assert.doesNotMatch(browserText, /SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY/);
  assert.doesNotMatch(browserText, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(appText, /\/rest\/v1\//);
  assert.doesNotMatch(appText, /createClient|SUPABASE_/);
  assert.doesNotMatch(newCodeText, /\b(?:POST|PUT|PATCH|DELETE)\b/);
  assert.doesNotMatch(newCodeText, /npm run (?:sync|repair|backfill|archive|deploy)|fetch\([^)]*(?:sync|repair|backfill|archive|cron|deploy)/i);
});

test('call tracker commission is a flat twenty percent of revenue', () => {
  const pageRouteText = readFileSync(join(appRoot, 'app/api/call-tracker-data/route.ts'), 'utf8');
  const appText = readFileSync(join(appRoot, 'public/prospect-call-tracker/app.js'), 'utf8');
  const materializeText = readFileSync(join(repoRoot, 'scripts/materialize-call-tracker-data-contract.mjs'), 'utf8');
  for (const source of [pageRouteText, appText, materializeText]) {
    assert.match(source, /COMMISSION_RATE = 0\.2/);
    assert.match(source, /commissionCentsForRow/);
    assert.doesNotMatch(source, /0\.175/);
    assert.doesNotMatch(source, /firstSubscriptionBillDate/);
  }
  assert.doesNotMatch(pageRouteText, /commissionCents[\s\S]*\/ 2/);
  assert.doesNotMatch(appText, /monthlySubscriptionCommissionCents/);
  assert.match(pageRouteText, /moneyEarnedCents: commissionCentsForRows\(rows\)/);
  assert.match(pageRouteText, /if \(row\.tracker_outcome === 'closed_won'\) return true/);
  assert.match(pageRouteText, /closedWon: closedWonRows\.length/);
  assert.match(pageRouteText, /function isPaidClosedWon/);
  assert.match(pageRouteText, /paidCommissionSources\.has\(row\.source\)/);
  assert.match(appText, /fallbackCommissionCents/);
  assert.match(appText, /if \(row\.tracker_outcome === 'closed_won'\) return true/);
  assert.match(appText, /function isPaidClosedWon/);
  assert.match(appText, /PAID_COMMISSION_SOURCES\.has\(row\.source\)/);
});

test('prospect mobile set meetings uses confirmation cache messages', () => {
  const appText = readFileSync(join(appRoot, 'public/prospect-mobile/app.js'), 'utf8');
  const utilitiesText = readFileSync(join(appRoot, 'public/prospect-mobile/set-meetings-utils.mjs'), 'utf8');
  const pageText = readFileSync(join(appRoot, 'app/prospect-mobile/page.tsx'), 'utf8');
  const setMeetingsRouteExists = existsSync(join(appRoot, 'app/api/set-meetings/route.ts'));
  assert.match(pageText, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(pageText, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(appText, /window\.__PROSPECT_SUPABASE__/);
  assert.match(appText, /\/rest\/v1\/set_meeting_confirmation_cache/);
  assert.doesNotMatch(appText, /\/rest\/v1\/reminders/);
  assert.match(appText, /supabase_confirmation_cache/);
  assert.match(appText, /event\.confirmation_1_message/);
  assert.match(appText, /event\.confirmation_2_message/);
  assert.match(appText, /cache: 'no-store'/);
  assert.match(appText, /'cache-control': 'no-cache'/);
  assert.match(appText, /\.filter\(\(event\) => isCurrentCachedMeeting\(event\.start, week\)\)/);
  assert.match(appText, /isCurrentCachedMeeting/);
  assert.match(appText, /parseCachedMeetingInstant\(value\)/);
  assert.match(utilitiesText, /function isCurrentCachedMeeting/);
  assert.match(utilitiesText, /function getCurrentCachedMeetingClock/);
  assert.match(appText, /formatCachedMeetingLabel\(event\.current_meeting_label \|\| event\.start, event\.meeting_timezone\)/);
  assert.match(appText, /function normalizeMeetingTimezoneLabel/);
  assert.match(appText, /function meetingTimezoneLabel/);
  assert.match(appText, /buildBookedMeetingEventDate\(event\.start, event\.meeting_timezone\)/);
  assert.match(appText, /ordinalSuffix/);
  assert.match(appText, /\/api\/set-meeting-confirmation-prefix/);
  assert.match(appText, /\/api\/post-meeting-outcome/);
  assert.match(appText, /data-confirmation-prefix="\(ACF\)"/);
  assert.match(appText, /data-confirmation-prefix="\(ACF\*2\)"/);
  assert.match(appText, /data-confirmation-modal/);
  assert.match(appText, /showConfirmationModal/);
  assert.match(appText, /ID Cards/);
  assert.match(appText, /class="link-button admin-button" type="button" data-admin-modal/);
  assert.match(appText, /clipboardIconSvg/);
  assert.match(appText, /scriptable:\/\/\/run\/share-prospect-contact-card/);
  assert.match(appText, /data-admin-modal/);
  assert.match(appText, /data-athlete-id/);
  assert.match(appText, /data-athlete-main-id/);
  assert.match(appText, /data-post-meeting-reason/);
  assert.match(appText, /data-prefix-action="\(CF\)"/);
  assert.match(appText, /data-prefix-action="\(RSP\)"/);
  assert.match(appText, /data-prefix-action="\(CAN\)"/);
  assert.match(appText, /showAdminModal/);
  assert.match(appText, /updatePostMeetingOutcome/);
  assert.doesNotMatch(appText, /\/api\/set-meetings/);
  assert.equal(setMeetingsRouteExists, false);
  assert.doesNotMatch(appText, /function buildConfirmationText\(/);
});

test('prospect mobile exposes set meetings, scout schedules, and contact search tabs', () => {
  const appText = readFileSync(join(appRoot, 'public/prospect-mobile/app.js'), 'utf8');
  const stylesText = readFileSync(join(appRoot, 'public/prospect-mobile/styles.css'), 'utf8');
  const pageText = readFileSync(join(appRoot, 'app/prospect-mobile/page.tsx'), 'utf8');
  const contactReminderPageExists = existsSync(
    join(appRoot, 'app/prospect-mobile/contact-reminder/page.tsx'),
  );
  const contactSearchPageExists = existsSync(
    join(appRoot, 'app/prospect-mobile/contact-search/page.tsx'),
  );
  const contactReminderApiExists = existsSync(
    join(appRoot, 'app/api/contact-reminder-intake/route.ts'),
  );
  assert.match(pageText, /data-route="\/set-meetings"/);
  assert.match(pageText, /data-route="\/scout-schedules"/);
  assert.match(pageText, /data-route="\/contact-search"/);
  assert.match(pageText, /SC: Mobile/);
  assert.match(pageText, /className="brand-home-link" href="\/" aria-label="Back to Command Center"/);
  assert.match(pageText, /src="\/prospect-id-shield\.svg"/);
  assert.match(pageText, /alt="Prospect ID"/);
  assert.match(pageText, /className="mobile-mark shrink-0"/);
  assert.doesNotMatch(pageText, /className="brand-mark"/);
  assert.doesNotMatch(pageText, /\/prospect-mobile\/assets\/prospect-pipeline\.png/);
  assert.match(appText, /pageTitle\.textContent = 'SC: Mobile'/);
  assert.match(stylesText, /--command-bg:[\s\S]*#081120/);
  assert.match(stylesText, /background: var\(--command-bg\)/);
  assert.match(stylesText, /\.topbar \{[\s\S]*border: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
  assert.doesNotMatch(stylesText, /\.brand-mark/);
  assert.match(stylesText, /\.mobile-mark \{[\s\S]*width: 52px;[\s\S]*height: 52px;/);
  assert.match(stylesText, /\.mobile-mark \{[\s\S]*drop-shadow\(0 0 24px rgba\(0, 112, 243, 0\.3\)\)/);
  assert.match(stylesText, /\.shrink-0 \{[\s\S]*flex-shrink: 0;/);
  assert.match(stylesText, /text-shadow:[\s\S]*rgba\(0, 112, 243, 0\.22\)/);
  assert.equal(contactSearchPageExists, true);
  assert.match(appText, /'\/contact-search'/);
  assert.match(appText, /search_athlete_contact_cache/);
  assert.match(appText, /matched-result-actions/);
  assert.match(appText, /class="link-button admin-button"/);
  assert.match(appText, /buildAthleteAdminUrl/);
  assert.match(appText, /row\.admin_url/);
  assert.match(appText, /contact-create-button/);
  assert.match(appText, /contact-follow-up-button/);
  assert.match(appText, /renderContactSearch/);
  assert.match(appText, /scriptable:\/\/\/run\/\$\{encodeURIComponent\(scriptName\)\}\?phone=/);
  assert.match(appText, /buildContactClipboardPayload/);
  assert.match(appText, /data-contact-clipboard/);
  assert.match(appText, /bindScriptableContactButtons/);
  assert.match(appText, /navigator\.clipboard\.writeText\(clipboardText\)/);
  assert.match(appText, /ID New Contact/);
  assert.match(appText, /ID iCal Follow-Up/);
  assert.doesNotMatch(pageText, /data-route="\/contact-reminder"/);
  assert.doesNotMatch(appText, /'\/contact-reminder'/);
  assert.equal(contactReminderPageExists, false);
  assert.equal(contactReminderApiExists, false);
  assert.doesNotMatch(appText, /renderContactReminder/);
  assert.doesNotMatch(appText, /Reminder Intake/);
  assert.doesNotMatch(appText, /\/api\/contact-reminder-intake/);
  assert.doesNotMatch(appText, /\/api\/v1\/mobile/);
});

test('prospect mobile contact search keeps lookup and timezone matching on Supabase', () => {
  const appText = readFileSync(join(appRoot, 'public/prospect-mobile/app.js'), 'utf8');
  assert.match(appText, /\/rest\/v1\/rpc\/search_athlete_contact_cache/);
  assert.match(appText, /formatSlotRangeForTimezone/);
  assert.match(appText, /buildCurrentTimezoneTag/);
  assert.match(appText, /timezone-tag/);
  assert.match(appText, /state\.scheduleSearch/);
  assert.match(appText, /Search Contacts/);
  assert.match(appText, /data-schedule-search-start/);
  assert.doesNotMatch(appText, /\/api\/contact-search/);
  assert.doesNotMatch(appText, /\/api\/contact-lookup/);
});

test('prospect mobile scout schedules use short cache and local scout search', () => {
  const appText = readFileSync(join(appRoot, 'public/prospect-mobile/app.js'), 'utf8');
  const stylesText = readFileSync(join(appRoot, 'public/prospect-mobile/styles.css'), 'utf8');
  assert.match(appText, /ROUTE_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(appText, /routeResponseCache/);
  assert.match(appText, /getCachedRoutePayload\(cacheKey\)/);
  assert.match(appText, /loadRoute\(\{ forceRefresh: true \}\)/);
  assert.match(appText, /Search Scouts/);
  assert.match(appText, /state\.scheduleScoutSearch/);
  assert.match(appText, /filterScheduleGroupsByScout/);
  assert.match(appText, /normalizeScoutSearchText/);
  assert.match(stylesText, /\.scout-search-button \{[\s\S]*background: #0070f3;/);
  assert.match(stylesText, /\.contact-search-button \{[\s\S]*background: #b45309;/);
});

test('prospect mobile contact search supports shortcut query params', () => {
  const appText = readFileSync(join(appRoot, 'public/prospect-mobile/app.js'), 'utf8');
  assert.match(appText, /applyStartupSearchParams/);
  assert.match(appText, /URLSearchParams\(window\.location\.search\)/);
  assert.match(appText, /params\.get\('q'\)/);
  assert.match(appText, /params\.get\('phone'\)/);
  assert.match(appText, /runContactSearchQuery\(initialContactQuery, 'contact', \{ autoSelectSingle: true \}\)/);
  assert.match(appText, /history\.replaceState\(\{\}, '', `\/prospect-mobile\/contact-search\?q=\$\{encodeURIComponent\(trimmedQuery\)\}`\)/);
});

test('home command center uses the reduced glowing shield svg', () => {
  const pageText = readFileSync(join(appRoot, 'app/page.tsx'), 'utf8');
  const stylesText = readFileSync(join(appRoot, 'app/globals.css'), 'utf8');

  assert.match(pageText, /Command Center/);
  assert.match(pageText, /href: '\/prospect-call-tracker'[\s\S]*title: 'Prospect Call Tracker'/);
  assert.match(pageText, /href: '\/prospect-mobile'[\s\S]*title: 'Prospect Mobile'/);
  assert.match(pageText, /href: '\/prospect-meetings'[\s\S]*title: 'SC: Meetings'/);
  assert.match(pageText, /src="\/prospect-id-shield\.svg"/);
  assert.match(pageText, /alt="Prospect ID"/);
  assert.doesNotMatch(pageText, /\/prospect-call-tracker\/prospect-pipeline\.png/);
  assert.match(stylesText, /\.home-actions a \{[\s\S]*background: #0a0a0a;[\s\S]*color: var\(--geist-text\);/);
  assert.doesNotMatch(stylesText, /\.home-actions a \+ a/);
  assert.match(stylesText, /\.home-mark \{[\s\S]*width: 28px;[\s\S]*height: 28px;/);
  assert.match(stylesText, /\.home-mark \{[\s\S]*drop-shadow\(0 0 20px rgba\(0, 112, 243, 0\.28\)\)/);
});

test('prospect mobile tabs keep route renders scoped to the active tab', () => {
  const appText = readFileSync(join(appRoot, 'public/prospect-mobile/app.js'), 'utf8');
  assert.match(appText, /routeRequestId/);
  assert.match(appText, /setCurrentRoute\(nextRoute\)/);
  assert.match(appText, /isActiveRoute\(renderContext\)/);
  assert.match(appText, /swapContentHtml\(html, renderContext\)/);
  assert.match(appText, /nextRoute !== '\/scout-schedules'/);
  assert.match(appText, /nextRoute !== '\/contact-search'/);
});
