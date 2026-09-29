import { describe, expect, it, vi } from 'vitest';
import type { FlakeCondition, FlakeResultLine } from '@piwitests/core/flake-plan';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  FLAKE_BATCH_RUNS,
  armDone,
  bisectExitCode,
  countArm,
  estimateMs,
  exitCodeFor,
  grepFor,
  nextBatch,
  parseDuration,
  playwrightArgs,
  roundKept,
  verifyVerdict,
  type LabArm,
  type LabPlan,
} from '../src/internal/flake/lab.js';
import {
  armLine,
  commitsDiffer,
  parseFlakeArgs,
  runFlake,
  runSession,
  sessionVerdict,
  type FlakeRunner,
} from '../src/cli/flake.js';

const ADMIN = { file: 'tests/admin.spec.ts', title: 'resets catalog', suite: ['admin'] };
const DELAY: FlakeCondition = { kind: 'delay', route: 'GET /api/cart', ms: 1800, match: 'all' };

let clock = 1_000_000;
/** A results line; each call starts a second after the last unless `startedAt` is given. */
function line(over: Partial<FlakeResultLine> = {}): FlakeResultLine {
  clock += 1000;
  return {
    version: 1,
    experimentId: '1',
    armId: 'arm',
    role: 'target',
    file: 'tests/checkout.spec.ts',
    title: 'pays',
    project: 'chromium',
    browserName: 'chromium',
    status: 'passed',
    errorSignature: null,
    matchesHistory: false,
    startedAt: clock,
    duration: 500,
    workerIndex: 0,
    parallelIndex: 0,
    repeatEachIndex: 0,
    retry: 0,
    conditions: [],
    ...over,
  };
}
const pass = () => line();
const match = () => line({ status: 'failed', errorSignature: 'Error: total', matchesHistory: true });
const other = () => line({ status: 'failed', errorSignature: 'Error: something else', matchesHistory: false });

const arm = (over: Partial<LabArm> = {}): LabArm => ({
  id: 'suspect-1',
  label: 'delay GET /api/cart 1.8 s',
  suspectId: 'slow-route:GET /api/cart',
  rank: 1,
  conditions: [DELAY],
  runs: 10,
  stopAt: 3,
  ...over,
});

describe('early stop at matching failures', () => {
  it('counts only failures whose signature matches history, other failures apart', () => {
    const count = countArm([[pass(), other(), match(), pass(), other()]], arm({ stopAt: null }));
    expect(count).toMatchObject({ runs: 5, matchingFailures: 1, otherFailures: 2, stoppedEarly: false });
    expect(count.otherSignatures).toEqual(['Error: something else']);
  });

  it('never stops on other failures, however many', () => {
    const count = countArm([[other(), other(), other(), other()]], arm());
    expect(count).toMatchObject({ runs: 4, matchingFailures: 0, otherFailures: 4, stoppedEarly: false });
    expect(armDone(count, arm())).toBe(false);
  });

  it('cuts a batch that ran past the third matching failure, as a run that stopped there would', () => {
    const count = countArm([[match(), match(), pass(), match(), match()]], arm());
    expect(count).toMatchObject({ runs: 4, matchingFailures: 3, stoppedEarly: true });
    expect(armDone(count, arm())).toBe(true);
  });

  it('reads batches in the order they ran and stops across them', () => {
    const count = countArm(
      [
        [pass(), match(), pass(), pass(), match()],
        [pass(), match(), match()],
      ],
      arm(),
    );
    expect(count).toMatchObject({ runs: 7, matchingFailures: 3, stoppedEarly: true });
  });

  it('leaves out skipped and interrupted attempts, and companion lines', () => {
    const count = countArm(
      [[pass(), line({ status: 'skipped' }), line({ status: 'interrupted' }), line({ role: 'companion' })]],
      arm(),
    );
    expect(count.runs).toBe(1);
  });

  it('asks for batches of a few runs, and the whole control at once', () => {
    const empty = countArm([], arm());
    expect(nextBatch(empty, arm())).toBe(FLAKE_BATCH_RUNS);
    expect(nextBatch({ ...empty, runs: 8 }, arm())).toBe(2);
    expect(nextBatch(empty, arm({ id: 'control', stopAt: null }))).toBe(10);
    expect(armDone({ ...empty, runs: 10 }, arm())).toBe(true);
  });
});

describe('alongside and after rounds', () => {
  const alongside: FlakeCondition[] = [{ kind: 'alongside', test: ADMIN }];
  const after: FlakeCondition[] = [{ kind: 'after', test: ADMIN }];

  it('keeps an alongside round only when the companion overlapped it', () => {
    const target = line({ startedAt: 10_000, duration: 1000 });
    const overlapping = line({ role: 'companion', startedAt: 10_500, duration: 1000 });
    const late = line({ role: 'companion', startedAt: 20_000, duration: 1000 });
    expect(roundKept(target, [target, overlapping], alongside)).toBe(true);
    expect(roundKept(target, [target, late], alongside)).toBe(false);

    const lonely = line({ startedAt: 30_000, duration: 1000 });
    const count = countArm([[target, overlapping, lonely, late]], { conditions: alongside, stopAt: 3 });
    expect(count).toMatchObject({ runs: 1, discardedRounds: 1 });
  });

  it('keeps an after round only when the companion ran just before it', () => {
    const companion = line({ role: 'companion', startedAt: 1_000 });
    const first = line({ startedAt: 2_000 });
    const second = line({ startedAt: 3_000 });
    const all = [companion, first, second];
    expect(roundKept(first, all, after)).toBe(true);
    // The target ran just before this one, so the order is not the one asked for.
    expect(roundKept(second, all, after)).toBe(false);
    expect(countArm([all], { conditions: after, stopAt: 3 })).toMatchObject({ runs: 1, discardedRounds: 1 });
  });

  it('judges the order within one batch: a new Playwright run starts afresh', () => {
    const lastOfFirst = line({ role: 'companion', startedAt: 1_000 });
    const firstOfSecond = line({ startedAt: 2_000 });
    expect(countArm([[lastOfFirst], [firstOfSecond]], { conditions: after, stopAt: 3 })).toMatchObject({
      runs: 0,
      discardedRounds: 1,
    });
  });
});

describe('the Playwright arguments', () => {
  const test = { file: 'tests/checkout.spec.ts', title: 'pays (card)', suite: ['checkout'], project: 'chromium' };

  it('select the test by file and an anchored grep, retries off, one worker', () => {
    const args = playwrightArgs(test, arm(), 5);
    expect(args).toEqual([
      'tests/checkout.spec.ts',
      '--grep',
      '(^| )checkout pays \\(card\\)( @\\S+)*$',
      '--repeat-each=5',
      '--retries=0',
      '--workers=1',
      '--project=chromium',
    ]);
    const grep = new RegExp(args[2]!);
    expect(grep.test(' chromium tests/checkout.spec.ts checkout pays (card)')).toBe(true);
    expect(grep.test(' chromium tests/checkout.spec.ts checkout pays (card) twice')).toBe(false);
    expect(grep.test(' chromium tests/checkout.spec.ts checkout pays (card) @slow @cart')).toBe(true);
  });

  it('select both tests for alongside, on two workers, fully parallel when they share a file', () => {
    const args = playwrightArgs(test, { conditions: [{ kind: 'alongside', test: ADMIN }] }, 3);
    expect(args.slice(0, 2)).toEqual(['tests/checkout.spec.ts', 'tests/admin.spec.ts']);
    const grep = new RegExp(args[3]!);
    expect(grep.test('chromium tests/admin.spec.ts admin resets catalog')).toBe(true);
    expect(grep.test('chromium tests/checkout.spec.ts checkout pays (card)')).toBe(true);
    expect(args).toContain('--workers=2');
    expect(args).not.toContain('--fully-parallel');
    const same = playwrightArgs(test, { conditions: [{ kind: 'alongside', test: { ...ADMIN, file: test.file } }] }, 3);
    expect(same).toContain('--fully-parallel');
  });

  it('run both tests on one worker for after, and pass a project condition', () => {
    expect(playwrightArgs(test, { conditions: [{ kind: 'after', test: ADMIN }] }, 3)).toContain('--workers=1');
    expect(playwrightArgs(test, { conditions: [{ kind: 'project', name: 'firefox' }] }, 3)).toContain(
      '--project=firefox',
    );
    expect(playwrightArgs({ ...test, project: null }, arm(), 3).some((a) => a.startsWith('--project'))).toBe(false);
  });

  it('grep for several tests joins them', () => {
    expect(grepFor([ADMIN, { file: 'a', title: 'x.y', suite: [] }])).toBe(
      '(^| )admin resets catalog( @\\S+)*$|(^| )x\\.y( @\\S+)*$',
    );
  });
});

describe('the budget and the estimate', () => {
  it('reads durations', () => {
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('1h30m')).toBe(5_400_000);
    expect(parseDuration('20')).toBe(1_200_000);
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('10x')).toBeNull();
  });

  it('estimates from the median duration, doubled for two-test arms', () => {
    const control = arm({ id: 'control', conditions: [], stopAt: null });
    const two = arm({ conditions: [{ kind: 'alongside', test: ADMIN }] });
    expect(estimateMs([control], 2000)).toBe(10 * 2000 + 3000);
    expect(estimateMs([two], 2000)).toBe(10 * 4000 + 2 * 3000);
    expect(estimateMs([control], null)).toBeNull();
  });
});

describe('verdicts and exit codes', () => {
  it('exit 0 only when reproduced or verified', () => {
    expect(exitCodeFor('reproduced')).toBe(0);
    expect(exitCodeFor('verified')).toBe(0);
    expect(exitCodeFor('amplified')).toBe(1);
    expect(exitCodeFor('not-reproduced')).toBe(1);
    expect(exitCodeFor('still-fails')).toBe(1);
    expect(exitCodeFor('inconclusive')).toBe(1);
  });

  it('a bisect step answers good, bad or skip in git bisect run codes', () => {
    expect(bisectExitCode('verified')).toBe(0);
    expect(bisectExitCode('still-fails')).toBe(1);
    expect(bisectExitCode('inconclusive')).toBe(125);
  });

  it('verify holds at the D9 run count with no matching failure', () => {
    const count = countArm([[pass(), pass(), pass(), pass(), pass()]], arm({ stopAt: 1 }));
    expect(verifyVerdict(count, 0.75)).toBe('verified');
    expect(verifyVerdict({ ...count, runs: 4 }, 0.75)).toBe('inconclusive');
    expect(verifyVerdict({ ...count, matchingFailures: 1 }, 0.75)).toBe('still-fails');
  });

  it('compares commits whatever their length', () => {
    expect(commitsDiffer('9f2c1e0aa', '9f2c1e0')).toBe(false);
    expect(commitsDiffer('9f2c1e0', '4e1a7b2')).toBe(true);
    expect(commitsDiffer(null, '4e1a7b2')).toBe(false);
  });
});

describe('the command line', () => {
  it('reads its options', () => {
    expect(
      parseFlakeArgs(['1842', '--suspect', '2', '--runs', '6', '--budget', '5m', '--no-upload', '--json']),
    ).toMatchObject({ verify: false, test: '1842', suspect: 2, runs: 6, budgetMs: 300_000, upload: false, json: true });
    expect(parseFlakeArgs(['verify', 'tests/a.spec.ts:12'])).toMatchObject({
      verify: true,
      test: 'tests/a.spec.ts:12',
    });
    expect(parseFlakeArgs(['1', '--plan', 'p.json'])).toMatchObject({ planFile: 'p.json', upload: false });
    expect(() => parseFlakeArgs(['1', '--suspect', '1', '--all'])).toThrow(/cannot be used together/);
    expect(() => parseFlakeArgs(['1', '--runs', '0'])).toThrow(/whole number/);
    expect(() => parseFlakeArgs(['1', '--budget', 'later'])).toThrow(/duration/);
    expect(() => parseFlakeArgs(['1', '--frobnicate'])).toThrow(/unknown option/);
    expect(() => parseFlakeArgs(['verify', '1', '--all'])).toThrow(/verify reruns one arm/);
  });

  it('reads --bisect on verify only, and saves nothing with it', () => {
    expect(parseFlakeArgs(['verify', '1842', '--bisect'])).toMatchObject({ verify: true, bisect: true, upload: false });
    expect(() => parseFlakeArgs(['1842', '--bisect'])).toThrow(/--bisect is a verify option/);
  });

  it('reads --source from a closed list', () => {
    expect(parseFlakeArgs(['1842', '--source', 'desktop'])).toMatchObject({ source: 'desktop' });
    expect(parseFlakeArgs(['1842'])).toMatchObject({ source: null });
    expect(() => parseFlakeArgs(['1842', '--source', 'laptop'])).toThrow(/--source must be one of cli, ci, desktop/);
  });

  it('exits 2 on a bad option and with no dashboard to read the plan from', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runFlake(['1', '--nope'])).toBe(2);
    const saved = { ...process.env };
    delete process.env.PIWI_DASHBOARD_URL;
    process.env.PIWI_DESKTOP_CONFIG = '/nonexistent/desktop.json';
    try {
      expect(await runFlake(['1'])).toBe(2);
      expect(error.mock.calls.flat().join('\n')).toMatch(/no dashboard to read the plan from/);
    } finally {
      process.env = saved;
      error.mockRestore();
    }
  });
});

function planOf(over: Partial<LabPlan> = {}): LabPlan {
  return {
    version: 1,
    experimentId: '7',
    kind: 'reproduce',
    projectId: 1,
    testCaseId: 1842,
    test: { file: 'tests/checkout.spec.ts', title: 'pays', suite: ['checkout'], project: 'chromium' },
    displayTitle: 'checkout › pays',
    windowDays: 30,
    failures: 8,
    passes: 44,
    failureCommit: null,
    medianDurationMs: 1000,
    errorSignatures: ['Error: total'],
    suspects: [],
    control: arm({ id: 'control', label: 'control', suspectId: null, rank: null, conditions: [], stopAt: null }),
    arms: [
      arm(),
      arm({ id: 'suspect-2', rank: 2, label: 'CPU ×4', suspectId: 'load:3', conditions: [{ kind: 'cpu', rate: 4 }] }),
    ],
    combined: arm({ id: 'combined', rank: null, label: 'both', conditions: [DELAY, { kind: 'cpu', rate: 4 }] }),
    verifies: null,
    ...over,
  };
}

/** A runner whose arms fail as scripted: `script[armId](i)` is the i-th attempt of that arm. */
function fakeRunner(
  script: Record<string, (i: number) => FlakeResultLine>,
  advance = 0,
): FlakeRunner & { calls: string[] } {
  let now = 0;
  const seen: Record<string, number> = {};
  const calls: string[] = [];
  return {
    calls,
    now: () => now,
    async runBatch(_plan, a, repeat) {
      calls.push(`${a.id}×${repeat}`);
      now += advance;
      return Array.from({ length: repeat }, () => {
        const i = (seen[a.id] = (seen[a.id] ?? 0) + 1);
        return script[a.id]!(i);
      });
    },
  };
}

describe('a session', () => {
  it('runs the control, then each arm, stopping an arm at 3 matching failures', async () => {
    const runner = fakeRunner({
      control: () => pass(),
      'suspect-1': (i) => (i === 3 ? pass() : match()),
      'suspect-2': () => pass(),
    });
    const { control, arms } = await runSession(runner, planOf(), { suspect: null, all: false, budgetMs: 60_000 });
    expect(control.count.runs).toBe(10);
    expect(arms[0]).toMatchObject({
      verdict: 'reproduced',
      count: { runs: 4, matchingFailures: 3, stoppedEarly: true },
    });
    expect(arms[0]!.pValue).toBeCloseTo(0.011, 3);
    expect(arms[1]).toMatchObject({ verdict: 'not-reproduced', count: { runs: 10 } });
    expect(runner.calls).toEqual(['control×10', 'suspect-1×5', 'suspect-2×5', 'suspect-2×5']);
    expect(sessionVerdict('reproduce', arms)).toEqual({ verdict: 'reproduced', reproducingArm: 'suspect-1' });
    expect(armLine(arms[0]!, 3)).toMatch(
      /1 {2}delay GET \/api\/cart 1\.8 s +3\/4 +stopped at 3 · same error as in CI +reproduced/,
    );
  });

  it('runs one suspect with --suspect, and the combination with --all when none reproduces alone', async () => {
    const quiet = {
      control: () => pass(),
      'suspect-1': () => pass(),
      'suspect-2': () => pass(),
      combined: () => match(),
    };
    const one = fakeRunner(quiet);
    await runSession(one, planOf(), { suspect: 2, all: false, budgetMs: 60_000 });
    expect(one.calls.map((c) => c.split('×')[0])).toEqual(['control', 'suspect-2', 'suspect-2']);

    const all = fakeRunner(quiet);
    const { arms } = await runSession(all, planOf(), { suspect: null, all: true, budgetMs: 60_000 });
    expect(arms.map((a) => [a.arm.id, a.verdict])).toEqual([
      ['suspect-1', 'not-reproduced'],
      ['suspect-2', 'not-reproduced'],
      ['combined', 'reproduced'],
    ]);
  });

  it('starts no new arm once the budget is spent, and finishes the one it started', async () => {
    const runner = fakeRunner({ control: () => pass(), 'suspect-1': () => pass(), 'suspect-2': () => pass() }, 40_000);
    const { arms } = await runSession(runner, planOf(), { suspect: null, all: false, budgetMs: 60_000 });
    expect(arms[0]).toMatchObject({ skipped: null, count: { runs: 10 } });
    expect(arms[1]).toMatchObject({ skipped: 'budget spent', verdict: null });
  });

  it('verify stops at the first matching failure and judges the fix', async () => {
    const plan = planOf({
      kind: 'verify',
      arms: [arm({ id: 'verify', rank: null, runs: 5, stopAt: 1 })],
      combined: null,
      control: planOf().control,
      verifies: {
        experimentId: 3,
        armId: 9,
        label: 'delay GET /api/cart 1.8 s',
        rate: 0.75,
        commit: null,
        finishedAt: null,
      },
    });
    const held = await runSession(fakeRunner({ control: () => pass(), verify: () => pass() }), plan, {
      suspect: null,
      all: false,
      budgetMs: 60_000,
    });
    expect(sessionVerdict('verify', held.arms)).toEqual({ verdict: 'verified', reproducingArm: 'verify' });
    const failed = await runSession(
      fakeRunner({ control: () => pass(), verify: (i) => (i === 2 ? match() : pass()) }),
      plan,
      {
        suspect: null,
        all: false,
        budgetMs: 60_000,
      },
    );
    expect(failed.arms[0]).toMatchObject({ verdict: 'still-fails', count: { runs: 2, stoppedEarly: true } });
  });

  it('stops with an error when an arm records no attempt of the test', async () => {
    const runner: FlakeRunner = { now: () => 0, runBatch: async () => [] };
    await expect(runSession(runner, planOf(), { suspect: null, all: false, budgetMs: 60_000 })).rejects.toThrow(
      /recorded no attempt/,
    );
  });
});

describe('a bisect step', () => {
  const verifyPlan = () =>
    planOf({
      kind: 'verify',
      experimentId: null,
      arms: [arm({ id: 'verify', rank: null, runs: 5, stopAt: 1 })],
      combined: null,
      verifies: {
        experimentId: 3,
        armId: 9,
        label: 'delay GET /api/cart 1.8 s',
        rate: 0.75,
        commit: null,
        finishedAt: null,
      },
    });

  function planFile(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-flake-bisect-'));
    const file = path.join(dir, 'plan.json');
    fs.writeFileSync(file, JSON.stringify(verifyPlan()));
    return file;
  }

  async function step(
    script: Record<string, (i: number) => FlakeResultLine>,
  ): Promise<{ code: number; calls: string[]; out: string }> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = fakeRunner(script);
    try {
      const code = await runFlake(['verify', '--plan', planFile(), '--bisect'], runner);
      return { code, calls: runner.calls, out: log.mock.calls.flat().join('\n') };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }

  it('runs the verify arm alone and exits 0 when it holds', async () => {
    const { code, calls, out } = await step({ verify: () => pass() });
    expect(code).toBe(0);
    expect(calls.every((c) => c.startsWith('verify'))).toBe(true);
    expect(out).toMatch(/Bisect step: good/);
    expect(out).not.toMatch(/control/);
  });

  it('exits 1 at the first failure with the same error as in CI', async () => {
    const { code, out } = await step({ verify: (i) => (i === 2 ? match() : pass()) });
    expect(code).toBe(1);
    expect(out).toMatch(/Bisect step: bad/);
  });

  it('exits 125 when the commit cannot run the arm', async () => {
    const { code, out } = await step({ verify: () => line({ role: 'companion' }) });
    expect(code).toBe(125);
    expect(out).toMatch(/Bisect step: skip/);
  });
});
