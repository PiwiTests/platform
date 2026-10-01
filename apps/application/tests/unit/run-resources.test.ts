import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';
import {
  mergeResourceReport,
  readStoredResourceReport,
  sanitizeExecutionResources,
  sanitizeResourceReport,
} from '../../shared/resource-report';
import { demoExecutionResources, demoResourceReport } from '../../shared/demo/demo-resources.mjs';
import { findingView } from '../../shared/resource-copy';
import { machineFacts, resourceTotals } from '../../app/utils/resources';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set.
delete process.env.PIWI_DATABASE_URL;
const { getRunResources } = await import('../../shared/handlers/run-resources');
const { getTestRun } = await import('../../shared/handlers/test-runs');
const { getCapabilityEvidence } = await import('../../shared/handlers/setup-status');
const { recordRunResourceFindings, runFindingsNovelty, listResourceFindings, FIXED_AFTER_CLEAN_RUNS } =
  await import('../../shared/handlers/resource-findings');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
});

const report = (shardIndex: number | null, leaky = true) =>
  demoResourceReport({
    leaky,
    wallMs: 60_000,
    workers: [
      { worker: 0, tests: 3 },
      { worker: 1, tests: 2 },
    ],
    fixtureFile: 'tests/fixtures.ts',
    handleTest: { title: 'exports', file: 'tests/reports.spec.ts' },
    artifactBytes: 5_000_000,
    shardIndex,
  });

describe('sanitizeResourceReport', () => {
  test('keeps a report as the reporter sends it', () => {
    const sent = report(null);
    expect(sanitizeResourceReport(JSON.parse(JSON.stringify(sent)))).toEqual(sent);
  });

  test('rejects what is not a report, and drops what does not belong in one', () => {
    expect(sanitizeResourceReport(null)).toBeNull();
    expect(sanitizeResourceReport({ v: 2 })).toBeNull();
    const clean = sanitizeResourceReport({
      v: 1,
      findings: [
        { verdict: 'leaked', kind: 'page', where: 'tests/a.spec.ts:3', tests: 1, count: 1, extra: 'x' },
        { verdict: 'exploded', kind: 'page', where: 'x', tests: 1, count: 1 },
        { verdict: 'idle', kind: 'page', where: '', tests: 1, count: 1 },
        ...Array.from({ length: 200 }, (_, i) => ({
          verdict: 'idle',
          kind: 'page',
          where: `w${i}`,
          tests: 1,
          count: 1,
        })),
      ],
      counts: { leaked: -3, idle: 'many' },
      profile: { platform: 'linux' },
      workers: [
        { worker: 0, openPages: [1, -2, 'x', 3.6] },
        { worker: 'a', openPages: [] },
      ],
      artifactBytes: { trace: 10, movie: 99 },
    })!;
    expect(clean.findings[0]).toEqual({
      verdict: 'leaked',
      kind: 'page',
      where: 'tests/a.spec.ts:3',
      tests: 1,
      count: 1,
    });
    // The first 100 entries are read; the two invalid ones among them are dropped.
    expect(clean.findings).toHaveLength(98);
    expect(clean.counts).toEqual({ leaked: 0, idle: 0, piling: 0, handle: 0, probable: 0 });
    expect(clean.profile).toBeNull();
    expect(clean.workers).toEqual([{ worker: 0, openPages: [1, 0, 0, 4] }]);
    expect(clean.artifactBytes).toEqual({ trace: 10 });
  });
});

describe('sanitizeExecutionResources', () => {
  test('keeps a cost as a worker measures it, and rejects one without the worker CPU', () => {
    const sent = demoExecutionResources({ seq: 3, durationMs: 4000, openAtStart: 2, leaky: true });
    expect(sanitizeExecutionResources(JSON.parse(JSON.stringify(sent)))).toEqual(sent);
    expect(sanitizeExecutionResources({ loopUtilization: 0.2 })).toBeNull();
    expect(
      sanitizeExecutionResources({ workerCpuMs: 10, loopUtilization: 7, roles: { kernel: { cpuMs: 1 } } }),
    ).toMatchObject({ workerCpuMs: 10, loopUtilization: 1, roles: null });
  });
});

describe('mergeResourceReport', () => {
  test('keeps one part per shard, in shard order, the latest replacing an earlier one', () => {
    let stored = mergeResourceReport(null, report(2));
    stored = mergeResourceReport(stored, report(1));
    stored = mergeResourceReport(stored, report(2, false));
    expect(stored.parts.map((p) => [p.shardIndex, p.counts.leaked])).toEqual([
      [1, 1],
      [2, 0],
    ]);
    expect(readStoredResourceReport('nonsense')).toEqual({ v: 1, parts: [] });
  });
});

describe('getRunResources', () => {
  async function seedRun(capabilities: Record<string, string> | null = null) {
    await db.insert(schema.projects).values({ id: 1, name: 'checkout', capabilities });
    await db.insert(schema.testRuns).values({
      id: 7,
      projectId: 1,
      status: 'passed',
      startTime: new Date(),
      resourceReport: mergeResourceReport(null, report(null)),
    });
    await db.insert(schema.testCases).values([
      { id: 1, projectId: 1, title: 'cheap', filePath: 'tests/a.spec.ts' },
      { id: 2, projectId: 1, title: 'costly', filePath: 'tests/a.spec.ts' },
      { id: 3, projectId: 1, title: 'unmeasured', filePath: 'tests/a.spec.ts' },
    ]);
    await db.insert(schema.testRunsCases).values([
      {
        id: 11,
        testRunId: 7,
        testCaseId: 1,
        status: 'passed',
        line: 3,
        resources: demoExecutionResources({ seq: 1, durationMs: 1000 }),
      },
      {
        id: 12,
        testRunId: 7,
        testCaseId: 2,
        status: 'passed',
        line: 9,
        resources: demoExecutionResources({ seq: 2, durationMs: 9000, openAtStart: 3, leaky: true }),
      },
      { id: 13, testRunId: 7, testCaseId: 3, status: 'passed', line: 12 },
    ]);
  }

  test('serves the report and the measured executions, costliest first', async () => {
    await seedRun();
    const resources = (await getRunResources(db as any, 7))!;
    expect(resources.report!.parts).toHaveLength(1);
    expect(resources.measuredExecutions).toBe(2);
    expect(resources.costliest.map((e) => e.title)).toEqual(['costly', 'cheap']);
    expect(resources.costliest[0]).toMatchObject({ executionId: 12, openAtStartPages: 3, leftOpen: 1, line: 9 });
    expect(resources.costliest[0]!.cpuMs).toBeGreaterThan(resources.costliest[0]!.browserCpuMs!);

    const run = await getTestRun(db as any, 7);
    expect(run).toMatchObject({ hasResources: true });
    expect(run).not.toHaveProperty('resourceReport');
    expect((await getCapabilityEvidence(db as any, 1)).resources).toBe(true);
  });

  test('serves nothing for a project that declined the capability, and null for a missing run', async () => {
    await seedRun({ resources: 'declined' });
    expect(await getRunResources(db as any, 7)).toEqual({
      report: null,
      baseBranch: null,
      history: {},
      costliest: [],
      measuredExecutions: 0,
    });
    expect(await getTestRun(db as any, 7)).toMatchObject({ hasResources: false });
    expect(await getRunResources(db as any, 99)).toBeNull();
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, 1));
    expect(project?.capabilities).toEqual({ resources: 'declined' });
  });
});

describe('findingView', () => {
  test('reads each verdict in the words of the end-of-run summary', () => {
    const [leaked, idle, piling, handle] = report(null).findings.map(findingView);
    expect(leaked).toEqual({
      label: 'Leaked context',
      where: 'fixture "loggedInContext" at tests/fixtures.ts:14',
      site: 'tests/fixtures.ts:14',
      facts: [
        '5 contexts',
        'with 5 pages',
        '5 tests',
        'open until the worker shut down (49.2 s past its test)',
        '12.6 s of page CPU after its test',
      ],
    });
    expect(idle).toMatchObject({ label: 'Never used page', facts: ['3 pages', '3 tests', 'set up with loggedInPage'] });
    expect(piling).toMatchObject({ label: 'Piling up listeners', facts: ['2 → 8 over 3 tests'] });
    expect(handle).toEqual({
      label: 'Left running server',
      where: null,
      site: null,
      facts: ['left running in the worker by "exports" (tests/reports.spec.ts)'],
    });
  });
});

describe('machineFacts and resourceTotals', () => {
  test('describe the machine one resource per line, and sum the shards', () => {
    const facts = machineFacts(report(null));
    expect(facts.map((f) => f.label)).toEqual(['CPU', 'Memory', 'Disk', 'Workers']);
    expect(facts[0]!.facts[0]).toBe('88% busy');
    expect(facts[1]!.facts).toContain('largest process: renderer 620 MB');

    const totals = resourceTotals(mergeResourceReport(mergeResourceReport(null, report(1)), report(2, false)));
    expect(totals.counts).toEqual({ leaked: 1, idle: 3, piling: 1, handle: 1, probable: 0 });
    expect(totals.peakMemoryBytes).toBe(9.6 * 1024 ** 3);
    expect(totals.artifactBytes).toBe(10_000_000);
  });
});

describe('finding history', () => {
  let nextRun = 100;
  /** A finished run of project 1 whose report is the leaky one (or a clean one), on a branch. */
  async function run(opts: { leaky: boolean; branch?: string | null; full?: boolean; baseBranch?: string }) {
    const id = nextRun++;
    await db.insert(schema.testRuns).values({
      id,
      projectId: 1,
      status: 'passed',
      startTime: new Date(Date.UTC(2026, 0, 1) + id * 60_000),
      branch: opts.branch === undefined ? 'main' : opts.branch,
      isFullRun: opts.full === false ? 0 : 1,
      metadata: opts.baseBranch ? { scm: { branch: opts.branch, baseBranch: opts.baseBranch } } : null,
      resourceReport: mergeResourceReport(null, report(null, opts.leaky)),
    });
    return id;
  }

  beforeEach(async () => {
    nextRun = 100;
    await db.insert(schema.projects).values({ id: 1, name: 'checkout', defaultBranch: 'main' });
  });

  test('records each finding once per run, however often the run is finished', async () => {
    const first = await run({ leaky: true });
    await recordRunResourceFindings(db as any, first);
    await recordRunResourceFindings(db as any, first);
    const findings = await listResourceFindings(db as any, 1);
    expect(findings.map((f) => f.verdict).sort()).toEqual(['handle', 'idle', 'leaked', 'piling']);
    expect(findings.every((f) => f.runs === 1 && f.firstSeenRunId === first)).toBe(true);
    expect(await db.select().from(schema.resourceOccurrences)).toHaveLength(4);

    const second = await run({ leaky: true });
    await recordRunResourceFindings(db as any, second);
    const leaked = (await listResourceFindings(db as any, 1, { verdict: 'leaked' }))[0]!;
    expect(leaked).toMatchObject({ runs: 2, firstSeenRunId: first, lastSeenRunId: second, status: 'open' });
  });

  test('fixes a finding after five clean full runs of the default branch, and reopens it when it comes back', async () => {
    await recordRunResourceFindings(db as any, await run({ leaky: true }));
    // Neither a partial run nor a feature-branch run vouches for the fix.
    await recordRunResourceFindings(db as any, await run({ leaky: false, full: false }));
    await recordRunResourceFindings(db as any, await run({ leaky: false, branch: 'feature/x' }));
    const clean: number[] = [];
    for (let i = 0; i < FIXED_AFTER_CLEAN_RUNS; i++) {
      const id = await run({ leaky: false });
      clean.push(id);
      const recorded = await recordRunResourceFindings(db as any, id);
      // A retried finish does not count the same run twice.
      await recordRunResourceFindings(db as any, id);
      expect(recorded.fixed).toHaveLength(i === FIXED_AFTER_CLEAN_RUNS - 1 ? 4 : 0);
    }
    const leaked = (await listResourceFindings(db as any, 1, { status: 'all', verdict: 'leaked' }))[0]!;
    expect(leaked).toMatchObject({ status: 'fixed', fixedRunId: clean[0], cleanRuns: FIXED_AFTER_CLEAN_RUNS });
    expect(await listResourceFindings(db as any, 1)).toEqual([]);

    const back = await run({ leaky: true });
    expect((await recordRunResourceFindings(db as any, back)).reopened).toHaveLength(4);
    expect((await listResourceFindings(db as any, 1, { verdict: 'leaked' }))[0]).toMatchObject({
      status: 'open',
      reopenedRunId: back,
      cleanRuns: 0,
      fixedRunId: null,
    });
  });

  test('a finding is new until a run of the base branch shows it, and a run with no branch counts as the default branch', async () => {
    const onBranch = await run({ leaky: true, branch: 'feature/login', baseBranch: 'main' });
    await recordRunResourceFindings(db as any, onBranch);
    const again = await run({ leaky: true, branch: 'feature/login', baseBranch: 'main' });
    const novelty = (await runFindingsNovelty(db as any, again))!;
    expect(novelty.baseBranch).toBe('main');
    expect(novelty.findings.every((f) => f.isNew)).toBe(true);

    await recordRunResourceFindings(db as any, await run({ leaky: true, branch: null }));
    const later = await run({ leaky: true, branch: 'feature/login', baseBranch: 'main' });
    expect((await runFindingsNovelty(db as any, later))!.findings.some((f) => f.isNew)).toBe(false);

    const resources = (await getRunResources(db as any, later))!;
    expect(resources.baseBranch).toBe('main');
    expect(Object.values(resources.history)).toHaveLength(4);
    expect(Object.values(resources.history).every((h) => !h.isNew && h.firstSeenRunId === onBranch)).toBe(true);
  });

  test('orders runs by when they started, not by when they were stored', async () => {
    // Stored first, started last: the newest run on main.
    await db.insert(schema.testRuns).values({
      id: 50,
      projectId: 1,
      status: 'passed',
      startTime: new Date(Date.UTC(2026, 6, 1)),
      branch: 'main',
      resourceReport: mergeResourceReport(null, report(null, true)),
    });
    const older = await run({ leaky: true });
    await recordRunResourceFindings(db as any, older);
    expect((await runFindingsNovelty(db as any, 50))!.findings.every((f) => !f.isNew)).toBe(true);
    expect((await runFindingsNovelty(db as any, older))!.findings.every((f) => f.isNew)).toBe(true);
    await recordRunResourceFindings(db as any, 50);
    expect((await listResourceFindings(db as any, 1, { verdict: 'leaked' }))[0]).toMatchObject({
      firstSeenRunId: older,
      lastSeenRunId: 50,
    });
  });

  test('says nothing about a run that sent no report', async () => {
    await db.insert(schema.testRuns).values({ id: 99, projectId: 1, status: 'passed', startTime: new Date() });
    expect(await runFindingsNovelty(db as any, 99)).toBeNull();
    expect(await recordRunResourceFindings(db as any, 99)).toEqual({ seen: 0, fixed: [], reopened: [] });
  });
});
