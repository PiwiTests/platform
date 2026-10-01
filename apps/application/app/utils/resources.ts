/**
 * How the Resources tab and the execution's cost read what a reporter measured:
 * one finding as a label, a place and its facts, and the machine a run ran on
 * as one line per resource, in the words the reporter's end-of-run summary uses.
 */
import type {
  ProcessRole,
  ResourceVerdict,
  WireExecutionResources,
  WireResourceFinding,
  WireResourceReport,
  WireRunProfile,
  WorkerHealth,
} from '#shared/types';
import type { StoredResourceReport } from '#shared/resource-report';

/** `5.6 s`, `2 min 3 s`, `850 ms`. */
export function formatCpuTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

/** `845 kB`, `120 MB`, `1.4 GB`. */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} kB`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const VERDICT_LABEL: Record<ResourceVerdict, string> = {
  leaked: 'Leaked',
  idle: 'Never used',
  piling: 'Piling up',
  handle: 'Left running',
  probable: 'Probable leak',
};

const KIND_LABEL: Record<WireResourceFinding['kind'], string> = {
  browser: 'browser',
  context: 'context',
  page: 'page',
  request: 'API context',
  handle: 'handle',
};

/** Node's handle type names, as a reader knows them. */
const HANDLE_LABEL: Record<string, string> = {
  TCPServerWrap: 'server',
  FSEventWrap: 'file watcher',
  StatWatcher: 'file watcher',
};

const GROWTH_NOUN = { pages: 'open pages', listeners: 'listeners', routes: 'route handlers' } as const;

export interface FindingView {
  /** `Leaked context`, `Never used page`, `Piling up listeners`. */
  label: string;
  /** Where it was opened, as the reporter named it; null for a Node handle. */
  where: string | null;
  /** The `file:line` that opened it, for the open-in-IDE link. */
  site: string | null;
  /** The facts, in the order the summary prints them. */
  facts: string[];
}

/** One finding as a row reads it. */
export function findingView(finding: WireResourceFinding): FindingView {
  const what =
    finding.verdict === 'handle'
      ? (HANDLE_LABEL[finding.where] ?? finding.where)
      : finding.growth
        ? GROWTH_NOUN[finding.growth.what]
        : KIND_LABEL[finding.kind];
  const facts: string[] = [];
  switch (finding.verdict) {
    case 'leaked': {
      if (finding.count > 1) facts.push(`${finding.count} ${KIND_LABEL[finding.kind]}s`);
      if (finding.detail) facts.push(finding.detail);
      if (finding.pages) facts.push(`with ${plural(finding.pages, 'page')}`);
      if (finding.tests) facts.push(plural(finding.tests, 'test'));
      const past = finding.scope === 'describe' ? 'its describe block' : 'its test';
      if (finding.closedByPiwi) facts.push('closed by Piwi at the end of its test');
      else if (finding.untilWorkerEnd)
        facts.push(`open until the worker shut down (${formatCpuTime(finding.heldMs ?? 0)} past ${past})`);
      else facts.push(`open ${formatCpuTime(finding.heldMs ?? 0)} past ${past}`);
      if ((finding.afterTestCpuMs ?? 0) >= 500)
        facts.push(`${formatCpuTime(finding.afterTestCpuMs!)} of page CPU after its test`);
      break;
    }
    case 'idle':
      facts.push(plural(finding.count, 'page'));
      if (finding.tests) facts.push(plural(finding.tests, 'test'));
      if (finding.detail) facts.push(finding.detail);
      break;
    case 'piling': {
      const growth = finding.growth;
      if (growth) facts.push(`${growth.from} → ${growth.to} over ${growth.tests} tests`);
      break;
    }
    case 'handle':
      facts.push(`left running in the worker by ${finding.detail ?? 'a test'}`);
      break;
    case 'probable':
      if (finding.detail) facts.push(finding.detail);
      break;
  }
  return {
    label: `${VERDICT_LABEL[finding.verdict]} ${what}`,
    where: finding.verdict === 'handle' ? null : finding.where,
    site: finding.site ?? null,
    facts,
  };
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

const ARTIFACT_LABEL = { trace: 'traces', video: 'videos', screenshot: 'screenshots', other: 'other' } as const;

/** `3 min 1 s` past the run's start, as `3:01`. */
function clock(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The machine in one line: cores, memory, its limits. */
export function machineHead(profile: WireRunProfile): string {
  const { machine, cpu } = profile;
  const head = [
    `${machine.cores} cores${machine.cpuQuotaCores ? ` (a quota of ${machine.cpuQuotaCores})` : ''}`,
    formatSize(machine.memoryBytes),
  ];
  if (machine.memoryLimitBytes) head.push(`container limit ${formatSize(machine.memoryLimitBytes)}`);
  if (cpu.stealPct !== null && cpu.stealPct >= 1) head.push(`steal ${cpu.stealPct}%`);
  return head.join(' · ');
}

export interface MachineFact {
  label: 'CPU' | 'Memory' | 'Disk' | 'Workers' | 'Not measured';
  facts: string[];
}

function cpuFacts(profile: WireRunProfile): string[] {
  const facts: string[] = [];
  if (profile.cpu.busyPct !== null) facts.push(`${Math.round(profile.cpu.busyPct)}% busy`);
  if (profile.cpu.pressurePct !== null) {
    facts.push(`a task waited for a CPU ${Math.round(profile.cpu.pressurePct)}% of the time`);
  }
  const roles = Object.entries(profile.cpu.byRole ?? {}) as Array<
    [ProcessRole, NonNullable<WireRunProfile['cpu']['byRole']>[ProcessRole]]
  >;
  const total = roles.reduce((sum, [, usage]) => sum + (usage?.cpuMs ?? 0), 0);
  if (total > 0) {
    const top = roles
      .filter(([, usage]) => (usage?.cpuMs ?? 0) >= total * 0.02)
      .sort((a, b) => (b[1]?.cpuMs ?? 0) - (a[1]?.cpuMs ?? 0))
      .slice(0, 5)
      .map(([role, usage]) => `${ROLE_LABEL[role]} ${formatCpuTime(usage!.cpuMs)}`);
    facts.push(`${formatCpuTime(total)} of CPU: ${top.join(', ')}`);
    const waiting = roles
      .filter(([, usage]) => (usage?.runWaitMs ?? 0) >= 1000)
      .sort((a, b) => (b[1]?.runWaitMs ?? 0) - (a[1]?.runWaitMs ?? 0))[0];
    if (waiting) facts.push(`${ROLE_LABEL[waiting[0]]} waited ${formatCpuTime(waiting[1]!.runWaitMs!)} for a CPU`);
  }
  if (profile.cpu.throttledMs) {
    facts.push(`the container's CPU quota held it back ${formatCpuTime(profile.cpu.throttledMs)}`);
  }
  return facts;
}

function memoryFacts(profile: WireRunProfile): string[] {
  const { memory, machine } = profile;
  const facts: string[] = [];
  if (memory.kind && memory.peakBytes !== null) {
    const fallbacks = memory.rssFallbacks ? `, ${memory.rssFallbacks} by RSS` : '';
    const at = memory.peakAtMs !== null ? ` at ${clock(memory.peakAtMs)}` : '';
    facts.push(`peak ${formatSize(memory.peakBytes)} (${memory.kind.toUpperCase()}${fallbacks})${at}`);
    const limit = machine.memoryLimitBytes;
    const whole = limit ?? machine.memoryBytes;
    if (whole > 0) {
      facts.push(`${Math.round((memory.peakBytes / whole) * 100)}% of the ${limit ? 'limit' : "machine's memory"}`);
    }
    if (memory.largest) {
      facts.push(`largest process: ${ROLE_SINGULAR[memory.largest.role]} ${formatSize(memory.largest.bytes)}`);
    }
  }
  if (memory.containerPeakBytes !== null)
    facts.push(`the container peaked at ${formatSize(memory.containerPeakBytes)}`);
  if (memory.oomKills) {
    facts.push(`${memory.oomKills} process${memory.oomKills === 1 ? '' : 'es'} killed for memory`);
  }
  if (memory.pressurePct !== null) {
    facts.push(
      memory.pressurePct >= 0.1 ? `a task waited for memory ${memory.pressurePct}% of the time` : 'no memory pressure',
    );
  }
  if (memory.lowestAvailableBytes !== null && memory.lowestAvailableBytes < machine.memoryBytes * 0.1) {
    facts.push(`${formatSize(memory.lowestAvailableBytes)} available at the low point`);
  }
  return facts;
}

function diskFacts(profile: WireRunProfile, artifacts: WireResourceReport['artifactBytes']): string[] {
  const facts: string[] = [];
  const kinds = (Object.entries(artifacts) as Array<[keyof typeof ARTIFACT_LABEL, number]>).filter(
    ([, bytes]) => bytes > 0,
  );
  const total = kinds.reduce((sum, [, bytes]) => sum + bytes, 0);
  facts.push(
    total > 0
      ? `${formatSize(total)} of artifacts (${kinds
          .sort((a, b) => b[1] - a[1])
          .map(([kind, bytes]) => `${ARTIFACT_LABEL[kind]} ${formatSize(bytes)}`)
          .join(', ')})`
      : 'no artifacts',
  );
  const { disk } = profile;
  if (disk.peakInUseBytes !== null && disk.peakInUseBytes > 0) {
    facts.push(`${disk.peakInUseIsLowerBound ? 'at least ' : ''}${formatSize(disk.peakInUseBytes)} in use at the peak`);
  }
  if (disk.lowestFreeBytes !== null) facts.push(`${formatSize(disk.lowestFreeBytes)} free at the low point`);
  if (disk.leftoverBytes !== null && disk.leftoverBytes >= 10 * 1024 ** 2) {
    facts.push(`${formatSize(disk.leftoverBytes)} left in the temp folder by earlier runs`);
  }
  return facts;
}

function workerFacts(workers: WorkerHealth | null): string[] {
  if (!workers || workers.tests === 0) return [];
  return [
    `event loop busy ${Math.round(workers.loopUtilization * 100)}%`,
    `p99 delay ${Math.round(workers.loopDelayP99Ms)} ms at worst`,
    `${Math.round(workers.involuntarySwitchesPerTest).toLocaleString('en-US')} involuntary context switches per test`,
  ];
}

/** What one reporter measured about its machine, one line per resource. */
export function machineFacts(part: WireResourceReport): MachineFact[] {
  const profile = part.profile;
  const out: MachineFact[] = [];
  if (profile) {
    out.push({ label: 'CPU', facts: cpuFacts(profile) }, { label: 'Memory', facts: memoryFacts(profile) });
    out.push({ label: 'Disk', facts: diskFacts(profile, part.artifactBytes) });
  }
  out.push({ label: 'Workers', facts: workerFacts(part.workerHealth) });
  if (profile?.notMeasured.length) out.push({ label: 'Not measured', facts: [profile.notMeasured.join(', ')] });
  return out.filter((fact) => fact.facts.length > 0);
}

export interface ResourceTotals {
  counts: Record<ResourceVerdict, number>;
  /** CPU of every process the reporters sampled, across the run's machines; null when none sampled. */
  cpuMs: number | null;
  /** Time those processes waited for a CPU; null when no machine could tell. */
  runWaitMs: number | null;
  /** The largest peak of the run's machines. */
  peakMemoryBytes: number | null;
  artifactBytes: number;
}

/** The figures the tab's tiles show, summed over the shards. */
export function resourceTotals(report: StoredResourceReport): ResourceTotals {
  const counts: Record<ResourceVerdict, number> = { leaked: 0, idle: 0, piling: 0, handle: 0, probable: 0 };
  let cpuMs: number | null = null;
  let runWaitMs: number | null = null;
  let peakMemoryBytes: number | null = null;
  let artifactBytes = 0;
  for (const part of report.parts) {
    for (const verdict of Object.keys(counts) as ResourceVerdict[]) counts[verdict] += part.counts[verdict] ?? 0;
    for (const usage of Object.values(part.profile?.cpu.byRole ?? {})) {
      if (!usage) continue;
      cpuMs = (cpuMs ?? 0) + usage.cpuMs;
      if (usage.runWaitMs !== null) runWaitMs = (runWaitMs ?? 0) + usage.runWaitMs;
    }
    const peak = part.profile?.memory.peakBytes ?? null;
    if (peak !== null) peakMemoryBytes = Math.max(peakMemoryBytes ?? 0, peak);
    artifactBytes += Object.values(part.artifactBytes).reduce((sum, bytes) => sum + (bytes ?? 0), 0);
  }
  return { counts, cpuMs, runWaitMs, peakMemoryBytes, artifactBytes };
}

/** The browser processes of an execution, costliest first: `renderers 4.1 s`. */
export function executionRoleFacts(resources: WireExecutionResources): string[] {
  return (
    Object.entries(resources.roles ?? {}) as Array<
      [ProcessRole, NonNullable<WireExecutionResources['roles']>[ProcessRole]]
    >
  )
    .filter(([, cost]) => (cost?.cpuMs ?? 0) > 0)
    .sort((a, b) => (b[1]?.cpuMs ?? 0) - (a[1]?.cpuMs ?? 0))
    .map(([role, cost]) => `${ROLE_LABEL[role]} ${formatCpuTime(cost!.cpuMs)}`);
}
