/**
 * Periods and comparisons of the analytics scope, stored as definitions and
 * resolved each time they are used, so a saved "last 30 days" stays relative.
 *
 * Everything here is pure: `resolvePeriod` takes the clock, the time zone, the
 * locale and the markers it may anchor on as arguments.
 */

// ── Definitions ──────────────────────────────────────────────────────────────

export type CalendarUnit = 'week' | 'month' | 'quarter' | 'year';

export type PeriodSpec =
  /** The last `days` days, ending now. */
  | { kind: 'rolling'; days: number }
  /** This (`offset: 0`, so far) or a previous calendar unit (`offset: 1` is the last one). */
  | { kind: 'calendar'; unit: CalendarUnit; offset: number }
  /** Two dates, inclusive, in `YYYY-MM-DD`. */
  | { kind: 'range'; from: string; to: string }
  /** From a marker's time to now. */
  | { kind: 'since-marker'; markerId: number }
  /** From one marker's time to another's. */
  | { kind: 'between-markers'; fromMarkerId: number; toMarkerId: number }
  /** Between consecutive `release` markers: 0 is the cycle in progress, 1 the previous one. */
  | { kind: 'release'; offset: number }
  /** A fixed cadence of `lengthDays` days starting on `start`: 0 is the sprint in progress. */
  | { kind: 'sprint'; offset: number; start: string; lengthDays: number }
  /** Everything kept. */
  | { kind: 'all' };

export type ComparisonSpec =
  /** The previous period of the same length, ending where this one starts. */
  | { kind: 'previous' }
  /** The previous calendar unit, release cycle or sprint, when the period is one; else `previous`. */
  | { kind: 'previous-unit' }
  /** The same period a year earlier. */
  | { kind: 'year' }
  /** A range chosen by hand. */
  | { kind: 'range'; from: string; to: string }
  | { kind: 'none' };

export type Granularity = 'auto' | 'day' | 'week' | 'month';

export const GRANULARITIES: Granularity[] = ['auto', 'day', 'week', 'month'];

/** "All time" is a ten-year window, so the bucket math needs no special case. */
export const ALL_TIME_DAYS = 3650;

export const DEFAULT_PERIOD: PeriodSpec = { kind: 'rolling', days: 30 };
export const DEFAULT_COMPARISON: ComparisonSpec = { kind: 'previous' };

// ── Resolution ───────────────────────────────────────────────────────────────

export interface PeriodMarker {
  id: number;
  label: string;
  category: string;
  occurredAt: Date | string | number;
}

export interface ResolveContext {
  now: number;
  /** IANA time zone for calendar boundaries; `UTC` when unknown. */
  timeZone: string;
  /** BCP-47 locale, for the first day of the week. */
  locale?: string;
  /** Markers the period may anchor on (for release cycles: every release marker in scope). */
  markers?: PeriodMarker[];
}

export interface ResolvedPeriod {
  /** Inclusive start instant. */
  from: Date;
  /** Exclusive end instant. */
  to: Date;
  label: string;
  /** Set when the definition could not be resolved (a deleted marker) and a default was used. */
  fallback?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Resolve a period definition to two instants. Never throws. */
export function resolvePeriod(spec: PeriodSpec, ctx: ResolveContext): ResolvedPeriod {
  const now = new Date(ctx.now);
  switch (spec.kind) {
    case 'rolling': {
      const days = clampDays(spec.days);
      if (days >= ALL_TIME_DAYS) return { from: utcDaysBack(ctx.now, ALL_TIME_DAYS), to: now, label: 'All time' };
      return { from: utcDaysBack(ctx.now, days), to: now, label: `Last ${days} days` };
    }
    case 'all':
      return { from: utcDaysBack(ctx.now, ALL_TIME_DAYS), to: now, label: 'All time' };
    case 'calendar': {
      const { from, to } = calendarBounds(spec.unit, spec.offset, ctx);
      return { from, to: spec.offset === 0 ? now : to, label: calendarLabel(spec.unit, spec.offset) };
    }
    case 'range': {
      const from = zonedMidnight(spec.from, ctx.timeZone);
      const to = zonedMidnight(addDays(spec.to, 1), ctx.timeZone);
      if (!from || !to || to <= from) return fallback(ctx, 'The date range is invalid.');
      return { from, to, label: `${spec.from} to ${spec.to}` };
    }
    case 'since-marker': {
      const marker = ctx.markers?.find((m) => m.id === spec.markerId);
      if (!marker) return fallback(ctx, 'The marker this period starts from no longer exists.');
      return { from: new Date(marker.occurredAt), to: now, label: `Since ${marker.label}` };
    }
    case 'between-markers': {
      const a = ctx.markers?.find((m) => m.id === spec.fromMarkerId);
      const b = ctx.markers?.find((m) => m.id === spec.toMarkerId);
      if (!a || !b) return fallback(ctx, 'A marker this period is anchored on no longer exists.');
      const [first, second] = new Date(a.occurredAt) <= new Date(b.occurredAt) ? [a, b] : [b, a];
      return {
        from: new Date(first.occurredAt),
        to: new Date(second.occurredAt),
        label: `${first.label} to ${second.label}`,
      };
    }
    case 'release': {
      const releases = (ctx.markers ?? [])
        .filter((m) => m.category === 'release' && new Date(m.occurredAt).getTime() <= ctx.now)
        .sort((x, y) => new Date(y.occurredAt).getTime() - new Date(x.occurredAt).getTime());
      const start = releases[spec.offset];
      if (!start) return fallback(ctx, 'There are not enough release markers for this release cycle.');
      const end = spec.offset === 0 ? now : new Date(releases[spec.offset - 1]!.occurredAt);
      return {
        from: new Date(start.occurredAt),
        to: end,
        label: spec.offset === 0 ? `Since ${start.label}` : `${start.label} to ${releases[spec.offset - 1]!.label}`,
      };
    }
    case 'sprint': {
      const start = zonedMidnight(spec.start, ctx.timeZone);
      const length = Math.max(1, Math.round(spec.lengthDays));
      if (!start) return fallback(ctx, 'The sprint start date is invalid.');
      const elapsed = Math.floor((ctx.now - start.getTime()) / (length * DAY_MS));
      const index = elapsed - spec.offset;
      const fromDay = addDays(spec.start, index * length);
      const from = zonedMidnight(fromDay, ctx.timeZone)!;
      const to = zonedMidnight(addDays(fromDay, length), ctx.timeZone)!;
      return {
        from,
        to: spec.offset === 0 && to.getTime() > ctx.now ? now : to,
        label: spec.offset === 0 ? 'This sprint' : spec.offset === 1 ? 'Last sprint' : `${spec.offset} sprints ago`,
      };
    }
  }
}

/**
 * UTC midnight starting the last `days` UTC days, today included: rolling
 * periods cover whole UTC days, the unit the daily rollups are kept in.
 */
function utcDaysBack(now: number, days: number): Date {
  const today = new Date(now);
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1)));
}

function fallback(ctx: ResolveContext, reason: string): ResolvedPeriod {
  const resolved = resolvePeriod(DEFAULT_PERIOD, ctx);
  return { ...resolved, fallback: reason };
}

/**
 * The reference period a change is measured against, or null for none.
 * `previous-unit` steps the calendar unit, release cycle or sprint back by
 * one, and falls back to the previous period of the same length otherwise.
 */
export function resolveComparison(
  comparison: ComparisonSpec,
  period: PeriodSpec,
  resolved: ResolvedPeriod,
  ctx: ResolveContext,
): ResolvedPeriod | null {
  const length = resolved.to.getTime() - resolved.from.getTime();
  switch (comparison.kind) {
    case 'none':
      return null;
    case 'year': {
      const from = shiftYears(resolved.from, -1);
      const to = shiftYears(resolved.to, -1);
      return { from, to, label: 'The same period a year earlier' };
    }
    case 'range': {
      const r = resolvePeriod({ kind: 'range', from: comparison.from, to: comparison.to }, ctx);
      return r.fallback ? null : r;
    }
    case 'previous-unit': {
      if (period.kind === 'calendar' || period.kind === 'release' || period.kind === 'sprint') {
        const previous = resolvePeriod({ ...period, offset: period.offset + 1 }, ctx);
        if (!previous.fallback) {
          // A period in progress compares with the same elapsed span of the previous unit.
          if (period.offset === 0) {
            const to = new Date(Math.min(previous.to.getTime(), previous.from.getTime() + length));
            return { ...previous, to };
          }
          return previous;
        }
      }
      return previousOfSameLength(resolved);
    }
    case 'previous':
      return previousOfSameLength(resolved);
  }
}

/** The previous period of the same length in whole days, ending where this one starts. */
function previousOfSameLength(resolved: ResolvedPeriod): ResolvedPeriod {
  const days = Math.max(1, Math.ceil((resolved.to.getTime() - resolved.from.getTime()) / DAY_MS));
  return {
    from: new Date(resolved.from.getTime() - days * DAY_MS),
    to: resolved.from,
    label: 'The previous period',
  };
}

// ── Encoding (compact URL form) ──────────────────────────────────────────────

const CALENDAR_UNITS: CalendarUnit[] = ['week', 'month', 'quarter', 'year'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Compact, URL-safe form of a period:
 * `last-30d`, `this-month`, `last-quarter`, `2026-08-01..2026-08-31`,
 * `since-marker-12`, `markers-12..15`, `release-0`, `release-1`,
 * `sprint-0@2026-09-01/14d`, `all`.
 */
export function encodePeriod(spec: PeriodSpec): string {
  switch (spec.kind) {
    case 'rolling':
      return `last-${clampDays(spec.days)}d`;
    case 'all':
      return 'all';
    case 'calendar':
      if (spec.offset === 0) return `this-${spec.unit}`;
      if (spec.offset === 1) return `last-${spec.unit}`;
      return `${spec.unit}-${spec.offset}`;
    case 'range':
      return `${spec.from}..${spec.to}`;
    case 'since-marker':
      return `since-marker-${spec.markerId}`;
    case 'between-markers':
      return `markers-${spec.fromMarkerId}..${spec.toMarkerId}`;
    case 'release':
      return `release-${spec.offset}`;
    case 'sprint':
      return `sprint-${spec.offset}@${spec.start}/${spec.lengthDays}d`;
  }
}

/** Parse the compact form; null when the text is not a period. */
export function parsePeriod(raw: string | null | undefined): PeriodSpec | null {
  if (!raw) return null;
  const text = raw.trim();
  if (text === 'all') return { kind: 'all' };
  let m = /^last-(\d{1,4})d$/.exec(text);
  if (m) return { kind: 'rolling', days: clampDays(Number(m[1])) };
  m = /^(this|last)-(week|month|quarter|year)$/.exec(text);
  if (m) return { kind: 'calendar', unit: m[2] as CalendarUnit, offset: m[1] === 'this' ? 0 : 1 };
  m = /^(week|month|quarter|year)-(\d{1,3})$/.exec(text);
  if (m && CALENDAR_UNITS.includes(m[1] as CalendarUnit))
    return { kind: 'calendar', unit: m[1] as CalendarUnit, offset: Number(m[2]) };
  m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (m && isValidDay(m[1]!) && isValidDay(m[2]!)) {
    const [from, to] = m[1]! <= m[2]! ? [m[1]!, m[2]!] : [m[2]!, m[1]!];
    return { kind: 'range', from, to };
  }
  m = /^since-marker-(\d+)$/.exec(text);
  if (m) return { kind: 'since-marker', markerId: Number(m[1]) };
  m = /^markers-(\d+)\.\.(\d+)$/.exec(text);
  if (m) return { kind: 'between-markers', fromMarkerId: Number(m[1]), toMarkerId: Number(m[2]) };
  m = /^release-(\d{1,3})$/.exec(text);
  if (m) return { kind: 'release', offset: Number(m[1]) };
  m = /^sprint-(\d{1,3})@(\d{4}-\d{2}-\d{2})\/(\d{1,3})d$/.exec(text);
  if (m && isValidDay(m[2]!) && Number(m[3]) > 0)
    return { kind: 'sprint', offset: Number(m[1]), start: m[2]!, lengthDays: Number(m[3]) };
  return null;
}

/** Compact form of a comparison: `previous`, `previous-unit`, `year`, `none`, `YYYY-MM-DD..YYYY-MM-DD`. */
export function encodeComparison(spec: ComparisonSpec): string {
  return spec.kind === 'range' ? `${spec.from}..${spec.to}` : spec.kind;
}

export function parseComparison(raw: string | null | undefined): ComparisonSpec | null {
  if (!raw) return null;
  const text = raw.trim();
  if (text === 'previous' || text === 'previous-unit' || text === 'year' || text === 'none') return { kind: text };
  const range = parsePeriod(text);
  if (range?.kind === 'range') return { kind: 'range', from: range.from, to: range.to };
  return null;
}

export function parseGranularity(raw: string | null | undefined): Granularity | null {
  return raw && (GRANULARITIES as string[]).includes(raw) ? (raw as Granularity) : null;
}

/** The rolling period a legacy `days` value stands for (3650 is All time). */
export function periodFromDays(days: number): PeriodSpec {
  const clamped = clampDays(days);
  return clamped >= ALL_TIME_DAYS ? { kind: 'all' } : { kind: 'rolling', days: clamped };
}

/** The length in whole days a resolved period spans, at least one. */
export function periodDays(resolved: ResolvedPeriod): number {
  return Math.max(1, Math.ceil((resolved.to.getTime() - resolved.from.getTime()) / DAY_MS));
}

function clampDays(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 30;
  return Math.min(ALL_TIME_DAYS, Math.round(days));
}

// ── Calendar arithmetic in a time zone ───────────────────────────────────────

function isValidDay(day: string): boolean {
  if (!ISO_DAY.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/** `YYYY-MM-DD` plus `n` calendar days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** Local calendar date (`YYYY-MM-DD`) of an instant in a time zone. */
export function zonedDay(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Offset of a time zone from UTC at an instant, in ms (positive east of UTC). */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant local midnight of `day` happens in a time zone (DST-safe). */
export function zonedMidnight(day: string, timeZone: string): Date | null {
  if (!isValidDay(day)) return null;
  const zone = safeTimeZone(timeZone);
  const guess = new Date(`${day}T00:00:00Z`).getTime();
  let instant = guess - zoneOffset(guess, zone);
  // A second pass settles a midnight on the far side of a DST change.
  instant = guess - zoneOffset(instant, zone);
  return new Date(instant);
}

/** First day of the week for a locale: 1 = Monday … 7 = Sunday; Monday when unknown. */
export function firstDayOfWeek(locale?: string): number {
  if (!locale) return 1;
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    return firstDay && firstDay >= 1 && firstDay <= 7 ? firstDay : 1;
  } catch {
    return 1;
  }
}

function calendarBounds(unit: CalendarUnit, offset: number, ctx: ResolveContext): { from: Date; to: Date } {
  const today = zonedDay(ctx.now, ctx.timeZone);
  const [y, m] = today.split('-').map(Number) as [number, number];
  let startDay: string;
  let endDay: string;
  if (unit === 'week') {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7; // 1 = Monday … 7 = Sunday
    const back = (weekday - firstDayOfWeek(ctx.locale) + 7) % 7;
    startDay = addDays(today, -back - offset * 7);
    endDay = addDays(startDay, 7);
  } else {
    const months = unit === 'month' ? 1 : unit === 'quarter' ? 3 : 12;
    const firstMonth = unit === 'month' ? m : unit === 'quarter' ? Math.floor((m - 1) / 3) * 3 + 1 : 1;
    const start = new Date(Date.UTC(y, firstMonth - 1 - offset * months, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
    startDay = start.toISOString().slice(0, 10);
    endDay = end.toISOString().slice(0, 10);
  }
  return { from: zonedMidnight(startDay, ctx.timeZone)!, to: zonedMidnight(endDay, ctx.timeZone)! };
}

function calendarLabel(unit: CalendarUnit, offset: number): string {
  if (offset === 0) return `This ${unit}`;
  if (offset === 1) return `Last ${unit}`;
  return `${offset} ${unit}s ago`;
}

function shiftYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}
