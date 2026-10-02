/**
 * The resource tracks of the run's workers timeline: the machine's CPU, the
 * run's memory and the pages open in its workers, drawn above the worker rows
 * on the timeline's clock. One band of tracks per reporter that sent them,
 * above the rows of its shard, since each shard ran on its own machine.
 * Pure, so the layout and the readings are unit-tested.
 */
import type { RunResourceTimelinePart } from '#shared/handlers/run-resources';
import type { SeriesPoint } from '#shared/types';
import { formatSize } from '#shared/resource-copy';
import type { WorkerRow } from '~/composables/useTimelineModel';

export type ResourceTrackKind = 'cpu' | 'memory' | 'pages';

/** The tracks in the order they are drawn, with the name each one goes by. */
export const RESOURCE_TRACK_KINDS: ReadonlyArray<{ kind: ResourceTrackKind; label: string; menuLabel: string }> = [
  { kind: 'cpu', label: 'CPU', menuLabel: 'CPU' },
  { kind: 'memory', label: 'Memory', menuLabel: 'Memory' },
  { kind: 'pages', label: 'Pages', menuLabel: 'Open pages' },
];

/** Which tracks are shown: all of them until the viewer turns one off. */
export type ResourceTrackVisibility = Record<ResourceTrackKind, boolean>;
export const ALL_RESOURCE_TRACKS: ResourceTrackVisibility = { cpu: true, memory: true, pages: true };

/** One track: a series on the timeline's clock (ms after the run's first test) and its scale. */
export interface ResourceTrack {
  kind: ResourceTrackKind;
  points: SeriesPoint[];
  /** The value the top of the track stands for. */
  yMax: number;
  /** A level held until the next point (open pages), rather than a reading at each point. */
  step: boolean;
  /** Memory: the top is the machine's memory or its container's limit, close enough to matter. */
  atCapacity: boolean;
  /** What the label column says under the track's name: the value of its top. */
  scaleLabel: string;
}

/** The tracks of one reporter, placed above the rows of its shard. */
export interface ResourceBand {
  key: string;
  shardIndex: number | null;
  /** The track names' prefix when the run has several shards: `S1`. */
  prefix: string | null;
  /** The first lane of the band's shard: the band sits above it. */
  firstLane: number;
  tracks: Record<ResourceTrackKind, ResourceTrack | null>;
  /** Each lane's open pages, named as its row is, for the readout. */
  workers: Array<{ name: string; points: SeriesPoint[] }>;
  memoryKind: 'pss' | 'rss' | null;
}

/** The memory at which the track is drawn against the machine's capacity rather than the run's peak. */
const CAPACITY_SCALE_RATIO = 1.5;

/** The sum of step series: at each change of any of them, the total of their current values. */
export function sumSteps(series: SeriesPoint[][]): SeriesPoint[] {
  const events = series.flatMap((points, index) => points.map(([at, value]) => ({ at, index, value })));
  events.sort((a, b) => a.at - b.at);
  const current = series.map(() => 0);
  const out: SeriesPoint[] = [];
  let total = 0;
  for (const { at, index, value } of events) {
    total += value - current[index]!;
    current[index] = value;
    const last = out[out.length - 1];
    if (last && last[0] === at) last[1] = total;
    else out.push([at, total]);
  }
  return out;
}

function peak(points: SeriesPoint[]): number {
  return points.reduce((max, [, value]) => Math.max(max, value), 0);
}

function rowName(row: WorkerRow, sharded: boolean): string {
  return row.shardIndex != null && sharded ? `S${row.shardIndex} W${row.slot}` : `Worker ${row.slot}`;
}

/**
 * The bands of the run's resource tracks. `origin` is the epoch ms of the
 * timeline's zero (its first test's start); a part whose shard has no rows is
 * left out. A run with a single reporter and a single shard of rows pairs
 * them whatever their shard numbers say.
 */
export function buildResourceBands(
  parts: RunResourceTimelinePart[],
  rows: WorkerRow[],
  origin: number,
  sharded: boolean,
): ResourceBand[] {
  const firstRowByShard = new Map<number | null, WorkerRow>();
  for (const row of rows) if (!firstRowByShard.has(row.shardIndex)) firstRowByShard.set(row.shardIndex, row);

  const bands: ResourceBand[] = [];
  for (const part of parts) {
    let first = firstRowByShard.get(part.shardIndex);
    if (!first && parts.length === 1 && firstRowByShard.size === 1) first = [...firstRowByShard.values()][0];
    if (!first) continue;
    const shardRows = rows.filter((row) => row.shardIndex === first.shardIndex);
    const shift = part.timeline.startedAt - origin;
    const onClock = (points: SeriesPoint[]): SeriesPoint[] => points.map(([at, value]) => [at + shift, value]);

    const cpu = onClock(part.timeline.cpuPct);
    const memory = onClock(part.timeline.memoryBytes);
    const memoryPeak = peak(memory);
    const capacity = part.memoryCapacityBytes;
    const atCapacity = capacity !== null && capacity > 0 && capacity <= memoryPeak * CAPACITY_SCALE_RATIO;

    // A lane's processes run one after another, so its pages are their sum.
    const byLane = new Map<string, SeriesPoint[][]>();
    for (const { worker, points } of part.timeline.pages) {
      const row = shardRows.find((r) => r.processes.includes(worker));
      const name = row ? rowName(row, sharded) : `Process ${worker}`;
      byLane.set(name, [...(byLane.get(name) ?? []), onClock(points)]);
    }
    const workers = [...byLane.entries()].map(([name, series]) => ({ name, points: sumSteps(series) }));
    const pages = sumSteps(workers.map((w) => w.points));
    const pagesPeak = peak(pages);

    bands.push({
      key: `resources-${part.shardIndex ?? 'all'}`,
      shardIndex: part.shardIndex,
      prefix: sharded && part.shardIndex != null ? `S${part.shardIndex}` : null,
      firstLane: first.baseLane,
      tracks: {
        cpu:
          cpu.length > 0
            ? { kind: 'cpu', points: cpu, yMax: 100, step: false, atCapacity: false, scaleLabel: '100%' }
            : null,
        memory:
          memory.length > 0 && memoryPeak > 0
            ? {
                kind: 'memory',
                points: memory,
                yMax: atCapacity ? capacity : memoryPeak,
                step: false,
                atCapacity,
                scaleLabel: atCapacity ? `limit ${formatSize(capacity)}` : `peak ${formatSize(memoryPeak)}`,
              }
            : null,
        pages:
          pages.length > 0
            ? {
                kind: 'pages',
                points: pages,
                yMax: Math.max(1, pagesPeak),
                step: true,
                atCapacity: false,
                scaleLabel: `peak ${pagesPeak}`,
              }
            : null,
      },
      workers,
      memoryKind: part.memoryKind,
    });
  }
  return bands.sort((a, b) => a.firstLane - b.firstLane);
}

/** The tracks of a band that are drawn: present in its data and shown. */
export function shownTracks(band: ResourceBand, visibility: ResourceTrackVisibility): ResourceTrack[] {
  return RESOURCE_TRACK_KINDS.map(({ kind }) => (visibility[kind] ? band.tracks[kind] : null)).filter(
    (track): track is ResourceTrack => track !== null,
  );
}

/** How far from a reading the readout still shows it. */
const READING_REACH_MS = 6000;

/**
 * A track's value at `t` (ms on the timeline's clock): a step series' level
 * then (zero before its first point), a sampled series' nearest reading, or
 * null when no reading is near.
 */
export function valueAt(points: SeriesPoint[], t: number, step: boolean): number | null {
  if (points.length === 0) return null;
  // The last point at or before t.
  let lo = 0;
  let hi = points.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]![0] <= t) {
      at = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (step) return at < 0 ? 0 : points[at]![1];
  const before = at >= 0 ? points[at]! : null;
  const after = points[at + 1] ?? null;
  const nearest = before && after ? (t - before[0] <= after[0] - t ? before : after) : (before ?? after)!;
  return Math.abs(nearest[0] - t) <= READING_REACH_MS ? nearest[1] : null;
}

/**
 * A track's line and the area under it, with x in ms on the timeline's clock
 * and y in px from the track's top: the timeline scales x to its zoom, so a
 * zoom never rebuilds them.
 */
export function trackPaths(track: ResourceTrack, height: number): { line: string; area: string } {
  const { points, yMax, step } = track;
  if (points.length === 0) return { line: '', area: '' };
  const y = (value: number) => Math.round((height - (Math.min(value, yMax) / yMax) * height) * 10) / 10;
  const line: string[] = [];
  points.forEach(([at, value], i) => {
    if (i === 0) line.push(`M${at},${y(value)}`);
    else if (step) line.push(`H${at}`, `V${y(value)}`);
    else line.push(`L${at},${y(value)}`);
  });
  const first = points[0]![0];
  const last = points[points.length - 1]![0];
  return { line: line.join(''), area: `M${first},${height}${line.join('').replace(/^M/, 'L')}L${last},${height}Z` };
}

/** A track's value as the readout prints it. */
export function formatTrackValue(kind: ResourceTrackKind, value: number): string {
  if (kind === 'cpu') return `${Math.round(value)}%`;
  if (kind === 'memory') return formatSize(value);
  return `${value} open`;
}
