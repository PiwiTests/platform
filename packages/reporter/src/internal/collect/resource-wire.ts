import type { ArtifactKind, WireExecutionResources, WireResourceReport } from '@piwitests/core/wire';
import type { ResourceCensus } from '../capture/resource-ledger.js';
import type { RunProfile } from './process-sampler.js';
import type { ResourceReport } from './resource-verdicts.js';
import { workerHealthOf, type ArtifactBytes } from './machine-panel.js';

/**
 * The resource data the dashboard receives: per execution, what the test cost
 * its worker and browsers; per run, the findings, what the run cost its
 * machine and the pages open in each worker test after test. Bounded, so a
 * large or leaky suite sends a report of a few tens of kilobytes at most.
 */

/** The most findings a report carries; the summary already orders them most severe first. */
export const REPORT_FINDINGS_CAP = 100;
/** The most points of the machine's CPU series, and of each worker's open pages. */
export const REPORT_SERIES_CAP = 240;
export const REPORT_WORKER_POINTS_CAP = 200;

/** A series shortened to at most `cap` points, each the mean of its slice. */
export function downsample(series: number[], cap: number): number[] {
  if (series.length <= cap) return series;
  const out: number[] = [];
  for (let i = 0; i < cap; i++) {
    const slice = series.slice(Math.floor((i * series.length) / cap), Math.floor(((i + 1) * series.length) / cap));
    out.push(Math.round((slice.reduce((sum, v) => sum + v, 0) / Math.max(1, slice.length)) * 10) / 10);
  }
  return out;
}

/** The non-zero kinds of a byte tally, or null when every kind is zero. */
function nonZero(bytes: Partial<Record<ArtifactKind, number>>): Partial<Record<ArtifactKind, number>> | null {
  const out = Object.fromEntries(Object.entries(bytes).filter(([, n]) => (n ?? 0) > 0));
  return Object.keys(out).length > 0 ? out : null;
}

/** What one execution cost, from its census; null when the census carried no metrics. */
export function executionResources(
  census: ResourceCensus,
  artifacts: Partial<Record<ArtifactKind, number>>,
): WireExecutionResources | null {
  const metrics = census.metrics;
  if (!metrics) return null;
  return {
    workerCpuMs: metrics.worker.cpuMs,
    roles: metrics.roles ?? null,
    loopUtilization: metrics.worker.loopUtilization,
    loopDelayP99Ms: metrics.worker.loopDelayP99Ms,
    involuntarySwitches: metrics.worker.involuntarySwitches,
    heapUsedMb: metrics.worker.heapUsedMb,
    openAtStart: census.openAtStart ?? null,
    leftOpen: census.leftOpen ?? null,
    artifactBytes: nonZero(artifacts),
  };
}

/** Open pages in each worker at the end of each of its tests, from the censuses in order. */
function openPagesByWorker(censuses: ResourceCensus[]): WireResourceReport['workers'] {
  const byWorker = new Map<number, ResourceCensus[]>();
  for (const census of censuses) {
    const list = byWorker.get(census.worker) ?? [];
    list.push(census);
    byWorker.set(census.worker, list);
  }
  const out: WireResourceReport['workers'] = [];
  for (const [worker, list] of [...byWorker.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.at - b.at);
    const kinds = new Map<number, string>();
    const points: number[] = [];
    for (const census of list) {
      for (const birth of census.born) kinds.set(birth.id, birth.kind);
      if (census.test) points.push(census.open.filter((open) => kinds.get(open.id) === 'page').length);
    }
    if (points.length > 0) out.push({ worker, openPages: downsample(points, REPORT_WORKER_POINTS_CAP) });
  }
  return out;
}

/** The run's report as the dashboard stores it. */
export function resourceReportWire(input: {
  report: ResourceReport | null;
  profile: RunProfile | null;
  censuses: ResourceCensus[];
  artifacts: ArtifactBytes;
  shardIndex: number | null;
}): WireResourceReport {
  const { report, profile } = input;
  return {
    v: 1,
    shardIndex: input.shardIndex,
    findings: (report?.findings ?? []).slice(0, REPORT_FINDINGS_CAP),
    counts: report?.counts ?? { leaked: 0, idle: 0, piling: 0, handle: 0, probable: 0 },
    profile: profile
      ? { ...profile, cpu: { ...profile.cpu, series: downsample(profile.cpu.series, REPORT_SERIES_CAP) } }
      : null,
    workers: openPagesByWorker(input.censuses),
    artifactBytes: nonZero(input.artifacts) ?? {},
    workerHealth: workerHealthOf(input.censuses),
  };
}
