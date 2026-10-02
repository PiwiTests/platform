import { describe, test, expect } from 'vitest';
import {
  ALL_RESOURCE_TRACKS,
  buildResourceBands,
  formatTrackValue,
  shownTracks,
  sumSteps,
  trackPaths,
  valueAt,
} from '../../app/utils/resource-tracks';
import type { WorkerRow } from '../../app/composables/useTimelineModel';
import type { RunResourceTimelinePart } from '../../shared/handlers/run-resources';

const GB = 1024 ** 3;

const row = (shardIndex: number | null, slot: number, processes: number[], baseLane: number): WorkerRow => ({
  shardIndex,
  slot,
  processes,
  baseLane,
  laneSpan: 1,
});

const part = (shardIndex: number | null, extra: Partial<RunResourceTimelinePart> = {}): RunResourceTimelinePart => ({
  shardIndex,
  memoryCapacityBytes: 16 * GB,
  memoryKind: 'pss',
  timeline: {
    startedAt: 9_000,
    cpuPct: [
      [1000, 40],
      [3000, 80],
    ],
    memoryBytes: [
      [0, 2 * GB],
      [5000, 4 * GB],
    ],
    pages: [
      {
        worker: 0,
        points: [
          [1000, 1],
          [2000, 2],
          [6000, 0],
        ],
      },
      // A second process on worker 0's lane, after the first one ended.
      {
        worker: 2,
        points: [
          [7000, 1],
          [8000, 0],
        ],
      },
      {
        worker: 1,
        points: [
          [1500, 1],
          [3000, 0],
        ],
      },
    ],
  },
  ...extra,
});

describe('sumSteps', () => {
  test('adds step series at each change of any of them', () => {
    expect(
      sumSteps([
        [
          [0, 1],
          [10, 2],
        ],
        [
          [5, 3],
          [10, 0],
        ],
      ]),
    ).toEqual([
      [0, 1],
      [5, 4],
      [10, 2],
    ]);
  });
});

describe('buildResourceBands', () => {
  test('puts a reporter’s series on the timeline’s clock, its pages by lane', () => {
    const [band] = buildResourceBands([part(null)], [row(null, 0, [0, 2], 0), row(null, 1, [1], 1)], 10_000, false);
    expect(band).toMatchObject({ key: 'resources-all', prefix: null, firstLane: 0, memoryKind: 'pss' });
    // The reporter's clock starts a second before the first test.
    expect(band!.tracks.cpu!.points).toEqual([
      [0, 40],
      [2000, 80],
    ]);
    expect(band!.tracks.memory).toMatchObject({ yMax: 4 * GB, atCapacity: false, scaleLabel: 'peak 4.0 GB' });
    expect(band!.workers).toEqual([
      {
        name: 'Worker 0',
        points: [
          [0, 1],
          [1000, 2],
          [5000, 0],
          [6000, 1],
          [7000, 0],
        ],
      },
      {
        name: 'Worker 1',
        points: [
          [500, 1],
          [2000, 0],
        ],
      },
    ]);
    expect(band!.tracks.pages).toMatchObject({ yMax: 3, step: true, scaleLabel: 'peak 3' });
    expect(band!.tracks.pages!.points).toEqual([
      [0, 1],
      [500, 2],
      [1000, 3],
      [2000, 2],
      [5000, 0],
      [6000, 1],
      [7000, 0],
    ]);
  });

  test('draws memory against the container’s limit when the run came close to it', () => {
    const [band] = buildResourceBands(
      [part(null, { memoryCapacityBytes: 5 * GB })],
      [row(null, 0, [0], 0)],
      9_000,
      false,
    );
    expect(band!.tracks.memory).toMatchObject({ yMax: 5 * GB, atCapacity: true, scaleLabel: 'limit 5.0 GB' });
  });

  test('places each shard’s band above its own rows, and leaves out a shard with none', () => {
    const rows = [row(1, 0, [0], 0), row(1, 1, [1], 1), row(2, 0, [0], 2), row(2, 1, [1, 2], 3)];
    const bands = buildResourceBands([part(2), part(1), part(3)], rows, 9_000, true);
    expect(bands.map((b) => [b.key, b.firstLane, b.prefix])).toEqual([
      ['resources-1', 0, 'S1'],
      ['resources-2', 2, 'S2'],
    ]);
    expect(bands[1]!.workers.map((w) => w.name)).toEqual(['S2 W0', 'S2 W1']);
  });

  test('pairs a single reporter with a single shard of rows whatever their numbers', () => {
    expect(buildResourceBands([part(null)], [row(3, 0, [0], 0)], 9_000, false)).toHaveLength(1);
  });

  test('leaves out the tracks a reporter could not measure', () => {
    const [band] = buildResourceBands(
      [part(null, { timeline: { startedAt: 9_000, cpuPct: [], memoryBytes: [], pages: part(null).timeline.pages } })],
      [row(null, 0, [0], 0)],
      9_000,
      false,
    );
    expect(band!.tracks.cpu).toBeNull();
    expect(band!.tracks.memory).toBeNull();
    expect(shownTracks(band!, ALL_RESOURCE_TRACKS).map((t) => t.kind)).toEqual(['pages']);
    expect(shownTracks(band!, { ...ALL_RESOURCE_TRACKS, pages: false })).toEqual([]);
  });
});

describe('valueAt', () => {
  const points: Array<[number, number]> = [
    [1000, 10],
    [3000, 30],
  ];

  test('holds a step series’ level, zero before it starts', () => {
    expect(valueAt(points, 500, true)).toBe(0);
    expect(valueAt(points, 2999, true)).toBe(10);
    expect(valueAt(points, 9000, true)).toBe(30);
  });

  test('reads a sampled series’ nearest reading, and nothing far from any', () => {
    expect(valueAt(points, 1900, false)).toBe(10);
    expect(valueAt(points, 2100, false)).toBe(30);
    expect(valueAt(points, 20_000, false)).toBeNull();
    expect(valueAt([], 0, false)).toBeNull();
  });
});

describe('trackPaths', () => {
  test('draws a reading as a line and a level as steps, x in ms', () => {
    const base = { kind: 'cpu' as const, yMax: 100, atCapacity: false, scaleLabel: '100%' };
    expect(
      trackPaths(
        {
          ...base,
          step: false,
          points: [
            [0, 0],
            [1000, 50],
            [2000, 150],
          ],
        },
        20,
      ),
    ).toEqual({ line: 'M0,20L1000,10L2000,0', area: 'M0,20L0,20L1000,10L2000,0L2000,20Z' });
    expect(
      trackPaths(
        {
          ...base,
          step: true,
          points: [
            [0, 50],
            [1000, 100],
          ],
        },
        20,
      ).line,
    ).toBe('M0,10H1000V0');
  });
});

describe('formatTrackValue', () => {
  test('reads each track in its unit', () => {
    expect(formatTrackValue('cpu', 63.4)).toBe('63%');
    expect(formatTrackValue('memory', 2.5 * GB)).toBe('2.5 GB');
    expect(formatTrackValue('pages', 4)).toBe('4 open');
  });
});
