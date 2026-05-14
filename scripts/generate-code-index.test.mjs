import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateCodeIndex } from './generate-code-index.mjs';

function assertRecordShape(record) {
  assert.equal(typeof record.id, 'string');
  assert.equal(typeof record.kind, 'string');
  assert.equal(typeof record.name, 'string');
  assert.equal(typeof record.file, 'string');
  assert.equal(typeof record.line, 'number');
  assert.equal(typeof record.system, 'string');
  assert.equal(typeof record.bucket, 'string');
  assert.equal(typeof record.exported, 'boolean');
  assert.ok(Array.isArray(record.tags));
}

test('scanner finds architecture anchors', () => {
  const records = generateCodeIndex();

  assert.ok(
    records.some(
      (record) => record.kind === 'function' && record.name === 'buildMeetingSetLaravelPayload',
    ),
    'expected meeting-set domain function',
  );
  assert.ok(
    records.some(
      (record) => record.kind === 'function' && record.name === 'recordLifecycleMutation',
    ),
    'expected Supabase lifecycle function',
  );
  assert.ok(
    records.some(
      (record) =>
        record.kind === 'route' &&
        record.system === 'FastAPI' &&
        record.method === 'POST' &&
        record.file === 'npid-api-layer/app/routers/sales.py',
    ),
    'expected FastAPI sales POST route',
  );
});

test('generated IDs are stable and unique', () => {
  const first = generateCodeIndex();
  const second = generateCodeIndex();

  assert.deepEqual(
    first.map((record) => record.id),
    second.map((record) => record.id),
  );
  assert.equal(new Set(first.map((record) => record.id)).size, first.length);
});

test('records match the code-index schema', () => {
  const records = generateCodeIndex();
  assert.ok(records.length > 100, 'expected useful repo inventory');
  records.forEach(assertRecordShape);
});

test('checked-in generated file is current when present', () => {
  const generated = JSON.parse(readFileSync('src/generated/code-index.generated.json', 'utf8'));
  const fresh = generateCodeIndex();
  assert.deepEqual(generated, fresh);
});
