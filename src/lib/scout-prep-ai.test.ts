import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCurrentLocalTime,
  formatScoutPrepTimeInsight,
  getNaturalZoneLabel,
  resolveTimezone,
} from './scout-prep-ai.js';

test('resolveTimezone: resolves South St. Paul, MN to America/Chicago', () => {
  assert.equal(resolveTimezone('South St. Paul', 'MN'), 'America/Chicago');
});

test('resolveTimezone: falls back to state timezone when city missing or unknown', () => {
  assert.equal(resolveTimezone('Unknown City', 'MN'), 'America/Chicago');
  assert.equal(resolveTimezone(undefined, 'MN'), 'America/Chicago');
});

test('getNaturalZoneLabel: returns natural labels without DST abbreviations', () => {
  assert.equal(getNaturalZoneLabel('America/Chicago'), 'Central');
  assert.equal(getNaturalZoneLabel('America/Phoenix'), 'Mountain');
  assert.equal(getNaturalZoneLabel('America/Los_Angeles'), 'Pacific');
});

test('formatCurrentLocalTime: uses 12-hour en-US time with minutes', () => {
  const formatted = formatCurrentLocalTime('America/Chicago', new Date('2026-01-15T18:59:00.000Z'));
  assert.match(formatted, /^\d{1,2}:\d{2}\s(?:AM|PM)$/);
});

test('formatScoutPrepTimeInsight: formats time, natural zone, and location', () => {
  const formatted = formatScoutPrepTimeInsight(
    'South St. Paul',
    'Minnesota',
    new Date('2026-01-15T18:59:00.000Z'),
  );

  assert.equal(formatted, '12:59 PM | Central | South St. Paul, Minnesota');
  assert.doesNotMatch(formatted || '', /\b[ECMPAH]D?ST\b/);
});

test('formatScoutPrepTimeInsight: returns null when city and state are both missing', () => {
  assert.equal(formatScoutPrepTimeInsight(undefined, undefined), null);
});
