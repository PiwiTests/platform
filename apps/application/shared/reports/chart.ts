/**
 * The geometry of a `series` block, in plot coordinates (origin top left):
 * one set of numbers the HTML renderer turns into SVG, the PDF renderer into
 * vector lines and the email into a PNG, so every document draws the same
 * chart.
 */
import { STATUS_COLORS, type StatusColorKey } from '#shared/status-colors';
import type { ReportBlock } from './types';

type SeriesBlock = Extract<ReportBlock, { kind: 'series' }>;

/** The line color of a series that names none: indigo, the report accent. */
export const REPORT_ACCENT = '#4f46e5';
/** The comparison line. */
export const REPORT_FAINT = '#a1a1aa';
/** Horizontal gridlines. */
export const REPORT_GRID = '#e4e4e7';
/** The vertical rule of a timeline marker. */
export const REPORT_MARKER = '#a855f7';

export interface ChartGeometry {
  width: number;
  height: number;
  /** One entry per series: its color and its runs of consecutive points (a null value breaks the line). */
  lines: Array<{ color: string; faint: boolean; label: string; runs: Array<Array<[number, number]>> }>;
  /** Horizontal gridlines with the value they mark. */
  ticks: Array<{ y: number; value: number }>;
  /** A few x positions with their bucket date. */
  labels: Array<{ x: number; date: string }>;
  markers: Array<{ x: number; label: string }>;
}

export function seriesColor(color: string | undefined, faint: boolean | undefined): string {
  if (faint) return REPORT_FAINT;
  if (!color || color === 'accent') return REPORT_ACCENT;
  if (color.startsWith('#')) return color;
  return STATUS_COLORS[color as StatusColorKey]?.fill ?? REPORT_ACCENT;
}

/** A gridline's value as the axis prints it: `50%` for a percentage, the bare number otherwise. */
export function chartTickLabel(block: Pick<SeriesBlock, 'unit'>, value: number): string {
  return block.unit === 'percent' ? `${value}%` : String(value);
}

/** How a date label sits on its point: centered, or ending there on the plot's right edge, so it is not cut. */
export function chartLabelAnchor(x: number, width: number): 'middle' | 'end' {
  return x >= width - 0.5 ? 'end' : 'middle';
}

/** Round steps (1, 2, 5 × 10ⁿ) up to a top that clears `max`. */
export function chartTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  const ticks: number[] = [];
  for (let v = 0; v < max + step - 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

export function seriesGeometry(block: SeriesBlock, width: number, height: number, labelCount = 5): ChartGeometry {
  const count = Math.max(1, ...block.series.map((s) => s.points.length));
  const values = block.series.flatMap((s) => s.points.map((p) => p.value ?? 0));
  const ticks = chartTicks(block.max ?? Math.max(1, ...values));
  const top = ticks[ticks.length - 1] || 1;
  const xOf = (i: number) => (count === 1 ? width / 2 : (i / (count - 1)) * width);
  const yOf = (v: number) => height - (v / top) * height;

  const lines = block.series.map((s) => {
    const runs: Array<Array<[number, number]>> = [];
    let run: Array<[number, number]> = [];
    s.points.forEach((p, i) => {
      if (p.value === null) {
        if (run.length) runs.push(run);
        run = [];
        return;
      }
      run.push([xOf(i), yOf(p.value)]);
    });
    if (run.length) runs.push(run);
    return { color: seriesColor(s.color, s.faint), faint: !!s.faint, label: s.label, runs };
  });

  const dates = (block.series[0]?.points ?? []).map((p) => p.date);
  const step = Math.max(1, Math.ceil(dates.length / labelCount));
  const labels = dates.flatMap((date, i) => (i % step === 0 ? [{ x: xOf(i), date }] : []));

  const markers = block.markers.flatMap((m) => {
    let index = -1;
    for (let i = 0; i < dates.length; i++) if (dates[i]! <= m.date) index = i;
    return index < 0 ? [] : [{ x: xOf(index), label: m.label }];
  });

  return { width, height, lines, ticks: ticks.map((value) => ({ y: yOf(value), value })), labels, markers };
}

/** The padding around the plot inside a marks-only image, so a line on the top gridline is not cut. */
export const CHART_MARKS_PAD = 4;

function marksPath(run: Array<[number, number]>): string {
  return run.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

/**
 * The chart's marks as a standalone SVG (gridlines, lines, marker rules) with
 * no `<text>` element: the email and the share image rasterize it where no
 * font is installed, and print the axis values beside the image instead.
 */
export function chartMarksSvg(block: SeriesBlock, width: number, height: number): string {
  const pad = CHART_MARKS_PAD;
  const g = seriesGeometry(block, width - pad * 2, height - pad * 2);
  const parts: string[] = [];
  for (const tick of g.ticks) {
    parts.push(
      `<line x1="0" x2="${g.width}" y1="${tick.y.toFixed(1)}" y2="${tick.y.toFixed(1)}" stroke="${REPORT_GRID}" stroke-width="1"/>`,
    );
  }
  for (const marker of g.markers) {
    parts.push(
      `<line x1="${marker.x.toFixed(1)}" x2="${marker.x.toFixed(1)}" y1="0" y2="${g.height}" stroke="${REPORT_MARKER}" stroke-width="1" stroke-dasharray="3 3"/>`,
    );
  }
  for (const line of g.lines) {
    for (const run of line.runs) {
      if (run.length === 1) {
        const [x, y] = run[0]!;
        parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${line.color}"/>`);
        continue;
      }
      parts.push(
        `<path d="${marksPath(run)}" fill="none" stroke="${line.color}" stroke-width="${line.faint ? 1.5 : 2.5}"${line.faint ? ' stroke-dasharray="4 3"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/><g transform="translate(${pad},${pad})">${parts.join('')}</g></svg>`;
}

/** A text sparkline of one series (`▁▂▃▅▇`), empty buckets as spaces. */
export function sparkline(points: Array<{ value: number | null }>): string {
  const bars = '▁▂▃▄▅▆▇█';
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return points
    .map((p) => {
      if (p.value === null) return ' ';
      const t = max === min ? 0.5 : (p.value - min) / (max - min);
      return bars[Math.min(bars.length - 1, Math.round(t * (bars.length - 1)))];
    })
    .join('');
}
