import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashParentResponseToken,
  isParentResponseRequestOpen,
  selectNoParentResponseOptionsWork,
  selectParentReadyLater,
  selectParentResponseOption,
} from './parent-response-request';

test('hashParentResponseToken is deterministic and hides the token', async () => {
  const hash = await hashParentResponseToken('secret-token', 'pepper');
  assert.equal(hash, await hashParentResponseToken('secret-token', 'pepper'));
  assert.notEqual(hash, 'secret-token');
});

test('isParentResponseRequestOpen rejects used and expired requests', () => {
  assert.equal(
    isParentResponseRequestOpen(
      { request_status: 'open', used_at: null, expires_at: '2099-01-01T00:00:00Z' },
      new Date('2026-06-12T12:00:00Z'),
    ),
    true,
  );
  assert.equal(
    isParentResponseRequestOpen(
      { request_status: 'selected', used_at: null, expires_at: '2099-01-01T00:00:00Z' },
      new Date('2026-06-12T12:00:00Z'),
    ),
    false,
  );
  assert.equal(
    isParentResponseRequestOpen(
      { request_status: 'open', used_at: '2026-06-12T10:00:00Z', expires_at: '2099-01-01T00:00:00Z' },
      new Date('2026-06-12T12:00:00Z'),
    ),
    false,
  );
  assert.equal(
    isParentResponseRequestOpen(
      { request_status: 'open', used_at: null, expires_at: '2026-06-12T10:00:00Z' },
      new Date('2026-06-12T12:00:00Z'),
    ),
    false,
  );
});

test('selectParentResponseOption writes intent only', () => {
  const update = selectParentResponseOption({
    optionId: 'slot-1',
    responsePayload: { parent_note: 'That works' },
    selectedAt: '2026-06-12T12:00:00Z',
  });
  assert.equal(update.request_status, 'selected');
  assert.equal(update.response_kind, 'selected_slot');
  assert.equal(update.selected_option_id, 'slot-1');
  assert.equal(update.used_at, '2026-06-12T12:00:00Z');
  assert.equal('crm_stage' in update, false);
  assert.equal('appointment_status' in update, false);
});

test('selectNoParentResponseOptionsWork writes review intent only', () => {
  const update = selectNoParentResponseOptionsWork({
    responsePayload: { parent_note: 'Need another day' },
    selectedAt: '2026-06-12T12:05:00Z',
  });
  assert.equal(update.request_status, 'none_work');
  assert.equal(update.response_kind, 'none_work');
  assert.equal(update.selected_option_id, null);
  assert.equal(update.used_at, '2026-06-12T12:05:00Z');
  assert.equal('crm_stage' in update, false);
  assert.equal('appointment_status' in update, false);
});

test('selectParentReadyLater writes human follow-up intent only', () => {
  const update = selectParentReadyLater({
    responsePayload: { parent_note: 'We will reach back out once we know the schedule' },
    selectedAt: '2026-06-12T12:10:00Z',
  });
  assert.equal(update.request_status, 'ready_later');
  assert.equal(update.response_kind, 'ready_later');
  assert.equal(update.selected_option_id, null);
  assert.equal(update.used_at, '2026-06-12T12:10:00Z');
  assert.equal('crm_stage' in update, false);
  assert.equal('appointment_status' in update, false);
});
