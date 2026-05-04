import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCallActivityFact, buildMeetingOutcomeFact, buildMeetingSetFact } from './call-tracker-facts';
import { resolveOwnerContext } from './owner-resolution';

test('call activity facts preserve compatibility fields and explicit operator context', () => {
  const ownerContext = resolveOwnerContext({
    purpose: 'call_activity',
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '900',
        title: 'Call Attempt 1',
        assigned_owner: 'Jerami Singleton',
        completion_date: '',
      },
    ],
    currentTaskId: '900',
  });

  const row = buildCallActivityFact({
    athleteId: '123',
    athleteMainId: '456',
    athleteName: 'Sample Athlete',
    taskId: '900',
    taskTitle: 'Call Attempt 1',
    activitySubtype: 'call_attempt_1',
    ownerInput: { purpose: 'call_activity', athleteId: '123', athleteMainId: '456' },
    ownerContext,
    occurredAt: '2026-05-02T12:00:00-04:00',
  });

  assert.equal(row.athlete_key, '123:456');
  assert.equal(row.activity_kind, 'dial');
  assert.equal(row.activity_subtype, 'call_attempt_1');
  assert.equal(row.payload_json.counts_as_dial, true);
  assert.equal(row.payload_json.counts_as_contact, false);
  assert.equal(row.payload_json.counts_as_meeting_set, false);
  assert.equal(row.payload_json.counts_as_post_meeting_outcome, false);
  assert.equal(row.payload_json.tracker_outcome, 'voicemail');
  assert.equal(row.source_owner, 'Jerami Singleton');
  assert.equal(row.owner_proof, 'task.assigned_owner');
  assert.equal(row.payload_json.active_operator_key, 'jerami_singleton');
  assert.equal(row.payload_json.materialization_status, 'operator_task');
  assert.equal(row.payload_json.materialization_reason, 'task_assigned_owner_matches_active_operator');
});

test('contact activity facts count as both dial and contact', () => {
  const ownerContext = resolveOwnerContext({
    purpose: 'call_activity',
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '901',
        title: 'Spoke to - I Need To Follow Up',
        assigned_owner: 'Jerami Singleton',
        completion_date: '',
      },
    ],
    currentTaskId: '901',
  });

  const row = buildCallActivityFact({
    athleteId: '123',
    athleteMainId: '456',
    athleteName: 'Sample Athlete',
    taskId: '901',
    taskTitle: 'Spoke to - I Need To Follow Up',
    activitySubtype: 'spoke_to_follow_up',
    ownerInput: { purpose: 'call_activity', athleteId: '123', athleteMainId: '456' },
    ownerContext,
    occurredAt: '2026-05-02T12:00:00-04:00',
  });

  assert.equal(row.activity_kind, 'contact');
  assert.equal(row.activity_type, 'spoke_to_follow_up');
  assert.equal(row.payload_json.counts_as_dial, true);
  assert.equal(row.payload_json.counts_as_contact, true);
  assert.equal(row.payload_json.counts_as_meeting_set, false);
  assert.equal(row.payload_json.counts_as_post_meeting_outcome, false);
  assert.equal(row.payload_json.tracker_outcome, 'spoke_follow_up');
});

test('unable to leave voicemail activity facts remain dial-only', () => {
  const ownerContext = resolveOwnerContext({
    purpose: 'call_activity',
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '902',
        title: 'Called - Unable to Leave VM',
        assigned_owner: 'Jerami Singleton',
        completion_date: '',
      },
    ],
    currentTaskId: '902',
  });

  const row = buildCallActivityFact({
    athleteId: '123',
    athleteMainId: '456',
    athleteName: 'Sample Athlete',
    taskId: '902',
    taskTitle: 'Called - Unable to Leave VM',
    activitySubtype: 'unable_to_leave_vm',
    ownerInput: { purpose: 'call_activity', athleteId: '123', athleteMainId: '456' },
    ownerContext,
    occurredAt: '2026-05-02T12:00:00-04:00',
  });

  assert.equal(row.activity_kind, 'dial');
  assert.equal(row.activity_type, 'unable_to_leave_vm');
  assert.equal(row.payload_json.counts_as_dial, true);
  assert.equal(row.payload_json.counts_as_contact, false);
  assert.equal(row.payload_json.tracker_outcome, 'unable_to_leave_vm');
});

test('call activity facts reject missing occurrence clocks', () => {
  const ownerContext = resolveOwnerContext({
    purpose: 'call_activity',
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '903',
        title: 'Call Attempt 1',
        assigned_owner: 'Jerami Singleton',
        completion_date: '',
      },
    ],
    currentTaskId: '903',
  });

  assert.throws(
    () =>
      buildCallActivityFact({
        athleteId: '123',
        athleteMainId: '456',
        athleteName: 'Sample Athlete',
        taskId: '903',
        taskTitle: 'Call Attempt 1',
        activitySubtype: 'call_attempt_1',
        ownerInput: { purpose: 'call_activity', athleteId: '123', athleteMainId: '456' },
        ownerContext,
      }),
    /explicit occurredAt reporting clock/,
  );
});

test('meeting outcome facts can carry a non-operator event owner but block Tim-owned task materialization', () => {
  const ownerContext = resolveOwnerContext({
    purpose: 'meeting_outcome',
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '901',
        title: 'Confirmation Call',
        assigned_owner: 'Tim Risner',
        completion_date: '',
      },
    ],
    currentTaskId: '901',
    bookedMeeting: {
      event_id: '777',
      assigned_owner: 'Ryan Lietz',
      athlete_id: '123',
      athlete_main_id: '456',
    },
  });

  const row = buildMeetingOutcomeFact({
    athleteId: '123',
    athleteMainId: '456',
    athleteName: 'Sample Athlete',
    source: 'current_sales_stage_reconcile',
    rawCrmStage: 'Closed Won',
    rawTaskStatus: 'closed_won',
    rawEventType: 'meeting_outcome',
    appointmentId: '777',
    liveEventId: '777',
    bookedEventTitle: '(ENR $99) Sample Athlete Football 2026 PA',
    occurredAt: '2026-05-02T12:00:00-04:00',
    ownerInput: { purpose: 'meeting_outcome', athleteId: '123', athleteMainId: '456' },
    ownerContext,
  });

  assert.equal(row.source_owner, 'Ryan Lietz');
  assert.equal(row.owner_proof, 'bookedMeeting.assigned_owner');
  assert.equal(row.is_tracked_owner, false);
  assert.equal(row.payload_json.task_assigned_owner, 'Tim Risner');
  assert.equal(row.payload_json.materialization_status, 'not_operator_task');
  assert.equal(row.payload_json.materialization_reason, 'task_assigned_owner_is_other_owner');
});

test('meeting outcome facts are post-meeting outcomes, not call activity or meeting-set lifecycle facts', () => {
  const ownerContext = resolveOwnerContext({
    purpose: 'meeting_outcome',
    athleteId: '123',
    athleteMainId: '456',
    tasks: [
      {
        task_id: '902',
        title: 'Confirmation Call',
        assigned_owner: 'Jerami Singleton',
        completion_date: '',
      },
    ],
    currentTaskId: '902',
    bookedMeeting: {
      event_id: '778',
      assigned_owner: 'Ryan Lietz',
      athlete_id: '123',
      athlete_main_id: '456',
    },
  });

  const row = buildMeetingOutcomeFact({
    athleteId: '123',
    athleteMainId: '456',
    athleteName: 'Sample Athlete',
    source: 'legacy_sales_stage_current',
    rawCrmStage: 'Actual Meeting - No Show',
    rawTaskStatus: 'no_show',
    rawEventType: 'post_meeting_outcome',
    appointmentId: '778',
    liveEventId: '778',
    bookedEventTitle: '(NS) Sample Athlete Football 2026 PA',
    occurredAt: '2026-05-02T12:00:00-04:00',
    ownerInput: { purpose: 'meeting_outcome', athleteId: '123', athleteMainId: '456' },
    ownerContext,
  });

  assert.equal(row.raw_event_type, 'post_meeting_outcome');
  assert.equal(row.payload_json.activity_kind, undefined);
  assert.equal(row.payload_json.activity_subtype, undefined);
  assert.notEqual(row.dedupe_key.includes('meeting_set'), true);
});

test('post-meeting outcomes dedupe across stage title and commission evidence for the same appointment', () => {
  const ownerContext = resolveOwnerContext({
    purpose: 'meeting_outcome',
    athleteId: '1489625',
    athleteMainId: '951462',
    tasks: [
      {
        task_id: '625214',
        title: 'Confirmation Call',
        assigned_owner: 'Jerami Singleton',
      },
    ],
    currentTaskId: '625214',
    bookedMeeting: {
      event_id: '613323',
      assigned_owner: 'Luther Winfield',
      athlete_id: '1489625',
      athlete_main_id: '951462',
    },
  });

  const stageFact = buildMeetingOutcomeFact({
    athleteId: '1489625',
    athleteMainId: '951462',
    athleteName: 'Marcus Garcia',
    source: 'current_sales_stage_reconcile',
    rawCrmStage: 'Actual Meeting - Close Won',
    rawTaskStatus: 'closed_won',
    rawEventType: 'post_meeting_outcome',
    dedupeOutcome: 'closed_won',
    appointmentId: '613323',
    liveEventId: '613323',
    bookedEventTitle: 'Marcus Garcia Baseball 2027 NM',
    occurredAt: '2026-05-02T12:00:00-04:00',
    ownerInput: { purpose: 'meeting_outcome', athleteId: '1489625', athleteMainId: '951462' },
    ownerContext,
  });
  const commissionFact = buildMeetingOutcomeFact({
    athleteId: '1489625',
    athleteMainId: '951462',
    athleteName: 'Marcus Garcia',
    source: 'stripe_commissions',
    rawCrmStage: 'Actual Meeting - Close Won',
    rawTaskStatus: 'closed_won',
    rawEventType: 'post_meeting_outcome',
    dedupeOutcome: 'closed_won',
    appointmentId: '613323',
    liveEventId: '613323',
    bookedEventTitle: 'Marcus Garcia Baseball 2027 NM',
    revenueCents: 9900,
    occurredAt: '2026-05-02T12:00:00-04:00',
    ownerInput: { purpose: 'meeting_outcome', athleteId: '1489625', athleteMainId: '951462' },
    ownerContext,
  });

  assert.equal(stageFact.dedupe_key, commissionFact.dedupe_key);
  assert.equal(stageFact.dedupe_key, 'post_meeting_outcome:1489625:951462:613323:closed_won');
});

test('meeting set facts are keyed by the canonical booked meeting event id', () => {
  const row = buildMeetingSetFact({
    athleteId: '1491000',
    athleteMainId: '952900',
    crmStage: 'Meeting Set',
    taskStatus: 'confirmation_call',
    payload: {
      source: 'weekly_booked_meetings_with_operator_confirmation_task',
      appointment_id: '613999',
      meeting_name: 'Bryce Hill Football 2026 PA',
      starts_at: '2026-05-04T19:00:00-04:00',
      task_assigned_owner: 'Jerami Singleton',
      booked_meeting_assigned_owner: 'Ryan Lietz',
    },
    createdAt: '2026-05-01T15:00:00-04:00',
  });

  assert.equal(row.event_type, 'meeting_set');
  assert.equal(row.dedupe_key, 'meeting_set:1491000:952900:613999');
  assert.equal(row.payload_json.appointment_id, '613999');
});

test('meeting set facts reject rows that do not come from a booked calendar event', () => {
  assert.throws(
    () =>
      buildMeetingSetFact({
        athleteId: '1491000',
        athleteMainId: '952900',
        crmStage: 'Meeting Set',
        taskStatus: 'confirmation_call',
        payload: {
          source: 'manual_pipeline_promotion',
          meeting_name: 'Bryce Hill Football 2026 PA',
        },
      }),
    /appointment_id\/event_id/,
  );
});
