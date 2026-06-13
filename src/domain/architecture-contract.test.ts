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

test('Pending Clients exposes an operator note action that writes to the Notes tab and refreshes', () => {
  const headScoutSchedules = readRepoFile('src/head-scout-schedules.tsx');
  assert.match(headScoutSchedules, /PendingClientOperatorNoteForm/);
  assert.match(headScoutSchedules, /import \{ addAthleteNote \} from '\.\/lib\/npid-mcp-adapter'/);
  assert.match(headScoutSchedules, /title="Note"/);
  assert.match(headScoutSchedules, /shortcut=\{\{ modifiers: \['cmd'\], key: 'n' \}\}/);
  assert.match(headScoutSchedules, /await addAthleteNote\(\{/);
  assert.match(headScoutSchedules, /onSaved\(\);/);
  assert.match(headScoutSchedules, /setRefreshTick\(\(current\) => current \+ 1\)/);
});

test('Pending Clients reuses Scout Prep reschedule voicemail instead of adding a new message path', () => {
  const headScoutSchedules = readRepoFile('src/head-scout-schedules.tsx');
  const scoutPrep = readRepoFile('src/scout-prep.tsx');

  assert.match(
    headScoutSchedules,
    /import \{ PostCallUpdateForm, VoicemailFollowUpRecipientForm \} from '\.\/scout-prep'/,
  );
  assert.match(headScoutSchedules, /function buildPendingClientTask/);
  assert.match(headScoutSchedules, /title:\s*'Reschedule Pending'/);
  assert.match(headScoutSchedules, /function PendingClientRescheduleFollowUp/);
  assert.match(headScoutSchedules, /await loadScoutPrepContext\(task\)/);
  assert.match(
    headScoutSchedules,
    /<VoicemailFollowUpRecipientForm[\s\S]*currentTask="Reschedule Pending"/,
  );
  assert.match(scoutPrep, /const mode = await openMessagesDraftForRecipients\(recipient\.phones, body\)/);
  assert.doesNotMatch(scoutPrep, /mode: 'raycast-ui'/);
  assert.match(headScoutSchedules, /title="Send"/);
  assert.match(headScoutSchedules, /shortcut=\{\{ modifiers: \['cmd', 'shift'\], key: 'r' \}\}/);
});

test('Scouting Command post-call helper wraps Raycast post-call writer paths', () => {
  const source = readRepoFile('src/lib/scout-prep-post-call-update.ts');
  const contract = readRepoFile('docs/architecture/scouting-command-raycast-mutation-contract.md');

  assert.match(source, /buildPostCallActionPlan/);
  assert.match(source, /fetchScoutPrepPostCallUpdateStageOptions/);
  assert.match(source, /fetchCuratedSalesStageOptions/);
  assert.match(source, /POST_CALL_UPDATE_EXCLUDED_STAGE_LABELS/);
  assert.match(source, /classifyPostCallActivityStage\(label\)/);
  assert.match(source, /updateSalesStage\(\{/);
  assert.match(source, /completeScoutPrepTaskAfterVoicemail\(\{/);
  assert.match(source, /needsPostCallMeetingSchedulingFields\(stageLabel\)/);
  assert.match(source, /classifyPostMeetingOutcomeStage\(stageLabel\)/);
  assert.match(source, /fetchScoutPrepPostCallMeetingSetFormModel/);
  assert.match(source, /submitMeetingSet\(initialPlan\.laravelMeetingSetSubmit\)/);
  assert.match(source, /recordMeetingSet\(actionPlan\.supabaseLifecycleWrite\.args\)/);
  assert.match(source, /syncMeetingSetConfirmationCacheFromScoutPrep\(\{/);
  assert.doesNotMatch(source, /crmStage:\s*null/);

  assert.match(contract, /src\/lib\/scout-prep-post-call-update\.ts/);
  assert.match(contract, /`submitMeetingSet` -> `updateSalesStage` -> `recordMeetingSet` -> `syncMeetingSetConfirmationCacheFromScoutPrep`/);
  assert.match(contract, /Confirmed reschedule scheduling and post-meeting outcome stages must remain blocked/);
});

test('one-off and batch reschedule voicemail share ranked slot suggestions', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const rescheduleRecovery = readRepoFile('src/lib/reschedule-recovery-context.ts');
  const pickerStart = scoutPrep.indexOf('function RescheduleSlotSelectionList');
  const formStart = scoutPrep.indexOf('export function VoicemailFollowUpRecipientForm');
  const batchPlanStart = scoutPrep.indexOf('async function buildRescheduleBatchPlan');
  const batchPlanEnd = scoutPrep.indexOf('async function runScoutPrepStageCompletionBatchRow');

  assert.match(scoutPrep, /from '\.\/lib\/reschedule-recovery-context'/);
  assert.match(rescheduleRecovery, /export function scoreRescheduleRecoverySlot\(/);
  assert.doesNotMatch(scoutPrep, /scoreRescheduleBatchSlot/);
  assert.doesNotMatch(scoutPrep, /function scoreRescheduleSlot\(/);
  assert.doesNotMatch(scoutPrep, /async function buildRankedRescheduleSlotPlan/);
  assert.match(rescheduleRecovery, /export async function buildRankedRescheduleSlotPlan/);
  assert.match(
    rescheduleRecovery,
    /const weekOffsets = args\.weekOffsets\?\.length \? args\.weekOffsets : \[0, 1\]/,
  );

  const picker = scoutPrep.slice(pickerStart, formStart);
  assert.match(picker, /buildRankedRescheduleSlotPlan\(\{/);
  assert.match(picker, /weekOffsets: weekOffset > 0 \? \[weekOffset\] : \[0, 1\]/);
  assert.match(picker, /title="Use Suggested Slots"/);
  assert.match(picker, /title="Select New Slots"/);
  assert.match(picker, /onSlotsSelected\(suggestedSlots\.slice\(0, 2\)\)/);

  const batchPlan = scoutPrep.slice(batchPlanStart, batchPlanEnd);
  assert.match(batchPlan, /const plan = await buildRankedRescheduleSlotPlan\(args\)/);
  assert.match(batchPlan, /slots: plan\.suggestedSlots/);
});

test('Client Outreach proposed times uses slot picker without appointment truth', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const rescheduleRecovery = readRepoFile('src/lib/reschedule-recovery-context.ts');

  assert.match(
    scoutPrep,
    /requirePreviousMeeting=\{isRescheduleVoicemailVariant\(selectedVariant\)\}/,
  );
  assert.match(
    rescheduleRecovery,
    /const mustHavePreviousMeeting = args\.requirePreviousMeeting !== false/,
  );
  assert.match(rescheduleRecovery, /mustHavePreviousMeeting && athleteId && athleteMainId/);
  assert.match(rescheduleRecovery, /resolveBookedMeetingDetailsForForm\(/);
  assert.doesNotMatch(rescheduleRecovery, /resolveRequiredAppointmentTruthMeeting\(/);
  assert.match(
    rescheduleRecovery,
    /resolveTimezone\(identity\.city, identity\.state\)/,
  );
});

test('Client Messages and Pending Clients use the shared reschedule recovery foundation', () => {
  const clientMessages = readRepoFile('src/client-message-inbox.tsx');
  const headScoutSchedules = readRepoFile('src/head-scout-schedules.tsx');
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const rescheduleRecovery = readRepoFile('src/lib/reschedule-recovery-context.ts');

  assert.match(clientMessages, /from '\.\/lib\/reschedule-recovery-context'/);
  assert.match(clientMessages, /buildRescheduleRecoverySlotPlan\(\{/);
  assert.doesNotMatch(clientMessages, /function buildClientReviewRescheduleSlotOptions/);
  assert.doesNotMatch(clientMessages, /function resolveReviewClientTimezone/);
  assert.match(headScoutSchedules, /<VoicemailFollowUpRecipientForm[\s\S]*currentTask="Reschedule Pending"/);
  assert.match(scoutPrep, /buildRankedRescheduleSlotPlan\(\{/);
  assert.match(rescheduleRecovery, /export async function buildRescheduleRecoverySlotPlan/);
  assert.match(rescheduleRecovery, /previousMeetingSource: 'latest_appointment_truth'/);
});

test('Post-call reschedule template hydration reads the exact admin Events row', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const loadTemplateStart = scoutPrep.indexOf('const loadTemplate = async () => {');
  const loadTemplateEnd = scoutPrep.indexOf('const meetingTemplateKey =', loadTemplateStart);
  const loadTemplate = scoutPrep.slice(loadTemplateStart, loadTemplateEnd);

  assert.match(loadTemplate, /fetchExactAdminEventsTabMeeting\(/);
  assert.match(loadTemplate, /eventId:\s*initialBookedMeeting\?\.event_id \|\| currentBookedMeeting\?\.event_id/);
  assert.match(loadTemplate, /resolveBookedMeetingDetailsForForm\(/);
  assert.match(loadTemplate, /initialBookedMeeting:\s*adminEventsTabMeeting \|\| initialBookedMeeting/);
  assert.match(loadTemplate, /meeting_name:\s*adminEventsTabMeeting\.title/);
  assert.match(loadTemplate, /details_template:\s*adminEventsTabMeeting\.description \|\| ''/);
  assert.doesNotMatch(loadTemplate, /'appointment_truth'/);
});

test('Scout Prep keeps confirmed reschedule inside the Post-Call Update sales-stage dropdown', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const salesStageContract = readRepoFile('src/domain/sales-stage-contract.ts');

  assert.doesNotMatch(scoutPrep, /title="Meeting Set - Rescheduled"/);
  assert.doesNotMatch(scoutPrep, /initialStageLabel="Meeting Result - Rescheduled"/);
  assert.match(salesStageContract, /'Meeting Result - Rescheduled'/);
});

test('Post-call reschedule full-title writes emit title audit logs', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const rescheduleSubmitStart = scoutPrep.indexOf(
    '} else if (isConfirmedRescheduleMeetingStage(stageLabel))',
  );
  const rescheduleSubmitEnd = scoutPrep.indexOf(
    'const basePlan = buildPostCallActionPlan',
    rescheduleSubmitStart,
  );
  const rescheduleSubmit = scoutPrep.slice(rescheduleSubmitStart, rescheduleSubmitEnd);

  assert.match(rescheduleSubmit, /SCOUT_PREP_RESCHEDULE_TITLE_WRITE/);
  assert.match(rescheduleSubmit, /meetingNameMatchesHeadScoutName/);
  assert.match(rescheduleSubmit, /meetingNameMatchesCurrentBookedMeetingTitle/);
  assert.match(rescheduleSubmit, /submitRescheduleMeeting\(rescheduleMeetingPayload\)/);
});

test('Post-call confirmed reschedule uses one Meetings identity for Laravel and Supabase', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const formStart = scoutPrep.indexOf('export function PostCallUpdateForm');
  const formEnd = scoutPrep.indexOf('function ScoutPrepTaskItem', formStart);
  const formSource = scoutPrep.slice(formStart, formEnd);

  assert.match(
    scoutPrep,
    /resolveConfirmedRescheduleAppointmentIdentity/,
  );
  assert.match(
    formSource,
    /rescheduleAppointmentIdentity = resolveConfirmedRescheduleAppointmentIdentity/,
  );
  assert.match(formSource, /previous_event_id:\s*rescheduleAppointmentIdentity\.previousEventId/);
  assert.match(formSource, /previousAppointmentId:\s*rescheduleAppointmentIdentity\.previousAppointmentId/);
  assert.match(formSource, /previous_appointment_id:\s*rescheduleAppointmentIdentity\.previousAppointmentId/);
  assert.doesNotMatch(formSource, /previous_event_id:\s*initialBookedMeeting\?\.event_id/);
  assert.doesNotMatch(formSource, /previousAppointmentId:\s*initialBookedMeeting\?\.event_id/);
  assert.doesNotMatch(formSource, /previous_appointment_id:\s*initialBookedMeeting\?\.event_id/);
});

test('Set Meetings confirmation send path does not rebuild confirmation cache', () => {
  const headScoutSchedules = readRepoFile('src/head-scout-schedules.tsx');
  const sendConfirmationStart = headScoutSchedules.indexOf('async function sendConfirmationText');
  const confirmationFlow = headScoutSchedules.slice(
    sendConfirmationStart,
    headScoutSchedules.indexOf('function buildConfirmationTextForm', sendConfirmationStart),
  );

  assert.match(confirmationFlow, /readCachedSetMeetingConfirmation/);
  assert.doesNotMatch(confirmationFlow, /prepareConfirmationFollowUp/);
  assert.doesNotMatch(confirmationFlow, /buildSetMeetingConfirmationCacheRows/);
  assert.doesNotMatch(confirmationFlow, /deleteRows\([\s\S]*?set_meeting_confirmation_cache/);
  assert.doesNotMatch(confirmationFlow, /meetingTimezone:\s*['"]America\/New_York['"]/);
});

test('Set Meetings confirmation send path reads confirmation cache before rebuilding context', () => {
  const headScoutSchedules = readRepoFile('src/head-scout-schedules.tsx');
  const cacheReaderStart = headScoutSchedules.indexOf(
    'async function readCachedSetMeetingConfirmation',
  );
  const sendConfirmationStart = headScoutSchedules.indexOf('async function sendConfirmationText');
  const confirmationFlow = headScoutSchedules.slice(
    sendConfirmationStart,
    headScoutSchedules.indexOf('function buildConfirmationTextForm', sendConfirmationStart),
  );

  assert.ok(cacheReaderStart >= 0);
  assert.match(
    headScoutSchedules.slice(cacheReaderStart, sendConfirmationStart),
    /readRows<[\s\S]*set_meeting_confirmation_cache[\s\S]*message_body[\s\S]*recipient_phone/,
  );
  assert.match(confirmationFlow, /const cached = await readCachedSetMeetingConfirmation/);
  assert.doesNotMatch(confirmationFlow, /loadScoutPrepContext\(task\)/);
  assert.doesNotMatch(confirmationFlow, /Confirmation2SendForm/);
  assert.match(confirmationFlow, /buildMessagesComposeUrlForRecipients\(cached\.phones, cached\.message\)/);
});

test('Scout Prep contact context resolves timezone from athlete city and state', () => {
  const scoutPrepContext = readRepoFile('src/lib/scout-prep.tsx');
  const timezoneStart = scoutPrepContext.indexOf('const resolvedCity =');
  const timezoneFlow = scoutPrepContext.slice(
    timezoneStart,
    scoutPrepContext.indexOf('return {', timezoneStart),
  );
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const contactDomain = readRepoFile('src/lib/scout-prep-contact.ts');
  const contactNoteStart = contactDomain.indexOf('export function buildProspectContactAdminNote');
  const contactNoteFlow = contactDomain.slice(
    contactNoteStart,
    contactDomain.indexOf('function setTemplateValue', contactNoteStart),
  );

  assert.match(timezoneFlow, /resolveTimezone\(resolvedCity, resolvedState\)/);
  assert.doesNotMatch(timezoneFlow, /resolveBookedMeetingDetailsForForm/);
  assert.match(contactNoteFlow, /resolveTimezone\(context\.resolved\.city, context\.resolved\.state\)/);
  assert.doesNotMatch(contactNoteFlow, /appointment truth timezone/);
  assert.doesNotMatch(contactNoteFlow, /meetingTimezone|current_meeting_timezone|appointment/);
  assert.match(scoutPrep, /saveProspectContacts\(firstNames, lastNames, phones, urls, notes\)/);
  assert.match(scoutPrep, /saveProspectContactsWithNameOverride\([\s\S]*?uniqueCandidates\.map\(\(\) => true\),[\s\S]*?\)/);
  assert.match(scoutPrep, /handleCreateAllProspectContacts\([\s\S]*?createProspectContactsBatch\([\s\S]*?contactCandidates,[\s\S]*?''[\s\S]*?\)/);
  assert.match(scoutPrep, /handleSaveProspectContactRole\([\s\S]*?createProspectContactsBatch\([\s\S]*?\[candidate\],[\s\S]*?\{ overwriteNames: true \}[\s\S]*?\)/);
  assert.match(scoutPrep, /title="Save as Parent 1 Contact"[\s\S]*?shortcut=\{\{ modifiers: \['cmd'\], key: '2' \}\}/);
  assert.match(scoutPrep, /title="Save as Parent 2 Contact"[\s\S]*?shortcut=\{\{ modifiers: \['cmd'\], key: '3' \}\}/);
  assert.doesNotMatch(scoutPrep, /Save as Student Athlete Contact/);
  assert.match(scoutPrep, /normalizePhoneForMessages\(candidate\.phone\) \|\| candidate\.phone/);
  assert.match(scoutPrep, /createProspectContactsBatch\([\s\S]*?buildScoutPrepAdminUrl\([\s\S]*?''[\s\S]*?\)/);
  assert.doesNotMatch(scoutPrep, /appendProspectContactNotes|runAppleScript|osascript/);
  const contactsBridge = readRepoFile('swift/contacts/Sources/ContactsBridge.swift');
  assert.match(contactsBridge, /appendHomeUrlIfMissing\(url, to: contact\)/);
  assert.match(contactsBridge, /findContactByPhone\(normalizedPhone, store: store, keys: keys\)/);
  assert.match(contactsBridge, /findContactsByPhone\(normalizedPhone, store: store, keys: prospectContactKeys\(\)\)/);
  assert.match(contactsBridge, /request\.delete\(duplicateContact\.mutableCopy\(\) as! CNMutableContact\)/);
  assert.doesNotMatch(contactsBridge, /launchContactNotesUpdateWithContactsApp|osascript|set note of contactPerson/);
  assert.doesNotMatch(contactsBridge, /appendTimezonePayload|queryItems|contact\.organizationName|CNContactNoteKey|contact\.note|kABNoteProperty/);
});

test('Scout Prep meeting-set confirmation cache writer replaces appointment rows', () => {
  const cacheSync = readRepoFile('src/lib/set-meeting-confirmation-cache-sync.ts');
  const syncFlow = cacheSync.slice(
    cacheSync.indexOf('export async function syncMeetingSetConfirmationCacheFromScoutPrep'),
  );

  assert.match(
    syncFlow,
    /deleteRows\([\s\S]*?'set_meeting_confirmation_cache'[\s\S]*?'appointment_id'/,
  );
  assert.match(syncFlow, /await upsertSetMeetingConfirmationCacheRows\(config, rows\)/);
  assert.ok(
    syncFlow.indexOf('deleteRows(') <
      syncFlow.indexOf('upsertSetMeetingConfirmationCacheRows(config, rows)'),
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
  const scoutPrepLib = readRepoFile('src/lib/scout-prep.tsx');
  const taskCompletion = readRepoFile('src/lib/scout-prep-task-completion.ts');
  const taskUpdate = readRepoFile('src/lib/scout-prep-task-update.ts');

  assert.match(scoutPrepLib, /export \{ completeScoutPrepTaskAfterVoicemail \} from '\.\/scout-prep-task-completion'/);
  assert.match(scoutPrepLib, /export \{ updateScoutPrepTask \} from '\.\/scout-prep-task-update'/);
  assert.match(
    scoutPrep,
    /completeScoutPrepTaskAfterVoicemail\(\{\s*athleteId:\s*taskCompletion\.athleteId,[\s\S]*?crmStage:\s*taskCompletion\.crmStage,[\s\S]*?taskTitle:\s*taskCompletion\.taskTitle,/,
  );
  assert.match(taskCompletion, /apiFetch\('\/tasks\/complete'/);
  assert.match(taskCompletion, /lifecycleSalesStage\(\{\s*sourcePost: '\/tasks\/complete'/);
  assert.match(taskUpdate, /apiFetch\('\/tasks\/update'/);
  assert.match(taskUpdate, /lifecycleSalesStage\(\{\s*sourcePost: '\/tasks\/update'/);
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
    'lifecycleSalesStage',
    'recordMeetingSet',
    'Confirmation cache is not lifecycle truth',
    'Pending Clients',
    'Pending Clients may read confirmation cache as aligned meeting-support evidence',
    'it must not use confirmation cache to decide lifecycle stage',
    'manual Laravel sales stage changes',
    'calendar title or event-list changes',
    'Legacy repair only',
    'Do not add new script-local lifecycle translation helpers',
    'src/domain/supabase-lifecycle-translator.ts',
    'src/lib/supabase-lifecycle.ts',
    'Meeting Time Mutation Rights',
    'Meeting time means one thing across the system',
    'appointments.starts_at',
    'set_meeting_confirmation_cache.meeting_starts_at',
    'pending_client_watchlist.event_start',
    'call_log.booked_event_starts_at',
    'A post-meeting watcher may update appointment `post_meeting_result` and `status_reason`; it may not update `status` or `starts_at`',
    '`reschedule_pending` is a post-meeting outcome/Pending Clients state',
    'The hourly cron must not run broad booked-meeting backfills',
  ].forEach((phrase) =>
    assert.match(doc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
  );

  const syncCurrentPipeline = readRepoFile('scripts/sync-current-pipeline-to-supabase.mjs');
  assert.match(
    syncCurrentPipeline,
    /Scheduled current-pipeline sync lane for Laravel task\/stage facts/,
  );
  assert.match(syncCurrentPipeline, /resolveWorkflowContext/);

  const packageJson = readRepoFile('package.json');
  assert.doesNotMatch(packageJson, /reconcile:current-sales-stages-supabase/);

  const backsync = readRepoFile('scripts/backsync-lifecycle-call-activity-events.mjs');
  assert.match(backsync, /Legacy repair job only/);

  const materializer = readRepoFile('scripts/materialize-call-tracker-data-contract.mjs');
  assert.match(materializer, /Legacy\/materialization utility only/);
});

test('Scout Prep task ingest seeds missing athlete contact cache without blocking list render', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const setTaskBucketsIndex = scoutPrep.indexOf('setTaskBuckets((current) => ({');
  const seedIndex = scoutPrep.indexOf('seedMissingAthleteContactCacheFromTasks({');

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
    'lifecycle_events current projection',
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

  assert.match(clientMessages, /LaunchProps<\{ launchContext\?: ClientMessageLaunchContext \}>/);
  assert.match(
    clientMessages,
    /const initialSearchText = String\(launchContext\?\.searchText \|\| ''\)\.trim\(\)/,
  );
  assert.match(clientMessages, /name: 'scout-prep'/);
  assert.match(clientMessages, /initialFilter: 'all'/);
  assert.match(clientMessages, /searchText: athleteName/);
  assert.match(
    clientMessages,
    /title="Open Scout Prep"[\s\S]*?shortcut=\{\{ modifiers: \['cmd', 'shift'\], key: 's' \}\}/,
  );
  assert.match(scoutPrep, /resolveInitialTaskListFilter\(launchContext\.initialFilter\)/);
  assert.match(scoutPrep, /const \[taskSearchText, setTaskSearchText\]/);
  assert.match(scoutPrep, /viewMode === 'prospect'\s*\?\s*prospectSearchText\s*:\s*taskSearchText/);
});

test('Scout Prep all-task bucket is search-first and server filtered', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const scoutPrepApi = readRepoFile('src/lib/scout-prep.tsx');
  const scoutRouter = readRepoFile('npid-api-layer/app/routers/scout.py');
  const legacyTranslator = readRepoFile('npid-api-layer/app/translators/legacy.py');

  assert.match(scoutPrepApi, /searchText\?: string/);
  assert.match(scoutPrepApi, /params\.set\('searchText', options\.searchText\.trim\(\)\)/);
  assert.match(scoutRouter, /searchText: str \| None = None/);
  assert.match(legacyTranslator, /search_text: Optional\[str\] = None/);
  assert.match(legacyTranslator, /params\["search\[value\]"\] = search_text\.strip\(\)/);
  assert.match(scoutPrep, /const isAllTaskSearchFirst = taskListFilter === 'all'/);
  assert.match(scoutPrep, /const allTaskSearchText = taskSearchText\.trim\(\)/);
  assert.match(scoutPrep, /if \(!allTaskSearchText\)/);
  assert.match(scoutPrep, /async function selectAllTaskSearch\(\)/);
  assert.match(
    scoutPrep,
    /title="Show All"[\s\S]*?shortcut=\{\{ modifiers: \['cmd', 'opt'\], key: 's' \}\}/,
  );
  assert.doesNotMatch(
    scoutPrep,
    /title="Supabase Lifecycle Status"[\s\S]{0,160}?shortcut=\{\{ modifiers: \['cmd', 'opt'\], key: 's' \}\}/,
  );
  assert.match(scoutPrep, /loadAllTaskSearch\(allTaskSearchText\)/);
  assert.match(scoutPrep, /searchText,\s*\n\s*\}\)/);
  assert.match(
    scoutPrep,
    /async function returnToRootTaskList\(\)[\s\S]*allTaskSearchRequestIdRef\.current \+= 1;[\s\S]*setTaskSearchText\(''\);[\s\S]*all: \[\],[\s\S]*await clearSearchBar\(\{ forceScrollToTop: true \}\);[\s\S]*await loadTasks\(\{ force: true \}\);/,
  );
});

test('Scout Prep launches Client Messages against contact-cache matched threads', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');

  assert.match(scoutPrep, /name: 'client-message-inbox'/);
  assert.match(scoutPrep, /searchText: buildClientMessageSearchTextFromScoutPrepTask\(task\)/);
  assert.match(scoutPrep, /source: 'scout-prep'/);
  assert.match(
    scoutPrep,
    /title="Open Client Messages"[\s\S]*?shortcut=\{\{ modifiers: \['cmd', 'shift'\], key: 'm' \}\}/,
  );
});

test('Client Messages admits threads only through student-athlete contact-cache identity', () => {
  const sandbox = readRepoFile('src/lib/client-message-sandbox.ts');

  assert.match(sandbox, /resolveStudentAthleteMessagesForPhones\(chatPhones\)/);
  assert.match(sandbox, /mergeContactCacheMatches\(matchesByPhone, contactCacheResolutions\)/);
  assert.doesNotMatch(sandbox, /fetchContactsInGroup/);
  assert.doesNotMatch(sandbox, /CLIENT_CONTACT_GROUP_CANDIDATES/);
  assert.doesNotMatch(sandbox, /searchParentContactsByName/);
  assert.doesNotMatch(sandbox, /resolveBackendMatchForContact/);
  assert.doesNotMatch(sandbox, /contactsByPhone/);
  assert.doesNotMatch(sandbox, /source: 'contacts'/);
  assert.doesNotMatch(sandbox, /source: 'backend'/);
});

test('Client message UI verifies direct sends while normal Scout Prep and Set Meetings use native draft handoff', () => {
  const clientMessages = readRepoFile('src/client-message-inbox.tsx');
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const setMeetings = readRepoFile('src/head-scout-schedules.tsx');
  const sandbox = readRepoFile('src/lib/client-message-sandbox.ts');

  assert.match(sandbox, /export async function sendVerifiedClientMessage/);
  assert.match(sandbox, /const result = await sendClientMessage\(args\)/);
  assert.match(sandbox, /await verifyRecentClientMessageSend\(/);
  assert.match(clientMessages, /sendVerifiedClientMessage\(/);
  assert.match(clientMessages, /completeScoutPrepTaskAfterVoicemail/);
  assert.match(clientMessages, /async function completeClientMessageTaskIfAvailable/);
  assert.match(clientMessages, /completionMessage = await completeClientMessageTaskIfAvailable/);
  assert.match(clientMessages, /No task completed/);
  assert.match(clientMessages, /function ClientMessageSendForm/);
  assert.match(clientMessages, /title="Send Message"/);
  assert.doesNotMatch(clientMessages, /title="Send Follow-Up"[\s\S]*target=\{<ClientMessageSendForm/);
  assert.match(clientMessages, /title=\{`Send Reschedule/);
  assert.match(
    clientMessages,
    /<ActionPanel.Section title="Navigation">[\s\S]*title="Open Thread"[\s\S]*<ActionPanel.Section title="Workflow">[\s\S]*title="Book Cal Follow-Up"/,
  );
  assert.doesNotMatch(clientMessages, /title="Export Inbox"/);
  assert.doesNotMatch(clientMessages, /FollowUpDraftForm/);
  assert.doesNotMatch(clientMessages, /sendClientMessage\(/);
  assert.doesNotMatch(setMeetings, /sendClientMessage\(/);
  assert.match(scoutPrep, /const mode = await openMessagesDraftForRecipients\(recipient\.phones, body\)/);
  assert.match(scoutPrep, /sendClientMessage\(/);
  assert.doesNotMatch(setMeetings, /sendVerifiedClientMessage/);
  assert.match(
    setMeetings,
    /await open\(buildMessagesComposeUrlForRecipients\(cached\.phones, cached\.message\)\)/,
  );
  assert.match(setMeetings, /toast\.message =[\s\S]*'Template copied'[\s\S]*'Draft open'/);
});

test('Scout Prep home keeps the preferred due-today sorted view as the root state', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const commandStart = scoutPrep.indexOf('export default function ScoutPrepCommand');
  const command = scoutPrep.slice(commandStart);

  assert.match(scoutPrep, /const DEFAULT_TASK_LIST_FILTER: TaskListFilter = 'todayPastDue';/);
  assert.match(scoutPrep, /const DEFAULT_TASK_LIST_SORT: TaskListSort = \[/);
  assert.match(
    scoutPrep,
    /\{ key: 'callAttempt', direction: 'asc' \},\s*\{ key: 'gradYear', direction: 'asc' \}/,
  );
  assert.match(command, /useState<TaskListSort>\(DEFAULT_TASK_LIST_SORT\)/);
  assert.match(command, /setTaskListFilter\(DEFAULT_TASK_LIST_FILTER\)/);
  assert.match(command, /setTaskListSort\(DEFAULT_TASK_LIST_SORT\)/);
  assert.match(
    command,
    /function buildBatchSourceTasks\(\): ScoutPortalTask\[\] \{[\s\S]*filter: DEFAULT_TASK_LIST_FILTER,[\s\S]*taskBuckets,[\s\S]*sort: taskListSort,[\s\S]*\}\)\.map\(\(row\) => row\.task\);[\s\S]*\}/,
  );
  assert.doesNotMatch(
    command,
    /function buildBatchSourceTasks\(\): ScoutPortalTask\[\] \{[\s\S]*\.\.\.taskBuckets\.tomorrow[\s\S]*\.\.\.taskBuckets\.future/,
  );
  assert.doesNotMatch(command, /selectedSortLabel/);
});

test('Scout Prep mutations refresh the root list without resetting cancelled navigation', () => {
  const scoutPrep = readRepoFile('src/scout-prep.tsx');
  const detailStart = scoutPrep.indexOf('function ScoutPrepDetail');
  const taskItemStart = scoutPrep.indexOf('function ScoutPrepTaskItem');
  const voicemailStart = scoutPrep.indexOf('function VoicemailFollowUpRecipientForm');
  const prospectItemStart = scoutPrep.indexOf('function ProspectSearchListItem');
  const detail = scoutPrep.slice(detailStart, taskItemStart);
  const taskItem = scoutPrep.slice(taskItemStart, prospectItemStart);
  const voicemail = scoutPrep.slice(voicemailStart, scoutPrep.indexOf('type ViewMode ='));

  assert.match(scoutPrep, /async function returnToRootTaskList\(\)/);
  assert.doesNotMatch(scoutPrep, /popToRoot\(/);
  assert.doesNotMatch(scoutPrep, /name: 'scout-prep'[\s\S]*source: 'mutation-return'/);
  assert.match(
    scoutPrep,
    /const loadTasksRequestIdRef = useRef\(0\);[\s\S]*const loadTasks = async \(options: \{ force\?: boolean \} = \{\}\) => \{[\s\S]*if \(loadTasksPromiseRef\.current && !options\.force\)[\s\S]*const requestId = \+\+loadTasksRequestIdRef\.current;[\s\S]*if \(requestId !== loadTasksRequestIdRef\.current\)/,
  );
  assert.match(
    scoutPrep,
    /async function popViews\(pop: \(\) => void, count: number\)[\s\S]*pop\(\);[\s\S]*setTimeout\(resolve, 0\)[\s\S]*async function popViewsThenRefreshRoot\([\s\S]*await popViews\(pop, count\);[\s\S]*await refreshRoot\?\.\(\);/,
  );
  assert.match(
    detail,
    /async function returnToRootListAndCloseDetail\(\)[\s\S]*await popViewsThenRefreshRoot\(pop, 1, onReturnToRootList\);/,
  );
  assert.match(detail, /<PostCallUpdateForm[\s\S]*onSaved=\{onReturnToRootList\}/);
  assert.match(
    taskItem,
    /async function returnToRootListAndCloseCurrentView\(\)[\s\S]*await popViewsThenRefreshRoot\(pop, 1, onReturnToRootList\);/,
  );
  assert.match(
    taskItem,
    /<PostCallUpdateForm[\s\S]*onSaved=\{returnToRootListAndCloseCurrentView\}/,
  );
  assert.match(taskItem, /<VoicemailFollowUpRecipientForm[\s\S]*onComplete=\{onReturnToRootList\}/);
  assert.match(voicemail, /finishFollowUpFlow\([\s\S]*completeScoutPrepMutationSuccess/);
  assert.match(
    voicemail,
    /finishFollowUpFlow\([\s\S]*await popViewsThenRefreshRoot\(pop, closeAfterCompleteViews \+ extraChildViews, onComplete\);/,
  );
  assert.match(
    voicemail,
    /selectedVariant === 'parent_contact_intro'[\s\S]*onMessageSentComplete=\{async \(\) => \{[\s\S]*finishFollowUpFlow\('Sent', 'No Laravel update', 1\)/,
  );
  assert.doesNotMatch(voicemail, /onReturnToRootList: onComplete/);

  assert.match(voicemail, /push\([\s\S]*<RescheduleSlotSelectionList[\s\S]*\n\s*\);\n\s*return;/);
  assert.match(voicemail, /const mode = await openMessagesDraftForRecipients\(recipient\.phones, body\)/);
  assert.doesNotMatch(voicemail, /mode: 'raycast-ui'/);
  assert.doesNotMatch(voicemail, /resetFollowUpFlowOnPop/);
  assert.match(
    taskItem,
    /<Action\.Push[\s\S]*title="Build Scout Prep"[\s\S]*target=\{<ScoutPrepDetail[\s\S]*\/>\}\s*\/>/,
  );
  assert.doesNotMatch(taskItem, /title="Build Scout Prep"[\s\S]*onPop=\{resetRootListOnPop\}/);
  assert.doesNotMatch(taskItem, /title="Contact Info"[\s\S]*onPop=\{resetRootListOnPop\}/);
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
    'There is no normal current-sales-stage reconciler writer.',
    'tied to source-owned stage evidence instead of a background reconciler guess',
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
    'docs/architecture/scout-prep-supabase-source-of-truth.md',
    'docs/architecture/supabase-clean-house-truth-map.md',
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
