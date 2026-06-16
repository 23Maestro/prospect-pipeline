import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildPendingClientOwnerSnapshot,
  buildPendingClientEvidenceDescription,
  buildPendingClientResolvedPatch,
  buildPendingClientWatchlistRow,
  buildPendingClientScanWindow,
  cleanPendingClientAthleteName,
  classifyPendingClientActionTag,
  classifyPendingClientCentralQueue,
  classifyPendingClientLifecycle,
  classifyPendingClientOperatorQueue,
  filterReadySetMeetingConfirmationGroups,
  filterPendingClientCandidateEvents,
  findPendingClientSignals,
  hasStrictNoShowEvidence,
  hasPendingClientWatchNote,
  isPendingClientResolvedByFutureConfirmation,
  isPendingClientReviewEventTitle,
  normalizePendingClientAIVerdict,
  pendingClientExpiresAt,
  selectLatestPendingClientReviewEvent,
  selectLatestPendingClientNote,
  type PendingClientCentralQueueClassification,
  type PendingClientOperatorQueueReplyEvidence,
  type PendingClientWatchlistRow,
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
  assert.deepEqual(findPendingClientSignals('Premium with a post date.'), ['post date', 'premium']);
  assert.deepEqual(findPendingClientSignals('Icon subscription.'), ['icon']);
  assert.deepEqual(findPendingClientSignals('Come aboard with $179 12 month upgrade.'), [
    'upgrade',
    '$',
  ]);
  assert.deepEqual(findPendingClientSignals('Follow up on interest.'), []);
  assert.deepEqual(findPendingClientSignals('Follow up with the dad.'), []);
});

test('pending client watch note rejects meeting descriptions and keeps real follow-up notes', () => {
  const meetingDescription = [
    'Main Number: (862) 832-1192',
    'Spoke To: Wallache (Dad)',
    'About The Athlete:',
    'DE | ILB',
    'Deficit: sq1, exposure',
  ].join('\n');

  assert.equal(hasPendingClientWatchNote(meetingDescription), false);
  assert.equal(hasPendingClientWatchNote('Follow up with the father on coming aboard.'), true);
  assert.equal(hasPendingClientWatchNote(''), false);
  assert.equal(hasPendingClientWatchNote('   \n  '), false);
  assert.equal(hasPendingClientWatchNote('Date\nCreated By\nTitle\nDescription'), false);
  assert.equal(hasPendingClientWatchNote('Date Created By Title Description'), false);
});

test('pending client rows reject athlete-key text as display name', () => {
  const row = buildPendingClientWatchlistRow({
    event: {
      event_id: 'appointment:630246',
      title: '(RSP) Daylen Johnson Football 2029 CA',
      assigned_owner: 'Kenton Manis',
      start: '2026-06-14T20:00:00.000Z',
      end: '2026-06-14T21:00:00.000Z',
    },
    athleteId: '1499520',
    athleteMainId: '954251',
    athleteName: '1499520:954251',
    description: 'Pending client review from appointment outcome: reschedule_pending.',
    matchedSignals: ['reschedule_pending'],
    actionTag: 'Operator Input',
    aiVerdict: 'pending_client',
    now: new Date('2026-06-16T18:00:00.000Z'),
  });

  assert.equal(row.athlete_name, 'Daylen Johnson');
  assert.equal(cleanPendingClientAthleteName('(CAN) Christan Hirniak Football 2027 IL'), 'Christan Hirniak');
  assert.equal(cleanPendingClientAthleteName('1499520:954251'), '');
});

test('pending client notes source chooses the latest real notes-tab entry', () => {
  const note = selectLatestPendingClientNote([
    {
      title: 'Notes',
      description: 'Date\nCreated By\nTitle\nDescription',
      metadata: null,
    },
    {
      title: '05/28/26 09:03 PM',
      description: 'Family will reach back out. Give them a few weeks.',
      metadata: 'Luther Winfield | Meeting Rescheduled Pending',
    },
    {
      title: '05/29/26 09:03 PM',
      description: 'Need a few days on Elite package.',
      metadata: 'Luther Winfield | Follow Up',
    },
  ]);

  assert.equal(note?.description, 'Need a few days on Elite package.');
  assert.equal(note?.metadata, 'Luther Winfield | Follow Up');
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

test('pending client evidence uses post-meeting event list and notes tab, not meeting description', () => {
  const description = buildPendingClientEvidenceDescription({
    reviewEvent: {
      title: '(FU) Ryan Leeds Football 2027 TX',
      description: 'Follow up with his family in two months. They want Legend.',
    },
    notesTabEntry: {
      title: '05/30/26 10:00 AM',
      description: 'Family asked for the Elite package payment options.',
    },
  });

  assert.match(description, /Event List: Follow up with his family in two months/);
  assert.match(description, /Notes Tab: Family asked for the Elite package payment options/);
  assert.doesNotMatch(description, /Original prep notes/);
});

test('pending client action tags stay to four visible helper states', () => {
  assert.equal(
    classifyPendingClientActionTag({
      normalizedStage: 'meeting_follow_up',
      description: 'Family wants Legend and asked about payment timing.',
      matchedSignals: ['legend', 'payment'],
    }),
    'Payment Watch',
  );
  assert.equal(
    classifyPendingClientActionTag({
      normalizedStage: 'meeting_follow_up',
      description: 'Follow up with the family in two months.',
      matchedSignals: [],
    }),
    'Scout Update',
  );
  assert.equal(
    classifyPendingClientActionTag({
      normalizedStage: 'reschedule_pending',
      description: 'Dad said the family needs to reschedule.',
      matchedSignals: [],
    }),
    'Operator Input',
  );
  assert.equal(
    classifyPendingClientActionTag({
      normalizedStage: 'canceled',
      description: 'Client canceled and needs operator recovery.',
      matchedSignals: [],
    }),
    'Operator Input',
  );
  assert.equal(
    classifyPendingClientActionTag({
      normalizedStage: 'canceled',
      description: 'Client canceled after asking about enrollment and payment.',
      matchedSignals: ['enroll', 'payment'],
    }),
    'Operator Input',
  );
  assert.equal(
    classifyPendingClientActionTag({
      normalizedStage: 'reschedule_pending',
      description: 'Family needs a new time and asked about payment.',
      matchedSignals: ['payment'],
    }),
    'Operator Input',
  );
  assert.equal(
    classifyPendingClientActionTag({
      normalizedStage: 'meeting_follow_up',
      description: 'Date\nCreated By\nTitle\nDescription',
      matchedSignals: [],
      hasEvidence: false,
    }),
    'Missing Notes',
  );
});

test('pending client watchlist row persists the helper action tag', () => {
  const row = buildPendingClientWatchlistRow({
    event: {
      event_id: 'pending-client:1',
      title: '(FU) Ryan Leeds Football 2027 TX',
      assigned_owner: 'Ryan Lietz',
      start: '2026-05-30T10:00',
      end: '2026-05-30T10:30',
    },
    description: 'Family wants Legend and asked about payment timing.',
    matchedSignals: ['legend', 'payment'],
    actionTag: 'Payment Watch',
    aiVerdict: 'pending_client',
    activeOperator: {
      operatorKey: 'jerami_singleton',
      personName: 'Jerami Singleton',
      legacyUserId: '1408164',
      taskAssignedOwnerName: 'Jerami Singleton',
      dashboardTrackingEnabled: true,
      senderName: 'Jerami Singleton',
    },
  });

  assert.equal(row.action_tag, 'Payment Watch');
});

function pendingClientRow(overrides = {}) {
  return buildPendingClientWatchlistRow({
    event: {
      event_id: 'pending-client:queue',
      title: '(RSP) Avery Jones Football 2027 TN',
      assigned_owner: 'Ryan Lietz',
      start: '2026-06-13T10:00',
      end: '2026-06-13T11:00',
    },
    description: 'Lifecycle: reschedule_pending',
    matchedSignals: [],
    actionTag: 'Operator Input',
    aiVerdict: 'pending_client',
    athleteId: '123',
    athleteMainId: '456',
    athleteName: 'Avery Jones',
    now: new Date('2026-06-13T15:00:00.000Z'),
    ...overrides,
  });
}

test('pending client operator queue labels reply evidence before generic action tags', () => {
  assert.equal(
    classifyPendingClientOperatorQueue({
      row: pendingClientRow(),
      replyEvidence: {
        themeBucket: 'RSP',
        lastMeaningfulInbound: { body: '1' },
        operatorReplyProposedTimes: false,
      },
    }).label,
    'Needs Times',
  );
  assert.equal(
    classifyPendingClientOperatorQueue({
      row: pendingClientRow(),
      replyEvidence: {
        themeBucket: 'RSP',
        lastMeaningfulInbound: { body: '1' },
        operatorReplyProposedTimes: true,
      },
    }).label,
    'Awaiting RSP',
  );
  assert.equal(
    classifyPendingClientOperatorQueue({
      row: pendingClientRow(),
      replyEvidence: {
        themeBucket: 'RSP',
        lastMeaningfulInbound: { body: 'Friday works' },
        operatorReplyProposedTimes: true,
        clientRepliedAfterOperatorTimes: true,
      },
    }).label,
    'Review Reply',
  );
  assert.equal(
    classifyPendingClientOperatorQueue({
      row: pendingClientRow({ event: { title: '(NS) Avery Jones', start: '2026-06-13T10:00' } }),
      replyEvidence: {
        themeBucket: 'No Show',
        lastMeaningfulInbound: { body: '1' },
        operatorReplyProposedTimes: false,
      },
    }).label,
    'Needs Times',
  );
  assert.equal(
    classifyPendingClientOperatorQueue({
      row: pendingClientRow({ event: { title: '(NS) Avery Jones', start: '2026-06-13T10:00' } }),
      replyEvidence: {
        themeBucket: 'No Show',
        lastMeaningfulInbound: { body: '2' },
        operatorReplyProposedTimes: false,
      },
    }).label,
    'Timing Bad',
  );
  assert.equal(
    classifyPendingClientOperatorQueue({
      row: pendingClientRow({ event: { title: '(NS) Avery Jones', start: '2026-06-13T10:00' } }),
      replyEvidence: {
        themeBucket: 'No Show',
        lastMeaningfulInbound: { body: '3' },
        operatorReplyProposedTimes: false,
      },
    }).label,
    'No Interest',
  );
  assert.equal(
    classifyPendingClientOperatorQueue({
      row: pendingClientRow({ event: { title: '(CAN) Avery Jones', start: '2026-06-13T10:00' } }),
      replyEvidence: {
        themeBucket: 'Cancel',
        lastMeaningfulInbound: { body: 'Timing is bad right now' },
        operatorReplyProposedTimes: false,
      },
    }).label,
    'Timing Issue',
  );
  assert.equal(
    classifyPendingClientOperatorQueue({
      row: pendingClientRow({ event: { title: '(CAN) Avery Jones', start: '2026-06-13T10:00' } }),
      replyEvidence: {
        themeBucket: 'Cancel',
        lastMeaningfulInbound: { body: 'Not interested anymore' },
        operatorReplyProposedTimes: false,
        clientOptedOut: true,
      },
    }).label,
    'No Interest',
  );
  assert.equal(
    classifyPendingClientOperatorQueue({
      row: pendingClientRow({ actionTag: 'Scout Update' }),
      replyEvidence: {
        themeBucket: 'Call Attempt',
        lastMeaningfulInbound: { body: 'Call me after work' },
        operatorReplyProposedTimes: false,
      },
    }).label,
    'Call Back',
  );
});

test('pending client central queue collapses review work to four router lanes', () => {
  const baseRow = buildPendingClientWatchlistRow({
    event: {
      event_id: 'appointment:630246',
      title: '(RSP) Daylen Johnson Football 2029 CA',
      assigned_owner: 'Kenton Manis',
      start: '2026-06-14T20:00:00.000Z',
      end: '2026-06-14T21:00:00.000Z',
    },
    athleteId: '1499520',
    athleteMainId: '954251',
    athleteName: 'Daylen Johnson',
    description: 'Pending client review from appointment outcome: reschedule_pending.',
    matchedSignals: ['reschedule_pending'],
    actionTag: 'Operator Input',
    aiVerdict: 'pending_client',
    now: new Date('2026-06-16T18:00:00.000Z'),
  });

  const cases: {
    name: string;
    row: PendingClientWatchlistRow;
    replyEvidence: PendingClientOperatorQueueReplyEvidence | null;
    expected: PendingClientCentralQueueClassification;
  }[] = [
    {
      name: 'RSP · Offer Slots',
      row: baseRow,
      replyEvidence: { themeBucket: 'RSP', operatorReplyProposedTimes: false },
      expected: { filter: 'reschedule', label: 'RSP', actionLabel: 'Offer Slots', priority: 10 },
    },
    {
      name: 'RSP · Awaiting Client',
      row: baseRow,
      replyEvidence: { themeBucket: 'RSP', operatorReplyProposedTimes: true },
      expected: { filter: 'reschedule', label: 'RSP', actionLabel: 'Awaiting Client', priority: 20 },
    },
    {
      name: 'RSP · Review Reply',
      row: baseRow,
      replyEvidence: { themeBucket: 'RSP', operatorReplyProposedTimes: true, clientRepliedAfterOperatorTimes: true },
      expected: { filter: 'reschedule', label: 'RSP', actionLabel: 'Review Reply', priority: 20 },
    },
    {
      name: 'No Show · Offer Slots',
      row: { ...baseRow, event_title: 'No Show' },
      replyEvidence: { themeBucket: 'No Show', operatorReplyProposedTimes: false },
      expected: { filter: 'no_show', label: 'No Show', actionLabel: 'Offer Slots', priority: 10 },
    },
    {
      name: 'No Show · Awaiting Client',
      row: { ...baseRow, event_title: 'No Show' },
      replyEvidence: { themeBucket: 'No Show', operatorReplyProposedTimes: true },
      expected: { filter: 'no_show', label: 'No Show', actionLabel: 'Awaiting Client', priority: 20 },
    },
    {
      name: 'No Show · Bad Timing',
      row: { ...baseRow, event_title: 'No Show' },
      replyEvidence: {
        themeBucket: 'No Show',
        lastMeaningfulInbound: { body: 'Bad timing right now' },
        operatorReplyProposedTimes: false,
      },
      expected: { filter: 'no_show', label: 'No Show', actionLabel: 'Bad Timing', priority: 15 },
    },
    {
      name: 'Review Follow Ups · Needs Reply',
      row: { ...baseRow, description: 'Call attempt 2. Parent said tomorrow works.' },
      replyEvidence: { themeBucket: 'Call Attempt', operatorRepliedAfterInbound: false },
      expected: { filter: 'review_follow_ups', label: 'Review Follow Ups', actionLabel: 'Needs Reply', priority: 30 },
    },
    {
      name: 'Review Follow Ups · Review',
      row: { ...baseRow, description: 'Call attempt 2. Operator already responded.' },
      replyEvidence: { themeBucket: 'Call Attempt', operatorRepliedAfterInbound: true },
      expected: { filter: 'review_follow_ups', label: 'Review Follow Ups', actionLabel: 'Review', priority: 30 },
    },
    {
      name: 'Payments',
      row: { ...baseRow, action_tag: 'Payment Watch', matched_signals: ['payment'] },
      replyEvidence: null,
      expected: { filter: 'payments', label: 'Payments', actionLabel: 'Payments', priority: 40 },
    },
  ];

  const allowedRowTags = new Set([
    'RSP · Offer Slots',
    'RSP · Awaiting Client',
    'RSP · Review Reply',
    'No Show · Offer Slots',
    'No Show · Awaiting Client',
    'No Show · Bad Timing',
    'Review Follow Ups · Needs Reply',
    'Review Follow Ups · Review',
    'Payments',
  ]);

  for (const testCase of cases) {
    const actual = classifyPendingClientCentralQueue({
      row: testCase.row,
      replyEvidence: testCase.replyEvidence,
    });
    const rowTag = actual.filter === 'payments' ? actual.label : `${actual.label} · ${actual.actionLabel}`;

    assert.deepEqual(actual, testCase.expected, testCase.name);
    assert.ok(allowedRowTags.has(rowTag), testCase.name);
  }
});

test('pending client payment watch does not require appointment truth backing', () => {
  const row = buildPendingClientWatchlistRow({
    event: {
      event_id: 'pending-client:arthur-payment-watch',
      title: 'Follow Up - Arthur Uribe Football 2029 CA',
      assigned_owner: 'Ryan Lietz',
      start: '2026-07-06T08:30',
      end: '2026-07-06T09:00',
    },
    description: 'Family discussed coming aboard, full payment, discount, and Icon.',
    matchedSignals: ['coming aboard', 'full payment', 'discount', 'payment', 'icon'],
    actionTag: 'Payment Watch',
    aiVerdict: 'pending_client',
    athleteId: '1489688',
    athleteMainId: '951523',
    athleteName: 'Arthur Uribe',
  });

  assert.equal(row.status, 'watching');
  assert.equal(row.action_tag, 'Payment Watch');
  assert.equal(row.athlete_name, 'Arthur Uribe');
  assert.equal(row.event_start, '2026-07-06T12:30:00.000Z');
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

test('pending client Raycast loader reads appointment outcomes plus support tombstones for meeting display', () => {
  const source = fs.readFileSync('src/lib/pending-client-watchlist.ts', 'utf8');
  assert.match(source, /'appointments'/);
  assert.match(source, /post_meeting_result\.in\./);
  assert.match(source, /status\.in\./);
  assert.match(source, /reschedule_pending/);
  assert.match(source, /no_show/);
  assert.match(source, /pending_client_watchlist/);
  assert.match(source, /status=in\.\("resolved","expired"\)/);
  assert.match(source, /resolveBookedMeetingDetailsForForm/);
  assert.match(source, /meeting_timezone/);
  assert.doesNotMatch(source, /status=eq\.watching/);
  assert.doesNotMatch(source, /expires_at=gte/);
  assert.doesNotMatch(source, /active_athlete_meeting_truth/);
  assert.doesNotMatch(source, /readCurrentPipelineRows/);
  assert.doesNotMatch(source, /fetchAthleteBookedMeetings/);
  assert.doesNotMatch(source, /fetchAthleteNotes/);
  assert.doesNotMatch(source, /confirmPendingClientWithRayAI/);
  assert.doesNotMatch(source, /currentMeeting\\.description/);
});

test('pending client Raycast loader suppresses stale RSP after newer active replacement appointment', () => {
  const source = fs.readFileSync('src/lib/pending-client-watchlist.ts', 'utf8');
  assert.match(source, /function hasNewerActiveReplacementAppointment/);
  assert.match(source, /ACTIVE_REPLACEMENT_APPOINTMENT_STATUSES/);
  assert.match(
    source,
    /ACTIVE_REPLACEMENT_POST_MEETING_RESULTS = new Set\(\['', 'rescheduled'\]\)/,
  );
  assert.match(source, /status=in\.\(\$\{ACTIVE_REPLACEMENT_APPOINTMENT_STATUS_QUERY\}\)/);
  assert.match(source, /groupActiveReplacementAppointmentsByAthleteKey/);
  assert.match(source, /const actionableAppointmentRows = appointmentRows\.filter/);
  assert.match(
    source,
    /!hasNewerActiveReplacementAppointment\(row, activeReplacementsByAthleteKey\)/,
  );
  assert.match(source, /buildPendingClientRowsFromAppointments\(\s*actionableAppointmentRows,/);
});

test('pending client Raycast loader collapses duplicate active rows per athlete', () => {
  const source = fs.readFileSync('src/lib/pending-client-watchlist.ts', 'utf8');
  assert.match(source, /function dedupePendingClientRows/);
  assert.match(source, /athleteDedupeKey/);
  assert.match(source, /dedupePendingClientRows\(/);
});

test('pending client review title accepts FU and follow-up event-list titles', () => {
  assert.equal(isPendingClientReviewEventTitle('(FU) Avery Jones Football 2027 TN'), true);
  assert.equal(isPendingClientReviewEventTitle('(FU)*2 Avery Jones Football 2027 TN'), true);
  assert.equal(isPendingClientReviewEventTitle('Follow Up - Avery Jones Football 2027 TN'), true);
  assert.equal(isPendingClientReviewEventTitle('Follow up with the family in August'), true);
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
  assert.equal(
    classifyPendingClientLifecycle({
      crmStage: 'Meeting Result - Canceled',
      reviewEventTitle: '(CAN) Raul Agramonte Football 2027 FL',
      reviewDescription: '',
    }).eligible,
    true,
  );
});

test('pending client recovery row is suppressed by a newer confirmed meeting cache group', () => {
  const pendingRow = buildPendingClientWatchlistRow({
    event: {
      event_id: 'pending-client:1498941:953710:628043',
      title: '(RSP) Diego Crespo Franco Baseball 2026 GA',
      assigned_owner: 'James Holcomb',
      start: '2026-05-31T20:00:00.000Z',
      end: '2026-05-31T21:00:00.000Z',
    },
    athleteId: '1498941',
    athleteMainId: '953710',
    athleteName: 'Diego Crespo Franco',
    description: [
      'Sales Stage: Meeting Result - Res. Pending',
      '',
      'Lifecycle: reschedule_pending',
    ].join('\n'),
    actionTag: 'Operator Input',
    matchedSignals: [],
    aiVerdict: 'pending_client',
    now: new Date('2026-06-05T18:30:00.000Z'),
  });

  assert.equal(
    isPendingClientResolvedByFutureConfirmation(
      pendingRow,
      [
        {
          appointment_id: '628045',
          athlete_id: '1498941',
          athlete_main_id: '953710',
          athlete_name: 'Diego Crespo Franco',
          source: 'set_meetings_confirmation',
          kind: 'confirmation_1',
          status: 'cached',
          meeting_starts_at: '2026-06-07T20:00:00.000Z',
          meeting_ends_at: '2026-06-07T21:00:00.000Z',
        },
        {
          appointment_id: '628045',
          athlete_id: '1498941',
          athlete_main_id: '953710',
          athlete_name: 'Diego Crespo Franco',
          source: 'set_meetings_confirmation',
          kind: 'confirmation_2',
          status: 'cached',
          meeting_starts_at: '2026-06-07T20:00:00.000Z',
          meeting_ends_at: '2026-06-07T21:00:00.000Z',
        },
      ],
      new Date('2026-06-05T18:30:00.000Z'),
    ),
    true,
  );
});

test('pending client confirmation suppression does not hide payment follow-up rows', () => {
  const pendingRow = buildPendingClientWatchlistRow({
    event: {
      event_id: 'pending-client:payment-watch',
      title: '(FU) Diego Crespo Franco Baseball 2026 GA',
      assigned_owner: 'James Holcomb',
      start: '2026-05-31T20:00:00.000Z',
      end: '2026-05-31T21:00:00.000Z',
    },
    athleteId: '1498941',
    athleteMainId: '953710',
    athleteName: 'Diego Crespo Franco',
    description: 'Lifecycle: meeting_follow_up\n\nNotes Tab: Family asked about payment.',
    actionTag: 'Payment Watch',
    matchedSignals: ['payment'],
    aiVerdict: 'pending_client',
    now: new Date('2026-06-05T18:30:00.000Z'),
  });

  assert.equal(
    isPendingClientResolvedByFutureConfirmation(
      pendingRow,
      [
        {
          appointment_id: '628045',
          athlete_id: '1498941',
          athlete_main_id: '953710',
          athlete_name: 'Diego Crespo Franco',
          source: 'set_meetings_confirmation',
          kind: 'confirmation_1',
          status: 'cached',
          meeting_starts_at: '2026-06-07T20:00:00.000Z',
          meeting_ends_at: '2026-06-07T21:00:00.000Z',
        },
        {
          appointment_id: '628045',
          athlete_id: '1498941',
          athlete_main_id: '953710',
          athlete_name: 'Diego Crespo Franco',
          source: 'set_meetings_confirmation',
          kind: 'confirmation_2',
          status: 'cached',
          meeting_starts_at: '2026-06-07T20:00:00.000Z',
          meeting_ends_at: '2026-06-07T21:00:00.000Z',
        },
      ],
      new Date('2026-06-05T18:30:00.000Z'),
    ),
    false,
  );
});

test('no-show evidence accepts legacy title prefixes and CRM no-show stages', () => {
  assert.equal(hasStrictNoShowEvidence({ crmStage: 'Meeting Result - No Show' }), true);
  assert.equal(
    hasStrictNoShowEvidence({ bookedEventTitle: '(NS)*2 Raul Agramonte Football 2027 FL' }),
    true,
  );
  assert.equal(
    hasStrictNoShowEvidence({
      crmStage: 'Actual Meeting - Follow Up',
      bookedEventTitle: '(NS)*2 Raul Agramonte Football 2027 FL',
    }),
    true,
  );
  assert.equal(hasStrictNoShowEvidence({ crmStage: 'Actual Meeting - Follow Up' }), false);
});

test('pending client loader avoids live source adapters for the review list', () => {
  const source = fs.readFileSync('src/lib/pending-client-watchlist.ts', 'utf8');
  assert.match(source, /'appointments'/);
  assert.match(source, /post_meeting_result\.in\./);
  assert.match(source, /status\.in\./);
  assert.match(source, /pending_client_watchlist/);
  assert.doesNotMatch(source, /status=eq\.watching/);
  assert.doesNotMatch(source, /fetchAthleteBookedMeetings/);
  assert.doesNotMatch(source, /athlete_pipeline_state/);
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
  assert.equal(pendingClientExpiresAt('2026-05-02T08:30'), '2026-05-16T12:30:00.000Z');
  assert.deepEqual(buildPendingClientScanWindow(new Date('2026-05-06T16:00:00-04:00')), {
    start: '2026-04-22',
    end: '2026-05-07',
  });
});
