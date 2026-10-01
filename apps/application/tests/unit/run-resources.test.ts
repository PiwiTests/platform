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
import { findingView, machineFacts, resourceTotals } from '../../app/utils/resources';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set.
delete process.env.PIWI_DATABASE_URL;
const { getRunResources } = await import('../../shared/handlers/run-resources');
const { getTestRun } = await import('../../shared/handlers/test-runs');
const { getCapabilityEvidence } = await import('../../shared/handlers/setup-status');

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
    expect(await getRunResources(db as any, 7)).toEqual({ report: null, costliest: [], measuredExecutions: 0 });
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
