/**
 * The locator index: which locator chain each test used, from which call site,
 * for which action. Rows are built from the steps Playwright reports for every
 * execution, so the index needs no capture beyond what the reporter already
 * sends, and works with locator healing turned off.
 *
 * Shared by the server ingest path and the demo mirror.
 */
import { and, count, countDistinct, desc, eq, inArray, isNotNull, max, or, sql } from 'drizzle-orm';
import { locatorUsages, testCases, testRunsCases } from '../database/schema';
import {
  extractStepLocatorUses,
  findLocationRoot,
  locatorScopes,
  locatorTarget,
  stepLocations,
  stripLocationRoot,
} from '#shared/locator-chain';
import type { DrizzleDB } from '#shared/handlers/db';
import type {
  ExecutionLocatorUse,
  ExecutionLocatorsResult,
  LocatorUsageMatch,
  LocatorUsageSite,
  LocatorUsagesResult,
} from '#shared/locator-usages.types';

/** Chains longer than this are skipped rather than indexed. */
const MAX_LOCATOR_CHARS = 1000;
/** Rows per insert statement, well under SQLite's bound-parameter limit. */
const INSERT_CHUNK = 200;

export interface LocatorUsageCase {
  caseId: number;
  /** The stored steps of the execution. */
  steps: unknown;
  /** The test's project-relative file, used to make step locations relative. */
  filePath: string | null;
  /** The run that produced the steps. */
  runId: number;
  /**
   * The execution ran to the end and every step was kept, so a use missing
   * from it no longer exists in the test and may be removed.
   */
  complete: boolean;
}

type UsageInsert = typeof locatorUsages.$inferInsert;

const usageKey = (caseId: number, callSite: string, action: string, locator: string) =>
  `${caseId}\x00${callSite}\x00${action}\x00${locator}`;

/**
 * The project root of each execution's absolute step locations. An execution
 * whose steps all sit outside its test file (every locator behind a page
 * object) borrows the root another execution of the same run revealed: one
 * run comes from one checkout.
 */
function locationRoots(cases: LocatorUsageCase[]): Array<string | null> {
  const own = cases.map((c) => findLocationRoot(stepLocations(c.steps), c.filePath));
  const byRun = new Map<number, string>();
  cases.forEach((c, i) => {
    const root = own[i];
    if (root && !byRun.has(c.runId)) byRun.set(c.runId, root);
  });
  return cases.map((c, i) => own[i] ?? byRun.get(c.runId) ?? null);
}

/** The rows a batch of executions contributes, one per distinct use per test. */
export function buildLocatorUsageRows(projectId: number, cases: LocatorUsageCase[], now = new Date()): UsageInsert[] {
  const rows = new Map<string, UsageInsert>();
  const roots = locationRoots(cases);
  cases.forEach((c, k) => {
    const uses = extractStepLocatorUses(c.steps);
    for (const use of uses) {
      if (use.locator.length > MAX_LOCATOR_CHARS) continue;
      const callSite = use.location ? stripLocationRoot(use.location, roots[k]!) : '';
      rows.set(usageKey(c.caseId, callSite, use.action, use.locator), {
        projectId,
        testCaseId: c.caseId,
        locator: use.locator,
        target: locatorTarget(use.chain),
        action: use.action,
        callSite,
        firstSeenRunId: c.runId,
        lastSeenRunId: c.runId,
        lastSeenAt: now,
      });
    }
  });
  return [...rows.values()];
}

/**
 * Upsert the locator uses of a batch of executions. A use seen again keeps its
 * first-seen run and moves its last-seen run forward. For executions that ran
 * to the end with every step kept, uses no longer present are removed, so a
 * locator edited out of a test stops counting; a failed or truncated execution
 * never removes anything, because it may have stopped before reaching them.
 */
export async function upsertLocatorUsages(db: DrizzleDB, projectId: number, cases: LocatorUsageCase[]): Promise<void> {
  const rows = buildLocatorUsageRows(projectId, cases);

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db
      .insert(locatorUsages)
      .values(rows.slice(i, i + INSERT_CHUNK))
      .onConflictDoUpdate({
        target: [locatorUsages.testCaseId, locatorUsages.callSite, locatorUsages.action, locatorUsages.locator],
        set: {
          lastSeenRunId: sql`excluded.last_seen_run_id`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      });
  }

  const purgeable = new Set(
    cases.filter((c) => c.complete && Array.isArray(c.steps) && c.steps.length > 0).map((c) => c.caseId),
  );
  if (purgeable.size === 0) return;
  const seen = new Set(rows.map((r) => usageKey(r.testCaseId, r.callSite, r.action, r.locator)));
  const existing = await db
    .select({
      id: locatorUsages.id,
      testCaseId: locatorUsages.testCaseId,
      callSite: locatorUsages.callSite,
      action: locatorUsages.action,
      locator: locatorUsages.locator,
    })
    .from(locatorUsages)
    .where(inArray(locatorUsages.testCaseId, [...purgeable]));
  const stale = existing
    .filter((r) => !seen.has(usageKey(r.testCaseId, r.callSite, r.action, r.locator)))
    .map((r) => r.id);
  for (let i = 0; i < stale.length; i += INSERT_CHUNK) {
    await db.delete(locatorUsages).where(inArray(locatorUsages.id, stale.slice(i, i + INSERT_CHUNK)));
  }
}

/** Whether a project's index holds any row yet. */
export async function hasLocatorUsages(db: DrizzleDB, projectId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: locatorUsages.id })
    .from(locatorUsages)
    .where(eq(locatorUsages.projectId, projectId))
    .limit(1);
  return row !== undefined;
}

/**
 * Build a project's index from the executions already stored: the latest
 * execution of each test case, newest test cases first, bounded by `maxCases`.
 * Idempotent, so running it on a filled index only refreshes it.
 */
export async function backfillLocatorUsages(
  db: DrizzleDB,
  projectId: number,
  opts: { maxCases?: number } = {},
): Promise<{ casesProcessed: number; usages: number }> {
  const latest = await db
    .select({ id: max(testRunsCases.id) })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testCases.id, testRunsCases.testCaseId))
    .where(and(eq(testCases.projectId, projectId), isNotNull(testRunsCases.steps)))
    .groupBy(testRunsCases.testCaseId)
    .orderBy(desc(max(testRunsCases.id)))
    .limit(opts.maxCases ?? 5000);
  const ids = latest.map((r) => r.id).filter((id): id is number => typeof id === 'number');

  let casesProcessed = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const executions = await db
      .select({
        testCaseId: testRunsCases.testCaseId,
        testRunId: testRunsCases.testRunId,
        steps: testRunsCases.steps,
        filePath: testCases.filePath,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testCases.id, testRunsCases.testCaseId))
      .where(inArray(testRunsCases.id, ids.slice(i, i + 100)));
    await upsertLocatorUsages(
      db,
      projectId,
      executions.map((e) => ({
        caseId: e.testCaseId,
        steps: e.steps,
        filePath: e.filePath,
        runId: e.testRunId,
        complete: false,
      })),
    );
    casesProcessed += executions.length;
  }

  const [total] = await db.select({ n: count() }).from(locatorUsages).where(eq(locatorUsages.projectId, projectId));
  return { casesProcessed, usages: Number(total?.n ?? 0) };
}

/** The project root revealed by any execution of a run whose steps touch its own test file. */
async function runLocationRoot(db: DrizzleDB, runId: number): Promise<string | null> {
  const siblings = await db
    .select({ steps: testRunsCases.steps, filePath: testCases.filePath })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testCases.id, testRunsCases.testCaseId))
    .where(and(eq(testRunsCases.testRunId, runId), isNotNull(testRunsCases.steps)))
    .limit(50);
  for (const s of siblings) {
    const root = findLocationRoot(stepLocations(s.steps), s.filePath);
    if (root) return root;
  }
  return null;
}

/** Distinct tests per value of `column`, for the given values of that column. */
async function countTestsBy(
  db: DrizzleDB,
  projectId: number,
  column: typeof locatorUsages.locator | typeof locatorUsages.target,
  values: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < values.length; i += INSERT_CHUNK) {
    const rows = await db
      .select({ value: column, n: countDistinct(locatorUsages.testCaseId) })
      .from(locatorUsages)
      .where(and(eq(locatorUsages.projectId, projectId), inArray(column, values.slice(i, i + INSERT_CHUNK))))
      .groupBy(column);
    for (const r of rows) out.set(r.value, Number(r.n));
  }
  return out;
}

/**
 * The locators one execution used, in step order, each with how many tests in
 * the project use the same chain and the same target. Builds the project's
 * index from stored runs first when it is still empty. Null when the execution
 * does not exist.
 */
export async function getExecutionLocators(db: DrizzleDB, runCaseId: number): Promise<ExecutionLocatorsResult | null> {
  const [row] = await db
    .select({
      steps: testRunsCases.steps,
      testRunId: testRunsCases.testRunId,
      filePath: testCases.filePath,
      projectId: testCases.projectId,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testCases.id, testRunsCases.testCaseId))
    .where(eq(testRunsCases.id, runCaseId));
  if (!row) return null;

  if (!(await hasLocatorUsages(db, row.projectId))) {
    await backfillLocatorUsages(db, row.projectId, { maxCases: 2000 });
  }

  const found = extractStepLocatorUses(row.steps);
  const root =
    findLocationRoot(stepLocations(row.steps), row.filePath) ??
    (found.length > 0 ? await runLocationRoot(db, row.testRunId) : null);
  const byKey = new Map<string, ExecutionLocatorUse>();
  found.forEach((use) => {
    const callSite = use.location ? stripLocationRoot(use.location, root) : null;
    const key = `${callSite ?? ''}\x00${use.action}\x00${use.locator}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences++;
      return;
    }
    byKey.set(key, {
      stepIndex: use.stepIndex,
      occurrences: 1,
      action: use.action,
      locator: use.locator,
      target: locatorTarget(use.chain),
      scopes: locatorScopes(use.chain),
      callSite,
      sameLocatorTests: 0,
      sameTargetTests: 0,
    });
  });
  const uses = [...byKey.values()];

  const [byLocator, byTarget] = await Promise.all([
    countTestsBy(db, row.projectId, locatorUsages.locator, [...new Set(uses.map((u) => u.locator))]),
    countTestsBy(db, row.projectId, locatorUsages.target, [...new Set(uses.map((u) => u.target))]),
  ]);
  for (const use of uses) {
    use.sameLocatorTests = byLocator.get(use.locator) ?? 0;
    use.sameTargetTests = byTarget.get(use.target) ?? 0;
  }

  return { projectId: row.projectId, uses, hasSteps: Array.isArray(row.steps) && row.steps.length > 0 };
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The call sites and tests that use matching chains:
 * - `locator`: exactly this chain;
 * - `target`: any chain ending on this call, whatever its containers;
 * - `scope`: this chain and every chain that continues inside it;
 * - `search`: chains containing the text, case-insensitively.
 */
export async function getLocatorUsages(
  db: DrizzleDB,
  projectId: number,
  match: LocatorUsageMatch,
  value: string,
  opts: { limit?: number } = {},
): Promise<LocatorUsagesResult> {
  const limit = opts.limit ?? 1000;
  const condition =
    match === 'locator'
      ? eq(locatorUsages.locator, value)
      : match === 'target'
        ? eq(locatorUsages.target, value)
        : match === 'scope'
          ? or(
              eq(locatorUsages.locator, value),
              sql`${locatorUsages.locator} LIKE ${`${escapeLike(value)}.%`} ESCAPE '\\'`,
            )
          : sql`lower(${locatorUsages.locator}) LIKE ${`%${escapeLike(value.toLowerCase())}%`} ESCAPE '\\'`;

  const rows = await db
    .select({
      testCaseId: locatorUsages.testCaseId,
      locator: locatorUsages.locator,
      action: locatorUsages.action,
      callSite: locatorUsages.callSite,
      lastSeenAt: locatorUsages.lastSeenAt,
      title: testCases.title,
      filePath: testCases.filePath,
      suitePath: testCases.suitePath,
    })
    .from(locatorUsages)
    .innerJoin(testCases, eq(testCases.id, locatorUsages.testCaseId))
    .where(and(eq(locatorUsages.projectId, projectId), condition))
    .orderBy(desc(locatorUsages.lastSeenAt))
    .limit(limit + 1);

  const truncated = rows.length > limit;
  // SQLite's LIKE ignores ASCII case; a scope match is a case-sensitive prefix.
  const kept = rows
    .slice(0, limit)
    .filter((r) => match !== 'scope' || r.locator === value || r.locator.startsWith(`${value}.`));

  const sites = new Map<string, LocatorUsageSite>();
  const tests = new Set<number>();
  for (const r of kept) {
    tests.add(r.testCaseId);
    const key = `${r.callSite}\x00${r.locator}`;
    let site = sites.get(key);
    if (!site) {
      site = {
        callSite: r.callSite || null,
        locator: r.locator,
        actions: [],
        tests: [],
        lastSeenAt: new Date(r.lastSeenAt).toISOString(),
      };
      sites.set(key, site);
    }
    if (!site.actions.includes(r.action)) site.actions.push(r.action);
    if (!site.tests.some((t) => t.testCaseId === r.testCaseId)) {
      site.tests.push({ testCaseId: r.testCaseId, title: r.title, filePath: r.filePath, suitePath: r.suitePath });
    }
  }

  // Call sites shared by the most tests first: a page-object line is one fix for all of them.
  const ordered = [...sites.values()].sort((a, b) => b.tests.length - a.tests.length);
  return { match, value, testCount: tests.size, sites: ordered, truncated };
}
