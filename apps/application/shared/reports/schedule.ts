/**
 * The clock of a report schedule: when it next fires and which period each
 * firing reports on. Pure, so the server task, the demo and the unit tests
 * compute the same instants.
 *
 * A schedule fires at `at` (`HH:mm`) in the instance time zone, on its anchor:
 * every day, a weekday every week or every other week, or a day of the month.
 * Each firing reports on the whole days since the previous scheduled firing,
 * up to the day before this one, in that time zone: a weekly Monday schedule
 * reports on the week from the previous Monday to Sunday.
 */
import { addDays, zonedDay } from '#shared/analytics/period';

export const REPORT_CADENCES = ['daily', 'weekly', 'biweekly', 'monthly'] as const;
export type ReportCadence = (typeof REPORT_CADENCES)[number];

export const SCHEDULE_COMPARISONS = ['previous', 'year-ago', 'none'] as const;
export type ScheduleComparison = (typeof SCHEDULE_COMPARISONS)[number];

/** The last day of the month a monthly schedule can anchor on, so every month has it. */
export const MONTHLY_ANCHOR_MAX = 28;

export interface ScheduleTiming {
  cadence: ReportCadence;
  /** Weekday 1 (Monday) to 7 (Sunday) for weekly and biweekly; day of month 1 to 28 for monthly. */
  anchor: number | null;
  /** `HH:mm`, in the schedule's time zone. */
  at: string;
  /** Biweekly schedules count their fortnights from the first firing after creation. */
  createdAt: Date | number;
}

const AT_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const MAX_STEPS = 1000;

export function isValidScheduleTime(at: string): boolean {
  return AT_PATTERN.test(at);
}

/** Normalize `8:05` to `08:05`. */
export function normalizeScheduleTime(at: string): string {
  const m = AT_PATTERN.exec(at.trim());
  if (!m) return '08:00';
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

/**
 * The time zone schedules run in: the instance time zone, or UTC when the
 * instance leaves it to each viewer's browser (`auto`), since a server task
 * has no browser.
 */
export function scheduleTimeZone(instanceTimeZone: string | null | undefined): string {
  if (!instanceTimeZone || instanceTimeZone === 'auto') return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: instanceTimeZone });
    return instanceTimeZone;
  } catch {
    return 'UTC';
  }
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

/**
 * The instant a wall-clock time happens on a local day in a time zone. A time
 * the clocks skip (02:30 on a spring-forward night) resolves to the same
 * distance past the change (03:30); a time that happens twice resolves to the
 * first.
 */
export function zonedInstant(day: string, at: string, timeZone: string): Date {
  const [h, m] = normalizeScheduleTime(at).split(':').map(Number) as [number, number];
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, m);
  const before = guess - zoneOffset(guess - 12 * 3600_000, timeZone);
  const after = guess - zoneOffset(guess + 12 * 3600_000, timeZone);
  // Both offsets agree away from a change; around one, keep the reading whose
  // local time is the one asked for, or the later one inside a skipped hour.
  if (before === after) return new Date(before);
  const matches = (instant: number) => instant + zoneOffset(instant, timeZone) === guess;
  if (matches(before)) return new Date(before);
  if (matches(after)) return new Date(after);
  return new Date(Math.max(before, after));
}

function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
}

function addMonths(day: string, months: number, dayOfMonth: number): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + months, dayOfMonth));
  return d.toISOString().slice(0, 10);
}

function anchorOf(timing: ScheduleTiming): number {
  if (timing.cadence === 'monthly') return Math.min(MONTHLY_ANCHOR_MAX, Math.max(1, timing.anchor ?? 1));
  return Math.min(7, Math.max(1, timing.anchor ?? 1));
}

/** The scheduled local days in order, starting at the first one on or after `fromDay`. */
function* scheduledDays(timing: ScheduleTiming, fromDay: string, timeZone: string): Generator<string> {
  const anchor = anchorOf(timing);
  if (timing.cadence === 'daily') {
    for (let day = fromDay, i = 0; i < MAX_STEPS; i++, day = addDays(day, 1)) yield day;
    return;
  }
  if (timing.cadence === 'monthly') {
    let day = addMonths(fromDay, 0, anchor);
    if (day < fromDay) day = addMonths(fromDay, 1, anchor);
    for (let i = 0; i < MAX_STEPS; i++, day = addMonths(day, 1, anchor)) yield day;
    return;
  }
  const step = timing.cadence === 'biweekly' ? 14 : 7;
  let day = addDays(fromDay, (anchor - weekday(fromDay) + 7) % 7);
  if (timing.cadence === 'biweekly') {
    // Fortnights count from the first anchor weekday on or after creation.
    const created = zonedDay(new Date(timing.createdAt).getTime(), timeZone);
    const first = addDays(created, (anchor - weekday(created) + 7) % 7);
    const weeks = Math.round((Date.parse(day) - Date.parse(first)) / (7 * 86_400_000));
    if (weeks % 2 !== 0) day = addDays(day, 7);
  }
  for (let i = 0; i < MAX_STEPS; i++, day = addDays(day, step)) yield day;
}

/** The first scheduled instant strictly after `after`. */
export function nextRunAt(timing: ScheduleTiming, after: number, timeZone: string): Date {
  // Start a day early so a firing late on the previous local day is not skipped.
  const fromDay = addDays(zonedDay(after, timeZone), -1);
  for (const day of scheduledDays(timing, fromDay, timeZone)) {
    const instant = zonedInstant(day, timing.at, timeZone);
    if (instant.getTime() > after) return instant;
  }
  return new Date(after + 86_400_000);
}

/** The scheduled local day one cadence before `day`. */
function previousDay(timing: ScheduleTiming, day: string): string {
  if (timing.cadence === 'daily') return addDays(day, -1);
  if (timing.cadence === 'weekly') return addDays(day, -7);
  if (timing.cadence === 'biweekly') return addDays(day, -14);
  return addMonths(day, -1, anchorOf(timing));
}

/**
 * The latest scheduled instant at or before `now`, starting from a due
 * `nextRun`: when the server missed several firings, the task reports the most
 * recent period once instead of every missed one.
 */
export function latestDueRun(timing: ScheduleTiming, nextRun: number, now: number, timeZone: string): Date {
  let due = new Date(nextRun);
  for (let i = 0; i < MAX_STEPS; i++) {
    const following = nextRunAt(timing, due.getTime(), timeZone);
    if (following.getTime() > now) break;
    due = following;
  }
  return due;
}

export interface SchedulePeriod {
  /** First day reported, `YYYY-MM-DD` in the schedule's time zone. */
  from: string;
  /** Last day reported, inclusive. */
  to: string;
  /** Set when the period starts at the schedule's creation instead of a whole cadence. */
  firstRun: boolean;
}

/**
 * The period a firing at `runAt` reports on: the whole days from the previous
 * scheduled firing to the day before this one. The first firing after
 * creation covers only the days since the schedule was created (when at least
 * one whole day has passed), and says so.
 */
export function periodFor(timing: ScheduleTiming, runAt: number, timeZone: string): SchedulePeriod {
  const runDay = zonedDay(runAt, timeZone);
  const to = addDays(runDay, -1);
  let from = previousDay(timing, runDay);
  let firstRun = false;
  const previousRun = zonedInstant(from, timing.at, timeZone).getTime();
  const created = new Date(timing.createdAt).getTime();
  if (created > previousRun) {
    const createdDay = zonedDay(created, timeZone);
    if (createdDay <= to && createdDay > from) {
      from = createdDay;
      firstRun = true;
    }
  }
  return { from, to, firstRun };
}

/**
 * The period *Run now* reports on: the last complete cadence, the one the
 * latest scheduled firing at or before `now` covered (or would have).
 */
export function lastCompletePeriod(timing: ScheduleTiming, now: number, timeZone: string): SchedulePeriod {
  const next = nextRunAt(timing, now, timeZone);
  const runDay = previousDay(timing, zonedDay(next.getTime(), timeZone));
  const to = addDays(runDay, -1);
  return { from: previousDay(timing, runDay), to, firstRun: false };
}

/**
 * The outbox dedupe key of one delivery: a restart between storing the
 * snapshot and queueing the deliveries never sends a report twice. A *Run
 * now* delivery carries its snapshot, so each click is delivered once.
 */
export function reportDedupeKey(
  scheduleId: number,
  periodEnd: string,
  channelId: number,
  manualSnapshotId?: number,
): string {
  const key = `report:${scheduleId}:${periodEnd}:${channelId}`;
  return manualSnapshotId ? `${key}:run-${manualSnapshotId}` : key;
}

export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function ordinal(n: number): string {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** `Weekly on Monday at 08:00`, `Monthly on the 1st at 07:00`. */
export function describeCadence(timing: Pick<ScheduleTiming, 'cadence' | 'anchor' | 'at'>): string {
  const at = normalizeScheduleTime(timing.at);
  const weekday = WEEKDAY_NAMES[Math.min(7, Math.max(1, timing.anchor ?? 1)) - 1];
  if (timing.cadence === 'daily') return `Daily at ${at}`;
  if (timing.cadence === 'weekly') return `Weekly on ${weekday} at ${at}`;
  if (timing.cadence === 'biweekly') return `Every other ${weekday} at ${at}`;
  return `Monthly on the ${ordinal(Math.min(MONTHLY_ANCHOR_MAX, Math.max(1, timing.anchor ?? 1)))} at ${at}`;
}
