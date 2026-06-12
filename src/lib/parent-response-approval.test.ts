import assert from 'node:assert/strict';
import test from 'node:test';
import { applyApprovedParentResponseReschedule } from './parent-response-approval';

const requestRow = {
  id: 'request-1',
  appointment_id: 'previous-appointment',
  athlete_id: '149',
  athlete_main_id: '953',
  athlete_name: 'Jamiya Turner',
  original_head_scout_name: 'Ryan Lietz',
  original_meeting_timezone: 'America/New_York',
  request_status: 'selected',
  approval_status: 'pending',
  response_kind: 'selected_slot',
  selected_option_id: 'slot-1',
  proposed_options: [
    {
      option_id: 'slot-1',
      display_label: 'Monday 6:00 PM ET',
      starts_at: '2026-06-15T18:00',
      ends_at: '2026-06-15T19:00',
      timezone: 'America/New_York',
      open_event_id: 'open-1',
      assigned_to: '1354049',
      head_scout_name: 'Ryan Lietz',
    },
  ],
  approval_payload: {
    previous_appointment_id: 'previous-appointment',
    previous_meeting_title: 'Ryan Lietz - Jamiya Turner',
    previous_meeting_text: 'Prior saved meeting details',
  },
};

test('applyApprovedParentResponseReschedule preserves Raycast confirmed reschedule order', async () => {
  const calls: string[] = [];
  const result = await applyApprovedParentResponseReschedule(requestRow, {
    submitRescheduleMeeting: async (payload) => {
      calls.push('submitRescheduleMeeting');
      assert.equal(payload.athlete_id, '149');
      assert.equal(payload.athlete_main_id, '953');
      assert.equal(payload.assigned_to, '1354049');
      assert.equal(payload.open_event_id, 'open-1');
      assert.equal(payload.previous_event_id, 'previous-appointment');
      assert.equal(payload.keep_as_open_slot, 'yes');
      return {
        success: true,
        athlete_id: '149',
        athlete_main_id: '953',
        assigned_to: '1354049',
        open_event_id: 'open-1',
        meeting_name: payload.meeting_name,
        template_id: '210',
        status_code: 200,
        email_sent: true,
        created_task: { task_id: 'task-1', title: 'Confirmation Call' },
      };
    },
    updateSalesStage: async (args) => {
      calls.push('updateSalesStage');
      assert.equal(args.stage, 'Meeting Result - Rescheduled');
      assert.equal(args.appointmentId, 'previous-appointment');
      return {
        success: true,
        stage: 'Meeting Result - Rescheduled',
        athlete_id: '149',
        athlete_main_id: '953',
        status_code: 200,
        tasks_count: 1,
      };
    },
    recordRescheduled: async (args) => {
      calls.push('recordRescheduled');
      assert.equal(args.previousAppointmentId, 'previous-appointment');
      assert.equal(args.appointmentId, 'open-1');
      assert.equal(args.payload?.parent_response_request_id, 'request-1');
      assert.equal(args.payload?.owner_proof, 'parent_response_operator_approval');
      return { enabled: true };
    },
  });

  assert.deepEqual(calls, [
    'submitRescheduleMeeting',
    'updateSalesStage',
    'recordRescheduled',
  ]);
  assert.equal(result.stage, 'Meeting Result - Rescheduled');
});

test('applyApprovedParentResponseReschedule rejects non-selected responses', async () => {
  await assert.rejects(
    () =>
      applyApprovedParentResponseReschedule({
        ...requestRow,
        request_status: 'none_work',
        response_kind: 'none_work',
      }),
    /Only selected parent response slots can be approved/,
  );
});
