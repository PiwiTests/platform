/**
 * The locator index: which locator chain each test used, from which call site,
 * for which action, in which Playwright project. Rows are built from the steps
 * Playwright reports for every execution, so the index needs no capture beyond
 * what the reporter already sends, and works with locator healing turned off.
 *
 * Shared by the server ingest path and the demo mirror.
 */
import { and, count, countDistinct, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { locatorUsages, projects, testCases, testRuns, testRunsCases } from '../database/schema';
import {
  extractStepLocatorUses,
  findLocationRoot,
  isAbsoluteLocation,
  locationRootOf,
  locatorScopes,
  locatorTarget,
  stepLocations,
  stripLocationRoot,
} from '#shared/locator-chain';
import { isProbeRun } from '#shared/handlers/probes';
import { escapeLikePattern } from '#shared/utils/tag-filter';
import type { DrizzleDB } from '#shared/handlers/db';
import type {
  ExecutionLocatorUse,
  ExecutionLocatorsResult,
  LocatorUsageMatch,
  LocatorUsageSite,
  LocatorUsagesResult,
} from '#shared/locator-usages.types';

/**
 * UTF-8 byte budgets for indexed text. A Postgres btree entry holds about
 * 2700 bytes, so the chain and the whole unique key stay well under it; a use
 * over budget is left out.
 */
const MAX_LOCATOR_BYTES = 1000;
const MAX_KEY_BYTES = 2000;
/** Rows per insert statement, well under SQLite's bound-parameter limit. */
const INSERT_CHUNK = 200;

const utf8 = new TextEncoder();
const byteLength = (value: string) => utf8.encode(value).length;

export interface LocatorUsageCase {
  caseId: number;
  /** The Playwright project the execution ran in (`test_runs_cases.browser_name`). */
  browserName: string | null;
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

/** What the index needs to know about a run. */
interface RunFacts {
  /** Orders uses across runs, including an old report imported late. */
  startedAt: Date;
  /** The checkout directory the reporter ran from, when it sent one. */
  root: string | null;
  probe: boolean;
}

type UsageInsert = typeof locatorUsages.$inferInsert;

const usageKey = (caseId: number, browserName: string, callSite: string, action: string, locator: string) =>
  `${caseId}\x00${browserName}\x00${callSite}\x00${action}\x00${locator}`;

async function loadRunFacts(db: DrizzleDB, runIds: number[]): Promise<Map<number, RunFacts>> {
  const out = new Map<number, RunFacts>();
  const ids = [...new Set(runIds)];
  for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
    const rows = await db
      .select({ id: testRuns.id, startTime: testRuns.startTime, metadata: testRuns.metadata })
      .from(testRuns)
      .where(inArray(testRuns.id, ids.slice(i, i + INSERT_CHUNK)));
    for (const r of rows) {
      const metadata = r.metadata as Record<string, unknown> | null;
      out.set(r.id, {
        startedAt: new Date(r.startTime),
        root: locationRootOf(metadata?.workingDir),
        probe: isProbeRun(metadata),
      });
    }
  }
  return out;
}

/**
 * The project root of each execution's absolute step locations: the working
 * directory the reporter sent with the run, else the prefix revealed by a step
 * in the test's own file, else the one another execution of the same run
 * revealed (one run comes from one checkout).
 */
function locationRoots(cases: LocatorUsageCase[], runs: Map<number, RunFacts>): Array<string | null> {
  const own = cases.map((c) => runs.get(c.runId)?.root ?? findLocationRoot(stepLocations(c.steps), c.filePath));
  const byRun = new Map<number, string>();
  cases.forEach((c, i) => {
    const root = own[i];
    if (root && !byRun.has(c.runId)) byRun.set(c.runId, root);
  });
  return cases.map((c, i) => own[i] ?? byRun.get(c.runId) ?? null);
}

/**
 * The rows a batch of executions contributes, one per distinct use per test and
 * project, and the cases that had a use left out: over the byte budget, or at a
 * call site that could not be made project-relative. Those never purge.
 */
export function buildLocatorUsageRows(
  projectId: number,
  cases: LocatorUsageCase[],
  runs: Map<number, RunFacts> = new Map(),
  now = new Date(),
): { rows: UsageInsert[]; partial: Set<number> } {
  const rows = new Map<string, UsageInsert>();
  const partial = new Set<number>();
  const roots = locationRoots(cases, runs);
  cases.forEach((c, k) => {
    const browserName = c.browserName ?? '';
    const seenAt = runs.get(c.runId)?.startedAt ?? now;
    for (const use of extractStepLocatorUses(c.steps)) {
      const callSite = use.location ? stripLocationRoot(use.location, roots[k]!) : '';
      const bytes = byteLength(use.locator);
      if (
        isAbsoluteLocation(callSite) ||
        bytes > MAX_LOCATOR_BYTES ||
        bytes + byteLength(callSite) + byteLength(browserName) + byteLength(use.action) > MAX_KEY_BYTES
      ) {
        partial.add(k);
        continue;
      }
      rows.set(usageKey(c.caseId, browserName, callSite, use.action, use.locator), {
        projectId,
        testCaseId: c.caseId,
        browserName,
        locator: use.locator,
        target: locatorTarget(use.chain),
        action: use.action,
        callSite,
        firstSeenRunId: c.runId,
        lastSeenRunId: c.runId,
        lastSeenAt: seenAt,
      });
    }
  });
  return { rows: [...rows.values()], partial };
}

/**
 * Upsert the locator uses of a batch of executions. A use seen again keeps its
 * first-seen run, and moves to the newer of the two runs, so importing an old
 * report never rolls the index back.
 *
 * An execution that ran to the end with every step kept removes the uses its
 * test no longer has, in its own Playwright project only (another project can
 * take other paths through the same test), and only those last seen before its
 * run started. A failed or truncated execution never removes anything: it may
 * have stopped before reaching them.
 */
export async function upsertLocatorUsages(db: DrizzleDB, projectId: number, cases: LocatorUsageCase[]): Promise<void> {
  const runs = await loadRunFacts(
    db,
    cases.map((c) => c.runId),
  );
  const { rows, partial } = buildLocatorUsageRows(projectId, cases, runs);

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db
      .insert(locatorUsages)
      .values(rows.slice(i, i + INSERT_CHUNK))
      .onConflictDoUpdate({
        target: [
          locatorUsages.testCaseId,
          locatorUsages.browserName,
          locatorUsages.callSite,
          locatorUsages.action,
          locatorUsages.locator,
        ],
        set: {
          lastSeenRunId: sql`CASE WHEN excluded.last_seen_at >= locator_usages.last_seen_at THEN excluded.last_seen_run_id ELSE locator_usages.last_seen_run_id END`,
          lastSeenAt: sql`CASE WHEN excluded.last_seen_at >= locator_usages.last_seen_at THEN excluded.last_seen_at ELSE locator_usages.last_seen_at END`,
        },
      });
  }

  // (test case, Playwright project) → the start of the latest complete run seen for it.
  const purgeBefore = new Map<string, Date>();
  cases.forEach((c, k) => {
    if (!c.complete || partial.has(k) || !Array.isArray(c.steps) || c.steps.length === 0) return;
    const startedAt = runs.get(c.runId)?.startedAt;
    if (!startedAt) return;
    const key = `${c.caseId}\x00${c.browserName ?? ''}`;
    const current = purgeBefore.get(key);
    if (!current || startedAt > current) purgeBefore.set(key, startedAt);
  });
  if (purgeBefore.size === 0) return;

  const seen = new Set(rows.map((r) => usageKey(r.testCaseId, r.browserName, r.callSite, r.action, r.locator)));
  const caseIds = [...new Set([...purgeBefore.keys()].map((k) => Number(k.split('\x00')[0])))];
  const existing = await db
    .select({
      id: locatorUsages.id,
      testCaseId: locatorUsages.testCaseId,
      browserName: locatorUsages.browserName,
      callSite: locatorUsages.callSite,
      action: locatorUsages.action,
      locator: locatorUsages.locator,
      lastSeenAt: locatorUsages.lastSeenAt,
    })
    .from(locatorUsages)
    .where(inArray(locatorUsages.testCaseId, caseIds));
  const stale = existing
    .filter((r) => {
      const before = purgeBefore.get(`${r.testCaseId}\x00${r.browserName}`);
      return (
        before !== undefined &&
        new Date(r.lastSeenAt) < before &&
        !seen.has(usageKey(r.testCaseId, r.browserName, r.callSite, r.action, r.locator))
      );
    })
    .map((r) => r.id);
  for (let i = 0; i < stale.length; i += INSERT_CHUNK) {
    await db.delete(locatorUsages).where(inArray(locatorUsages.id, stale.slice(i, i + INSERT_CHUNK)));
  }
}

interface ExecutionRef {
  id: number;
  testCaseId: number;
  browserName: string | null;
  status: string;
  testRunId: number;
}

/**
 * The execution to index for each (test case, Playwright project): the latest
 * passed one, which reached every locator, else the latest one. Probe runs
 * replay tests with injected faults and are skipped. Newest groups first.
 */
function pickExecutions(refs: ExecutionRef[], probeRuns: Set<number>, maxCases: number): ExecutionRef[] {
  const picked = new Map<string, { latest: ExecutionRef; passed: ExecutionRef | null }>();
  for (const ref of refs) {
    if (probeRuns.has(ref.testRunId)) continue;
    const key = `${ref.testCaseId}\x00${ref.browserName ?? ''}`;
    const entry = picked.get(key);
    if (!entry) {
      if (picked.size >= maxCases) continue;
      picked.set(key, { latest: ref, passed: ref.status === 'passed' ? ref : null });
    } else if (!entry.passed && ref.status === 'passed') {
      entry.passed = ref;
    }
  }
  return [...picked.values()].map((e) => e.passed ?? e.latest);
}

/**
 * Build a project's index from the executions already stored, then mark the
 * project as indexed. Reads the most recent executions (newest first, bounded
 * by `maxExecutions`) and indexes one per test case and Playwright project, up
 * to `maxCases`. Idempotent, so running it on a filled index only refreshes it.
 */
export async function backfillLocatorUsages(
  db: DrizzleDB,
  projectId: number,
  opts: { maxCases?: number; maxExecutions?: number } = {},
): Promise<{ casesProcessed: number; usages: number }> {
  const refs: ExecutionRef[] = await db
    .select({
      id: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      browserName: testRunsCases.browserName,
      status: testRunsCases.status,
      testRunId: testRunsCases.testRunId,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testCases.id, testRunsCases.testCaseId))
    .where(and(eq(testCases.projectId, projectId), isNotNull(testRunsCases.steps)))
    .orderBy(desc(testRunsCases.id))
    .limit(opts.maxExecutions ?? 50_000);

  // Only the runs of the picked executions are checked for probes; a probe
  // found moves its groups to their next execution, whose run is checked next.
  const maxCases = opts.maxCases ?? 5000;
  const probeRuns = new Set<number>();
  const checked = new Set<number>();
  let chosen = pickExecutions(refs, probeRuns, maxCases);
  for (;;) {
    const unchecked = [...new Set(chosen.map((r) => r.testRunId))].filter((id) => !checked.has(id));
    if (unchecked.length === 0) break;
    const facts = await loadRunFacts(db, unchecked);
    let found = false;
    for (const id of unchecked) {
      checked.add(id);
      if (facts.get(id)?.probe) {
        probeRuns.add(id);
        found = true;
      }
    }
    if (!found) break;
    chosen = pickExecutions(refs, probeRuns, maxCases);
  }

  const ids = chosen.map((r) => r.id);
  let casesProcessed = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const executions = await db
      .select({
        testCaseId: testRunsCases.testCaseId,
        browserName: testRunsCases.browserName,
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
        browserName: e.browserName,
        steps: e.steps,
        filePath: e.filePath,
        runId: e.testRunId,
        complete: false,
      })),
    );
    casesProcessed += executions.length;
  }

  await db.update(projects).set({ locatorIndexBuiltAt: new Date() }).where(eq(projects.id, projectId));
  const [total] = await db.select({ n: count() }).from(locatorUsages).where(eq(locatorUsages.projectId, projectId));
  return { casesProcessed, usages: Number(total?.n ?? 0) };
}

/**
 * Build the index of every project not built yet, for the history stored
 * before the index existed. The server runs it once at startup, the demo when
 * its database opens; a restart only picks up the projects still unmarked.
 */
export async function backfillUnindexedProjects(
  db: DrizzleDB,
): Promise<Array<{ projectId: number; name: string; casesProcessed: number; usages: number }>> {
  const pending = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(isNull(projects.locatorIndexBuiltAt));
  const out = [];
  for (const project of pending) {
    out.push({ projectId: project.id, name: project.name, ...(await backfillLocatorUsages(db, project.id)) });
  }
  return out;
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
 * the project use the same chain and the same target. Null when the execution
 * does not exist.
 */
export async function getExecutionLocators(db: DrizzleDB, runCaseId: number): Promise<ExecutionLocatorsResult | null> {
  const [row] = await db
    .select({
      steps: testRunsCases.steps,
      filePath: testCases.filePath,
      projectId: testCases.projectId,
      runMetadata: testRuns.metadata,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testCases.id, testRunsCases.testCaseId))
    .innerJoin(testRuns, eq(testRuns.id, testRunsCases.testRunId))
    .where(eq(testRunsCases.id, runCaseId));
  if (!row) return null;

  const found = extractStepLocatorUses(row.steps);
  const metadata = row.runMetadata as Record<string, unknown> | null;
  const root = locationRootOf(metadata?.workingDir) ?? findLocationRoot(stepLocations(row.steps), row.filePath);
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
              sql`${locatorUsages.locator} LIKE ${`${escapeLikePattern(value)}.%`} ESCAPE '\\'`,
            )
          : sql`lower(${locatorUsages.locator}) LIKE ${`%${escapeLikePattern(value.toLowerCase())}%`} ESCAPE '\\'`;

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
