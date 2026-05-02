import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAthleteKey,
  normalizeAthleteId,
  normalizeAthleteMainId,
  sameAthleteIdentity,
  validateAthleteIdentity,
} from './athlete-identity';

test('normalizes athlete id parts and builds canonical athlete key', () => {
  assert.equal(normalizeAthleteId(' 123 '), '123');
  assert.equal(normalizeAthleteMainId(' 456 '), '456');
  assert.equal(buildAthleteKey(' 123 ', ' 456 '), '123:456');
  assert.deepEqual(validateAthleteIdentity({ athleteId: '123', athleteMainId: '456' }), {
    athleteId: '123',
    athleteMainId: '456',
    athleteKey: '123:456',
  });
});

test('malformed required identity throws instead of creating partial keys', () => {
  assert.throws(() => buildAthleteKey('123', ''), /Malformed athlete identity/);
  assert.throws(() => validateAthleteIdentity({ athleteId: '', athleteMainId: '456' }), /Malformed athlete identity/);
});

test('safe identity comparison treats missing candidate ids as not disqualifying', () => {
  assert.equal(
    sameAthleteIdentity({
      athleteId: '123',
      athleteMainId: '456',
      candidateAthleteId: '',
      candidateAthleteMainId: '',
    }),
    true,
  );
  assert.equal(
    sameAthleteIdentity({
      athleteId: '123',
      athleteMainId: '456',
      candidateAthleteId: '999',
      candidateAthleteMainId: '456',
    }),
    false,
  );
});
