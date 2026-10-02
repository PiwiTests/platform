import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const { getAiUsageSummary } = await import('#shared/handlers/ai-usage');

const NOW = new Date('2026-10-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  await db.insert(schema.projects).values({ id: 1, name: 'shop' });
  await db.insert(schema.testRuns).values({ id: 1, projectId: 1, status: 'failed', startTime: daysAgo(90) });
  const cluster = { projectId: 1, errorType: 'assertion', firstSeenRunId: 1, lastSeenRunId: 1 };
  await db.insert(schema.failureClusters).values([
    { ...cluster, id: 1, fingerprint: 'a', signature: 'a' },
    { ...cluster, id: 2, fingerprint: 'b', signature: 'b' },
  ]);
  const usage = { provider: 'openai', model: 'm', status: 'completed', inputTokens: 100, outputTokens: 10 };
  await db.insert(schema.failureDiagnoses).values([
    // Made 60 days ago, rated yesterday: outside a 30-day window.
    { ...usage, id: 1, clusterId: 1, scope: 'cluster', createdAt: daysAgo(60), updatedAt: daysAgo(1) },
    // Re-run 5 days ago.
    { ...usage, id: 2, clusterId: 2, scope: 'cluster', createdAt: daysAgo(5), updatedAt: daysAgo(5) },
  ]);
  // The version the re-run replaced, and a stale running snapshot.
  await db.insert(schema.failureDiagnosisVersions).values([
    { ...usage, diagnosisId: 2, clusterId: 2, scope: 'cluster', inputTokens: 40, createdAt: daysAgo(5) },
    { ...usage, diagnosisId: 2, clusterId: 2, scope: 'cluster', status: 'running', createdAt: daysAgo(6) },
  ]);
});

describe('getAiUsageSummary', () => {
  test('counts each version by creation time, not by when it was rated', async () => {
    const summary = await getAiUsageSummary(db, 30, NOW);
    expect(summary.totals).toEqual({ diagnoses: 2, inputTokens: 140, outputTokens: 20 });
    expect(summary.byModel).toHaveLength(1);
    expect(summary.byModel[0]).toMatchObject({ provider: 'openai', model: 'm', diagnoses: 2, failed: 0 });
  });

  test('a wider window reaches the older diagnosis', async () => {
    expect((await getAiUsageSummary(db, 90, NOW)).totals.diagnoses).toBe(3);
  });
});
