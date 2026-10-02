import { describe, it, expect } from 'vitest';
import type { ResourceCensus } from '../src/internal/capture/resource-ledger.js';
import {
  REPORT_FINDINGS_CAP,
  TIMELINE_SERIES_CAP,
  TIMELINE_WORKER_POINTS_CAP,
  downsample,
  downsamplePoints,
  executionResources,
  resourceReportWire,
  resourceTimeline,
} from '../src/internal/collect/resource-wire.js';
import type { ResourceReport } from '../src/internal/collect/resource-verdicts.js';
import type { RunProfile } from '../src/internal/collect/process-sampler.js';

const ref = (id: string) => ({ id, file: 'tests/cart.spec.ts', suite: [], title: `title ${id}` });

function census(worker: number, at: number, test: string | null, parts: Partial<ResourceCensus> = {}): ResourceCensus {
  return { v: 1, worker, pid: 1, at, test: test ? ref(test) : null, born: [], closed: [], open: [], ...parts };
}

const birth = (id: number, kind: 'page' | 'context', at = 0) => ({
  id,
  kind,
  parent: null,
  at,
  phase: 'test' as const,
  fixture: null,
  test: ref('t1'),
  site: 'tests/cart.spec.ts:4',
});

describe('downsample', () => {
  it('keeps a short series and averages a long one into at most the cap', () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(downsample([0, 10, 20, 30], 2)).toEqual([5, 25]);
    expect(downsample(Array.from({ length: 1000 }, (_, i) => i), 240)).toHaveLength(240);
  });
});

const close = (id: number, at: number) => ({ id, at, phase: 'test' as const, test: ref('t1') });

describe('downsamplePoints', () => {
  it('keeps a short series, and folds a long one at each slice’s first time', () => {
    const points: Array<[number, number]> = [
      [0, 10],
      [1, 30],
      [2, 0],
      [3, 4],
    ];
    expect(downsamplePoints(points, 5, 'mean')).toBe(points);
    expect(downsamplePoints(points, 2, 'mean')).toEqual([
      [0, 20],
      [2, 2],
    ]);
    expect(downsamplePoints(points, 2, 'max')).toEqual([
      [0, 30],
      [2, 4],
    ]);
  });
});

describe('resourceTimeline', () => {
  it('counts the pages open in each worker at each change, from the censuses', () => {
    const timeline = resourceTimeline(null, [
      // Worker 1: a page per test closed with it, and one a test left open.
      census(1, 1500, 't1', { born: [birth(1, 'context', 1000), birth(2, 'page', 1000)], closed: [close(2, 1400)] }),
      census(1, 2500, 't2', { born: [birth(3, 'page', 2000), birth(4, 'page', 2000)], closed: [close(3, 2400)] }),
      census(1, 3000, null, { closed: [close(4, 2900)] }),
      // Worker 0: its last census leaves a page open, which goes with the worker.
      census(0, 1800, 't3', { born: [birth(1, 'page', 1200)] }),
    ]);
    expect(timeline).toEqual({
      startedAt: 1000,
      cpuPct: [],
      memoryBytes: [],
      pages: [
        { worker: 0, points: [[200, 1], [800, 0]] },
        {
          worker: 1,
          points: [
            [0, 1],
            [400, 0],
            [1000, 2],
            [1400, 1],
            [1900, 0],
          ],
        },
      ],
    });
  });

  it('puts the sampler’s series and the pages on the earliest clock, and is null with nothing measured', () => {
    const samples = { startedAt: 900, cpuPct: [[1000, 40]] as Array<[number, number]>, memoryBytes: [[0, 5e8]] as Array<[number, number]> };
    const timeline = resourceTimeline(samples, [census(0, 1200, 't1', { born: [birth(1, 'page', 800)] })]);
    expect(timeline).toMatchObject({
      startedAt: 800,
      cpuPct: [[1100, 40]],
      memoryBytes: [[100, 5e8]],
      pages: [{ worker: 0, points: [[0, 1], [400, 0]] }],
    });
    expect(resourceTimeline({ startedAt: 1, cpuPct: [], memoryBytes: [] }, [])).toBeNull();
  });

  it('bounds every series and keeps where a worker’s count settles', () => {
    const long = Array.from({ length: 5000 }, (_, i): [number, number] => [i * 1000, i % 100]);
    const born = Array.from({ length: 1000 }, (_, i) => birth(i + 1, 'page', i * 10));
    const timeline = resourceTimeline({ startedAt: 0, cpuPct: long, memoryBytes: long }, [
      census(0, 20_000, 't1', { born }),
    ])!;
    expect(timeline.cpuPct).toHaveLength(TIMELINE_SERIES_CAP);
    expect(timeline.memoryBytes).toHaveLength(TIMELINE_SERIES_CAP);
    expect(timeline.pages[0]!.points).toHaveLength(TIMELINE_WORKER_POINTS_CAP);
    expect(timeline.pages[0]!.points[timeline.pages[0]!.points.length - 1]).toEqual([20_000, 0]);
  });
});

describe('executionResources', () => {
  it("projects a census's metrics, what was open at the start and what the test left open", () => {
    const resources = executionResources(
      census(0, 10, 't1', {
        metrics: {
          worker: { cpuMs: 120, involuntarySwitches: 4, loopUtilization: 0.3, loopDelayP99Ms: 21, loopDelayMaxMs: 40, heapUsedMb: 60, fds: 33 },
          roles: { renderer: { cpuMs: 900, runWaitMs: 12, peakRssMb: 140, processes: 2 } },
        },
        openAtStart: { contexts: 2, pages: 5 },
        leftOpen: 1,
      }),
      { trace: 2048, video: 0 },
    );
    expect(resources).toEqual({
      workerCpuMs: 120,
      roles: { renderer: { cpuMs: 900, runWaitMs: 12, peakRssMb: 140, processes: 2 } },
      loopUtilization: 0.3,
      loopDelayP99Ms: 21,
      involuntarySwitches: 4,
      heapUsedMb: 60,
      openAtStart: { contexts: 2, pages: 5 },
      leftOpen: 1,
      artifactBytes: { trace: 2048 },
    });
    expect(executionResources(census(0, 10, 't1'), {})).toBeNull();
  });
});

describe('resourceReportWire', () => {
  it('bounds the findings and the series, and counts the open pages of each worker test after test', () => {
    const report: ResourceReport = {
      findings: Array.from({ length: REPORT_FINDINGS_CAP + 5 }, (_, i) => ({
        verdict: 'idle' as const,
        kind: 'page' as const,
        where: `tests/a.spec.ts:${i}`,
        tests: 1,
        count: 1,
      })),
      counts: { leaked: 0, idle: 105, piling: 0, handle: 0, probable: 0 },
    };
    const profile = { cpu: { series: Array.from({ length: 1000 }, () => 50) } } as unknown as RunProfile;
    const wire = resourceReportWire({
      report,
      profile,
      artifacts: { trace: 10, video: 0, screenshot: 0, other: 0 },
      shardIndex: 2,
      censuses: [
        census(1, 10, 't1', { born: [birth(1, 'context'), birth(2, 'page')], open: [{ id: 1, pages: 1 }, { id: 2, used: true }] }),
        census(1, 20, 't2', { born: [birth(3, 'page')], open: [{ id: 1, pages: 2 }, { id: 2, used: true }, { id: 3, used: true }] }),
        census(1, 30, null, { open: [] }),
        census(0, 15, 't3', { born: [birth(1, 'page')], open: [] }),
      ],
    });
    expect(wire.v).toBe(1);
    expect(wire.shardIndex).toBe(2);
    expect(wire.findings).toHaveLength(REPORT_FINDINGS_CAP);
    expect(wire.profile!.cpu.series).toHaveLength(240);
    expect(wire.workers).toEqual([
      { worker: 0, openPages: [0] },
      { worker: 1, openPages: [1, 2] },
    ]);
    expect(wire.artifactBytes).toEqual({ trace: 10 });
    expect(wire.timeline?.pages.map((w) => w.worker)).toEqual([0, 1]);
  });
});
