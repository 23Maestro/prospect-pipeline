import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function listFiles(dir: string): string[] {
  const root = join(repoRoot, dir);
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((entry) => {
    const full = join(root, entry);
    const rel = relative(repoRoot, full);
    if (
      rel.includes('node_modules/') ||
      rel.includes('/venv/') ||
      rel.includes('__pycache__') ||
      rel.includes('/.temp/')
    ) {
      return [];
    }
    if (statSync(full).isDirectory()) {
      return listFiles(rel);
    }
    return [rel];
  });
}

test('architecture docs pin the domain/adapters/persistence contract', () => {
  const doc = readRepoFile('docs/architecture/scout-prep-domain-contract.md');

  [
    'Laravel / Prospect ID is the external command/source system',
    'Raycast is the operator UI adapter',
    'FastAPI is the legacy website adapter',
    'Supabase is extension persistence/reporting',
    'Domain layer is the internal contract',
    'Facts are countable events',
    'A real Prospect ID event is not automatically an active-operator fact',
    'Laravel field names must be preserved at adapter boundaries',
    'source_owner and owner_proof are persistence outputs',
    'Outreach wording is domain-owned',
    'Scout Prep, Head Scout Schedules, and View Set Meetings share one command/data pipeline',
  ].forEach((phrase) => assert.match(doc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));

  assert.doesNotMatch(doc, /vercel/i);
  assert.doesNotMatch(doc, /netlify migration/i);
});

test('architecture smoke checklist covers the manual cross-system proof path', () => {
  const checklist = readRepoFile('docs/architecture/scout-prep-smoke-test-checklist.md');

  [
    'Open Scout Prep command.',
    'Run post-call update for a normal voicemail/contact stage.',
    'Confirm Laravel sales stage update still persists.',
    'Set a meeting from Raycast.',
    'Confirm Laravel/Prospect ID meeting is created.',
    'Confirm email/text workflow still fires.',
    'Open View Set Meetings.',
    'Confirm only active-operator meetings show.',
    'Send confirmation 1.',
    'Send confirmation 2.',
    'Confirm phrasing says this afternoon / tonight / tomorrow morning correctly.',
    'Confirm Supabase Call Tracker reports only materialized rows.',
    'Confirm Tim or other coordinator meetings do not appear as Jerami-owned.',
    'Confirm Scout Openings still lists Jeffrey/Luther/Ryan/James open slots.',
    'Confirm Head Scout calendar owner IDs still match legacy behavior.',
    'Confirm FastAPI legacy adapter routes still return expected data.',
  ].forEach((phrase) => assert.match(checklist, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
});

test('active-operator fallbacks are sourced from owner config/domain in command pipeline code', () => {
  const checkedFiles = [
    'src/domain/booked-meeting-source.ts',
    'src/domain/scout-message-context.ts',
    'src/domain/scout-prep-command-pipeline.ts',
    'src/domain/set-meetings-candidate.ts',
    'src/head-scout-schedules.tsx',
    'src/scout-prep.tsx',
  ];

  for (const path of checkedFiles) {
    const source = readRepoFile(path);
    assert.doesNotMatch(source, /\|\|\s*['"]Jerami Singleton['"]/);
    assert.doesNotMatch(source, /operatorName:\s*['"]Jerami Singleton['"]/);
    assert.doesNotMatch(source, /assignedToLegacyUserId:\s*['"]1408164['"]/);
  }
});

test('domain-owned helper logic is not duplicated in Raycast command surfaces', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  assert.match(scoutPrep, /from '\.\/domain\/post-call-action'/);
  assert.match(scoutPrep, /from '\.\/domain\/scout-prep-command-pipeline'/);
  assert.match(scoutPrep, /from '\.\/domain\/scout-task-selection'/);
  assert.doesNotMatch(scoutPrep, /function\s+findNewestIncompleteConfirmationTask/);
  assert.doesNotMatch(scoutPrep, /function\s+getMeetingReminderRecipient/);
  assert.doesNotMatch(scoutPrep, /function\s+getVoicemailFollowUpRecipients/);

  const headScoutSchedules = readRepoFile('src/head-scout-schedules.tsx');
  assert.match(headScoutSchedules, /from '\.\/domain\/set-meetings-candidate'/);
  assert.match(headScoutSchedules, /from '\.\/domain\/scout-prep-command-pipeline'/);
  assert.doesNotMatch(headScoutSchedules, /function\s+sortSetMeetingCandidates/);
  assert.doesNotMatch(headScoutSchedules, /function\s+buildSetMeetingCandidate/);

  const viewSetMeetings = readRepoFile('src/view-set-meetings.tsx').trim();
  assert.equal(
    viewSetMeetings,
    "import { HeadScoutBookingsList } from './head-scout-schedules';\n\nexport default function Command() {\n  return <HeadScoutBookingsList weeklyMeetingsOnly />;\n}",
  );
});

test('adapter files preserve legacy names and delegate domain meaning', () => {
  const salesStage = readRepoFile('src/lib/sales-stage.ts');
  assert.match(salesStage, /from '\.\.\/domain\/sales-stage-contract'/);
  assert.doesNotMatch(salesStage, /const\s+CURATED_SALES_STAGE_LABELS\s*=/);
  assert.match(salesStage, /body:\s*JSON\.stringify\(\{\s*athlete_main_id:/s);
  assert.match(salesStage, /assignedTo:\s*payload\.assigned_to/);

  const headScoutSchedules = readRepoFile('src/lib/head-scout-schedules.ts');
  assert.match(headScoutSchedules, /from '\.\.\/domain\/owners'/);
  assert.doesNotMatch(headScoutSchedules, /const\s+HEAD_SCOUT_ORDER\s*=\s*\[/);
  assert.match(headScoutSchedules, /meeting_for/);
  assert.match(headScoutSchedules, /calendar_owner_id/);
});

test('outreach time wording is resolved through the domain module', () => {
  const templates = readRepoFile('src/lib/scout-follow-up-templates.ts');
  assert.match(templates, /from '\.\.\/domain\/outreach-time-wording'/);
  assert.match(templates, /resolveConfirmationDayPhrase/);
  assert.match(templates, /resolveMeetingReminderPhrase/);
  assert.doesNotMatch(templates, /return ['"]tonight['"]/);
  assert.doesNotMatch(templates, /tomorrow \$\{bucket\}/);
});

test('Supabase reporting views materialize only domain facts or explicit compatibility proof', () => {
  const migration = readRepoFile('supabase/migrations/20260502011000_call_tracker_active_operator_materialization_gate.sql');

  assert.match(migration, /A real Prospect ID event is not automatically an active-operator dashboard fact/i);
  assert.match(migration, /payload_json->'materialization_proof'->>'materialization_status'\s*=\s*'operator_task'/);
  assert.match(migration, /legacy_compatibility_proof'\s*=\s*'weekly_operator_task_assigned_owner'/);
  assert.match(migration, /cae\.payload_json->>'materialization_status'\s*=\s*'operator_task'/);
  assert.match(migration, /nullif\(cae\.owner_proof, ''\) is not null/);
  assert.doesNotMatch(migration, /coalesce\(nullif\(le\.payload_json->>'operator_name', ''\), 'Jerami Singleton'\)/);
});

test('new architecture docs do not introduce Netlify-to-Vercel migration scope', () => {
  const architectureDocs = listFiles('docs/architecture').filter((path) => path.endsWith('.md'));
  const matches = architectureDocs.filter((path) => /vercel|netlify migration/i.test(readRepoFile(path)));
  assert.deepEqual(matches, []);
});
