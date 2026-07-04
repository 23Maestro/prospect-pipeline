import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoApiResponse, getDemoSupabaseRows, isDemoMode } from './demo-mode';

async function readJson(response: Response | null): Promise<any> {
  assert.ok(response);
  assert.equal(response.ok, true);
  return response.json();
}

test('demo mode is default and live mode is explicit opt-in', () => {
  const previous = process.env.PROSPECT_PIPELINE_LIVE_MODE;
  try {
    delete process.env.PROSPECT_PIPELINE_LIVE_MODE;
    assert.equal(isDemoMode(), true);
    assert.notEqual(getDemoApiResponse('/scout/tasks'), null);

    process.env.PROSPECT_PIPELINE_LIVE_MODE = '1';
    assert.equal(isDemoMode(), false);
    assert.equal(getDemoApiResponse('/scout/tasks'), null);
  } finally {
    if (previous === undefined) {
      delete process.env.PROSPECT_PIPELINE_LIVE_MODE;
    } else {
      process.env.PROSPECT_PIPELINE_LIVE_MODE = previous;
    }
  }
});

test('demo api provides populated Scout Prep tasks with fake athletes', async () => {
  const payload = await readJson(getDemoApiResponse('/scout/tasks'));

  assert.ok(payload.tasks.length >= 10);
  assert.equal(payload.tasks[0].athlete_name, 'Camden Ellis');
  assert.equal(payload.tasks[0].athlete_profile_url.includes('ops.prospect-pipeline.local'), true);
});

test('demo api provides scout schedules and meeting slots', async () => {
  const payload = await readJson(getDemoApiResponse('/calendar/head-scout-slots'));

  assert.ok(payload.scouts.length >= 4);
  assert.equal(payload.scouts[0].scout_name, 'Riley Parker');
  assert.ok(payload.scouts[0].slots.length > 0);
});

test('demo api keeps Not Approved as a normal video status', async () => {
  const payload = await readJson(getDemoApiResponse('/video/progress'));
  const statuses = payload.tasks.map((task: any) => task.video_progress_status);

  assert.ok(statuses.includes('Not Approved'));
});

test('demo Supabase rows provide confirmation-cache recipient data', () => {
  const rows = getDemoSupabaseRows<any>('set_meeting_confirmation_cache');

  assert.ok(rows.length > 0);
  assert.equal(rows[0].recipient_phone, '5555555555');
  assert.equal(rows[0].recipient_name, 'Dana Ellis');
});
