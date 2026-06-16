import { testSuites } from '../database/schema';
import { eq } from 'drizzle-orm';
import type { getDatabase } from '../database';

type DB = Awaited<ReturnType<typeof getDatabase>>;

function makeCacheKey(filePath: string, suitePath: string): string {
  return `${filePath}\x00${suitePath}`;
}

/**
 * Process-level cache of suite IDs keyed by project.
 *
 * Mirrors TestCaseCache but for test_suites rows. Loaded from DB on first
 * access per project; new inserts are added immediately so subsequent
 * streaming batches skip the upsert path.
 */
class TestSuiteCache {
  private readonly cache = new Map<number, Map<string, number>>();
  private readonly loading = new Map<number, Promise<Map<string, number>>>();

  async getProjectCache(db: DB, projectId: number): Promise<Map<string, number>> {
    const cached = this.cache.get(projectId);
    if (cached) return cached;

    const inflight = this.loading.get(projectId);
    if (inflight) return inflight;

    const load = (async () => {
      const rows = await db
        .select({ id: testSuites.id, filePath: testSuites.filePath, suitePath: testSuites.suitePath })
        .from(testSuites)
        .where(eq(testSuites.projectId, projectId));

      const map = new Map<string, number>();
      for (const row of rows) {
        map.set(makeCacheKey(row.filePath, row.suitePath), row.id);
      }
      this.cache.set(projectId, map);
      this.loading.delete(projectId);
      return map;
    })();

    this.loading.set(projectId, load);
    return load;
  }

  add(projectId: number, filePath: string, suitePath: string, id: number): void {
    this.cache.get(projectId)?.set(makeCacheKey(filePath, suitePath), id);
  }

  invalidate(projectId: number): void {
    this.cache.delete(projectId);
    this.loading.delete(projectId);
  }
}

export const testSuiteCache = new TestSuiteCache();
