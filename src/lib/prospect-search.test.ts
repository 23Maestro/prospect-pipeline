import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProspectSearchTerm } from './prospect-search-term.js';

test('normalizeProspectSearchTerm drops leading US country code from mobile paste', () => {
  assert.equal(normalizeProspectSearchTerm('+1 (702) 675-1544'), '(702) 675-1544');
  assert.equal(normalizeProspectSearchTerm('+17026751544'), '(702) 675-1544');
  assert.equal(normalizeProspectSearchTerm('1-702-675-1544'), '(702) 675-1544');
});

test('normalizeProspectSearchTerm formats ten digit phone searches', () => {
  assert.equal(normalizeProspectSearchTerm('7026751544'), '(702) 675-1544');
  assert.equal(normalizeProspectSearchTerm('(702) 675-1544'), '(702) 675-1544');
});

test('normalizeProspectSearchTerm leaves non-phone searches alone', () => {
  assert.equal(normalizeProspectSearchTerm(' Anita Riggins '), 'Anita Riggins');
  assert.equal(normalizeProspectSearchTerm('ariggins61@gmail.com'), 'ariggins61@gmail.com');
  assert.equal(normalizeProspectSearchTerm('+44 20 7946 0958'), '+44 20 7946 0958');
});
