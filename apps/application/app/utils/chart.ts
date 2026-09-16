/** Shared geometry helpers, palette and series definitions for the SVG trend charts. */

/** Series colors for run-status stacks and their legends. */
export const CHART_STATUS_COLORS = {
  passed: 'rgb(34, 197, 94)',
  failed: 'rgb(239, 68, 68)',
  skipped: 'rgb(245, 158, 11)',
  flaky: 'rgb(147, 51, 234)',
} as const;

/** One plotted series: how it is drawn and how the legend names it. */
export interface ChartSeries<K extends string = string> {
  key: K;
  color: string;
  label: string;
}

/**
 * Run-status series, in stacking order — failed sits on the baseline so red is
 * comparable across bars, and passed carries the bulk on top.
 */
export const RUN_STATUS_SERIES = [
  { key: 'failed', color: CHART_STATUS_COLORS.failed, label: 'Failed' },
  { key: 'flaky', color: CHART_STATUS_COLORS.flaky, label: 'Flaky' },
  { key: 'skipped', color: CHART_STATUS_COLORS.skipped, label: 'Skipped' },
  { key: 'passed', color: CHART_STATUS_COLORS.passed, label: 'Passed' },
] as const satisfies readonly ChartSeries[];

/** Duration series of the project performance trend. */
export const RUN_DURATION_SERIES = [
  { key: 'duration', color: 'rgb(59, 130, 246)', label: 'Total duration' },
  { key: 'avgTestDuration', color: 'rgb(34, 197, 94)', label: 'Avg test duration' },
  { key: 'p90TestDuration', color: 'rgb(249, 115, 22)', label: 'P90 test duration' },
] as const satisfies readonly ChartSeries[];

/** Per-execution outcomes coloring the test-case history bars. */
export const CASE_STATUS_SERIES = [
  { key: 'passed', color: CHART_STATUS_COLORS.passed, label: 'Passed' },
  { key: 'failed', color: CHART_STATUS_COLORS.failed, label: 'Failed' },
  { key: 'skipped', color: 'rgb(156, 163, 175)', label: 'Skipped' },
] as const satisfies readonly ChartSeries[];

/** Legend rows for a series list — the color/label pairs `ChartCard` renders. */
export function legendOf(series: readonly ChartSeries[]): { color: string; label: string }[] {
  return series.map(({ color, label }) => ({ color, label }));
}

/** Y-axis ticks from 0 to the first 1/2/5×10ⁿ step multiple that clears `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const rough = max / count;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const steps = Math.ceil(max / step - 1e-9);
  return Array.from({ length: steps + 1 }, (_, i) => Math.round(i * step * 1e6) / 1e6);
}

/**
 * Indices worth labeling on a per-point (ordinal) x axis: the first point and
 * every point that starts a new calendar day, thinned to at most `maxTicks`.
 */
export function dayTickIndices(dates: Date[], maxTicks: number): number[] {
  if (maxTicks <= 0) return [];
  const dayStarts: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    if (i === 0 || dates[i]?.toDateString() !== dates[i - 1]?.toDateString()) dayStarts.push(i);
  }
  if (dayStarts.length <= maxTicks) return dayStarts;
  const step = Math.ceil(dayStarts.length / maxTicks);
  return dayStarts.filter((_, i) => i % step === 0);
}

/** 'Jul 29' — the x-tick date format shared by every trend chart. */
export function formatTickDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Maps a timestamp onto an ordinal (per-point) x axis by interpolating between
 * the centers of the two neighboring points. Returns null outside the plotted
 * range, matching how markers off the time axis were previously skipped.
 */
export function timeToOrdinalX(dates: Date[], centers: number[], time: number): number | null {
  if (dates.length === 0 || dates.length !== centers.length) return null;
  const times = dates.map((d) => d.getTime());
  const first = times[0] as number;
  const last = times[times.length - 1] as number;
  if (time < first || time > last) return null;
  if (times.length === 1) return centers[0] as number;
  for (let i = 0; i < times.length - 1; i++) {
    const a = times[i] as number;
    const b = times[i + 1] as number;
    if (time < a || time > b) continue;
    const fraction = b === a ? 0 : (time - a) / (b - a);
    const start = centers[i] as number;
    const end = centers[i + 1] as number;
    return start + fraction * (end - start);
  }
  return null;
}

/**
 * Per-index slot layout for ordinal charts: `centerOf` positions points and
 * hover columns, `xOf`/`barWidth` position the bars themselves.
 */
export function barGeometry(count: number, plotWidth: number, maxBarWidth = 24) {
  const slotWidth = count > 0 ? plotWidth / count : plotWidth;
  const barWidth = Math.max(2, Math.min(maxBarWidth, slotWidth * 0.7));
  return {
    slotWidth,
    barWidth,
    centerOf: (i: number) => i * slotWidth + slotWidth / 2,
    xOf: (i: number) => i * slotWidth + (slotWidth - barWidth) / 2,
  };
}

export interface StackSegment {
  color: string;
  y: number;
  height: number;
}

/**
 * Pixel segments for one stacked bar, bottom-up in `series` order. Non-zero
 * values get at least `minPx` so a single failure stays visible next to a
 * hundred passes; the excess is taken from the tallest segment.
 */
export function stackSegments(
  series: Array<{ color: string; value: number }>,
  plotHeight: number,
  yScale: (value: number) => number,
  minPx = 2,
): StackSegment[] {
  const heights = series.map((s) => (s.value > 0 ? Math.max(minPx, plotHeight - yScale(s.value)) : 0));
  const idealTotal = series.reduce((sum, s) => sum + (s.value > 0 ? plotHeight - yScale(s.value) : 0), 0);
  const excess = heights.reduce((sum, h) => sum + h, 0) - idealTotal;
  if (excess > 0) {
    const tallest = heights.indexOf(Math.max(...heights));
    heights[tallest] = Math.max(minPx, (heights[tallest] as number) - excess);
  }
  const segments: StackSegment[] = [];
  let y = plotHeight;
  for (let i = 0; i < series.length; i++) {
    const height = heights[i] as number;
    if (height <= 0) continue;
    y -= height;
    segments.push({ color: (series[i] as { color: string }).color, y, height });
  }
  return segments;
}
