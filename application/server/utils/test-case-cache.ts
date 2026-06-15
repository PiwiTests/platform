import { testCases } from '../database/schema';
import { eq } from 'drizzle-orm';
import type { getDatabase } from '../database';

type DB = Awaited<ReturnType<typeof getDatabase>>;

/**
 * Process-level cache of test case IDs keyed by project.
 *
 * On first access for a project, the full set of test cases is loaded from the
 * DB in a single query and stored in memory. Subsequent lookups for that project
 * (across all streaming batches and concurrent runs) hit the in-memory Map and
 * skip the DB entirely. New test case inserts are added to the cache immediately
 * so later batches in the same process see them too.
 *
 * Single-instance only — like the SSE event bus, this cache is local to one
 * Node.js process. It is invalidated when a project is deleted.
 */
class TestCaseCache {
  // projectId → (filePath::title → testCaseId)
  private readonly cache = new Map<number, Map<string, number>>();
  // Deduplicates concurrent loads for the same project
  private readonly loading = new Map<number, Promise<Map<string, number>>>();

  /**
   * Return the id→cache map for the project, loading it from DB on first call.
   * Concurrent callers for the same project share a single in-flight SELECT.
   */
  async getProjectCache(db: DB, projectId: number): Promise<Map<string, number>> {
    const cached = this.cache.get(projectId);
    if (cached) return cached;

    const inflight = this.loading.get(projectId);
    if (inflight) return inflight;

    const load = (async () => {
      const rows = await db
        .select({ id: testCases.id, filePath: testCases.filePath, title: testCases.title })
        .from(testCases)
        .where(eq(testCases.projectId, projectId));

      const map = new Map<string, number>();
      for (const row of rows) {
        map.set(`${row.filePath}::${row.title}`, row.id);
      }
      this.cache.set(projectId, map);
      this.loading.delete(projectId);
      return map;
    })();

    this.loading.set(projectId, load);
    return load;
  }

  /** Add a newly-inserted test case to the cache. */
  add(projectId: number, filePath: string, title: string, id: number): void {
    this.cache.get(projectId)?.set(`${filePath}::${title}`, id);
  }

  /** Drop the cache for a project (call when the project is deleted). */
  invalidate(projectId: number): void {
    this.cache.delete(projectId);
    this.loading.delete(projectId);
  }
}

export const testCaseCache = new TestCaseCache();
