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
  ].forEach((phrase) =>
    assert.match(doc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
  );

  assert.doesNotMatch(doc, /vercel/i);
  assert.doesNotMatch(doc, new RegExp('net' + 'lify migration', 'i'));
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
  ].forEach((phrase) =>
    assert.match(checklist, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
  );
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

test('confirmation text actions auto-prefix booked meeting titles', () => {
  const headScoutSchedules = readRepoFile('src/head-scout-schedules.tsx');
  assert.match(headScoutSchedules, /getConfirmationAppointmentPrefix/);
  assert.match(headScoutSchedules, /variant === 'confirmation_2' \? '\(ACF\*2\)' : '\(ACF\)'/);
  assert.match(
    headScoutSchedules,
    /updateBookedMeetingTitlePrefix\(\{\s*eventId:\s*candidate\.bookedMeeting\.event_id,[\s\S]*?prefix:\s*getConfirmationAppointmentPrefix\(variant\),/,
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

test('post-call task completion carries selected stage into lifecycle tracking', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  assert.match(
    scoutPrep,
    /completeScoutPrepTaskAfterVoicemail\(\{\s*athleteId:\s*taskCompletion\.athleteId,[\s\S]*?crmStage:\s*taskCompletion\.crmStage,[\s\S]*?taskTitle:\s*taskCompletion\.taskTitle,/,
  );
});

test('Supabase reporting views materialize only domain facts or explicit compatibility proof', () => {
  const migration = readRepoFile(
    'supabase/migrations/20260502011000_call_tracker_active_operator_materialization_gate.sql',
  );

  assert.match(
    migration,
    /A real Prospect ID event is not automatically an active-operator dashboard fact/i,
  );
  assert.match(
    migration,
    /payload_json->'materialization_proof'->>'materialization_status'\s*=\s*'operator_task'/,
  );
  assert.match(
    migration,
    /legacy_compatibility_proof'\s*=\s*'weekly_operator_task_assigned_owner'/,
  );
  assert.match(migration, /cae\.payload_json->>'materialization_status'\s*=\s*'operator_task'/);
  assert.match(migration, /nullif\(cae\.owner_proof, ''\) is not null/);
  assert.doesNotMatch(
    migration,
    /coalesce\(nullif\(le\.payload_json->>'operator_name', ''\), 'Jerami Singleton'\)/,
  );
});

test('Scout Prep Supabase source of truth keeps action-time writes separate from audit jobs', () => {
  const doc = readRepoFile('docs/architecture/scout-prep-supabase-source-of-truth.md');

  [
    'recordLifecycleMutation',
    'recordMeetingSet',
    'Confirmation cache is not lifecycle truth',
    'Pending Clients',
    'It must not read confirmation cache',
    'manual Laravel sales stage changes',
    'calendar title or event-list changes',
    'Legacy repair only',
    'Do not add new script-local lifecycle translation helpers',
    'src/domain/supabase-lifecycle-translator.ts',
    'src/lib/supabase-lifecycle.ts',
  ].forEach((phrase) =>
    assert.match(doc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
  );

  const reconcileSalesStages = readRepoFile(
    'scripts/reconcile-current-sales-stages-to-supabase.mjs',
  );
  assert.match(reconcileSalesStages, /Audit\/reconcile job only/);
  assert.match(
    reconcileSalesStages,
    /Raycast Scout Prep actions write Laravel and Supabase at action time/,
  );

  const syncCurrentPipeline = readRepoFile('scripts/sync-current-pipeline-to-supabase.mjs');
  assert.match(
    syncCurrentPipeline,
    /Audit\/reconcile job only for external\/manual current pipeline drift/,
  );

  const backsync = readRepoFile('scripts/backsync-lifecycle-call-activity-events.mjs');
  assert.match(backsync, /Legacy repair job only/);

  const materializer = readRepoFile('scripts/materialize-call-tracker-data-contract.mjs');
  assert.match(materializer, /Legacy\/materialization utility only/);
});

test('Scout Prep task ingest seeds missing athlete contact cache without blocking list render', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const setTaskBucketsIndex = scoutPrep.indexOf('setTaskBuckets(nextTaskBuckets)');
  const seedIndex = scoutPrep.indexOf('seedMissingAthleteContactCacheFromTasks(nextTaskBuckets)');

  assert.match(scoutPrep, /function uniqueContactCacheSeedTasks/);
  assert.match(scoutPrep, /hasAthleteContactCacheForTask\(task\)/);
  assert.match(scoutPrep, /if \(!cacheState\.enabled \|\| cacheState\.cached\) continue/);
  assert.match(scoutPrep, /source: 'scout_prep_task_ingest'/);
  assert.ok(setTaskBucketsIndex > 0);
  assert.ok(seedIndex > setTaskBucketsIndex);
});

test('Scout Prep client message and lifecycle flowcharts pin the current resolver gap', () => {
  const doc = readRepoFile('docs/architecture/scout-prep-client-message-lifecycle-flowcharts.md');

  [
    'Legacy Client Messages Routing',
    'the contact group was the gate',
    'Implemented Client Messages Routing',
    'active `athlete_contact_cache` rows can admit a thread into Client Messages',
    'ID Clients',
    'ID Contacts',
    'Current Lifecycle And Cache Truth',
    'athlete_pipeline_state current snapshot',
    'lifecycle_events audit history',
    'set_meeting_confirmation_cache',
    'not lifecycle truth',
    'Target Resolver Shape',
    'StudentAthleteMessageResolver',
    'plus lifecycle state is the natural gate',
    'Ambiguous message matches are flagged for review',
  ].forEach((phrase) =>
    assert.match(doc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
  );
});

test('Client Messages launches Scout Prep against the all-task bucket', () => {
  const clientMessages = readRepoFile('src/client-message-inbox.tsx');
  const scoutPrep = readRepoFile('src/scout-prep.tsx');

  assert.match(clientMessages, /name: 'scout-prep'/);
  assert.match(clientMessages, /initialFilter: 'all'/);
  assert.match(clientMessages, /searchText: athleteName/);
  assert.match(scoutPrep, /resolveInitialTaskListFilter\(launchContext\?\.initialFilter\)/);
  assert.match(scoutPrep, /const \[taskSearchText, setTaskSearchText\]/);
  assert.match(scoutPrep, /viewMode === 'tasks'\s*\?\s*taskSearchText/);
});

test('Scout Prep pipeline cleanup contract defines when active clients end', () => {
  const doc = readRepoFile('docs/architecture/scout-prep-pipeline-cleanup-contract.md');

  [
    'Deleted from the pipeline means: remove the athlete from the active work list.',
    'It does not mean: erase history.',
    'if there is still a real next step, keep them',
    'Actual Meeting - Close Won',
    'Actual Meeting - Close Lost',
    'Spoke to - Not Interested',
    'Spoke to - Too Young',
    'After a meeting ends, the meeting must get an ending.',
    'If the result is known, end it now.',
    'No Show: keep it for up to 7 days',
    'Follow Up: keep it for up to 7 days',
    'Reschedule Pending: keep it if there is a future booked meeting',
    'delete after 21 days',
    'Canceled: keep it for up to 21 days',
    'Never Spoke To / Call Attempt 3: delete after 3 days',
    'is only for confirmation message prep',
    'when reconciliation deletes `athlete_pipeline_state`',
    'the active pipeline row and active contact-cache rows end together',
  ].forEach((phrase) =>
    assert.match(doc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
  );
});

test('Prospect Web architecture docs keep hosting adapter scope separate from domain meaning', () => {
  const architectureDocs = listFiles('docs/architecture').filter((path) => path.endsWith('.md'));
  const matches = architectureDocs.filter((path) =>
    /prospect web|vercel/i.test(readRepoFile(path)),
  );
  assert.deepEqual(matches.sort(), [
    'docs/architecture/code-review-boundaries.md',
    'docs/architecture/prospect-web-hosting-adapter.md',
    'docs/architecture/vercel-live-verification.md',
  ]);

  for (const path of matches) {
    const doc = readRepoFile(path);
    assert.match(doc, /FastAPI remains|FastAPI is/i);
    assert.match(doc, /Supabase remains|Supabase is/i);
    assert.match(doc, /Domain modules remain|Domain modules define|Next\.js routes must not own/i);
    assert.doesNotMatch(doc, /Next\.js.*materialization source of truth/i);
    assert.doesNotMatch(doc, /Vercel.*domain ownership/i);
  }
});
