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
    'public/prospect-call-tracker/styles.css',
    'public/prospect-call-tracker/prospect-pipeline.png',
    'public/prospect-mobile/app.js',
    'public/prospect-mobile/styles.css',
    'public/prospect-mobile/set-meetings-utils.mjs',
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
    return serverOnly.filter((name) => text.includes(name)).map((name) => `${relative(appRoot, path)}:${name}`);
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
    return forbidden.filter((term) => text.includes(term)).map((term) => `${relative(appRoot, path)}:${term}`);
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

  const allowedSourceFiles = new Set([
    'npid-api-layer/app/routers/mobile.py',
    'npid-api-layer/test_mobile_booked_meetings.py',
    'npid-api-layer/app/static/call-tracker/app.js',
    'npid-api-layer/app/static/call-tracker/config.example.js',
    'npid-api-layer/app/static/call-tracker/styles.css',
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
    'scripts/reconcile-current-sales-stages-to-supabase.test.mjs',
    'scripts/repair-call-event-owner-proof.mjs',
    'scripts/sync-current-pipeline-to-supabase.mjs',
    'scripts/sync-current-pipeline-to-supabase.test.mjs',
    'supabase/migrations/20260503043000_backsync_meeting_set_materialization_contract.sql',
    'supabase/migrations/20260503044000_rename_call_events_to_meeting_events.sql',
    'supabase/migrations/20260503045000_backsync_call_activity_counting_contract.sql',
    'supabase/migrations/20260503030000_call_tracker_counting_contract.sql',
    'supabase/tests/call-activity-materialization-backsync.test.mjs',
    'supabase/tests/call-events-post-meeting-contract.test.mjs',
    'supabase/tests/call-tracker-counting-contract.test.mjs',
    'supabase/tests/call-tracker-summary-activity-counts.test.mjs',
    'supabase/tests/meeting-set-materialization-backsync.test.mjs',
  ]);
  const forbiddenPrefixes = ['npid-api-layer/', 'scripts/', 'supabase/', 'src/'];
  const offenders = changedFiles.filter(
    (path) => forbiddenPrefixes.some((prefix) => path.startsWith(prefix)) && !allowedSourceFiles.has(path),
  );
  assert.deepEqual(offenders, []);
});

test('Netlify files and deploy instructions are removed after Vercel migration', () => {
  assert.equal(existsSync(join(repoRoot, 'netlify.toml')), false, 'netlify.toml should not exist');
  assert.equal(existsSync(join(repoRoot, 'netlify', 'functions')), false, 'netlify/functions should not exist');
  assert.equal(existsSync(join(repoRoot, 'mobile-web')), false, 'old Netlify mobile-web publish dir should not exist');

  const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const netlifyScripts = Object.entries(rootPackage.scripts || {})
    .filter(([, value]) => /netlify/i.test(String(value)))
    .map(([key]) => key);
  assert.deepEqual(netlifyScripts, []);

  const historicalDocs = new Set([
    'docs/architecture/netlify-to-vercel-migration.md',
    'docs/architecture/prospect-web-hosting-adapter.md',
    'docs/architecture/vercel-live-verification.md',
    'docs/superpowers/plans/2026-05-02-prospect-web-vercel-adapter.md',
  ]);
  const scannedFiles = [
    ...walk(join(repoRoot, 'apps', 'prospect-web')),
    ...walk(join(repoRoot, 'docs')),
    ...walk(join(repoRoot, 'npid-api-layer', 'app')),
    ...walk(join(repoRoot, 'src')),
    join(repoRoot, 'package.json'),
  ].filter((path) => !path.includes('/node_modules/') && !path.includes('/.next/'));

  const offenders = scannedFiles.flatMap((path) => {
    const rel = relative(repoRoot, path);
    if (rel === 'apps/prospect-web/tests/static-guards.test.ts') return [];
    if (historicalDocs.has(rel)) return [];
    const text = readFileSync(path, 'utf8');
    return /netlify\.app|netlify deploy|netlify\/functions|netlify\.toml|mobile-web|x-mobile-proxy': 'netlify|x-mobile-proxy": "netlify/i.test(
      text,
    )
      ? [rel]
      : [];
  });
  assert.deepEqual([...new Set(offenders)].sort(), []);
});

test('call tracker public contract documents count flags as the reporting source of truth', () => {
  const contractPath = join(appRoot, 'public/prospect-call-tracker/data-contract.json');
  const contractText = readFileSync(contractPath, 'utf8');
  const contract = JSON.parse(contractText);

  assert.match(contract.purpose, /activity_kind is not the reporting source of truth/i);
  assert.match(contract.purpose, /countsAsDial/i);
  assert.match(contract.purpose, /countsAsContact/i);
  assert.match(contract.purpose, /countsAsMeetingSet/i);
  assert.match(contract.purpose, /countsAsPostMeetingOutcome/i);

  const meetingSet = contract.domainOutcomeRules.find((rule: { domainStatus: string }) => rule.domainStatus === 'meeting_set');
  assert.equal(meetingSet.countsAsDial, true);
  assert.equal(meetingSet.countsAsContact, true);
  assert.equal(meetingSet.countsAsMeetingSet, true);
  assert.equal(meetingSet.countsAsPostMeetingOutcome, false);

  const postMeetingRules = contract.domainOutcomeRules.filter((rule: { domainStatus: string }) =>
    ['closed_won', 'closed_lost', 'reschedule_pending', 'no_show', 'canceled'].includes(rule.domainStatus),
  );
  assert.equal(postMeetingRules.length, 5);
  for (const rule of postMeetingRules) {
    assert.equal(rule.countsAsDial, false, rule.domainStatus);
    assert.equal(rule.countsAsContact, false, rule.domainStatus);
    assert.equal(rule.countsAsPostMeetingOutcome, true, rule.domainStatus);
  }
});

test('Vercel public dashboard assets are tracked in git despite public ignore rule', () => {
  const trackedFiles = execFileSync('git', ['ls-files',
    'apps/prospect-web/public/prospect-call-tracker/app.js',
    'apps/prospect-web/public/prospect-call-tracker/data-contract.json',
    'apps/prospect-web/public/prospect-call-tracker/prospect-pipeline.png',
    'apps/prospect-web/public/prospect-call-tracker/styles.css',
    'apps/prospect-web/public/prospect-mobile/app.js',
    'apps/prospect-web/public/prospect-mobile/assets/prospect-pipeline.png',
    'apps/prospect-web/public/prospect-mobile/set-meetings-utils.mjs',
    'apps/prospect-web/public/prospect-mobile/styles.css',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(trackedFiles, [
    'apps/prospect-web/public/prospect-call-tracker/app.js',
    'apps/prospect-web/public/prospect-call-tracker/data-contract.json',
    'apps/prospect-web/public/prospect-call-tracker/prospect-pipeline.png',
    'apps/prospect-web/public/prospect-call-tracker/styles.css',
    'apps/prospect-web/public/prospect-mobile/app.js',
    'apps/prospect-web/public/prospect-mobile/assets/prospect-pipeline.png',
    'apps/prospect-web/public/prospect-mobile/set-meetings-utils.mjs',
    'apps/prospect-web/public/prospect-mobile/styles.css',
  ]);
});

test('call tracker daily cards consume Supabase boolean count fields only', () => {
  const appText = readFileSync(join(appRoot, 'public/prospect-call-tracker/app.js'), 'utf8');
  assert.match(appText, /counts_as_dial/);
  assert.match(appText, /counts_as_contact/);
  assert.match(appText, /counts_as_meeting_set/);
  assert.match(appText, /row\.counts_as_dial === true/);
  assert.match(appText, /row\.counts_as_contact === true/);
  assert.doesNotMatch(appText, /contactMadeOutcomes|callActivityOutcomes|isDailyCallActivity|isDailyContact/);
});
