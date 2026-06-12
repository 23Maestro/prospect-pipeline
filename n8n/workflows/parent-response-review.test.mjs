import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = JSON.parse(
  readFileSync(new URL('./parent-response-review.json', import.meta.url), 'utf8'),
);

function nodeByName(name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing node: ${name}`);
  return node;
}

function bodyParameterNames(node) {
  return node.parameters?.bodyParameters?.parameters?.map((parameter) => parameter.name).sort() || [];
}

test('parent response n8n workflow stays downstream of submitted responses', () => {
  assert.equal(workflow.active, false);
  assert.equal(nodeByName('Every 5 minutes').type, 'n8n-nodes-base.scheduleTrigger');

  const query = nodeByName('Find submitted responses').parameters.queryParameters.parameters;
  assert.deepEqual(
    Object.fromEntries(query.map((parameter) => [parameter.name, parameter.value])),
    {
      select: 'id,request_status,response_kind,approval_status,notification_status',
      request_status: 'in.(selected,none_work,ready_later)',
      approval_status: 'eq.pending',
      notification_status: 'neq.sent',
      order: 'updated_at.asc',
      limit: '10',
    },
  );

  const notify = nodeByName('Notify operator');
  assert.equal(notify.parameters.method, 'POST');
  assert.match(notify.parameters.url, /\/api\/parent-response\/'\s*\+\s*\$json\.id\s*\+\s*'\/notify/);
  assert.deepEqual(notify.parameters.headerParameters.parameters, [
    {
      name: 'x-parent-response-secret',
      value: '={{$env.PARENT_RESPONSE_NOTIFY_SECRET}}',
    },
  ]);
});

test('parent response n8n workflow patches only notification metadata', () => {
  const serialized = JSON.stringify(workflow);
  assert.doesNotMatch(serialized, /lifecycle_events/i);
  assert.doesNotMatch(serialized, /\/sales\/stage/i);
  assert.doesNotMatch(serialized, /\/sales\/reschedule-meeting/i);
  assert.doesNotMatch(serialized, /crm_stage/i);
  assert.doesNotMatch(serialized, /task_status/i);

  const patch = nodeByName('Mark notification sent');
  assert.equal(patch.parameters.method, 'PATCH');
  assert.match(patch.parameters.url, /\/rest\/v1\/parent_response_requests\?id=eq\.'\s*\+\s*\$json\.request_id/);
  assert.deepEqual(bodyParameterNames(patch), [
    'notification_error',
    'notification_sent_at',
    'notification_status',
  ]);
});

test('parent response n8n workflow keeps secrets in environment variables', () => {
  const serialized = JSON.stringify(workflow);
  assert.match(serialized, /\$env\.SUPABASE_URL/);
  assert.match(serialized, /\$env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(serialized, /\$env\.PARENT_RESPONSE_NOTIFY_BASE_URL/);
  assert.match(serialized, /\$env\.PARENT_RESPONSE_NOTIFY_SECRET/);
  assert.doesNotMatch(serialized, /eyJ[a-zA-Z0-9_-]{20,}/);
  assert.doesNotMatch(serialized, /re_[a-zA-Z0-9]/);
});
