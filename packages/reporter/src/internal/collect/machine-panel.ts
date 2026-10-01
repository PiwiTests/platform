import type { ProcessRole } from '../support/system-readers.js';
import type { ResourceCensus } from '../capture/resource-ledger.js';
import type { RunProfile } from './process-sampler.js';
import { formatHeld } from './resource-verdicts.js';

/**
 * The machine panel of the end-of-run summary: what the run had (cores,
 * memory, the container's limits) and what it used of it (CPU by role, waiting
 * for a CPU, peak memory, disk), from the run sampler, the artifacts the tests
 * attached and, with the capture fixtures, the workers' own health.
 */

export type ArtifactKind = 'trace' | 'video' | 'screenshot' | 'other';

/** Bytes of the files tests attached, by kind. */
export type ArtifactBytes = Record<ArtifactKind, number>;

/** The worker processes' health over the run's tests, from the censuses. */
export interface WorkerHealth {
  tests: number;
  /** Mean share of each test's time the worker's event loop was busy. */
  loopUtilization: number;
  /** The worst test's p99 event-loop delay. */
  loopDelayP99Ms: number;
  /** Mean involuntary context switches of the worker per test. */
  involuntarySwitchesPerTest: number;
}

/** The workers' health over the tests whose census carried their metrics; null without any. */
export function workerHealthOf(censuses: ResourceCensus[]): WorkerHealth | null {
  const measured = censuses.filter((census) => census.test && census.metrics);
  if (measured.length === 0) return null;
  let utilization = 0;
  let switches = 0;
  let worstP99 = 0;
  for (const census of measured) {
    const worker = census.metrics!.worker;
    utilization += worker.loopUtilization;
    switches += worker.involuntarySwitches;
    worstP99 = Math.max(worstP99, worker.loopDelayP99Ms);
  }
  return {
    tests: measured.length,
    loopUtilization: utilization / measured.length,
    loopDelayP99Ms: worstP99,
    involuntarySwitchesPerTest: switches / measured.length,
  };
}

/** The kind of an attachment's file, by Playwright's attachment names. */
export function artifactKind(name: string, contentType: string): ArtifactKind {
  if (name === 'trace') return 'trace';
  if (name === 'video' || contentType.startsWith('video/')) return 'video';
  if (name === 'screenshot' || contentType.startsWith('image/')) return 'screenshot';
  return 'other';
}

export function emptyArtifacts(): ArtifactBytes {
  return { trace: 0, video: 0, screenshot: 0, other: 0 };
}

const ROLE_LABEL: Record<ProcessRole, string> = {
  renderer: 'renderers',
  browser: 'browsers',
  worker: 'workers',
  gpu: 'GPU',
  utility: 'browser utilities',
  ffmpeg: 'ffmpeg',
  webServer: 'web server',
  runner: 'runner',
  other: 'other',
};

const ROLE_SINGULAR: Record<ProcessRole, string> = {
  renderer: 'renderer',
  browser: 'browser',
  worker: 'worker',
  gpu: 'GPU',
  utility: 'browser utility',
  ffmpeg: 'ffmpeg',
  webServer: 'web server',
  runner: 'runner',
  other: 'other',
};

const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  trace: 'traces',
  video: 'videos',
  screenshot: 'screenshots',
  other: 'other',
};

const BARS = '▁▂▃▄▅▆▇█';

/** `845 kB`, `120 MB`, `1.4 GB`. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} kB`;
}

/** At most `width` bars over a series of percentages, each the mean of its slice. */
export function sparkline(series: number[], width = 24): string {
  if (series.length < 3) return '';
  const buckets = Math.min(width, series.length);
  let out = '';
  for (let i = 0; i < buckets; i++) {
    const slice = series.slice(
      Math.floor((i * series.length) / buckets),
      Math.floor(((i + 1) * series.length) / buckets),
    );
    const mean = slice.reduce((sum, v) => sum + v, 0) / Math.max(1, slice.length);
    out += BARS[Math.min(BARS.length - 1, Math.max(0, Math.floor((mean / 100) * BARS.length)))];
  }
  return out;
}

/** `m:ss` after the run started. */
function clock(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function cpuLine(profile: RunProfile): string | null {
  const parts: string[] = [];
  const spark = sparkline(profile.cpu.series);
  if (profile.cpu.busyPct !== null) parts.push(`${spark ? `${spark} ` : ''}${Math.round(profile.cpu.busyPct)}% busy`);
  if (profile.cpu.pressurePct !== null) {
    parts.push(`a task waited for a CPU ${Math.round(profile.cpu.pressurePct)}% of the time`);
  }
  const roles = Object.entries(profile.cpu.byRole ?? {}) as Array<
    [ProcessRole, NonNullable<RunProfile['cpu']['byRole']>[ProcessRole]]
  >;
  const total = roles.reduce((sum, [, usage]) => sum + (usage?.cpuMs ?? 0), 0);
  if (total > 0) {
    const top = roles
      .filter(([, usage]) => (usage?.cpuMs ?? 0) >= total * 0.02)
      .sort((a, b) => (b[1]?.cpuMs ?? 0) - (a[1]?.cpuMs ?? 0))
      .slice(0, 5)
      .map(([role, usage]) => `${ROLE_LABEL[role]} ${formatHeld(usage!.cpuMs)}`);
    parts.push(`${formatHeld(total)} of CPU: ${top.join(' · ')}`);
    const waiting = roles
      .filter(([, usage]) => (usage?.runWaitMs ?? 0) >= 1000)
      .sort((a, b) => (b[1]?.runWaitMs ?? 0) - (a[1]?.runWaitMs ?? 0))[0];
    if (waiting) parts.push(`${ROLE_LABEL[waiting[0]]} waited ${formatHeld(waiting[1]!.runWaitMs!)} for a CPU`);
  }
  if (profile.cpu.throttledMs)
    parts.push(`the container's CPU quota held it back ${formatHeld(profile.cpu.throttledMs)}`);
  return parts.length ? `  CPU      ${parts.join(' · ')}` : null;
}

function memoryLine(profile: RunProfile): string | null {
  const { memory, machine } = profile;
  const parts: string[] = [];
  if (memory.kind && memory.peakBytes !== null) {
    const fallbacks = memory.rssFallbacks ? `, ${memory.rssFallbacks} by RSS` : '';
    const at = memory.peakAtMs !== null ? ` at ${clock(memory.peakAtMs)}` : '';
    parts.push(`peak ${formatBytes(memory.peakBytes)} (${memory.kind.toUpperCase()}${fallbacks})${at}`);
    const limit = machine.memoryLimitBytes;
    const whole = limit ?? machine.memoryBytes;
    if (whole > 0)
      parts.push(`${Math.round((memory.peakBytes / whole) * 100)}% of the ${limit ? 'limit' : "machine's memory"}`);
    if (memory.largest)
      parts.push(`largest process: ${ROLE_SINGULAR[memory.largest.role]} ${formatBytes(memory.largest.bytes)}`);
  }
  if (memory.containerPeakBytes !== null)
    parts.push(`the container peaked at ${formatBytes(memory.containerPeakBytes)}`);
  if (memory.oomKills) parts.push(`${memory.oomKills} process${memory.oomKills === 1 ? '' : 'es'} killed for memory`);
  if (memory.pressurePct !== null) {
    parts.push(
      memory.pressurePct >= 0.1 ? `a task waited for memory ${memory.pressurePct}% of the time` : 'no memory pressure',
    );
  }
  if (memory.lowestAvailableBytes !== null && memory.lowestAvailableBytes < machine.memoryBytes * 0.1) {
    parts.push(`${formatBytes(memory.lowestAvailableBytes)} available at the low point`);
  }
  return parts.length ? `  Memory   ${parts.join(' · ')}` : null;
}

function diskLine(profile: RunProfile, artifacts: ArtifactBytes | null): string | null {
  const parts: string[] = [];
  if (artifacts) {
    const kinds = (Object.entries(artifacts) as Array<[ArtifactKind, number]>).filter(([, bytes]) => bytes > 0);
    const total = kinds.reduce((sum, [, bytes]) => sum + bytes, 0);
    parts.push(
      total > 0
        ? `${formatBytes(total)} of artifacts (${kinds
            .sort((a, b) => b[1] - a[1])
            .map(([kind, bytes]) => `${ARTIFACT_LABEL[kind]} ${formatBytes(bytes)}`)
            .join(' · ')})`
        : 'no artifacts',
    );
  }
  const { disk } = profile;
  if (disk.peakInUseBytes !== null && disk.peakInUseBytes > 0) {
    parts.push(
      `${disk.peakInUseIsLowerBound ? 'at least ' : ''}${formatBytes(disk.peakInUseBytes)} in use at the peak`,
    );
  }
  if (disk.lowestFreeBytes !== null) parts.push(`${formatBytes(disk.lowestFreeBytes)} free at the low point`);
  if (disk.leftoverBytes !== null && disk.leftoverBytes >= 10 * 1024 ** 2) {
    parts.push(`${formatBytes(disk.leftoverBytes)} left in the temp folder by earlier runs`);
  }
  return parts.length ? `  Disk     ${parts.join(' · ')}` : null;
}

function workersLine(workers: WorkerHealth | null): string | null {
  if (!workers || workers.tests === 0) return null;
  return `  Workers  event loop busy ${Math.round(workers.loopUtilization * 100)}% · p99 delay ${Math.round(
    workers.loopDelayP99Ms,
  )} ms at worst · ${Math.round(workers.involuntarySwitchesPerTest).toLocaleString('en-US')} involuntary context switches per test`;
}

/** The panel's lines, without the logger prefix. */
export function formatMachinePanel(
  profile: RunProfile,
  extras: { artifacts: ArtifactBytes | null; workers: WorkerHealth | null },
): string[] {
  const { machine, cpu } = profile;
  const head = [
    `${machine.cores} cores${machine.cpuQuotaCores ? ` (a quota of ${machine.cpuQuotaCores})` : ''}`,
    formatBytes(machine.memoryBytes),
  ];
  if (machine.memoryLimitBytes) head.push(`container limit ${formatBytes(machine.memoryLimitBytes)}`);
  if (cpu.stealPct !== null && cpu.stealPct >= 1) head.push(`steal ${cpu.stealPct}%`);
  const lines = [
    `Machine: ${head.join(' · ')}`,
    cpuLine(profile),
    memoryLine(profile),
    diskLine(profile, extras.artifacts),
    workersLine(extras.workers),
  ].filter((line): line is string => line !== null);
  if (profile.notMeasured.length) lines.push(`  Not measured here: ${profile.notMeasured.join(', ')}`);
  return lines;
}
