import { describe, it, expect } from 'vitest';
import type { ResourceCensus } from '../src/internal/capture/resource-ledger.js';
import {
  REPORT_FINDINGS_CAP,
  downsample,
  executionResources,
  resourceReportWire,
} from '../src/internal/collect/resource-wire.js';
import type { ResourceReport } from '../src/internal/collect/resource-verdicts.js';
import type { RunProfile } from '../src/internal/collect/process-sampler.js';

const ref = (id: string) => ({ id, file: 'tests/cart.spec.ts', suite: [], title: `title ${id}` });

function census(worker: number, at: number, test: string | null, parts: Partial<ResourceCensus> = {}): ResourceCensus {
  return { v: 1, worker, pid: 1, at, test: test ? ref(test) : null, born: [], closed: [], open: [], ...parts };
}

const birth = (id: number, kind: 'page' | 'context') => ({
  id,
  kind,
  parent: null,
  at: 0,
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
  });
});
