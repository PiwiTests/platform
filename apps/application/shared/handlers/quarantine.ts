/**
 * Quarantine — with an exit ramp.
 *
 * The usual quarantine is `--grep-invert @quarantine`: the test stops running,
 * so nothing ever proves it is fixed, and the list only ever grows. A year
 * later nobody remembers why half of it is there.
 *
 * Here a quarantined test keeps running and keeps reporting. It is excluded
 * from the [CI gate](./gate)'s verdict and nothing else. That one difference is
 * what makes the exit possible: consecutive passes accumulate, and once a test
 * has earned its way out the dashboard says so instead of waiting to be asked.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { quarantinedTests, testCases, testRuns, testRunsCases } from '../../server/database/schema';
import type { DrizzleDB } from './db';

/** Consecutive passing runs after which release is proposed. */
export const RELEASE_AFTER_CONSECUTIVE_PASSES = 5;

/** Executions scanned per test when counting the current streak. */
const STREAK_SCAN_LIMIT = 30;

const FAIL_STATUSES = ['failed', 'timedOut', 'timedout'];

export interface QuarantineEntry {
  id: number;
  testCaseId: number;
  title: string;
  filePath: string;
  reason: string | null;
  source: string;
  owner: string | null;
  tags: string[] | null;
  createdAt: Date | string;
  /** How long this test has been quarantined, in ms. */
  ageMs: number;
  /** Passing runs since quarantine, counted back from the newest. */
  consecutivePasses: number;
  /** True once the streak clears the threshold — time to let it out. */
  releaseProposed: boolean;
  /** Runs seen since quarantine; zero means nothing has exercised it yet. */
  runsSinceQuarantine: number;
}

/** Aggregate cost of the quarantine list — the debt, so it cannot be ignored. */
export interface QuarantineDebt {
  active: number;
  /** Entries whose streak says they should be released. */
  readyToRelease: number;
  /** Age of the oldest active quarantine, in ms. */
  oldestAgeMs: number;
  /** Entries with no passing streak at all — still genuinely broken. */
  stillFailing: number;
}

/** Test-case ids currently quarantined in a project. Used by the CI gate. */
export async function getQuarantinedCaseIds(db: DrizzleDB, projectId: number): Promise<Set<number>> {
  const rows = await db
    .select({ testCaseId: quarantinedTests.testCaseId })
    .from(quarantinedTests)
    .where(and(eq(quarantinedTests.projectId, projectId), isNull(quarantinedTests.releasedAt)));
  return new Set(rows.map((row) => row.testCaseId));
}

/**
 * Trailing passing streak for each test, counted over executions recorded after
 * the run the test was quarantined at. Ordered newest first and stopped at the
 * first failure, so a single recent flake resets the count — which is the point.
 *
 * One query for the whole list: each test's executions since its own quarantine
 * run are ranked newest-first with a window function, and only the first
 * `STREAK_SCAN_LIMIT` of each are read back.
 */
async function computeStreaks(
  db: DrizzleDB,
  entries: Array<{ testCaseId: number; quarantinedAtRunId: number | null }>,
): Promise<Map<number, { passes: number; runs: number }>> {
  const streaks = new Map<number, { passes: number; runs: number }>();
  if (entries.length === 0) return streaks;

  const sinceQuarantine = or(
    ...entries.map((entry) =>
      and(
        eq(testRunsCases.testCaseId, entry.testCaseId),
        entry.quarantinedAtRunId != null ? gt(testRunsCases.testRunId, entry.quarantinedAtRunId) : sql`1 = 1`,
      ),
    ),
  );

  const ranked = db
    .select({
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      id: testRunsCases.id,
      newestRank:
        sql<number>`row_number() over (partition by ${testRunsCases.testCaseId} order by ${testRunsCases.id} desc)`.as(
          'newest_rank',
        ),
    })
    .from(testRunsCases)
    .where(sinceQuarantine)
    .as('ranked');

  const rows = await db
    .select({ testCaseId: ranked.testCaseId, status: ranked.status, id: ranked.id })
    .from(ranked)
    .where(lte(ranked.newestRank, STREAK_SCAN_LIMIT))
    .orderBy(desc(ranked.id));

  const byCase = new Map<number, Array<{ status: string }>>();
  for (const row of rows) {
    const list = byCase.get(row.testCaseId);
    if (list) list.push(row);
    else byCase.set(row.testCaseId, [row]);
  }

  for (const entry of entries) {
    const executions = byCase.get(entry.testCaseId) ?? [];
    let passes = 0;
    for (const row of executions) {
      if (row.status === 'passed') passes++;
      else if (FAIL_STATUSES.includes(row.status)) break;
      // Skipped / didnotrun executions prove nothing either way; ignore them
      // rather than counting or breaking the streak.
    }
    streaks.set(entry.testCaseId, { passes, runs: executions.length });
  }

  return streaks;
}

/** The active quarantine list for a project, with each test's exit progress. */
export async function listQuarantine(
  db: DrizzleDB,
  projectId: number,
): Promise<{ entries: QuarantineEntry[]; debt: QuarantineDebt }> {
  const rows: any[] = await db
    .select({
      id: quarantinedTests.id,
      testCaseId: quarantinedTests.testCaseId,
      reason: quarantinedTests.reason,
      source: quarantinedTests.source,
      quarantinedAtRunId: quarantinedTests.quarantinedAtRunId,
      createdAt: quarantinedTests.createdAt,
      title: testCases.title,
      filePath: testCases.filePath,
      owner: testCases.owner,
      tags: testCases.tags,
    })
    .from(quarantinedTests)
    .innerJoin(testCases, eq(quarantinedTests.testCaseId, testCases.id))
    .where(and(eq(quarantinedTests.projectId, projectId), isNull(quarantinedTests.releasedAt)))
    .orderBy(asc(quarantinedTests.createdAt));

  const streaks = await computeStreaks(db, rows);
  const now = Date.now();

  const entries: QuarantineEntry[] = rows.map((row) => {
    const streak = streaks.get(row.testCaseId) ?? { passes: 0, runs: 0 };
    const createdMs = row.createdAt instanceof Date ? row.createdAt.getTime() : new Date(row.createdAt).getTime();
    return {
      id: row.id,
      testCaseId: row.testCaseId,
      title: row.title,
      filePath: row.filePath,
      reason: row.reason,
      source: row.source,
      owner: row.owner ?? null,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : null,
      createdAt: row.createdAt,
      ageMs: Math.max(0, now - createdMs),
      consecutivePasses: streak.passes,
      releaseProposed: streak.passes >= RELEASE_AFTER_CONSECUTIVE_PASSES,
      runsSinceQuarantine: streak.runs,
    };
  });

  const debt: QuarantineDebt = {
    active: entries.length,
    readyToRelease: entries.filter((entry) => entry.releaseProposed).length,
    oldestAgeMs: entries.reduce((max, entry) => Math.max(max, entry.ageMs), 0),
    stillFailing: entries.filter((entry) => entry.runsSinceQuarantine > 0 && entry.consecutivePasses === 0).length,
  };

  return { entries, debt };
}

/**
 * Quarantine a test. Idempotent: quarantining an already-quarantined test
 * leaves the original entry (and its streak) alone rather than resetting it.
 */
export async function addQuarantine(
  db: DrizzleDB,
  projectId: number,
  testCaseId: number,
  options: { reason?: string | null; source?: string; createdBy?: number | null } = {},
): Promise<{ created: boolean }> {
  const [testCase] = await db
    .select({ id: testCases.id, projectId: testCases.projectId })
    .from(testCases)
    .where(eq(testCases.id, testCaseId));
  if (!testCase || testCase.projectId !== projectId) throw new Error('Test case not found in this project');

  const existing = await db
    .select({ id: quarantinedTests.id })
    .from(quarantinedTests)
    .where(and(eq(quarantinedTests.testCaseId, testCaseId), isNull(quarantinedTests.releasedAt)));
  if (existing.length > 0) return { created: false };

  // Anchor the streak to the newest run so executions already recorded cannot
  // count toward release — the point of quarantining is that history is bad.
  const [latestRun] = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.id))
    .limit(1);

  await db.insert(quarantinedTests).values({
    projectId,
    testCaseId,
    reason: options.reason ?? null,
    source: options.source === 'proposed' ? 'proposed' : 'manual',
    quarantinedAtRunId: latestRun?.id ?? null,
    // With authentication disabled the request carries a synthetic user whose
    // id is 0, which no `users` row has — store null rather than tripping the
    // foreign key on an instance that has no accounts at all.
    createdBy: typeof options.createdBy === 'number' && options.createdBy > 0 ? options.createdBy : null,
  });

  return { created: true };
}

/** Let a test back out. Keeps the row as history rather than deleting it. */
export async function releaseQuarantine(
  db: DrizzleDB,
  projectId: number,
  testCaseId: number,
  reason?: string | null,
): Promise<{ released: boolean }> {
  const active = await db
    .select({ id: quarantinedTests.id })
    .from(quarantinedTests)
    .where(
      and(
        eq(quarantinedTests.projectId, projectId),
        eq(quarantinedTests.testCaseId, testCaseId),
        isNull(quarantinedTests.releasedAt),
      ),
    );
  if (active.length === 0) return { released: false };

  await db
    .update(quarantinedTests)
    .set({ releasedAt: new Date(), releasedReason: reason ?? null })
    .where(
      inArray(
        quarantinedTests.id,
        active.map((row) => row.id),
      ),
    );
  return { released: true };
}
