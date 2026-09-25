import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const { runAnalyticsWidget } = await import('../../shared/handlers/analytics');
const { parseAnalyticsScope } = await import('../../shared/analytics/scope');
const { backfillDailyRollups } = await import('../../shared/handlers/analytics/rollups');
const { WIDGET_DOCUMENTS } = await import('../../shared/reports/widget-documents');
const { makeFormatter } = await import('../../shared/reports/format');
const { sentencesFor } = await import('../../shared/reports/sentences');

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
let db: ReturnType<typeof drizzle<typeof schema>>;

const docCtx = { f: makeFormatter('en'), s: sentencesFor('en'), baseUrl: null, markers: [], drawMarkers: true };

interface RunSeed {
  projectId: number;
  daysAgo: number;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  didNotRunTests?: number;
  flakyTests?: number;
  environment?: string;
  status?: string;
}

async function seedRun(seed: RunSeed): Promise<number> {
  const [row] = await db
    .insert(schema.testRuns)
    .values({
      projectId: seed.projectId,
      status: seed.status ?? ((seed.failedTests ?? 0) > 0 ? 'failed' : 'passed'),
      startTime: daysAgo(seed.daysAgo),
      duration: 60_000,
      totalTests: seed.totalTests ?? 10,
      passedTests: seed.passedTests ?? 10,
      failedTests: seed.failedTests ?? 0,
      skippedTests: seed.skippedTests ?? 0,
      didNotRunTests: seed.didNotRunTests ?? 0,
      flakyTests: seed.flakyTests ?? 0,
      isFullRun: 1,
      environment: seed.environment,
    })
    .returning({ id: schema.testRuns.id });
  return row!.id;
}

const scope = (query: Record<string, string> = {}) => parseAnalyticsScope({ days: '14', ...query });

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values([
    { id: 1, name: 'checkout' },
    { id: 2, name: 'search' },
  ]);
  // Previous period: a 10-test suite. Current period: it grows to 12, with skipped and not-run tests.
  const previousRun = await seedRun({ projectId: 1, daysAgo: 20, totalTests: 10, passedTests: 10 });
  const currentRun = await seedRun({
    projectId: 1,
    daysAgo: 5,
    totalTests: 12,
    passedTests: 10,
    skippedTests: 1,
    didNotRunTests: 1,
    flakyTests: 2,
  });
  await seedRun({ projectId: 2, daysAgo: 3, totalTests: 8, passedTests: 8 });

  await db.insert(schema.testCases).values([
    { id: 1, projectId: 1, filePath: 'pay.spec.ts', title: 'pays', owner: 'team-pay' },
    { id: 2, projectId: 1, filePath: 'cart.spec.ts', title: 'adds to cart', owner: 'team-cart' },
    { id: 3, projectId: 1, filePath: 'search.spec.ts', title: 'searches' },
  ]);
  await db.insert(schema.testRunsCases).values([
    // Test 1: stable before, flaky now and slower. Test 2: flaky before, stable now and faster.
    { testRunId: previousRun, testCaseId: 1, status: 'passed', duration: 1000, retries: 0 },
    { testRunId: previousRun, testCaseId: 2, status: 'passed', duration: 4000, retries: 1 },
    { testRunId: currentRun, testCaseId: 1, status: 'passed', duration: 3000, retries: 1, wastedTimeMs: 60_000 },
    { testRunId: currentRun, testCaseId: 2, status: 'passed', duration: 1000, retries: 0 },
    { testRunId: currentRun, testCaseId: 3, status: 'failed', duration: 120_000, retries: 0 },
  ]);
  await db.insert(schema.quarantinedTests).values([
    { projectId: 1, testCaseId: 3, createdAt: daysAgo(10) },
    { projectId: 1, testCaseId: 2, createdAt: daysAgo(25), releasedAt: daysAgo(12) },
  ]);
  const cluster = (id: number, over: Partial<typeof schema.failureClusters.$inferInsert>) => ({
    id,
    projectId: 1,
    fingerprint: `fp-${id}`,
    signature: `Error ${id}`,
    firstSeenRunId: previousRun,
    lastSeenRunId: currentRun,
    ...over,
  });
  await db.insert(schema.failureClusters).values([
    // Fixed in the period after 2 and 4 days; one regressed since.
    cluster(1, {
      status: 'resolved',
      createdAt: daysAgo(8),
      updatedAt: daysAgo(6),
      fixLandedAt: daysAgo(6),
      timeToResolutionMs: 2 * DAY_MS,
      assignee: 'team-pay',
    }),
    cluster(2, {
      status: 'resolved',
      createdAt: daysAgo(9),
      updatedAt: daysAgo(5),
      fixLandedAt: daysAgo(5),
      timeToResolutionMs: 4 * DAY_MS,
      fixVerification: 'regressed',
      assignee: 'team-pay',
    }),
    // Fixed in the comparison period after 1 day.
    cluster(3, {
      status: 'resolved',
      createdAt: daysAgo(22),
      updatedAt: daysAgo(21),
      fixLandedAt: daysAgo(21),
      timeToResolutionMs: DAY_MS,
    }),
    // Still open: one 40 days old and assigned, one opened in the period and unassigned.
    cluster(4, { status: 'open', createdAt: daysAgo(40), updatedAt: daysAgo(1), assignee: 'team-cart' }),
    cluster(5, { status: 'open', createdAt: daysAgo(3), updatedAt: daysAgo(1) }),
  ]);
  await backfillDailyRollups(db as any);
});

describe('suite growth', () => {
  test('reads the suite size, its change and the skipped and did-not-run shares', async () => {
    const data = (await runAnalyticsWidget(db as any, 'suite-growth', scope({ projects: '1' }))) as any;
    expect(data.suiteSize).toBe(12);
    expect(data.previousSuiteSize).toBe(10);
    expect(data.delta).toBe(2);
    expect(data.skippedPct).toBe(8.3);
    expect(data.didNotRunPct).toBe(8.3);
    expect(data.points.filter((p: any) => p.suiteSize !== null).map((p: any) => p.suiteSize)).toEqual([12]);
  });

  test('maps to a size series and a share series in a report', async () => {
    const data = await runAnalyticsWidget(db as any, 'suite-growth', scope({ projects: '1' }));
    const blocks = WIDGET_DOCUMENTS['suite-growth'](data, docCtx, {});
    expect(blocks.map((b) => b.kind)).toEqual(['series', 'series']);
    expect((blocks[0] as any).summary).toBe('Suite size: 12 (+2)');
  });
});

describe('flaky debt', () => {
  test('reads flaky occurrences per run, distinct flaky tests and the quarantine over time', async () => {
    const data = (await runAnalyticsWidget(db as any, 'flaky-debt', scope({ projects: '1' }))) as any;
    expect(data.flakyPerRun).toBe(2);
    expect(data.previousFlakyPerRun).toBe(0);
    expect(data.flakyTests).toBe(1);
    expect(data.quarantined).toBe(1);
    expect(data.previousQuarantined).toBe(1);
    const last = data.points[data.points.length - 1];
    expect(last.quarantined).toBe(1);
  });

  test('narrows to a test filter', async () => {
    const data = (await runAnalyticsWidget(
      db as any,
      'flaky-debt',
      scope({ projects: '1', browser: 'webkit' }),
    )) as any;
    expect(data.flakyTests).toBe(0);
  });

  test('maps to two series in a report', async () => {
    const data = await runAnalyticsWidget(db as any, 'flaky-debt', scope({ projects: '1' }));
    expect(WIDGET_DOCUMENTS['flaky-debt'](data, docCtx, {}).map((b) => b.kind)).toEqual(['series', 'series']);
  });
});

describe('time to fix', () => {
  test('counts opened and fixed causes, the median, p90 and held share, and open causes by age', async () => {
    const data = (await runAnalyticsWidget(db as any, 'time-to-fix', scope({ projects: '1' }))) as any;
    expect(data.opened).toBe(3);
    expect(data.fixed).toBe(2);
    expect(data.medianDays).toBe(3);
    expect(data.p90Days).toBe(4);
    expect(data.previousMedianDays).toBe(1);
    expect(data.fixesHeldPct).toBe(50);
    expect(data.openByAge.map((g: any) => g.count)).toEqual([0, 1, 0, 1, 0]);
    expect(data.points.reduce((n: number, p: any) => n + p.fixed, 0)).toBe(2);
  });

  test('maps to tiles, a series and the age table in a report', async () => {
    const data = await runAnalyticsWidget(db as any, 'time-to-fix', scope({ projects: '1' }));
    expect(WIDGET_DOCUMENTS['time-to-fix'](data, docCtx, {}).map((b) => b.kind)).toEqual(['stats', 'series', 'table']);
  });
});
