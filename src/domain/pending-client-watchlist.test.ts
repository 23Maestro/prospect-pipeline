import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPendingClientOwnerSnapshot,
  buildPendingClientResolvedPatch,
  buildPendingClientScanWindow,
  cleanPendingClientAthleteName,
  filterPendingClientCandidateEvents,
  findPendingClientSignals,
  normalizePendingClientAIVerdict,
  pendingClientExpiresAt,
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
    ['coming aboard', 'full payment', 'discount', 'payment'],
  );
  assert.deepEqual(findPendingClientSignals('Come aboard with $179 12 month upgrade.'), [
    'upgrade',
    '$',
  ]);
  assert.deepEqual(findPendingClientSignals('Follow up on interest.'), []);
  assert.deepEqual(findPendingClientSignals('Follow up with the dad.'), []);
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
