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

test('migration did not edit Laravel/FastAPI, Supabase, Raycast command, or domain source files', () => {
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
    'src/domain/architecture-contract.test.ts',
    'src/lib/scout-follow-up-templates.test.ts',
  ]);
  const forbiddenPrefixes = ['npid-api-layer/', 'supabase/', 'src/'];
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
