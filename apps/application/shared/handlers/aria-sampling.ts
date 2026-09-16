/**
 * Green ARIA-sampling schedule. At run start the reporter asks which of a
 * project's tests are due a fresh passing-page snapshot; a test is due when its
 * newest green snapshot is older than a day, or it has none. The reporter
 * captures the ARIA snapshot at the end of only those passing tests, so the
 * cost stays near zero in steady state. Shared by the REST endpoint and the
 * demo router (browser-safe: drizzle queries only).
 */
import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import { testCases, testRunsCases } from '../../server/database/schema';
import type { DrizzleDB } from './db';

/** A green sample counts as fresh for this long before another is due. */
export const GREEN_SAMPLE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A test's stable identity, matching how the reporter keys a case. */
export interface AriaSampleTest {
  /** Spec path relative to the project root, POSIX separators. */
  filePath: string;
  /** Test title (the leaf title the reporter sends). */
  title: string;
}

export interface AriaSamplingResult {
  /** Tests whose newest green snapshot is stale or missing. */
  tests: AriaSampleTest[];
}

/**
 * The set of tests due a fresh green ARIA sample for a project. A test is
 * included when no passing execution carries an ARIA snapshot, or the most
 * recent one that does is older than {@link GREEN_SAMPLE_MAX_AGE_MS}.
 */
export async function getAriaSampling(
  db: DrizzleDB,
  projectId: number,
  now: number = Date.now(),
): Promise<AriaSamplingResult> {
  const cases = await db
    .select({ id: testCases.id, filePath: testCases.filePath, title: testCases.title })
    .from(testCases)
    .where(eq(testCases.projectId, projectId));
  if (cases.length === 0) return { tests: [] };

  const freshest = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      latest: sql<number>`max(${testRunsCases.createdAt})`,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(
      and(
        eq(testCases.projectId, projectId),
        eq(testRunsCases.status, 'passed'),
        or(isNotNull(testRunsCases.ariaSnapshotPayloadId), isNotNull(testRunsCases.ariaSnapshot)),
      ),
    )
    .groupBy(testRunsCases.testCaseId);

  const freshById = new Map(freshest.map((row) => [row.testCaseId, Number(row.latest)]));
  const cutoff = now - GREEN_SAMPLE_MAX_AGE_MS;

  const tests = cases
    .filter((c) => {
      const latest = freshById.get(c.id);
      return latest == null || latest < cutoff;
    })
    .map((c) => ({ filePath: c.filePath, title: c.title }));

  return { tests };
}
