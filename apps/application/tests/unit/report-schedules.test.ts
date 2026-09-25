import { describe, expect, it } from 'vitest';
import {
  lastCompletePeriod,
  latestDueRun,
  nextRunAt,
  periodFor,
  reportDedupeKey,
  scheduleTimeZone,
  zonedInstant,
  type ScheduleTiming,
} from '#shared/reports/schedule';

const created = Date.parse('2026-01-01T00:00:00Z');
const weeklyMonday: ScheduleTiming = { cadence: 'weekly', anchor: 1, at: '08:00', createdAt: created };

describe('scheduleTimeZone', () => {
  it('runs in UTC when the instance zone is left to the browser', () => {
    expect(scheduleTimeZone('auto')).toBe('UTC');
    expect(scheduleTimeZone(null)).toBe('UTC');
    expect(scheduleTimeZone('Not/AZone')).toBe('UTC');
    expect(scheduleTimeZone('Europe/Paris')).toBe('Europe/Paris');
  });
});

describe('zonedInstant', () => {
  it('reads a wall-clock time in a zone on either side of a DST change', () => {
    // Paris is UTC+1 in winter and UTC+2 in summer; the clocks go forward on 2026-03-29.
    expect(zonedInstant('2026-03-28', '08:00', 'Europe/Paris').toISOString()).toBe('2026-03-28T07:00:00.000Z');
    expect(zonedInstant('2026-03-29', '08:00', 'Europe/Paris').toISOString()).toBe('2026-03-29T06:00:00.000Z');
    expect(zonedInstant('2026-10-25', '08:00', 'Europe/Paris').toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });

  it('moves a skipped time past the change and keeps the first of a repeated one', () => {
    // 02:30 does not exist in Paris on 2026-03-29: it fires at 03:30 local.
    expect(zonedInstant('2026-03-29', '02:30', 'Europe/Paris').toISOString()).toBe('2026-03-29T01:30:00.000Z');
    // 02:30 happens twice on 2026-10-25: the summer-time one comes first.
    expect(zonedInstant('2026-10-25', '02:30', 'Europe/Paris').toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });
});

describe('nextRunAt', () => {
  it('fires daily at the local time', () => {
    const timing: ScheduleTiming = { cadence: 'daily', anchor: null, at: '09:30', createdAt: created };
    expect(nextRunAt(timing, Date.parse('2026-06-10T07:00:00Z'), 'UTC').toISOString()).toBe('2026-06-10T09:30:00.000Z');
    expect(nextRunAt(timing, Date.parse('2026-06-10T09:30:00Z'), 'UTC').toISOString()).toBe('2026-06-11T09:30:00.000Z');
  });

  it('keeps the local time across the spring and autumn DST changes', () => {
    // Monday 2026-03-23 is winter time, Monday 2026-03-30 summer time.
    const first = nextRunAt(weeklyMonday, Date.parse('2026-03-23T12:00:00Z'), 'Europe/Paris');
    expect(first.toISOString()).toBe('2026-03-30T06:00:00.000Z');
    const autumn = nextRunAt(weeklyMonday, Date.parse('2026-10-20T12:00:00Z'), 'Europe/Paris');
    expect(autumn.toISOString()).toBe('2026-10-26T07:00:00.000Z');
    // New York changes on 2026-03-08: 08:00 EST is 13:00Z, 08:00 EDT is 12:00Z.
    const daily: ScheduleTiming = { cadence: 'daily', anchor: null, at: '08:00', createdAt: created };
    expect(nextRunAt(daily, Date.parse('2026-03-07T14:00:00Z'), 'America/New_York').toISOString()).toBe(
      '2026-03-08T12:00:00.000Z',
    );
  });

  it('fires on a late local evening that is already the next day in UTC', () => {
    const timing: ScheduleTiming = { cadence: 'weekly', anchor: 5, at: '23:30', createdAt: created };
    // Friday 23:30 in Los Angeles is Saturday 06:30 UTC.
    expect(nextRunAt(timing, Date.parse('2026-06-12T12:00:00Z'), 'America/Los_Angeles').toISOString()).toBe(
      '2026-06-13T06:30:00.000Z',
    );
  });

  it('alternates weeks from the first firing after creation for a biweekly schedule', () => {
    const timing: ScheduleTiming = {
      cadence: 'biweekly',
      anchor: 1,
      at: '08:00',
      createdAt: Date.parse('2026-06-03T10:00:00Z'), // a Wednesday
    };
    const first = nextRunAt(timing, Date.parse('2026-06-03T10:00:00Z'), 'UTC');
    expect(first.toISOString()).toBe('2026-06-08T08:00:00.000Z');
    const second = nextRunAt(timing, first.getTime(), 'UTC');
    expect(second.toISOString()).toBe('2026-06-22T08:00:00.000Z');
    // Asked from the off week, it still lands on the fortnight.
    expect(nextRunAt(timing, Date.parse('2026-06-15T12:00:00Z'), 'UTC').toISOString()).toBe('2026-06-22T08:00:00.000Z');
  });

  it('fires monthly on the anchor day, the next month once it has passed', () => {
    const timing: ScheduleTiming = { cadence: 'monthly', anchor: 1, at: '07:00', createdAt: created };
    expect(nextRunAt(timing, Date.parse('2026-01-15T00:00:00Z'), 'UTC').toISOString()).toBe('2026-02-01T07:00:00.000Z');
    expect(nextRunAt(timing, Date.parse('2026-12-01T08:00:00Z'), 'UTC').toISOString()).toBe('2027-01-01T07:00:00.000Z');
  });
});

describe('periodFor', () => {
  it('reports the whole days since the previous firing, up to the day before', () => {
    const runAt = zonedInstant('2026-09-21', '08:00', 'Europe/Paris').getTime();
    expect(periodFor(weeklyMonday, runAt, 'Europe/Paris')).toEqual({
      from: '2026-09-14',
      to: '2026-09-20',
      firstRun: false,
    });
    const monthly: ScheduleTiming = { cadence: 'monthly', anchor: 1, at: '07:00', createdAt: created };
    expect(periodFor(monthly, Date.parse('2026-03-01T07:00:00Z'), 'UTC')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      firstRun: false,
    });
  });

  it('covers a week of seven local days across a DST change', () => {
    const runAt = zonedInstant('2026-03-30', '08:00', 'Europe/Paris').getTime();
    expect(periodFor(weeklyMonday, runAt, 'Europe/Paris')).toEqual({
      from: '2026-03-23',
      to: '2026-03-29',
      firstRun: false,
    });
  });

  it('covers only the days since creation on the first firing', () => {
    const timing: ScheduleTiming = { ...weeklyMonday, createdAt: Date.parse('2026-09-16T15:00:00Z') };
    const first = nextRunAt(timing, timing.createdAt as number, 'UTC');
    expect(first.toISOString()).toBe('2026-09-21T08:00:00.000Z');
    expect(periodFor(timing, first.getTime(), 'UTC')).toEqual({
      from: '2026-09-16',
      to: '2026-09-20',
      firstRun: true,
    });
  });

  it('reports the whole cadence when the schedule was created on the day it first fires', () => {
    const timing: ScheduleTiming = {
      cadence: 'daily',
      anchor: null,
      at: '08:00',
      createdAt: Date.parse('2026-09-21T06:00:00Z'),
    };
    expect(periodFor(timing, Date.parse('2026-09-21T08:00:00Z'), 'UTC')).toEqual({
      from: '2026-09-20',
      to: '2026-09-20',
      firstRun: false,
    });
  });
});

describe('missed firings', () => {
  it('reports the intended period of the latest missed firing, not the days before now', () => {
    const daily: ScheduleTiming = { cadence: 'daily', anchor: null, at: '08:00', createdAt: created };
    const nextRun = Date.parse('2026-09-20T08:00:00Z');
    // The server was down from the 20th to the 22nd at 09:00.
    const now = Date.parse('2026-09-22T09:00:00Z');
    const due = latestDueRun(daily, nextRun, now, 'UTC');
    expect(due.toISOString()).toBe('2026-09-22T08:00:00.000Z');
    expect(periodFor(daily, due.getTime(), 'UTC')).toEqual({ from: '2026-09-21', to: '2026-09-21', firstRun: false });
    expect(nextRunAt(daily, due.getTime(), 'UTC').toISOString()).toBe('2026-09-23T08:00:00.000Z');
  });

  it('fires a weekly schedule on the sweep after its tick, for the week it was due', () => {
    const nextRun = Date.parse('2026-09-21T08:00:00Z');
    const due = latestDueRun(weeklyMonday, nextRun, Date.parse('2026-09-21T08:04:00Z'), 'UTC');
    expect(due.getTime()).toBe(nextRun);
    expect(periodFor(weeklyMonday, due.getTime(), 'UTC').from).toBe('2026-09-14');
  });
});

describe('lastCompletePeriod', () => {
  it('is the cadence the latest firing covered', () => {
    expect(lastCompletePeriod(weeklyMonday, Date.parse('2026-09-24T12:00:00Z'), 'UTC')).toEqual({
      from: '2026-09-14',
      to: '2026-09-20',
      firstRun: false,
    });
  });
});

describe('reportDedupeKey', () => {
  it('keys a delivery by schedule, period end and channel', () => {
    expect(reportDedupeKey(4, '2026-09-20', 7)).toBe('report:4:2026-09-20:7');
    expect(reportDedupeKey(4, '2026-09-20', 7, 31)).toBe('report:4:2026-09-20:7:run-31');
  });
});

describe('describeCadence', () => {
  it('says when a schedule fires', async () => {
    const { describeCadence } = await import('#shared/reports/schedule');
    expect(describeCadence({ cadence: 'weekly', anchor: 1, at: '8:00' })).toBe('Weekly on Monday at 08:00');
    expect(describeCadence({ cadence: 'biweekly', anchor: 5, at: '17:30' })).toBe('Every other Friday at 17:30');
    expect(describeCadence({ cadence: 'monthly', anchor: 2, at: '07:00' })).toBe('Monthly on the 2nd at 07:00');
    expect(describeCadence({ cadence: 'daily', anchor: null, at: '06:15' })).toBe('Daily at 06:15');
  });
});
