import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TEST_SUITES, FORBIDDEN_COMMAND_PATTERN } from './honest-test-report.mjs';

test('honest test runner exposes the expected local proof suites', () => {
  assert.deepEqual(
    TEST_SUITES.map((suite) => suite.name),
    [
      'domain contracts',
      'supabase lifecycle',
      'appointment truth and sql contracts',
      'raycast workflow identity contracts',
      'sync script unit contracts',
    ],
  );
});

test('honest test runner does not execute repair or live mutation commands', () => {
  for (const suite of TEST_SUITES) {
    assert.doesNotMatch(suite.command, FORBIDDEN_COMMAND_PATTERN, suite.command);
  }
});

test('package exposes root npm test as the honest reporting runner', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.test, 'node scripts/honest-test-report.mjs');
  assert.equal(pkg.scripts['test:honest-report'], 'node scripts/honest-test-report.mjs');
});
