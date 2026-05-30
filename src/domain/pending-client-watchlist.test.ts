import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildPendingClientOwnerSnapshot,
  buildPendingClientResolvedPatch,
  buildPendingClientScanWindow,
  cleanPendingClientAthleteName,
  classifyPendingClientLifecycle,
  filterReadySetMeetingConfirmationGroups,
  filterPendingClientCandidateEvents,
  findPendingClientSignals,
  hasStrictNoShowEvidence,
  hasPendingClientWatchNote,
  isPendingClientReviewEventTitle,
  normalizePendingClientAIVerdict,
  pendingClientExpiresAt,
  selectLatestPendingClientReviewEvent,
} from './pending-client-watchlist';

test('pending client event filter keeps recent follow-up rows across all scouts', () => {
  const now = new Date('2026-05-06T16:00:00-04:00');
  const events = [
    {
      event_id: '1',
      title: 'Follow Up - Arthur Uribe Football 2029 CA',
      assigned_owner: 'Ryan Lietz',
      start: '2026-05-02T08:30',
      end: '2026-05-02T09:00',
      date_time_label: 'Sat 05/02/26 8:30 AM',
    },
    {
      event_id: '2',
      title: '(FU) Poppy Kingan Women’s Soccer 2028',
      assigned_owner: 'Jeffrey Stein',
      start: '2026-04-24T08:30',
      end: '2026-04-24T09:00',
      date_time_label: 'Fri 04/24/26 8:30 AM',
    },
    {
      event_id: '3',
      title: '(ENR $99) Already Won Football 2028 TX',
      assigned_owner: 'Ryan Lietz',
      start: '2026-05-02T08:30',
      end: '2026-05-02T09:00',
      date_time_label: 'Sat 05/02/26 8:30 AM',
    },
    {
      event_id: '4',
      title: 'Follow Up - Too Old Football 2028 TX',
      assigned_owner: 'Luther Winfield',
      start: '2026-04-20T08:30',
      end: '2026-04-20T09:00',
      date_time_label: 'Mon 04/20/26 8:30 AM',
    },
    {
      event_id: '5',
      title: 'Follow Up - Future Football 2028 TX',
      assigned_owner: 'James Holcomb',
      start: '2026-05-07T08:30',
      end: '2026-05-07T09:00',
      date_time_label: 'Thu 05/07/26 8:30 AM',
    },
  ];

  assert.deepEqual(
    filterPendingClientCandidateEvents(events, now).map((event) => event.event_id),
    ['1', '2'],
  );
});

test('pending client signal matcher is broad but excludes generic interest notes', () => {
  assert.deepEqual(
    findPendingClientSignals(
      'Keep in contact. They are coming aboard in full payment without discount on ICON.',
    ),
    ['coming aboard', 'full payment', 'discount', 'payment', 'icon'],
  );
  assert.deepEqual(findPendingClientSignals('Need a few days on Elite or Legend.'), [
    'elite',
    'legend',
  ]);
  assert.deepEqual(findPendingClientSignals('Come aboard with $179 12 month upgrade.'), [
    'upgrade',
    '$',
  ]);
  assert.deepEqual(findPendingClientSignals('Follow up on interest.'), []);
  assert.deepEqual(findPendingClientSignals('Follow up with the dad.'), []);
});

test('pending client watch note keeps real follow-up descriptions without payment signals', () => {
  const description = [
    'Main Number: (862) 832-1192',
    'Spoke To: Wallache (Dad)',
    'About The Athlete:',
    'DE | ILB',
    'Deficit: sq1, exposure',
  ].join('\n');

  assert.equal(hasPendingClientWatchNote(description), true);
  assert.equal(hasPendingClientWatchNote(''), false);
  assert.equal(hasPendingClientWatchNote('   \n  '), false);
});

test('pending client review note chooses latest follow-up event after the meeting', () => {
  const meeting = {
    event_id: '612634',
    title: '(FU) Javiion Knight Football 2027 NJ',
    assigned_owner: 'Luther Winfield',
    start: '2026-05-12T20:00',
    end: '2026-05-12T21:00',
    date_time_label: 'Tue 05/12/26 8:00 PM',
    description: 'Original prep notes',
  };
  const review = selectLatestPendingClientReviewEvent(meeting, [
    meeting,
    {
      event_id: '628744',
      title: '(FU) Javiion Knight Football 2027 NJ',
      assigned_owner: 'Luther Winfield',
      start: '2026-05-16T19:00',
      end: '2026-05-16T19:30',
      date_time_label: 'Sat 05/16/26 7:00 PM',
      description: 'Family wanted a few days (Elite)',
    },
    {
      event_id: '628111',
      title: '(FU)*2 Javiion Knight Football 2027 NJ',
      assigned_owner: 'Luther Winfield',
      start: '2026-05-14T19:00',
      end: '2026-05-14T19:30',
      date_time_label: 'Thu 05/14/26 7:00 PM',
      description: 'Older review note (Icon)',
    },
    {
      event_id: '628745',
      title: '(FU) Blank Note Football 2027 NJ',
      assigned_owner: 'Luther Winfield',
      start: '2026-05-17T19:00',
      end: '2026-05-17T19:30',
      date_time_label: 'Sun 05/17/26 7:00 PM',
      description: '   ',
    },
  ]);

  assert.equal(review?.event_id, '628744');
  assert.equal(review?.description, 'Family wanted a few days (Elite)');
});

test('pending client source keeps only ready Jerami-owned set meeting cache groups', () => {
  const now = new Date('2026-05-15T21:05:00.000Z');
  const rows = [
    {
      appointment_id: 'past-jerami',
      athlete_id: '1489000',
      athlete_main_id: '951000',
      athlete_name: 'Avery Jones',
      head_scout_name: 'Ryan Lietz',
      meeting_starts_at: '2026-05-15T19:00:00.000Z',
      meeting_ends_at: '2026-05-15T20:00:00.000Z',
      source: 'set_meetings_confirmation',
      kind: 'confirmation_1',
      status: 'cached',
      message_body: 'one',
      payload_json: { active_operator_key: 'jerami_singleton' },
    },
    {
      appointment_id: 'future-jerami',
      athlete_id: '1489001',
      athlete_main_id: '951001',
      athlete_name: 'Future Jones',
      head_scout_name: 'Ryan Lietz',
      meeting_starts_at: '2026-05-15T21:00:00.000Z',
      meeting_ends_at: '2026-05-15T22:00:00.000Z',
      source: 'set_meetings_confirmation',
      kind: 'confirmation_1',
      status: 'cached',
      message_body: 'one',
      payload_json: { active_operator_key: 'jerami_singleton' },
    },
    {
      appointment_id: 'past-other',
      athlete_id: '1489002',
      athlete_main_id: '951002',
      athlete_name: 'Other Jones',
      head_scout_name: 'Ryan Lietz',
      meeting_starts_at: '2026-05-15T19:00:00.000Z',
      meeting_ends_at: '2026-05-15T20:00:00.000Z',
      source: 'set_meetings_confirmation',
      kind: 'confirmation_1',
      status: 'cached',
      message_body: 'one',
      payload_json: { active_operator_key: 'not_jerami' },
    },
    {
      appointment_id: 'past-missing-operator',
      athlete_id: '1489003',
      athlete_main_id: '951003',
      athlete_name: 'Missing Operator',
      head_scout_name: 'Ryan Lietz',
      meeting_starts_at: '2026-05-15T19:00:00.000Z',
      meeting_ends_at: '2026-05-15T20:00:00.000Z',
      source: 'set_meetings_confirmation',
      kind: 'confirmation_1',
      status: 'cached',
      message_body: 'one',
      payload_json: {},
    },
  ];

  assert.deepEqual(
    filterReadySetMeetingConfirmationGroups(rows, {
      now,
      activeOperatorKey: 'jerami_singleton',
    }).map((row) => row.appointmentId),
    ['past-jerami'],
  );
});

test('pending client loader uses lifecycle current appointment pointers before pipeline fallback', () => {
  const source = fs.readFileSync('src/lib/pending-client-watchlist.ts', 'utf8');
  assert.match(source, /athlete_lifecycle_current/);
  assert.match(source, /current_resolved_appointment_id/);
  assert.match(source, /mergeLifecycleAndPipelineRows/);
  assert.match(source, /readCurrentPipelineRows/);
});

test('pending client review title accepts only FU prefixes', () => {
  assert.equal(isPendingClientReviewEventTitle('(FU) Avery Jones Football 2027 TN'), true);
  assert.equal(isPendingClientReviewEventTitle('(FU)*2 Avery Jones Football 2027 TN'), true);
  assert.equal(isPendingClientReviewEventTitle('Follow Up - Avery Jones Football 2027 TN'), false);
  assert.equal(isPendingClientReviewEventTitle('Booked Meeting Avery Jones'), false);
});

test('pending client lifecycle starts from CRM stage and uses event notes as reason evidence', () => {
  assert.equal(
    classifyPendingClientLifecycle({
      crmStage: 'Actual Meeting - Follow Up',
      reviewEventTitle: 'Follow Up - Raul Agramonte Football 2027 FL',
      reviewDescription: 'Follow up with the father on coming aboard.',
    }).eligible,
    true,
  );
  assert.equal(
    classifyPendingClientLifecycle({
      crmStage: 'Meeting Set',
      reviewEventTitle: 'Follow Up - Raul Agramonte Football 2027 FL',
      reviewDescription: 'Follow up with the father on coming aboard.',
    }).eligible,
    false,
  );
  assert.equal(
    classifyPendingClientLifecycle({
      crmStage: 'Meeting Result - Res. Pending',
      reviewEventTitle: 'Booked Meeting - Raul Agramonte Football 2027 FL',
      reviewDescription: '',
    }).eligible,
    true,
  );
});

test('no-show evidence accepts legacy title prefixes and CRM no-show stages', () => {
  assert.equal(hasStrictNoShowEvidence({ crmStage: 'Meeting Result - No Show' }), true);
  assert.equal(hasStrictNoShowEvidence({ bookedEventTitle: '(NS)*2 Raul Agramonte Football 2027 FL' }), true);
  assert.equal(
    hasStrictNoShowEvidence({
      crmStage: 'Actual Meeting - Follow Up',
      bookedEventTitle: '(NS)*2 Raul Agramonte Football 2027 FL',
    }),
    true,
  );
  assert.equal(hasStrictNoShowEvidence({ crmStage: 'Actual Meeting - Follow Up' }), false);
});

test('pending client loader does not read the confirmation cache table', () => {
  const source = fs.readFileSync('src/lib/pending-client-watchlist.ts', 'utf8');
  assert.doesNotMatch(source, /set_meeting_confirmation_cache/);
  assert.doesNotMatch(source, /readSetMeetingConfirmationCacheRows/);
  assert.match(source, /fetchAthleteBookedMeetings/);
  assert.match(source, /athlete_pipeline_state/);
});

test('pending client AI verdict accepts exactly pending_client', () => {
  assert.equal(normalizePendingClientAIVerdict('pending_client'), 'pending_client');
  assert.equal(normalizePendingClientAIVerdict(' PENDING_CLIENT '), 'pending_client');
  assert.equal(normalizePendingClientAIVerdict('watch'), null);
  assert.equal(normalizePendingClientAIVerdict('pending_client because they may pay'), null);
});

test('pending client owner snapshot separates head scout and operator fields', () => {
  const snapshot = buildPendingClientOwnerSnapshot({
    assignedOwner: 'Ryan Lietz',
    activeOperator: {
      operatorKey: 'jerami_singleton',
      personName: 'Jerami Singleton',
      legacyUserId: '1408164',
      taskAssignedOwnerName: 'Jerami Singleton',
      dashboardTrackingEnabled: true,
      senderName: 'Jerami Singleton',
    },
  });

  assert.equal(snapshot.head_scout, 'Ryan Lietz');
  assert.equal(snapshot.head_scout_key, 'ryan_lietz');
  assert.equal(snapshot.calendar_owner_id, 'nhVvYOz8bAaL57c');
  assert.equal(snapshot.detected_by_operator, 'Jerami Singleton');
  assert.equal(snapshot.detected_by_operator_key, 'jerami_singleton');
  assert.equal(snapshot.owner_context.active_operator_name, 'Jerami Singleton');
  assert.equal(snapshot.owner_context.head_scout_name, 'Ryan Lietz');
});

test('resolved patch stamps the current active operator without call tracker proof fields', () => {
  const patch = buildPendingClientResolvedPatch(
    {
      operatorKey: 'jerami_singleton',
      personName: 'Jerami Singleton',
      legacyUserId: '1408164',
      taskAssignedOwnerName: 'Jerami Singleton',
      dashboardTrackingEnabled: true,
      senderName: 'Jerami Singleton',
    },
    new Date('2026-05-06T18:00:00Z'),
  );

  assert.equal(patch.status, 'resolved');
  assert.equal(patch.resolved_by_operator, 'Jerami Singleton');
  assert.equal(patch.resolved_by_operator_key, 'jerami_singleton');
  assert.equal(patch.resolved_at, '2026-05-06T18:00:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'owner_proof'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'materialization_status'), false);
});

test('pending client helpers derive clean athlete names and 14 day expiration', () => {
  assert.equal(
    cleanPendingClientAthleteName('Follow Up - Arthur Uribe Football 2029 CA'),
    'Arthur Uribe',
  );
  assert.equal(cleanPendingClientAthleteName('(FU) Deioan Means Football 2027 FL'), 'Deioan Means');
  assert.equal(pendingClientExpiresAt('2026-05-02T08:30'), '2026-05-16T08:30:00.000Z');
  assert.deepEqual(buildPendingClientScanWindow(new Date('2026-05-06T16:00:00-04:00')), {
    start: '2026-04-22',
    end: '2026-05-07',
  });
});
