#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

export const FORBIDDEN_COMMAND_PATTERN =
  /\b(--write|sync:|backfill-.*--write|reconcile:|materialize:|archive:|rotate:|dev:|api)\b/i;

export const TEST_SUITES = [
  {
    name: 'domain contracts',
    command: 'npm run test:domain',
  },
  {
    name: 'supabase lifecycle',
    command: 'npm run test:supabase-lifecycle',
  },
  {
    name: 'appointment truth and sql contracts',
    command: 'node --test scripts/backfill-appointment-truth.test.mjs supabase/tests/*.test.mjs',
  },
  {
    name: 'sync script unit contracts',
    command:
      'npm run test:call-tracker-ownership && node --test scripts/sync-current-pipeline-to-supabase.test.mjs scripts/sync-booked-meetings-to-supabase.test.mjs scripts/sync-supabase-pipeline.test.mjs scripts/lifecycle-call-tracker-backsync-core.test.mjs',
  },
];

function runCommand(command) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(command, {
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        CI: process.env.CI || '1',
      },
    });

    child.on('close', (code, signal) => {
      resolve({
        command,
        code,
        signal,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
  });
}

function assertSafeCommand(command) {
  if (FORBIDDEN_COMMAND_PATTERN.test(command)) {
    throw new Error(`Refusing to run mutating command from npm test: ${command}`);
  }
}

export async function runHonestTestReport(suites = TEST_SUITES) {
  const results = [];
  for (const suite of suites) {
    assertSafeCommand(suite.command);
    console.log(`\n== ${suite.name} ==`);
    const result = await runCommand(suite.command);
    results.push({ ...suite, ...result, status: result.code === 0 ? 'pass' : 'fail' });
  }

  await mkdir('.tmp', { recursive: true });
  await writeFile(
    '.tmp/honest-test-report.json',
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );

  console.log('\nHonest test report');
  for (const result of results) {
    console.log(
      `- ${result.status.toUpperCase()} ${result.name} (${result.durationMs}ms): ${result.command}`,
    );
  }
  console.log('\nReport written to .tmp/honest-test-report.json');

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = await runHonestTestReport();
  process.exitCode = results.some((result) => result.status !== 'pass') ? 1 : 0;
}
