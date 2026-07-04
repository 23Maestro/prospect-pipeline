import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildPendingClientOwnerSnapshot,
  buildPendingClientEvidenceDescription,
  buildPendingClientChecklistMarkdown,
  buildPendingClientCommunicationPlan,
  buildPendingClientResolvedPatch,
  buildPendingClientSourceLifecycleInput,
  buildPendingClientReviewFollowUpRowsFromSource,
  buildPendingClientReplyWaitTaskSchedule,
  buildPendingClientWatchlistRow,
  buildPendingClientScanWindow,
  cleanPendingClientAthleteName,
  classifyPendingClientActionTag,
  classifyPendingClientCentralQueue,
  classifyPendingClientLifecycle,
  classifyPendingClientOperatorQueue,
  derivePendingClientLaneState,
  derivePendingClientActiveFollowUpState,
  extractPendingClientEvidenceNote,
  filterReadySetMeetingConfirmationGroups,
  filterPendingClientCandidateEvents,
  findPendingClientSignals,
  hasStrictNoShowEvidence,
  hasPendingClientWatchNote,
  isPendingClientResolvedByFutureConfirmation,
  isPendingClientReviewEventTitle,
  normalizePendingClientAIVerdict,
  normalizePendingClientDisplayRowTag,
  parsePendingClientEvidenceNote,
  pendingClientEvidenceCrmStage,
  pendingClientExpiresAt,
  pendingClientTaskOnlySendModeForCycle,
  selectLatestPendingClientReviewEvent,
  selectLatestPendingClientNote,
  shouldResolvePendingClientForLifecycle,
  summarizePendingClientAppointmentHistory,
  summarizePendingClientMessageThread,
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
      assigned_owner: 'Head Scout D',
      start: '2026-05-02T08:30',
      end: '2026-05-02T09:00',
      date_time_label: 'Sat 05/02/26 8:30 AM',
    },
    {
      event_id: '2',
      title: '(FU) Poppy Kingan Women’s Soccer 2028',
      assigned_owner: 'Head Scout B',
      start: '2026-04-24T08:30',
      end: '2026-04-24T09:00',
      date_time_label: 'Fri 04/24/26 8:30 AM',
    },
    {
      event_id: '3',
      title: '(ENR $99) Already Won Football 2028 TX',
      assigned_owner: 'Head Scout D',
      start: '2026-05-02T08:30',
      end: '2026-05-02T09:00',
      date_time_label: 'Sat 05/02/26 8:30 AM',
    },
    {
      event_id: '4',
      title: 'Follow Up - Too Old Football 2028 TX',
      assigned_owner: 'Head Scout C',
      start: '2026-04-20T08:30',
      end: '2026-04-20T09:00',
      date_time_label: 'Mon 04/20/26 8:30 AM',
    },
    {
      event_id: '5',
      title: 'Follow Up - Future Football 2028 TX',
      assigned_owner: 'Head Scout E',
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
  assert.equal(
    extractPendingClientEvidenceNote(
      [
        'Pending client review from appointment outcome: reschedule_pending.',
        '',
        'Event List: https://www.maxpreps.com/ia/orange-city/moc-floyd-valley-dutchmen/football/',
        '',
        'Notes Tab: called into work',
        '',
        'Notes Tab: called into work',
      ].join('\n'),
    ),
    'called into work',
  );
  assert.equal(
    extractPendingClientEvidenceNote(
      [
        'Event List: Follow up with dad next week.',
        '',
        'Notes Tab: Father and son wanted to think it over.',
      ].join('\n'),
    ),
    'Father and son wanted to think it over.',
  );
});

test('pending client rows reject athlete-key text as display name', () => {
  const row = buildPendingClientWatchlistRow({
    event: {
      event_id: 'appointment:630246',
      title: '(RSP) Daylen Johnson Football 2029 CA',
      assigned_owner: 'Head Scout G',
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
  assert.equal(
    cleanPendingClientAthleteName('(CAN) Christan Hirniak Football 2027 IL'),
    'Christan Hirniak',
  );
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
      metadata: 'Head Scout C | Meeting Rescheduled Pending',
    },
    {
      title: '05/29/26 09:03 PM',
      description: 'Need a few days on Elite package.',
      metadata: 'Head Scout C | Follow Up',
    },
  ]);

  assert.equal(note?.description, 'Need a few days on Elite package.');
  assert.equal(note?.metadata, 'Head Scout C | Follow Up');
});

test('pending client review note chooses latest follow-up event after the meeting', () => {
  const meeting = {
    event_id: '612634',
    title: '(FU) Javiion Knight Football 2027 NJ',
    assigned_owner: 'Head Scout C',
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
      assigned_owner: 'Head Scout C',
      start: '2026-05-16T19:00',
      end: '2026-05-16T19:30',
      date_time_label: 'Sat 05/16/26 7:00 PM',
      description: 'Family wanted a few days (Elite)',
    },
    {
      event_id: '628111',
      title: '(FU)*2 Javiion Knight Football 2027 NJ',
      assigned_owner: 'Head Scout C',
      start: '2026-05-14T19:00',
      end: '2026-05-14T19:30',
      date_time_label: 'Thu 05/14/26 7:00 PM',
      description: 'Older review note (Icon)',
    },
    {
      event_id: '628745',
      title: '(FU) Blank Note Football 2027 NJ',
      assigned_owner: 'Head Scout C',
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
      normalizedStage: 'follow_up',
      description: 'Family is pending payment for the Elite package.',
      matchedSignals: ['payment', 'elite', 'package'],
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
      assigned_owner: 'Head Scout D',
      start: '2026-05-30T10:00',
      end: '2026-05-30T10:30',
    },
    description: 'Family wants Legend and asked about payment timing.',
    matchedSignals: ['legend', 'payment'],
    actionTag: 'Payment Watch',
    aiVerdict: 'pending_client',
    activeOperator: {
      operatorKey: 'operator_primary',
      personName: 'Primary Operator',
      legacyUserId: '100001',
      taskAssignedOwnerName: 'Primary Operator',
      dashboardTrackingEnabled: true,
      senderName: 'Primary Operator',
    },
  });

  assert.equal(row.action_tag, 'Payment Watch');
});

function pendingClientRow(overrides = {}) {
  return buildPendingClientWatchlistRow({
    event: {
      event_id: 'pending-client:queue',
      title: '(RSP) Avery Jones Football 2027 TN',
      assigned_owner: 'Head Scout D',
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
      assigned_owner: 'Head Scout G',
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
    sourceLifecycle?: Parameters<typeof classifyPendingClientCentralQueue>[0]['sourceLifecycle'];
    now?: Date;
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
      replyEvidence: {
        themeBucket: 'RSP',
        operatorReplyProposedTimes: true,
        lastMeaningfulOutbound: { date: '2026-06-17T15:05:00' },
      },
      now: new Date('2026-06-17T15:10:00'),
      expected: {
        filter: 'reschedule',
        label: 'RSP',
        actionLabel: 'Awaiting Client',
        priority: 20,
      },
    },
    {
      name: 'RSP · Try Again',
      row: baseRow,
      replyEvidence: {
        themeBucket: 'RSP',
        operatorReplyProposedTimes: true,
        lastMeaningfulOutbound: { date: '2026-06-17T15:05:00' },
      },
      now: new Date('2026-06-19T15:06:00'),
      expected: { filter: 'reschedule', label: 'RSP', actionLabel: 'Try Again', priority: 15 },
    },
    {
      name: 'RSP · Review Reply',
      row: baseRow,
      replyEvidence: {
        themeBucket: 'RSP',
        operatorReplyProposedTimes: true,
        clientRepliedAfterOperatorTimes: true,
      },
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
      replyEvidence: {
        themeBucket: 'No Show',
        operatorReplyProposedTimes: true,
        lastMeaningfulOutbound: { date: '2026-06-17T15:05:00' },
      },
      now: new Date('2026-06-17T15:10:00'),
      expected: {
        filter: 'no_show',
        label: 'No Show',
        actionLabel: 'Awaiting Client',
        priority: 20,
      },
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
      row: {
        ...baseRow,
        event_title: 'Follow Up - Avery Jones Football 2027 TN',
        description: 'Call attempt 2. Parent said tomorrow works.',
        action_tag: 'Scout Update',
      },
      sourceLifecycle: {
        crmStage: 'Left Voice Mail 2',
        taskTitle: 'Call Attempt 2',
        taskStatus: 'call_attempt_2',
      },
      replyEvidence: {
        themeBucket: 'Call Attempt',
        lastMeaningfulInbound: { body: 'Tomorrow works.', date: '2026-06-18T21:00:00.000Z' },
        operatorRepliedAfterInbound: false,
      },
      expected: {
        filter: 'review_follow_ups',
        label: 'Review Follow Ups',
        actionLabel: 'Needs Reply',
        priority: 30,
      },
    },
    {
      name: 'Review Follow Ups · Review Reply',
      row: {
        ...baseRow,
        event_title: 'Follow Up - Avery Jones Football 2027 TN',
        description: 'Call attempt 2. Parent said tomorrow works.',
        action_tag: 'Scout Update',
      },
      replyEvidence: {
        themeBucket: 'RSP',
        operatorReplyProposedTimes: true,
        clientRepliedAfterOperatorTimes: true,
      },
      expected: {
        filter: 'review_follow_ups',
        label: 'Review Follow Ups',
        actionLabel: 'Review Reply',
        priority: 20,
      },
    },
    {
      name: 'Review Follow Ups · Review',
      row: {
        ...baseRow,
        event_title: 'Follow Up - Avery Jones Football 2027 TN',
        description: 'Call attempt 2. Operator already responded.',
        action_tag: 'Scout Update',
      },
      replyEvidence: { themeBucket: 'Call Attempt', operatorRepliedAfterInbound: true },
      expected: {
        filter: 'review_follow_ups',
        label: 'Review Follow Ups',
        actionLabel: 'Review',
        priority: 30,
      },
    },
    {
      name: 'Payments',
      row: { ...baseRow, action_tag: 'Payment Watch', matched_signals: ['payment'] },
      replyEvidence: null,
      expected: { filter: 'payments', label: 'Payments', actionLabel: 'Payments', priority: 40 },
    },
    {
      name: 'Payments ignores message needs-reply evidence',
      row: {
        ...baseRow,
        action_tag: 'Payment Watch',
        description: 'Notes Tab: Family is pending payment for Elite.',
        matched_signals: ['payment', 'elite'],
      },
      replyEvidence: { themeBucket: 'Call Attempt', operatorRepliedAfterInbound: false },
      expected: { filter: 'payments', label: 'Payments', actionLabel: 'Payments', priority: 40 },
    },
    {
      name: 'Payments catches older scout-update payment notes',
      row: {
        ...baseRow,
        event_title: 'Follow Up - Jeremiah Cuyler Football 2027 TX',
        action_tag: 'Scout Update',
        description: 'Notes Tab: Father is taking over the Elite package payment.',
        matched_signals: ['elite', 'package', 'payment'],
      },
      replyEvidence: { themeBucket: 'Call Attempt', operatorRepliedAfterInbound: false },
      expected: { filter: 'payments', label: 'Payments', actionLabel: 'Payments', priority: 40 },
    },
  ];

  const allowedRowTags = new Set([
    'Offer Slots',
    'Awaiting Client',
    'Review Reply',
    'Try Again',
    'Bad Timing',
    'Needs Reply',
    'Review',
    'Payments',
  ]);

  for (const testCase of cases) {
    const actual = classifyPendingClientCentralQueue({
      row: testCase.row,
      replyEvidence: testCase.replyEvidence,
      sourceLifecycle: testCase.sourceLifecycle,
      now: testCase.now,
    });
    const rowTag = actual.actionLabel;

    assert.deepEqual(actual, testCase.expected, testCase.name);
    assert.ok(allowedRowTags.has(rowTag), testCase.name);
  }
});

test('pending client review follow ups require call follow-up sales stage and unhandled inbound reply', () => {
  const row = pendingClientRow({
    event: {
      event_id: 'pending-client:review-follow-up',
      title: 'Follow Up - Aundres Thomas Football 2027 TX',
      assigned_owner: 'Primary Operator',
      start: '2026-06-13T10:00',
      end: '2026-06-13T11:00',
    },
    description: 'Outreach callback after voicemail follow-up.',
    actionTag: 'Scout Update',
  });
  const replyEvidence: PendingClientOperatorQueueReplyEvidence = {
    themeBucket: 'Call Attempt',
    lastMeaningfulInbound: {
      body: 'Tomorrow',
      date: '2026-06-18T21:50:00.000Z',
    },
    operatorRepliedAfterInbound: false,
  };

  const active = derivePendingClientLaneState({
    row,
    replyEvidence,
    sourceLifecycle: {
      crmStage: 'Left Voice Mail 1',
      taskTitle: 'Call Attempt 1',
      taskStatus: 'call_attempt_1',
    },
  });
  const handled = derivePendingClientLaneState({
    row,
    replyEvidence: { ...replyEvidence, operatorRepliedAfterInbound: true },
    sourceLifecycle: {
      crmStage: 'Left Voice Mail 1',
      taskTitle: 'Call Attempt 1',
      taskStatus: 'call_attempt_1',
    },
  });
  const movedToMeetingSet = derivePendingClientLaneState({
    row,
    replyEvidence,
    sourceLifecycle: {
      crmStage: 'Meeting Set',
      taskTitle: 'Confirmation Call',
      taskStatus: 'confirmation_call',
    },
  });

  assert.equal(active.queue.filter, 'review_follow_ups');
  assert.equal(active.queue.actionLabel, 'Needs Reply');
  assert.equal(active.visible, true);
  assert.equal(handled.queue.actionLabel, 'Review');
  assert.equal(handled.visible, false);
  assert.equal(movedToMeetingSet.queue.actionLabel, 'Review');
  assert.equal(movedToMeetingSet.visible, false);
});

test('pending client review follow ups stay hidden from current source stage without message evidence', () => {
  const row = pendingClientRow({
    event: {
      event_id: 'pending-client:review-follow-up-source',
      title: 'Follow Up - Avery Jones Football 2027 TN',
      assigned_owner: 'Primary Operator',
      start: '2026-06-13T10:00',
      end: '2026-06-13T11:00',
    },
    description: 'Outreach callback after voicemail follow-up.',
    actionTag: 'Scout Update',
  });
  const state = derivePendingClientLaneState({
    row,
    replyEvidence: null,
    sourceLifecycle: {
      crmStage: 'Left Voice Mail 2',
      taskTitle: 'Call Attempt 2',
      taskStatus: 'call_attempt_2',
    },
  });

  assert.equal(state.queue.filter, 'review_follow_ups');
  assert.equal(state.queue.actionLabel, 'Review');
  assert.equal(state.visible, false);
});

test('pending client review follow ups admit current first-contact source stages', () => {
  const rows = buildPendingClientReviewFollowUpRowsFromSource(
    [
      {
        athleteKey: '1500173:954893',
        athleteId: '1500173',
        athleteMainId: '954893',
        athleteName: 'Elijah Burton Jr',
        crmStage: 'Left Voice Mail 1',
        taskTitle: 'Call Attempt 2',
        taskStatus: 'call_attempt_2',
        updatedAt: '2026-06-18T00:03:31.771Z',
      },
    ],
    new Date('2026-06-18T12:00:00.000Z'),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_event_id, 'contact-cache-review:1500173:954893');
  assert.equal(rows[0].action_tag, 'Scout Update');
  assert.equal(rows[0].athlete_name, 'Elijah Burton Jr');

  const state = derivePendingClientLaneState({
    row: rows[0],
    replyEvidence: null,
    sourceLifecycle: {
      crmStage: 'Left Voice Mail 1',
      taskTitle: 'Call Attempt 2',
      taskStatus: 'call_attempt_2',
    },
  });

  assert.equal(state.visible, false);
  assert.equal(state.queue.filter, 'review_follow_ups');
  assert.equal(state.queue.actionLabel, 'Review');
});

test('pending client reply wait task schedule defaults to second morning at 9 AM', () => {
  const schedule = buildPendingClientReplyWaitTaskSchedule({
    from: new Date('2026-06-18T19:42:00-04:00'),
  });

  assert.equal(schedule.dueDate, '06/20/2026');
  assert.equal(schedule.dueTime, '09:00');
  assert.equal(schedule.dueAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), '9:00 AM');
});

test('pending client task-only send mode moves first two cycles and completes final cycle', () => {
  assert.equal(pendingClientTaskOnlySendModeForCycle(null), 'move_reply_wait');
  assert.equal(pendingClientTaskOnlySendModeForCycle(1), 'move_reply_wait');
  assert.equal(pendingClientTaskOnlySendModeForCycle(2), 'move_reply_wait');
  assert.equal(pendingClientTaskOnlySendModeForCycle(3), 'complete_task');
});

test('pending client review follow ups reject non-follow-up current source stages', () => {
  const rows = buildPendingClientReviewFollowUpRowsFromSource([
    {
      athleteKey: '1500173:954893',
      athleteId: '1500173',
      athleteMainId: '954893',
      athleteName: 'Elijah Burton Jr',
      crmStage: 'Meeting Set',
      taskTitle: 'Confirmation Call',
      taskStatus: 'confirmation_call',
      updatedAt: '2026-06-18T00:03:31.771Z',
    },
  ]);

  assert.equal(rows.length, 0);
});

test('pending client review follow ups reject purge-level first-contact stages', () => {
  const rows = buildPendingClientReviewFollowUpRowsFromSource([
    {
      athleteKey: '1500173:954893',
      athleteId: '1500173',
      athleteMainId: '954893',
      athleteName: 'Elijah Burton Jr',
      crmStage: 'Never Spoke To',
      taskTitle: 'Call Attempt 3',
      taskStatus: 'call_attempt_3',
      updatedAt: '2026-06-18T00:03:31.771Z',
    },
    {
      athleteKey: '1500174:954894',
      athleteId: '1500174',
      athleteMainId: '954894',
      athleteName: 'Mario Davis',
      crmStage: 'Spoke to - Not Interested',
      taskTitle: 'Call Attempt 2',
      taskStatus: 'call_attempt_2',
      updatedAt: '2026-06-18T00:03:31.771Z',
    },
  ]);

  assert.equal(rows.length, 0);
});

test('pending client lane state keeps source stage ahead of message theme tags', () => {
  const rspRow = pendingClientRow({
    description: 'Notes Tab: Gage has practice',
    last_seen_at: '2026-06-17T17:34:00.000Z',
  });
  const rspState = derivePendingClientLaneState({
    row: rspRow,
    replyEvidence: {
      themeBucket: 'Call Attempt',
      operatorRepliedAfterInbound: false,
      operatorReplyProposedTimes: true,
      clientRepliedAfterOperatorTimes: false,
      lastMeaningfulOutbound: {
        body: 'Coach has me checking what works best to reschedule Gage: 1 - Thursday at 7PM ET 2 - Monday at 7PM ET',
        date: '2026-06-17T19:05:00.000Z',
      },
    },
    now: new Date('2026-06-18T12:00:00.000Z'),
  });

  assert.equal(rspState.queue.filter, 'reschedule');
  assert.equal(rspState.queue.actionLabel, 'Awaiting Client');
  assert.equal(rspState.messageEvidenceApplies, true);
  assert.equal(rspState.paymentLocked, false);

  const paymentRow = pendingClientRow({
    event: {
      event_id: 'appointment:payment',
      title: 'Head Scout A - Follow Up',
      assigned_owner: 'Head Scout D',
      start: '2026-06-17T19:00:00.000Z',
    },
    description: 'Notes Tab: Family asked for Elite package payment options.',
    matchedSignals: ['elite', 'package', 'payment'],
    actionTag: 'Payment Watch',
  });
  const paymentState = derivePendingClientLaneState({
    row: paymentRow,
    replyEvidence: {
      themeBucket: 'Call Attempt',
      operatorRepliedAfterInbound: false,
      operatorReplyProposedTimes: true,
      clientRepliedAfterOperatorTimes: true,
    },
  });

  assert.equal(paymentState.queue.filter, 'payments');
  assert.equal(paymentState.queue.actionLabel, 'Payments');
  assert.equal(paymentState.messageEvidenceApplies, false);
  assert.equal(paymentState.paymentLocked, true);
});

test('pending client display tag normalizer fixes stale support tags without moving RSP rows', () => {
  const stalePaymentRow = pendingClientRow({
    event: {
      event_id: 'pending-client:stale-payment',
      title: 'Follow Up - Jeremiah Cuyler Football 2027 TX',
      assigned_owner: 'Primary Operator',
      start: '2026-06-17T19:00:00.000Z',
    },
    description: 'Notes Tab: Father is taking over the Elite package payment.',
    matchedSignals: [],
    actionTag: 'Scout Update',
  });
  const rspWithPaymentWords = pendingClientRow({
    event: {
      event_id: 'appointment:rsp-payment-words',
      title: '(RSP) Gage Henry Football 2027 OH',
      assigned_owner: 'Head Scout H',
      start: '2026-06-17T19:00:00.000Z',
    },
    description: 'Notes Tab: Parent mentioned payment but Gage needs to reschedule.',
    matchedSignals: [],
    actionTag: 'Scout Update',
  });

  const normalizedPayment = normalizePendingClientDisplayRowTag(stalePaymentRow);
  const normalizedRsp = normalizePendingClientDisplayRowTag(rspWithPaymentWords);
  const storedSignalPayment = normalizePendingClientDisplayRowTag(
    pendingClientRow({
      event: {
        event_id: 'pending-client:stored-signal-payment',
        title: 'Follow Up - Stored Signal Football 2027 TX',
        assigned_owner: 'Primary Operator',
        start: '2026-06-17T19:00:00.000Z',
      },
      description: 'Notes Tab: Follow up with family.',
      matchedSignals: ['payment'],
      actionTag: 'Payment Watch',
    }),
  );

  assert.equal(normalizedPayment.action_tag, 'Payment Watch');
  assert.deepEqual(normalizedPayment.matched_signals, ['payment', 'package', 'elite']);
  assert.equal(normalizedRsp.action_tag, 'Operator Input');
  assert.equal(storedSignalPayment.action_tag, 'Payment Watch');
  assert.deepEqual(storedSignalPayment.matched_signals, ['payment']);
  assert.equal(
    classifyPendingClientCentralQueue({ row: normalizedRsp }).filter,
    'reschedule',
  );
});

test('pending client source lifecycle fallback keeps review reply tags aligned without loaded chat', () => {
  const row = pendingClientRow({
    event: {
      event_id: 'pending-client:review-follow-up-no-chat',
      title: 'Follow Up - Aundres Thomas Football 2027 TX',
      assigned_owner: 'Primary Operator',
      start: '2026-06-13T10:00',
      end: '2026-06-13T11:00',
    },
    description: 'Outreach callback after voicemail follow-up.',
    actionTag: 'Scout Update',
  });
  const state = derivePendingClientLaneState({
    row,
    replyEvidence: {
      themeBucket: 'Call Attempt',
      lastMeaningfulInbound: {
        body: 'Tomorrow',
        date: '2026-06-18T21:50:00.000Z',
      },
      operatorRepliedAfterInbound: false,
    },
    sourceLifecycle: {
      crmStage: 'Actual Meeting - Follow Up',
      taskTitle: 'Left Voice Mail 1',
      taskStatus: 'Left Voice Mail 1',
    },
  });

  assert.equal(state.visible, true);
  assert.equal(state.queue.filter, 'review_follow_ups');
  assert.equal(state.queue.actionLabel, 'Needs Reply');
});

test('pending client source lifecycle input is derived in the domain', () => {
  const row = pendingClientRow({
    event: {
      event_id: 'pending-client:lifecycle-source',
      title: 'Follow Up - Avery Jones Football 2027 TN',
      assigned_owner: 'Primary Operator',
      start: '2026-06-17T19:00:00.000Z',
    },
    description: 'Notes Tab: Follow up with family.',
    actionTag: 'Scout Update',
  });

  assert.deepEqual(
    buildPendingClientSourceLifecycleInput({
      row,
      replyTaskTitle: 'Left Voice Mail 1',
      matchedCrmStage: null,
      matchedTaskTitle: null,
      matchedTaskStatus: null,
    }),
    {
      crmStage: 'Actual Meeting - Follow Up',
      taskTitle: 'Left Voice Mail 1',
      taskStatus: 'Left Voice Mail 1',
    },
  );

  assert.deepEqual(
    buildPendingClientSourceLifecycleInput({
      row,
      replyTaskTitle: 'Left Voice Mail 1',
      matchedCrmStage: 'Meeting Result - Res. Pending',
      matchedTaskTitle: 'Reschedule Pending',
      matchedTaskStatus: 'reschedule_pending',
    }),
    {
      crmStage: 'Meeting Result - Res. Pending',
      taskTitle: 'Reschedule Pending',
      taskStatus: 'reschedule_pending',
    },
  );
});

test('pending client evidence CRM stage reuses prefix-aware stage inference', () => {
  const cases = [
    {
      title: '(RSP) Avery Jones Football 2027 TN',
      expected: 'Meeting Result - Res. Pending',
    },
    {
      title: '(NS) Avery Jones Football 2027 TN',
      expected: 'Meeting Result - No Show',
    },
    {
      title: '(CAN) Avery Jones Football 2027 TN',
      expected: 'Meeting Result - Canceled',
    },
  ];

  for (const item of cases) {
    assert.equal(
      pendingClientEvidenceCrmStage(
        pendingClientRow({
          event: {
            event_id: `pending-client:${item.expected}`,
            title: item.title,
            assigned_owner: 'Primary Operator',
            start: '2026-06-17T19:00:00.000Z',
          },
          description: 'Pending client review.',
          actionTag: 'Operator Input',
        }),
      ),
      item.expected,
    );
  }
});

test('pending client payment markdown renders note evidence without recovery checkboxes', () => {
  const row = pendingClientRow({
    event: {
      event_id: 'appointment:payment',
      title: 'Head Scout A - Follow Up',
      assigned_owner: 'Head Scout D',
      start: '2026-06-17T19:00:00.000Z',
    },
    description: 'Notes Tab: Father and son wanted to take over Elite at the discount price.',
    matchedSignals: ['elite', 'discount'],
    actionTag: 'Payment Watch',
  });

  assert.equal(
    buildPendingClientChecklistMarkdown({
      row,
      replyEvidence: {
        themeBucket: 'Call Attempt',
        operatorRepliedAfterInbound: false,
        operatorReplyProposedTimes: true,
        clientRepliedAfterOperatorTimes: true,
      },
    }),
    [
      '### Note',
      '',
      '```',
      'Father and son wanted to take over Elite at the discount price.',
      '```',
    ].join('\n'),
  );
});

test('reschedule-pending appointment outcome routes directly to RSP offer slots', () => {
  const row = buildPendingClientWatchlistRow({
    event: {
      event_id: 'appointment:613349',
      title: 'Joziah Zenobia - Reschedule Pending',
      assigned_owner: 'Head Scout A',
      start: '2026-06-17T01:00:00.000Z',
    },
    description: 'Pending client review from appointment outcome: reschedule_pending.',
    matchedSignals: ['reschedule_pending'],
    actionTag: 'Operator Input',
    aiVerdict: 'pending_client',
    athleteId: '1499361',
    athleteMainId: '954093',
    athleteName: 'Joziah Zenobia',
    now: new Date('2026-06-16T22:09:40.206Z'),
  });

  assert.equal(row.athlete_name, 'Joziah Zenobia');
  assert.equal(row.status, 'watching');
  assert.equal(row.last_seen_at, '2026-06-16T22:09:40.206Z');
  assert.deepEqual(
    classifyPendingClientCentralQueue({
      row,
      replyEvidence: null,
    }),
    {
      filter: 'reschedule',
      label: 'RSP',
      actionLabel: 'Offer Slots',
      priority: 10,
    },
  );
});

test('pending client appointment history summarizes literal schedule and outcome cycles', () => {
  const summary = summarizePendingClientAppointmentHistory([
    {
      appointmentId: '600001',
      startsAt: '2026-06-02T01:00:00.000Z',
      updatedAt: '2026-06-02T22:00:00.000Z',
      status: 'scheduled',
    },
    {
      appointmentId: '600002',
      startsAt: '2026-06-07T01:00:00.000Z',
      updatedAt: '2026-06-07T02:10:00.000Z',
      postMeetingResult: 'no_show',
    },
    {
      appointmentId: '600003',
      startsAt: '2026-06-11T01:00:00.000Z',
      updatedAt: '2026-06-11T22:17:56.556Z',
      postMeetingResult: 'rescheduled',
    },
    {
      appointmentId: '600004',
      startsAt: '2026-06-16T01:00:00.000Z',
      updatedAt: '2026-06-16T22:09:40.206Z',
      postMeetingResult: 'reschedule_pending',
    },
  ]);

  assert.deepEqual(summary, {
    scheduledCount: 4,
    rescheduleCount: 2,
    noShowCount: 1,
    canceledCount: 0,
    recoveryCycleCount: 3,
    originalMeetingAt: '2026-06-02T01:00:00.000Z',
    latestMeetingAt: '2026-06-16T01:00:00.000Z',
    latestOutcomeAt: '2026-06-16T22:09:40.206Z',
    latestOutcome: 'reschedule_pending',
  });
});

test('pending client message summary answers whether operator reached out after outcome', () => {
  const summary = summarizePendingClientMessageThread({
    latestOutcomeAt: '2026-06-16T22:09:40.206Z',
    now: new Date('2026-06-19T22:09:40.206Z'),
    replyEvidence: {
      themeBucket: 'RSP',
      lastMeaningfulOutbound: {
        body: 'Would tonight or tomorrow work?',
        date: '2026-06-17T15:00:00.000Z',
      },
      operatorReplyProposedTimes: true,
      operatorRepliedAfterInbound: true,
    },
  });

  assert.deepEqual(summary, {
    operatorReachedOutAfterLatestOutcome: true,
    clientRepliedAfterLatestOperator: false,
    dormantDaysSinceOperatorMessage: 2,
    lastOperatorMessageAt: '2026-06-17T15:00:00.000Z',
    lastClientMessageAt: null,
    state: 'awaiting_client',
  });
});

test('pending client checklist checks real note and outbound reschedule evidence once', () => {
  const row = pendingClientRow({
    description: [
      'Pending client review from appointment outcome: reschedule_pending.',
      '',
      'Notes Tab: called into work',
      '',
      'Notes Tab: called into work',
    ].join('\n'),
    last_seen_at: '2026-06-16T22:09:40.206Z',
  });
  const markdown = buildPendingClientChecklistMarkdown({
    row,
    replyEvidence: {
      themeBucket: 'RSP',
      operatorReplyProposedTimes: true,
      operatorRepliedAfterInbound: true,
      lastMeaningfulOutbound: {
        body: 'No worries. Would tonight or tomorrow work?',
        date: '2026-06-17T15:00:00.000Z',
      },
    },
    now: new Date('2026-06-19T15:00:00.000Z'),
  });

  assert.equal(
    markdown,
    [
      '### Stage 1',
      '',
      '**Action: Try Again**',
      '',
      '- [x] Add note',
      '- [x] Offer slots',
      '- [ ] Try again - waited until Friday, June 19th at 9:00 AM',
      '',
      '### Note',
      '',
      '```',
      'called into work',
      '```',
    ].join('\n'),
  );
  assert.equal(markdown.match(/Add note/g)?.length, 1);
  assert.doesNotMatch(markdown, /themeBucket|operatorReplyProposedTimes|reschedule_pending|_/);
});

test('pending client checklist waits for note and reschedule outreach when evidence is missing', () => {
  const row = pendingClientRow({
    description: 'Pending client review from appointment outcome: reschedule_pending.',
    last_seen_at: '2026-06-16T22:09:40.206Z',
  });

  assert.equal(
    buildPendingClientChecklistMarkdown({
      row,
      replyEvidence: null,
      now: new Date('2026-06-17T15:00:00.000Z'),
    }),
    ['### Stage 1', '', '**Action: Offer Slots**', '', '- [ ] Add note', '- [ ] Offer slots'].join('\n'),
  );
});

test('pending client checklist marks offered slots and waits for reply right after outbound times', () => {
  const row = pendingClientRow({
    description: 'Notes Tab: Gage has practice',
    last_seen_at: '2026-06-17T17:34:00.000Z',
  });

  assert.equal(
    buildPendingClientChecklistMarkdown({
      row,
      replyEvidence: {
        themeBucket: 'RSP',
        operatorReplyProposedTimes: true,
        clientRepliedAfterOperatorTimes: false,
        lastMeaningfulOutbound: {
          body: 'Coach Head Scout H has me checking what works best to reschedule Gage: 1 - Thursday, June 18 at 7PM ET 2 - Monday, June 22 at 7PM ET Which one works best?',
          date: '2026-06-17T15:05:00',
        },
      },
      now: new Date('2026-06-17T15:10:00'),
    }),
    [
      '### Stage 1',
      '',
      '**Action: Awaiting Client**',
      '',
      '- [x] Add note',
      '- [x] Offer slots',
      '- [ ] Wait for reply until Friday, June 19th at 9:00 AM',
      '',
      '### Note',
      '',
      '```',
      'Gage has practice',
      '```',
    ].join('\n'),
  );
});

test('pending client checklist asks for reply review when client responds after sent times', () => {
  const row = pendingClientRow({
    description: 'Notes Tab: called into work',
    last_seen_at: '2026-06-16T22:09:40.206Z',
  });

  assert.equal(
    buildPendingClientChecklistMarkdown({
      row,
      replyEvidence: {
        themeBucket: 'RSP',
        operatorReplyProposedTimes: true,
        clientRepliedAfterOperatorTimes: true,
        lastMeaningfulOutbound: {
          body: 'No worries. Would tonight or tomorrow work?',
          date: '2026-06-17T15:00:00.000Z',
        },
        lastMeaningfulInbound: {
          body: 'Tomorrow works better.',
          date: '2026-06-17T16:00:00.000Z',
        },
      },
      now: new Date('2026-06-17T17:00:00.000Z'),
    }),
    [
      '### Stage 1',
      '',
      '**Action: Review Reply**',
      '',
      '- [x] Add note',
      '- [x] Offer slots',
      '- [ ] Review reply',
      '',
      '### Note',
      '',
      '```',
      'called into work',
      '```',
    ].join('\n'),
  );
});

test('pending client active follow-up state marks outbound offer as awaiting client', () => {
  const row = pendingClientRow({
    last_seen_at: '2026-06-17T17:34:00.000Z',
    description: 'Notes Tab: 06/17/26 01:34 PM Gage has practice',
  });
  const replyEvidence: PendingClientOperatorQueueReplyEvidence = {
    operatorReplyProposedTimes: true,
    clientRepliedAfterOperatorTimes: false,
    lastMeaningfulOutbound: {
      body: 'Coach has me checking what works best to reschedule Gage: 1 - Thursday at 7PM ET 2 - Monday at 7PM ET',
      date: '2026-06-17T19:05:00.000Z',
    },
  };
  const state = derivePendingClientActiveFollowUpState({
    row,
    filter: 'reschedule',
    replyEvidence,
    now: new Date('2026-06-18T10:00:00.000Z'),
  });
  const queue = classifyPendingClientCentralQueue({
    row,
    replyEvidence,
    now: new Date('2026-06-18T10:00:00.000Z'),
  });
  const markdown = buildPendingClientChecklistMarkdown({
    row,
    replyEvidence,
    centralQueue: queue,
    now: new Date('2026-06-18T10:00:00.000Z'),
  });

  assert.equal(state.actionLabel, 'Awaiting Client');
  assert.equal(queue.actionLabel, 'Awaiting Client');
  assert.match(markdown, /- \[x\] Offer slots/);
  assert.match(markdown, /- \[ \] Wait for reply until/);
});

test('pending client active follow-up state moves awaiting client to try again after deadline', () => {
  const row = pendingClientRow({
    last_seen_at: '2026-06-17T17:34:00.000Z',
    description: 'Notes Tab: 06/17/26 01:34 PM Gage has practice',
  });
  const replyEvidence: PendingClientOperatorQueueReplyEvidence = {
    operatorReplyProposedTimes: true,
    clientRepliedAfterOperatorTimes: false,
    lastMeaningfulOutbound: {
      body: 'Coach has me checking what works best to reschedule Gage: 1 - Thursday at 7PM ET 2 - Monday at 7PM ET',
      date: '2026-06-17T19:05:00.000Z',
    },
  };
  const now = new Date('2026-06-19T19:06:00.000Z');
  const state = derivePendingClientActiveFollowUpState({
    row,
    filter: 'reschedule',
    replyEvidence,
    now,
  });
  const queue = classifyPendingClientCentralQueue({ row, replyEvidence, now });
  const markdown = buildPendingClientChecklistMarkdown({
    row,
    replyEvidence,
    centralQueue: queue,
    now,
  });

  assert.equal(state.actionLabel, 'Try Again');
  assert.equal(queue.actionLabel, 'Try Again');
  assert.match(markdown, /- \[x\] Offer slots/);
  assert.match(markdown, /- \[ \] Try again - waited until/);
});

test('pending client note evidence renders timestamp and description without title noise', () => {
  const rawNote =
    "Follow Up - Darius Nicholson Men's Basketball 2022 TX 04/21/26 07:50 PM Father and son wanted to think it over - Elite discount and price details.";
  const parsed = parsePendingClientEvidenceNote(rawNote);

  assert.equal(parsed?.timestampLabel, 'Tuesday, April 21st at 7:50 PM');
  assert.equal(
    parsed?.description,
    'Father and son wanted to think it over - Elite discount and price details.',
  );

  const row = pendingClientRow({
    description: `Lifecycle: meeting_follow_up\n\nNotes Tab: ${rawNote}`,
  });
  const markdown = buildPendingClientChecklistMarkdown({ row });

  assert.match(markdown, /### Note/);
  assert.match(markdown, /Tuesday, April 21st at 7:50 PM/);
  assert.match(
    markdown,
    /```\nFather and son wanted to think it over - Elite discount and price details\.\n```/,
  );
  assert.doesNotMatch(markdown, /Follow Up - Darius/);
  assert.doesNotMatch(markdown, /Text:/);
  assert.doesNotMatch(markdown, /Client:/);
});

test('pending client communication plan escalates repeated RSP cycles without new tags', () => {
  const appointmentHistory = summarizePendingClientAppointmentHistory([
    {
      appointmentId: '600001',
      startsAt: '2026-06-02T01:00:00.000Z',
      updatedAt: '2026-06-02T02:00:00.000Z',
      postMeetingResult: 'no_show',
    },
    {
      appointmentId: '600002',
      startsAt: '2026-06-07T01:00:00.000Z',
      updatedAt: '2026-06-07T02:00:00.000Z',
      postMeetingResult: 'reschedule_pending',
    },
    {
      appointmentId: '600003',
      startsAt: '2026-06-11T01:00:00.000Z',
      updatedAt: '2026-06-11T02:00:00.000Z',
      postMeetingResult: 'reschedule_pending',
    },
  ]);
  const messageThread = summarizePendingClientMessageThread({
    latestOutcomeAt: appointmentHistory.latestOutcomeAt,
    now: new Date('2026-06-12T12:00:00.000Z'),
    replyEvidence: null,
  });
  const plan = buildPendingClientCommunicationPlan({
    queue: {
      filter: 'reschedule',
      label: 'RSP',
      actionLabel: 'Offer Slots',
      priority: 10,
    },
    appointmentHistory,
    messageThread,
    salesStage: 'Meeting Result - Res. Pending',
  });

  assert.equal(plan.lane, 'reschedule');
  assert.equal(plan.action, 'offer_slots');
  assert.equal(plan.stageLabel, 'Final check');
  assert.equal(plan.templateTone, 'final_time_check');
  assert.equal(plan.templateKey, 'reschedule.final.needs_operator_outreach.offer_slots');
  assert.deepEqual(plan.evidenceFacts, [
    'Scheduled: 3',
    'Reschedules: 2',
    'No-shows: 1',
    'Cancels: 0',
    'Message state: needs_operator_outreach',
  ]);
  assert.ok(plan.nextSteps.some((step) => /final time-protection check/i.test(step)));
  assert.ok(plan.nextSteps.some((step) => /operator approval/i.test(step)));
  assert.match(plan.resolutionRule, /not automatic/i);
  assert.notEqual(plan.action, 'purge_terminal');
});

test('pending client communication plan labels first and second cycle valves', () => {
  const firstCycle = summarizePendingClientAppointmentHistory([
    {
      appointmentId: '600001',
      startsAt: '2026-06-02T01:00:00.000Z',
      updatedAt: '2026-06-02T02:00:00.000Z',
      postMeetingResult: 'no_show',
    },
  ]);
  const secondCycle = summarizePendingClientAppointmentHistory([
    {
      appointmentId: '600001',
      startsAt: '2026-06-02T01:00:00.000Z',
      updatedAt: '2026-06-02T02:00:00.000Z',
      postMeetingResult: 'no_show',
    },
    {
      appointmentId: '600002',
      startsAt: '2026-06-07T01:00:00.000Z',
      updatedAt: '2026-06-07T02:00:00.000Z',
      postMeetingResult: 'reschedule_pending',
    },
  ]);
  const queue = {
    filter: 'no_show',
    label: 'No Show',
    actionLabel: 'Needs Reply',
    priority: 10,
  } as const;

  const firstPlan = buildPendingClientCommunicationPlan({
    queue,
    appointmentHistory: firstCycle,
    messageThread: summarizePendingClientMessageThread({
      latestOutcomeAt: firstCycle.latestOutcomeAt,
      replyEvidence: null,
    }),
    salesStage: 'Meeting Result - No Show',
  });
  const secondPlan = buildPendingClientCommunicationPlan({
    queue,
    appointmentHistory: secondCycle,
    messageThread: summarizePendingClientMessageThread({
      latestOutcomeAt: secondCycle.latestOutcomeAt,
      replyEvidence: null,
    }),
    salesStage: 'Meeting Result - Res. Pending',
  });

  assert.equal(firstPlan.stageLabel, 'Stage 1');
  assert.equal(firstPlan.templateTone, 'simple_recovery');
  assert.equal(secondPlan.stageLabel, 'Stage 2');
  assert.equal(secondPlan.templateTone, 'direct_intent_check');
});

test('pending client communication plan purges terminal sales stages', () => {
  const appointmentHistory = summarizePendingClientAppointmentHistory([
    {
      appointmentId: '613349',
      startsAt: '2026-06-17T01:00:00.000Z',
      updatedAt: '2026-06-16T22:09:40.206Z',
      postMeetingResult: 'reschedule_pending',
    },
  ]);
  const messageThread = summarizePendingClientMessageThread({
    latestOutcomeAt: appointmentHistory.latestOutcomeAt,
    replyEvidence: null,
  });
  const plan = buildPendingClientCommunicationPlan({
    queue: {
      filter: 'reschedule',
      label: 'RSP',
      actionLabel: 'Offer Slots',
      priority: 10,
    },
    appointmentHistory,
    messageThread,
    salesStage: 'Spoke to - Not Interested',
  });

  assert.equal(plan.action, 'purge_terminal');
  assert.equal(plan.templateKey, 'reschedule.terminal.purge');
  assert.deepEqual(plan.nextSteps, [
    'Remove from active Pending Clients and Client Messages tracking.',
  ]);
});

test('pending client payment watch does not require appointment truth backing', () => {
  const row = buildPendingClientWatchlistRow({
    event: {
      event_id: 'pending-client:arthur-payment-watch',
      title: 'Follow Up - Arthur Uribe Football 2029 CA',
      assigned_owner: 'Head Scout D',
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
      head_scout_name: 'Head Scout D',
      meeting_starts_at: '2026-05-15T19:00:00.000Z',
      meeting_ends_at: '2026-05-15T20:00:00.000Z',
      source: 'set_meetings_confirmation',
      kind: 'confirmation_1',
      status: 'cached',
      message_body: 'one',
      payload_json: { active_operator_key: 'operator_primary' },
    },
    {
      appointment_id: 'future-jerami',
      athlete_id: '1489001',
      athlete_main_id: '951001',
      athlete_name: 'Future Jones',
      head_scout_name: 'Head Scout D',
      meeting_starts_at: '2026-05-15T21:00:00.000Z',
      meeting_ends_at: '2026-05-15T22:00:00.000Z',
      source: 'set_meetings_confirmation',
      kind: 'confirmation_1',
      status: 'cached',
      message_body: 'one',
      payload_json: { active_operator_key: 'operator_primary' },
    },
    {
      appointment_id: 'past-other',
      athlete_id: '1489002',
      athlete_main_id: '951002',
      athlete_name: 'Other Jones',
      head_scout_name: 'Head Scout D',
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
      head_scout_name: 'Head Scout D',
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
      activeOperatorKey: 'operator_primary',
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
  assert.match(source, /status=eq\.watching/);
  assert.match(source, /normalizePendingClientDisplayRowTag/);
  assert.doesNotMatch(source, /action_tag=eq\.Payment Watch/);
  assert.match(source, /resolveBookedMeetingDetailsForForm/);
  assert.match(source, /meeting_timezone/);
  assert.match(source, /buildPendingClientEvidenceDescription/);
  assert.match(source, /pending_client_operator_note/);
  assert.match(source, /pending_client_scout_note/);
  assert.match(source, /findPendingClientSignals\(description\)/);
  assert.match(source, /classifyPendingClientActionTag\(\{/);
  assert.doesNotMatch(source, /matchedSignals: \[outcome\]/);
  assert.doesNotMatch(source, /actionTag: 'Operator Input'/);
  assert.doesNotMatch(source, /expires_at=gte/);
  assert.doesNotMatch(source, /active_athlete_meeting_truth/);
  assert.doesNotMatch(source, /readCurrentPipelineRows/);
  assert.doesNotMatch(source, /fetchAthleteBookedMeetings/);
  assert.doesNotMatch(source, /fetchAthleteNotes/);
  assert.doesNotMatch(source, /confirmPendingClientWithRayAI/);
  assert.doesNotMatch(source, /currentMeeting\\.description/);
});

test('pending client remove path keeps full-row upsert for appointment-derived tombstones', () => {
  const source = fs.readFileSync('src/lib/pending-client-watchlist.ts', 'utf8');
  const helperStart = source.indexOf('export async function markPendingClientResolved');
  const helperEnd = source.indexOf('export async function loadPendingClientMessageContext');
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /typeof rowOrSourceEventId === 'string'/);
  assert.match(
    helper,
    /patchPendingClientWatchlistRow\(config, rowOrSourceEventId, resolvedPatch\)/,
  );
  assert.match(helper, /const row = rowOrSourceEventId/);
  assert.match(helper, /upsertPendingClientWatchlistRows\(config/);
  assert.match(helper, /status: 'resolved'/);
});

test('pending client follow-up context reads contact cache without full scout prep hydration', () => {
  const source = fs.readFileSync('src/lib/pending-client-watchlist.ts', 'utf8');
  const helperStart = source.indexOf('export async function loadPendingClientMessageContext');
  const helper = source.slice(helperStart);

  assert.match(helper, /'athlete_contact_cache'/);
  assert.match(helper, /athlete_key=eq\.\$\{encodeURIComponent\(athleteKey\)\}/);
  assert.match(helper, /cache_status=eq\.active/);
  assert.match(helper, /buildLightweightScoutPrepContextForMessages\(\{/);
  assert.doesNotMatch(helper, /loadScoutPrepContext/);
  assert.doesNotMatch(helper, /fetchAthleteNotes/);
  assert.doesNotMatch(helper, /fetchAthleteTasks/);
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
  assert.match(source, /candidateUpdatedAt >= rowUpdatedAt/);
  assert.match(source, /select=id,athlete_key,starts_at,status,post_meeting_result,updated_at/);
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

test('pending client queue order uses last seen date only', () => {
  const loaderSource = fs.readFileSync('src/lib/pending-client-watchlist.ts', 'utf8');
  const uiSource = fs.readFileSync('src/head-scout-schedules.tsx', 'utf8');

  assert.match(loaderSource, /export function pendingClientQueueTime/);
  assert.match(loaderSource, /Date\.parse\(String\(row\.last_seen_at \|\| ''\)\.trim\(\)\)/);
  assert.doesNotMatch(loaderSource, /appointment_starts_at \|\| row\.event_start/);
  assert.match(loaderSource, /updated_at=gte/);
  assert.match(loaderSource, /order=updated_at\.desc/);
  assert.doesNotMatch(loaderSource, /starts_at=gte/);
  assert.doesNotMatch(loaderSource, /order=starts_at\.desc/);
  assert.match(
    uiSource,
    /pendingClientQueueTime\(right\.row\) - pendingClientQueueTime\(left\.row\)/,
  );
});

test('pending client visible filters use a 14 day gate for RSP and no-show only', () => {
  const source = fs.readFileSync('src/head-scout-schedules.tsx', 'utf8');
  assert.match(source, /PENDING_CLIENT_RECOVERY_WINDOW_MS = 14 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /if \(queue\.filter === 'payments'\) return true/);
  assert.match(source, /if \(queue\.filter === 'review_follow_ups'\) return true/);
  assert.match(
    source,
    /if \(queue\.filter !== 'reschedule' && queue\.filter !== 'no_show'\) return true/,
  );
  assert.match(source, /const lastSeenAt = pendingClientQueueTime\(row\)/);
  assert.match(source, /lastSeenAt > 0 && now - lastSeenAt <= PENDING_CLIENT_RECOVERY_WINDOW_MS/);
  assert.match(source, /isPendingClientInsideVisibleWindow\(item\.row, item\.queue\)/);
});

test('pending client detail keeps meeting metadata but leaves deadline out of metadata', () => {
  const source = fs.readFileSync('src/head-scout-schedules.tsx', 'utf8');
  assert.match(source, /`# HS: \$\{scout\}`/);
  assert.match(source, /`### \$\{meeting\}`/);
  assert.match(source, /Metadata\.Label title="Meeting" text=\{eventDate\}/);
  assert.doesNotMatch(source, /`# HS: \$\{scout\} - \$\{meeting\}`/);
  assert.doesNotMatch(source, /Metadata\.Label title="Deadline"/);
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
  assert.equal(
    shouldResolvePendingClientForLifecycle({
      crmStage: 'Spoke to - Not Interested',
      bookedEventTitle: '(RSP) Jr Samuels Football 2029 IA',
    }),
    true,
  );
  assert.equal(
    classifyPendingClientLifecycle({
      crmStage: 'Spoke to - Not Interested',
      reviewEventTitle: '(RSP) Jr Samuels Football 2029 IA',
      reviewDescription: 'Previously needed slots.',
    }).eligible,
    false,
  );
});

test('pending client recovery row is suppressed by a newer confirmed meeting cache group', () => {
  const pendingRow = buildPendingClientWatchlistRow({
    event: {
      event_id: 'pending-client:1498941:953710:628043',
      title: '(RSP) Diego Crespo Franco Baseball 2026 GA',
      assigned_owner: 'Head Scout E',
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
      assigned_owner: 'Head Scout E',
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
  assert.match(source, /status=eq\.watching/);
  assert.match(source, /normalizePendingClientDisplayRowTag/);
  assert.doesNotMatch(source, /action_tag=eq\.Payment Watch/);
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
    assignedOwner: 'Head Scout D',
    activeOperator: {
      operatorKey: 'operator_primary',
      personName: 'Primary Operator',
      legacyUserId: '100001',
      taskAssignedOwnerName: 'Primary Operator',
      dashboardTrackingEnabled: true,
      senderName: 'Primary Operator',
    },
  });

  assert.equal(snapshot.head_scout, 'Head Scout D');
  assert.equal(snapshot.head_scout_key, 'head_scout_d');
  assert.equal(snapshot.calendar_owner_id, 'calendar_owner_d');
  assert.equal(snapshot.detected_by_operator, 'Primary Operator');
  assert.equal(snapshot.detected_by_operator_key, 'operator_primary');
  assert.equal(snapshot.owner_context.active_operator_name, 'Primary Operator');
  assert.equal(snapshot.owner_context.head_scout_name, 'Head Scout D');
});

test('resolved patch stamps the current active operator without call tracker proof fields', () => {
  const patch = buildPendingClientResolvedPatch(
    {
      operatorKey: 'operator_primary',
      personName: 'Primary Operator',
      legacyUserId: '100001',
      taskAssignedOwnerName: 'Primary Operator',
      dashboardTrackingEnabled: true,
      senderName: 'Primary Operator',
    },
    new Date('2026-05-06T18:00:00Z'),
  );

  assert.equal(patch.status, 'resolved');
  assert.equal(patch.resolved_by_operator, 'Primary Operator');
  assert.equal(patch.resolved_by_operator_key, 'operator_primary');
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
