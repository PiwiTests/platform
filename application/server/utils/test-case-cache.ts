import { testCases } from '../database/schema';
import { eq } from 'drizzle-orm';
import type { getDatabase } from '../database';

type DB = Awaited<ReturnType<typeof getDatabase>>;

// Cache key: filePath + NUL + suitePath (raw stored text, \x1f-delimited) + NUL + title
// NUL separates the three segments; \x1f separates describe levels within suitePath.
// Neither NUL nor \x1f can appear in Playwright test titles or file paths in practice.
function makeCacheKey(filePath: string, suitePath: string, title: string): string {
  return `${filePath}\x00${suitePath}\x00${title}`;
}

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
  // projectId → (filePath\x00suitePath\x00title → testCaseId)
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
        .select({
          id: testCases.id,
          filePath: testCases.filePath,
          suitePath: testCases.suitePath,
          title: testCases.title,
        })
        .from(testCases)
        .where(eq(testCases.projectId, projectId));

      const map = new Map<string, number>();
      for (const row of rows) {
        map.set(makeCacheKey(row.filePath, row.suitePath ?? '', row.title), row.id);
      }
      this.cache.set(projectId, map);
      this.loading.delete(projectId);
      return map;
    })();

    this.loading.set(projectId, load);
    return load;
  }

  /** Add a newly-inserted test case to the cache. */
  add(projectId: number, filePath: string, suitePath: string, title: string, id: number): void {
    this.cache.get(projectId)?.set(makeCacheKey(filePath, suitePath, title), id);
  }

  /** Drop the cache for a project (call when the project is deleted). */
  invalidate(projectId: number): void {
    this.cache.delete(projectId);
    this.loading.delete(projectId);
  }
}

export const testCaseCache = new TestCaseCache();
