/**
 * What the demo's runs cost and left open, for the seed generator and the run
 * simulator: each execution's cost as a worker measures it at the end of the
 * test, and the run's report as the reporter sends it with its finish (the
 * findings, the machine, the pages open in each worker test after test).
 *
 * A leaky run is a suite whose login fixture opens a browser context per test
 * and never closes it: every test after the first finds the earlier tests'
 * pages still open in its worker, those pages keep using CPU and memory, and
 * the machine runs short of both. A clean run closes everything it opens.
 * Deterministic (no randomness), so the seed stays byte-stable. Pure plain JS,
 * run under Node for the generator and in the browser for the simulator.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** A stable 0..1 value from an integer, for variation without randomness. */
function wobble(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * One execution's cost. `openAtStart` is how many pages earlier tests of the
 * same worker left open (each in its own leaked context); in a leaky run they
 * keep rendering in the background, so the renderers' CPU and memory grow
 * with them.
 */
export function demoExecutionResources({ seq, durationMs, openAtStart = 0, leaky = false }) {
  const w = wobble(seq);
  const background = leaky ? openAtStart : 0;
  const rendererCpu = Math.round(durationMs * (0.32 + 0.06 * w) + background * durationMs * 0.11);
  return {
    workerCpuMs: Math.round(260 + 180 * w),
    roles: {
      renderer: {
        cpuMs: rendererCpu,
        runWaitMs: Math.round(rendererCpu * (leaky ? 0.08 + background * 0.03 : 0.02)),
        peakRssMb: Math.round(150 + 30 * w + background * 46),
        processes: 1 + background,
      },
      browser: {
        cpuMs: Math.round(durationMs * 0.05),
        runWaitMs: null,
        peakRssMb: Math.round(210 + 20 * w),
        processes: 1,
      },
      gpu: { cpuMs: Math.round(durationMs * 0.03), runWaitMs: null, peakRssMb: Math.round(90 + 10 * w), processes: 1 },
    },
    loopUtilization: Math.round((0.16 + 0.08 * w + (leaky ? 0.03 * background : 0)) * 100) / 100,
    loopDelayP99Ms: Math.round(21 + 6 * w + (leaky ? 9 * background : 0)),
    involuntarySwitches: Math.round(120 + 90 * w + (leaky ? 260 * background : 0)),
    heapUsedMb: Math.round(58 + 9 * w + (leaky ? 3 * background : 0)),
    openAtStart: { contexts: background, pages: background },
    leftOpen: leaky ? 1 : 0,
    artifactBytes: { trace: Math.round((1.1 + 0.6 * w) * MB), screenshot: Math.round((60 + 40 * w) * 1024) },
  };
}

/** The open pages a worker counts at the end of each of its tests. */
export function demoOpenPages(testsInWorker, leaky) {
  return Array.from({ length: testsInWorker }, (_, i) => (leaky ? i + 2 : 1));
}

/** The CPU busy series of a run, in percent, one point per sample. */
function busySeries(points, leaky) {
  return Array.from({ length: points }, (_, i) => {
    const t = i / Math.max(1, points - 1);
    const base = leaky ? 52 + 44 * t : 58 + 6 * Math.sin(t * 9);
    return Math.round(Math.min(100, base + 5 * (wobble(i + 7) - 0.5)) * 10) / 10;
  });
}

/**
 * The findings of a leaky run. `fixtureFile` is where the suite's fixtures
 * live, `tests` how many tests used the leaking fixture, `handleTest` the test
 * that left a server running in its worker.
 */
function leakyFindings({ fixtureFile, tests, wallMs, handleTest }) {
  return [
    {
      verdict: 'leaked',
      kind: 'context',
      where: `fixture "loggedInContext" at ${fixtureFile}:14`,
      site: `${fixtureFile}:14`,
      scope: 'test',
      tests,
      count: tests,
      heldMs: Math.round(wallMs * 0.82),
      untilWorkerEnd: true,
      pages: tests,
      afterTestCpuMs: Math.round(wallMs * 0.21),
    },
    {
      verdict: 'idle',
      kind: 'page',
      where: 'fixture "page"',
      tests: Math.max(1, Math.round(tests / 2)),
      count: Math.max(1, Math.round(tests / 2)),
      detail: 'set up with loggedInPage',
    },
    {
      verdict: 'piling',
      kind: 'page',
      where: `fixture "sharedPage" at ${fixtureFile}:31`,
      site: `${fixtureFile}:31`,
      tests: 3,
      count: 1,
      growth: { what: 'listeners', from: 2, to: 8, tests: 3 },
    },
    {
      verdict: 'handle',
      kind: 'handle',
      where: 'TCPServerWrap',
      tests: 1,
      count: 1,
      detail: `"${handleTest.title}" (${handleTest.file})`,
    },
  ];
}

/**
 * The run's report. `workers` lists each worker with how many tests it ran;
 * `artifactBytes` is the sum of the executions' artifacts.
 */
export function demoResourceReport({
  leaky = false,
  wallMs,
  workers,
  fixtureFile,
  handleTest,
  artifactBytes,
  shardIndex = null,
}) {
  const tests = workers.reduce((sum, w) => sum + w.tests, 0);
  const findings = leaky ? leakyFindings({ fixtureFile, tests, wallMs, handleTest }) : [];
  const counts = { leaked: 0, idle: 0, piling: 0, handle: 0, probable: 0 };
  for (const finding of findings) counts[finding.verdict] += finding.verdict === 'idle' ? finding.count : 1;
  const seconds = wallMs / 1000;
  const cores = 4;
  return {
    v: 1,
    shardIndex,
    findings,
    counts,
    profile: {
      platform: 'linux',
      wallMs: Math.round(wallMs),
      machine: { cores, memoryBytes: 16 * GB, memoryLimitBytes: null, cpuQuotaCores: null },
      cpu: {
        busyPct: leaky ? 88 : 61,
        iowaitPct: 1.2,
        stealPct: 0,
        pressurePct: leaky ? 41 : 6,
        series: busySeries(Math.min(240, Math.max(12, Math.round(seconds))), leaky),
        byRole: {
          renderer: {
            cpuMs: Math.round(seconds * 1000 * (leaky ? 2.1 : 1.15)),
            runWaitMs: Math.round(seconds * 1000 * (leaky ? 0.62 : 0.04)),
            processes: leaky ? tests + workers.length : workers.length,
          },
          browser: {
            cpuMs: Math.round(seconds * 1000 * 0.22),
            runWaitMs: Math.round(seconds * 30),
            processes: workers.length,
          },
          worker: {
            cpuMs: Math.round(seconds * 1000 * 0.31),
            runWaitMs: Math.round(seconds * 20),
            processes: workers.length,
          },
          gpu: { cpuMs: Math.round(seconds * 1000 * 0.12), runWaitMs: null, processes: workers.length },
          webServer: { cpuMs: Math.round(seconds * 1000 * 0.18), runWaitMs: null, processes: 1 },
          runner: { cpuMs: Math.round(seconds * 1000 * 0.04), runWaitMs: null, processes: 1 },
        },
        throttledMs: null,
      },
      memory: {
        kind: 'pss',
        peakBytes: leaky ? 9.6 * GB : 4.1 * GB,
        peakAtMs: Math.round(wallMs * (leaky ? 0.94 : 0.41)),
        largest: { role: 'renderer', bytes: leaky ? 620 * MB : 240 * MB },
        rssFallbacks: 0,
        pressurePct: leaky ? 2.4 : 0,
        lowestAvailableBytes: leaky ? 1.1 * GB : 9.8 * GB,
        containerPeakBytes: null,
        oomKills: 0,
      },
      disk: {
        peakInUseBytes: Math.round(artifactBytes * 1.4),
        peakInUseIsLowerBound: false,
        lowestFreeBytes: 18.2 * GB,
        leftoverBytes: leaky ? 640 * MB : 0,
      },
      notMeasured: [],
    },
    workers: workers.map((w) => ({ worker: w.worker, openPages: demoOpenPages(w.tests, leaky) })),
    artifactBytes: { trace: Math.round(artifactBytes * 0.94), screenshot: Math.round(artifactBytes * 0.06) },
    workerHealth: {
      tests,
      loopUtilization: leaky ? 0.41 : 0.21,
      loopDelayP99Ms: leaky ? 96 : 27,
      involuntarySwitchesPerTest: leaky ? 2400 : 180,
    },
  };
}
