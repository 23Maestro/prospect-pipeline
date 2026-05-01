import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPOINTMENT_TITLE_PREFIXES,
  applyAppointmentTitlePrefix,
  parseAppointmentTitleOutcome,
  resolveAppointmentTitleOutcome,
} from './head-scout-event-prefix';

test('adds prefix to unprefixed title', () => {
  assert.equal(
    applyAppointmentTitlePrefix('Victor Williams Football 2027 FL', '(ACF)'),
    '(ACF) Victor Williams Football 2027 FL',
  );
});

test('replaces existing known prefix', () => {
  assert.equal(
    applyAppointmentTitlePrefix('(RSP) Victor Williams Football 2027 FL', '(CF)'),
    '(CF) Victor Williams Football 2027 FL',
  );
});

test('avoids duplicating the same prefix', () => {
  assert.equal(
    applyAppointmentTitlePrefix('(CAN) Victor Williams Football 2027 FL', '(CAN)'),
    '(CAN) Victor Williams Football 2027 FL',
  );
});

test('preserves athlete title text', () => {
  assert.equal(
    applyAppointmentTitlePrefix('(ACF) Donzi Ojeikere Football 2028 TX', '(ACF*2)'),
    '(ACF*2) Donzi Ojeikere Football 2028 TX',
  );
});

test('repairs human-error (ACF)*2 prefix before applying a new status', () => {
  assert.equal(
    applyAppointmentTitlePrefix('(ACF)*2 Donzi Ojeikere Football 2028 TX', '(CF)'),
    '(CF) Donzi Ojeikere Football 2028 TX',
  );
});

test('repairs human-error (ACF)*2 prefix without duplicating ACF*2', () => {
  assert.equal(
    applyAppointmentTitlePrefix('(ACF)*2 Donzi Ojeikere Football 2028 TX', '(ACF*2)'),
    '(ACF*2) Donzi Ojeikere Football 2028 TX',
  );
});

test('strips accidental leftover *2 when RSP replaces ACF*2', () => {
  assert.equal(
    applyAppointmentTitlePrefix('(RSP)*2 August Nyakeoga Football 2027 MN', '(CF)'),
    '(CF) August Nyakeoga Football 2027 MN',
  );
});

test('handles unknown existing prefix safely', () => {
  assert.equal(
    applyAppointmentTitlePrefix('(FU) Donzi Ojeikere Football 2028 TX', '(CF)'),
    '(CF) (FU) Donzi Ojeikere Football 2028 TX',
  );
});

test('exported prefixes stay in expected order', () => {
  assert.deepEqual(APPOINTMENT_TITLE_PREFIXES, ['(ACF)', '(CF)', '(RSP)', '(CAN)', '(ACF*2)']);
});

test('(FU) titles resolve to soft archive', () => {
  assert.equal(
    resolveAppointmentTitleOutcome('(FU) Victor Williams Football 2028 TX'),
    'soft_archive_follow_up',
  );
});

test('(CAN) titles resolve to soft archive canceled', () => {
  assert.equal(
    resolveAppointmentTitleOutcome('(CAN) Levi Childers Football 2026 CA'),
    'soft_archive_canceled',
  );
});

test('(NS) titles resolve to soft archive no show', () => {
  assert.equal(
    resolveAppointmentTitleOutcome('(NS) Victor Williams Football 2028 TX'),
    'soft_archive_no_show',
  );
});

test('(NS)*2 titles resolve to soft archive no show', () => {
  assert.equal(
    resolveAppointmentTitleOutcome('(NS)*2 Victor Williams Football 2028 TX'),
    'soft_archive_no_show',
  );
});

test('(ENR ...) titles resolve to terminal enrollment', () => {
  assert.equal(
    resolveAppointmentTitleOutcome('(ENR $69) Victor Williams Football 2028 TX'),
    'terminal_enrollment',
  );
});

test('(ENR $69) titles parse enrollment amount and clean title', () => {
  assert.deepEqual(parseAppointmentTitleOutcome('(ENR $69) Victor Williams Football 2028 TX'), {
    originalTitle: '(ENR $69) Victor Williams Football 2028 TX',
    cleanTitle: 'Victor Williams Football 2028 TX',
    outcome: 'terminal_enrollment',
    revenueCents: 6900,
    prefix: '(ENR $69)',
  });
});

test('(ENR $99) titles parse enrollment amount and clean title', () => {
  assert.deepEqual(parseAppointmentTitleOutcome('(ENR $99) Zyon Wicks Football 2027 TX'), {
    originalTitle: '(ENR $99) Zyon Wicks Football 2027 TX',
    cleanTitle: 'Zyon Wicks Football 2027 TX',
    outcome: 'terminal_enrollment',
    revenueCents: 9900,
    prefix: '(ENR $99)',
  });
});

test('(ENR $99 - note) titles parse enrollment amount and clean title', () => {
  assert.deepEqual(parseAppointmentTitleOutcome('(ENR $99 - Post Date) Zyon Wicks Football 2027 TX'), {
    originalTitle: '(ENR $99 - Post Date) Zyon Wicks Football 2027 TX',
    cleanTitle: 'Zyon Wicks Football 2027 TX',
    outcome: 'terminal_enrollment',
    revenueCents: 9900,
    prefix: '(ENR $99 - Post Date)',
  });
});

test('(ENR) title without amount keeps enrollment with null revenue', () => {
  assert.deepEqual(parseAppointmentTitleOutcome('(ENR) Zyon Wicks Football 2027 TX'), {
    originalTitle: '(ENR) Zyon Wicks Football 2027 TX',
    cleanTitle: 'Zyon Wicks Football 2027 TX',
    outcome: 'terminal_enrollment',
    revenueCents: null,
    prefix: '(ENR)',
  });
});

test('(RSP) title parses as reschedule pending with clean title', () => {
  assert.deepEqual(parseAppointmentTitleOutcome("(RSP) Jordan Niles Men's Basketball 2026 NC"), {
    originalTitle: "(RSP) Jordan Niles Men's Basketball 2026 NC",
    cleanTitle: "Jordan Niles Men's Basketball 2026 NC",
    outcome: 'reschedule_pending',
    revenueCents: null,
    prefix: '(RSP)',
  });
});

test('(RSP)*2 title parses as reschedule pending with accidental suffix stripped from clean title', () => {
  assert.deepEqual(parseAppointmentTitleOutcome('(RSP)*2 August Nyakeoga Football 2027 MN'), {
    originalTitle: '(RSP)*2 August Nyakeoga Football 2027 MN',
    cleanTitle: 'August Nyakeoga Football 2027 MN',
    outcome: 'reschedule_pending',
    revenueCents: null,
    prefix: '(RSP)*2',
  });
});

test('known outcome prefixes with accidental *number suffix keep their base meaning', () => {
  assert.deepEqual(parseAppointmentTitleOutcome('(FU)*3 Victor Williams Football 2028 TX'), {
    originalTitle: '(FU)*3 Victor Williams Football 2028 TX',
    cleanTitle: 'Victor Williams Football 2028 TX',
    outcome: 'soft_archive_follow_up',
    revenueCents: null,
    prefix: '(FU)*3',
  });

  assert.deepEqual(parseAppointmentTitleOutcome('(CL)*4 Zyon Wicks Football 2027 TX'), {
    originalTitle: '(CL)*4 Zyon Wicks Football 2027 TX',
    cleanTitle: 'Zyon Wicks Football 2027 TX',
    outcome: 'terminal_close_lost',
    revenueCents: null,
    prefix: '(CL)*4',
  });
});

test('unprefixed title parses as active without revenue', () => {
  assert.deepEqual(parseAppointmentTitleOutcome('Zyon Wicks Football 2027 TX'), {
    originalTitle: 'Zyon Wicks Football 2027 TX',
    cleanTitle: 'Zyon Wicks Football 2027 TX',
    outcome: 'active',
    revenueCents: null,
    prefix: null,
  });
});

test('(CL) titles resolve to terminal close lost', () => {
  assert.equal(
    resolveAppointmentTitleOutcome('(CL) Victor Williams Football 2028 TX'),
    'terminal_close_lost',
  );
});
