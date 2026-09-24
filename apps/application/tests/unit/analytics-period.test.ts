import { describe, test, expect } from 'vitest';
import {
  encodeComparison,
  encodePeriod,
  firstDayOfWeek,
  parseComparison,
  parsePeriod,
  resolveComparison,
  resolvePeriod,
  zonedMidnight,
  type ComparisonSpec,
  type PeriodSpec,
} from '../../shared/analytics/period';

const iso = (d: Date) => d.toISOString();
// Wednesday 2026-09-23, 15:00 UTC.
const NOW = Date.parse('2026-09-23T15:00:00Z');
const UTC = { now: NOW, timeZone: 'UTC' };

describe('encodePeriod and parsePeriod', () => {
  const specs: PeriodSpec[] = [
    { kind: 'rolling', days: 30 },
    { kind: 'rolling', days: 7 },
    { kind: 'calendar', unit: 'week', offset: 0 },
    { kind: 'calendar', unit: 'month', offset: 1 },
    { kind: 'calendar', unit: 'quarter', offset: 3 },
    { kind: 'calendar', unit: 'year', offset: 0 },
    { kind: 'range', from: '2026-08-01', to: '2026-08-31' },
    { kind: 'since-marker', markerId: 12 },
    { kind: 'between-markers', fromMarkerId: 12, toMarkerId: 15 },
    { kind: 'release', offset: 0 },
    { kind: 'release', offset: 1 },
    { kind: 'sprint', offset: 1, start: '2026-09-01', lengthDays: 14 },
    { kind: 'all' },
  ];
  test.each(specs.map((s) => [encodePeriod(s), s]))('%s round-trips', (encoded, spec) => {
    expect(parsePeriod(encoded)).toEqual(spec);
  });

  test('rejects text that is not a period, and an impossible date', () => {
    expect(parsePeriod('yesterday')).toBeNull();
    expect(parsePeriod('2026-02-30..2026-03-01')).toBeNull();
    expect(parsePeriod('')).toBeNull();
  });

  test('orders a reversed range', () => {
    expect(parsePeriod('2026-08-31..2026-08-01')).toEqual({ kind: 'range', from: '2026-08-01', to: '2026-08-31' });
  });

  test('comparisons round-trip', () => {
    const comparisons: ComparisonSpec[] = [
      { kind: 'previous' },
      { kind: 'previous-unit' },
      { kind: 'year' },
      { kind: 'none' },
      { kind: 'range', from: '2026-07-01', to: '2026-07-31' },
    ];
    for (const c of comparisons) expect(parseComparison(encodeComparison(c))).toEqual(c);
  });
});

describe('resolvePeriod', () => {
  test('a rolling period covers whole UTC days, today included', () => {
    const p = resolvePeriod({ kind: 'rolling', days: 7 }, UTC);
    expect(iso(p.from)).toBe('2026-09-17T00:00:00.000Z');
    expect(p.to.getTime()).toBe(NOW);
    expect(p.label).toBe('Last 7 days');
  });

  test('calendar units start on their boundary, so far for this one', () => {
    const month = resolvePeriod({ kind: 'calendar', unit: 'month', offset: 0 }, UTC);
    expect(iso(month.from)).toBe('2026-09-01T00:00:00.000Z');
    expect(month.to.getTime()).toBe(NOW);

    const lastMonth = resolvePeriod({ kind: 'calendar', unit: 'month', offset: 1 }, UTC);
    expect(iso(lastMonth.from)).toBe('2026-08-01T00:00:00.000Z');
    expect(iso(lastMonth.to)).toBe('2026-09-01T00:00:00.000Z');

    const quarter = resolvePeriod({ kind: 'calendar', unit: 'quarter', offset: 1 }, UTC);
    expect(iso(quarter.from)).toBe('2026-04-01T00:00:00.000Z');
    expect(iso(quarter.to)).toBe('2026-07-01T00:00:00.000Z');

    const lastYear = resolvePeriod({ kind: 'calendar', unit: 'year', offset: 1 }, UTC);
    expect(iso(lastYear.from)).toBe('2025-01-01T00:00:00.000Z');
    expect(iso(lastYear.to)).toBe('2026-01-01T00:00:00.000Z');
  });

  test('a month back across a year end and February in a leap year', () => {
    const jan = Date.parse('2024-01-15T12:00:00Z');
    const dec = resolvePeriod({ kind: 'calendar', unit: 'month', offset: 1 }, { now: jan, timeZone: 'UTC' });
    expect(iso(dec.from)).toBe('2023-12-01T00:00:00.000Z');
    const mar = Date.parse('2024-03-10T12:00:00Z');
    const feb = resolvePeriod({ kind: 'calendar', unit: 'month', offset: 1 }, { now: mar, timeZone: 'UTC' });
    expect(feb.to.getTime() - feb.from.getTime()).toBe(29 * 24 * 60 * 60 * 1000);
  });

  test('the week starts on the locale’s first day, Monday when unknown', () => {
    expect(firstDayOfWeek(undefined)).toBe(1);
    expect(firstDayOfWeek('fr-FR')).toBe(1);
    const monday = resolvePeriod({ kind: 'calendar', unit: 'week', offset: 0 }, { ...UTC, locale: 'fr-FR' });
    expect(iso(monday.from)).toBe('2026-09-21T00:00:00.000Z');
    // en-US weeks start on Sunday where the runtime knows it.
    if (firstDayOfWeek('en-US') === 7) {
      const sunday = resolvePeriod({ kind: 'calendar', unit: 'week', offset: 0 }, { ...UTC, locale: 'en-US' });
      expect(iso(sunday.from)).toBe('2026-09-20T00:00:00.000Z');
    }
  });

  test('calendar boundaries follow the time zone, across a DST change', () => {
    const paris = resolvePeriod({ kind: 'calendar', unit: 'month', offset: 0 }, { now: NOW, timeZone: 'Europe/Paris' });
    expect(iso(paris.from)).toBe('2026-08-31T22:00:00.000Z');
    // October 2026 starts in summer time and ends in winter time in Paris.
    const nov = Date.parse('2026-11-10T12:00:00Z');
    const oct = resolvePeriod({ kind: 'calendar', unit: 'month', offset: 1 }, { now: nov, timeZone: 'Europe/Paris' });
    expect(iso(oct.from)).toBe('2026-09-30T22:00:00.000Z');
    expect(iso(oct.to)).toBe('2026-10-31T23:00:00.000Z');
    expect(iso(zonedMidnight('2026-03-29', 'Europe/Paris')!)).toBe('2026-03-28T23:00:00.000Z');
  });

  test('a custom range is inclusive of both dates', () => {
    const p = resolvePeriod({ kind: 'range', from: '2026-08-01', to: '2026-08-31' }, UTC);
    expect(iso(p.from)).toBe('2026-08-01T00:00:00.000Z');
    expect(iso(p.to)).toBe('2026-09-01T00:00:00.000Z');
  });

  const markers = [
    { id: 1, label: 'Release 2.3', category: 'release', occurredAt: '2026-08-10T09:00:00Z' },
    { id: 2, label: 'Migrated runners', category: 'infra', occurredAt: '2026-08-20T09:00:00Z' },
    { id: 3, label: 'Release 2.4', category: 'release', occurredAt: '2026-09-05T09:00:00Z' },
  ];

  test('marker periods and release cycles', () => {
    const since = resolvePeriod({ kind: 'since-marker', markerId: 2 }, { ...UTC, markers });
    expect(iso(since.from)).toBe('2026-08-20T09:00:00.000Z');
    expect(since.label).toBe('Since Migrated runners');

    const between = resolvePeriod({ kind: 'between-markers', fromMarkerId: 3, toMarkerId: 1 }, { ...UTC, markers });
    expect(iso(between.from)).toBe('2026-08-10T09:00:00.000Z');
    expect(iso(between.to)).toBe('2026-09-05T09:00:00.000Z');

    const current = resolvePeriod({ kind: 'release', offset: 0 }, { ...UTC, markers });
    expect(iso(current.from)).toBe('2026-09-05T09:00:00.000Z');
    expect(current.to.getTime()).toBe(NOW);
    const previous = resolvePeriod({ kind: 'release', offset: 1 }, { ...UTC, markers });
    expect(iso(previous.from)).toBe('2026-08-10T09:00:00.000Z');
    expect(iso(previous.to)).toBe('2026-09-05T09:00:00.000Z');
  });

  test('a deleted marker falls back to the default period and says why', () => {
    const p = resolvePeriod({ kind: 'since-marker', markerId: 99 }, { ...UTC, markers });
    expect(p.fallback).toMatch(/no longer exists/);
    expect(p.label).toBe('Last 30 days');
  });

  test('sprints step by their cadence', () => {
    const sprint = { kind: 'sprint' as const, start: '2026-09-01', lengthDays: 14 };
    const current = resolvePeriod({ ...sprint, offset: 0 }, UTC);
    expect(iso(current.from)).toBe('2026-09-15T00:00:00.000Z');
    expect(current.to.getTime()).toBe(NOW);
    const last = resolvePeriod({ ...sprint, offset: 1 }, UTC);
    expect(iso(last.from)).toBe('2026-09-01T00:00:00.000Z');
    expect(iso(last.to)).toBe('2026-09-15T00:00:00.000Z');
  });
});

describe('resolveComparison', () => {
  test('previous is the same number of whole days, ending where the period starts', () => {
    const spec: PeriodSpec = { kind: 'rolling', days: 30 };
    const period = resolvePeriod(spec, UTC);
    const c = resolveComparison({ kind: 'previous' }, spec, period, UTC)!;
    expect(iso(c.to)).toBe(iso(period.from));
    expect(c.to.getTime() - c.from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test('previous-unit compares a month so far with the same elapsed span of the last month', () => {
    const spec: PeriodSpec = { kind: 'calendar', unit: 'month', offset: 0 };
    const period = resolvePeriod(spec, UTC);
    const c = resolveComparison({ kind: 'previous-unit' }, spec, period, UTC)!;
    expect(iso(c.from)).toBe('2026-08-01T00:00:00.000Z');
    expect(c.to.getTime() - c.from.getTime()).toBe(period.to.getTime() - period.from.getTime());
  });

  test('a full previous unit, a year earlier, and none', () => {
    const spec: PeriodSpec = { kind: 'calendar', unit: 'month', offset: 1 };
    const period = resolvePeriod(spec, UTC);
    const unit = resolveComparison({ kind: 'previous-unit' }, spec, period, UTC)!;
    expect(iso(unit.from)).toBe('2026-07-01T00:00:00.000Z');
    expect(iso(unit.to)).toBe('2026-08-01T00:00:00.000Z');
    const year = resolveComparison({ kind: 'year' }, spec, period, UTC)!;
    expect(iso(year.from)).toBe('2025-08-01T00:00:00.000Z');
    expect(resolveComparison({ kind: 'none' }, spec, period, UTC)).toBeNull();
  });
});
