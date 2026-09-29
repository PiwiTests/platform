import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const { normalizeProjectTargets, readProjectTargets, targetForPeriod, targetMet, TARGET_DEFS } =
  await import('../../shared/analytics/targets');
const { parseAnalyticsScope } = await import('../../shared/analytics/scope');
const { backfillDailyRollups } = await import('../../shared/handlers/analytics/rollups');
const { getAnalyticsContext } = await import('../../shared/handlers/analytics/common');
const { evaluateTargets } = await import('../../shared/handlers/analytics/targets');
const { getAnalyticsStats, tileTarget } = await import('../../shared/handlers/analytics/stats');
const { getAnalyticsPortfolio } = await import('../../shared/handlers/analytics/portfolio');
const { getAnalyticsRisks } = await import('../../shared/handlers/analytics/risks');
const { getAnalyticsMetric } = await import('../../shared/handlers/analytics/metric');
const { evaluateInsightRules } = await import('../../shared/analytics/insight-rules');
const { collectReportBundle } = await import('../../shared/reports/collect');
const { updateProject } = await import('../../shared/handlers/projects');

const DAY_MS = 24 * 60 * 60 * 1000;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values([
    { id: 1, name: 'meets', targets: { testPassRate: 80, maxFlakyTests: 5 } },
    { id: 2, name: 'misses', targets: { testPassRate: 99 } },
    { id: 3, name: 'no-targets' },
  ]);
  const run = (projectId: number, daysAgo: number, passed: number) => ({
    projectId,
    status: passed === 10 ? 'passed' : 'failed',
    startTime: new Date(Date.now() - daysAgo * DAY_MS),
    duration: 60_000,
    totalTests: 10,
    passedTests: passed,
    failedTests: 10 - passed,
    isFullRun: 1,
  });
  await db.insert(schema.testRuns).values([run(1, 3, 9), run(1, 2, 10), run(2, 3, 9), run(2, 1, 9), run(3, 2, 5)]);
  await backfillDailyRollups(db as any);
});

describe('targets', () => {
  test('normalize drops empty values and refuses values out of range', () => {
    expect(normalizeProjectTargets({ testPassRate: 98, maxFlakyTests: null })).toEqual({ testPassRate: 98 });
    expect(normalizeProjectTargets({})).toBeNull();
    expect(() => normalizeProjectTargets({ testPassRate: 120 })).toThrow();
    expect(readProjectTargets({ testPassRate: '98', maxFlakyTests: 3 })).toEqual({ maxFlakyTests: 3 });
  });

  test('a weekly target scales to the period and a verdict follows the direction', () => {
    const weekly = TARGET_DEFS.find((d) => d.key === 'maxWastedMinutesPerWeek')!;
    expect(targetForPeriod(weekly, 70, 30)).toBe(300);
    const passRate = TARGET_DEFS.find((d) => d.key === 'testPassRate')!;
    expect(targetForPeriod(passRate, 98, 30)).toBe(98);
    expect(targetMet(passRate, 98, 98)).toBe(true);
    expect(targetMet(weekly, 300, 301)).toBe(false);
    expect(targetMet(passRate, 98, null)).toBeNull();
  });

  test('updateProject stores normalized targets and clears them with null', async () => {
    await db.insert(schema.projects).values({ id: 9, name: 'editable' });
    const saved = await updateProject(db as any, 9, { targets: { testPassRate: 95, maxFlakyTests: null } });
    expect(saved.project.targets).toEqual({ testPassRate: 95 });
    const cleared = await updateProject(db as any, 9, { targets: null });
    expect(cleared.project.targets).toBeNull();
  });

  test('each project with targets gets one verdict per target, met or missed', async () => {
    const scope = parseAnalyticsScope({ days: '7', projects: '1,2,3' });
    const ctx = await getAnalyticsContext(db as any, scope, 'all');
    const verdicts = await evaluateTargets(db as any, ctx, null);
    expect(verdicts.map((v) => [v.projectId, v.key, v.met])).toEqual([
      [1, 'testPassRate', true],
      [1, 'maxFlakyTests', true],
      [2, 'testPassRate', false],
    ]);
    expect(verdicts[2]!.actual).toBe(90);
  });

  test('tiles, portfolio, risks and the metric widget read the verdicts', async () => {
    const scope = parseAnalyticsScope({ days: '7', projects: '1,2,3' });
    const stats = await getAnalyticsStats(db as any, scope, 'all', { metrics: ['test-pass-rate', 'runs'] });
    expect(stats.tiles[0]!.target).toEqual({ target: null, direction: 'min', met: 1, missed: 1 });
    expect(stats.tiles[1]!.target).toBeNull();

    const portfolio = await getAnalyticsPortfolio(db as any, scope, 'all');
    expect(portfolio.find((r) => r.projectId === 2)!.targets.map((t) => t.met)).toEqual([false]);
    expect(portfolio.find((r) => r.projectId === 3)!.targets).toEqual([]);

    const risks = await getAnalyticsRisks(db as any, scope, 'all');
    expect(risks.missedTargets.map((t) => t.projectId)).toEqual([2]);

    const one = parseAnalyticsScope({ days: '7', projects: '2' });
    const metric = await getAnalyticsMetric(db as any, one, 'all', { metric: 'test-pass-rate' });
    expect(metric.target).toEqual({ value: 99, direction: 'min', met: false });
    const off = await getAnalyticsMetric(db as any, one, 'all', { metric: 'test-pass-rate', target: false });
    expect(off.target).toBeNull();
    const oneStats = await getAnalyticsStats(db as any, one, 'all', { metrics: ['test-pass-rate'] });
    expect(oneStats.tiles[0]!.target).toEqual({ target: 99, direction: 'min', met: 0, missed: 1 });
  });

  test('tileTarget shows the target only for one project', () => {
    const v = {
      projectId: 1,
      projectName: 'a',
      key: 'testPassRate' as const,
      metric: 'test-pass-rate' as const,
      direction: 'min' as const,
      stored: 98,
      target: 98,
      actual: 97,
      met: false,
    };
    expect(tileTarget([v], 'test-pass-rate', true)).toEqual({ target: 98, direction: 'min', met: 0, missed: 1 });
    expect(tileTarget([v], 'test-pass-rate', false)!.target).toBeNull();
    expect(tileTarget([v], 'runs', true)).toBeNull();
  });

  test('the target-missed rule names the project and the gap', () => {
    const insights = evaluateInsightRules({
      scope: parseAnalyticsScope({ days: '7' }),
      portfolio: [],
      ciTime: {
        points: [],
        bucketDays: 1,
        totalMinutes: 0,
        runCount: 0,
        prevTotalMinutes: null,
        deltaPct: null,
        avgRunMinutes: null,
      },
      wastedTime: {
        points: [],
        bucketDays: 1,
        totalWaitMinutes: 0,
        totalFailedExecMinutes: 0,
        byProject: [],
        cost: null,
        timeoutReclaimable: null,
      },
      clusters: { totalOpen: 0, resolvedInPeriod: 0, byErrorType: [], clusters: [] },
      flakyTests: [],
      regressionVelocity: {
        points: [],
        bucketDays: 1,
        totalRegressions: 0,
        totalNewFlaky: 0,
        prevRegressions: null,
        deltaPct: null,
      },
      slowEndpoints: { endpoints: [], totalRequests: 0 },
      timeoutHygiene: { rows: [], oversizedCount: 0, staleSlowCount: 0, totalEstimatedSavingMs: 0, topProjectId: null },
      targets: [
        {
          projectId: 2,
          projectName: 'Checkout',
          key: 'testPassRate',
          metric: 'test-pass-rate',
          direction: 'min',
          stored: 98,
          target: 98,
          actual: 96.8,
          met: false,
        },
        {
          projectId: 3,
          projectName: 'Search',
          key: 'testPassRate',
          metric: 'test-pass-rate',
          direction: 'min',
          stored: 90,
          target: 90,
          actual: 95,
          met: true,
        },
      ],
    });
    expect(insights).toHaveLength(1);
    expect(insights[0]!.ruleId).toBe('target-missed');
    expect(insights[0]!.message).toBe('Checkout test pass rate is 1.2 pts under its target');
  });

  test('the quality report lists every target with its verdict', async () => {
    const bundle = await collectReportBundle(db as any, {
      dashboard: 'executive',
      scope: parseAnalyticsScope({ days: '7', projects: '1,2,3' }),
      language: 'en',
    });
    expect(bundle.targets.map((t) => t.met)).toEqual([true, true, false]);
    expect(bundle.targets[2]!.text).toBe('misses · Test pass rate: 90% for a target of at least 99%, missed.');
    const risks = bundle.bands.flatMap((b) => b.widgets).find((w) => w.type === 'risks')!;
    expect(JSON.stringify(risks.blocks)).toContain('misses · Test pass rate');
  });
});
