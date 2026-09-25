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
  await seedRun({ projectId: 1, daysAgo: 20, totalTests: 10, passedTests: 10 });
  await seedRun({ projectId: 1, daysAgo: 5, totalTests: 12, passedTests: 10, skippedTests: 1, didNotRunTests: 1 });
  await seedRun({ projectId: 2, daysAgo: 3, totalTests: 8, passedTests: 8 });
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
