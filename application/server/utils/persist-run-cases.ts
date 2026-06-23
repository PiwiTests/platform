import { testCases, testRunsCases, testSuites, networkRequests } from '../database/schema';
import { eq } from 'drizzle-orm';
import { buildNetworkRequestItems, buildNetworkRequestInsertValues } from './network-request-helpers';
import { sanitizeWebVitals, sanitizeConsoleLogs } from './sanitize';
import { computeErrorFingerprint, type ErrorFingerprint } from '../../shared/error-fingerprint';
import { testCaseCache } from './test-case-cache';
import { testSuiteCache } from './test-suite-cache';
import { SUITE_PATH_SEP, joinSuitePath } from '../../shared/utils/suites';
import { getOrCreateFailureClusters, type PendingCluster } from '~~/shared/handlers/failure-cluster-ops';
import type { getDatabase } from '../database';

type DB = Awaited<ReturnType<typeof getDatabase>>;

/**
 * Normalised test-case data ready to be persisted for a run. `filePath` + `suitePath` + `title`
 * identify the shared test case; the remaining fields are stored on the per-run
 * junction row (`test_runs_cases`).
 */
export interface RunCaseInput {
  filePath: string;
  suitePath?: string[] | null;
  suiteConfig?: Array<{ mode: string; annotations: Array<{ type: string; description?: string }> }> | null;
  testAnnotations?: Array<{ type: string; description?: string }> | null;
  title: string;
  status: string;
  duration?: number | null;
  error?: string | null;
  retries?: number | null;
  line: number | null;
  column: number | null;
  steps?: unknown;
  stepEvents?: unknown;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  wastedTimeMs?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  consoleLogs?: unknown;
  ariaSnapshot?: string | null;
  testSource?: string | null;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  browser?: unknown;
}

function resolveBrowserName(browser: unknown): string | null {
  if (typeof browser === 'string') return browser;
  if (browser && typeof browser === 'object') {
    const b = browser as Record<string, unknown>;
    if (typeof b.projectName === 'string') return b.projectName;
  }
  return null;
}

/**
 * Resolve (upsert) all unique suite paths from the batch into `test_suites`.
 * Returns a map of `${filePath}\x00${suitePathStr}` → suiteId covering every
 * level of every suitePath in the batch.
 *
 * Cache hits still fire a background update so mode/annotations stay fresh
 * when a describe block's config changes between runs.
 */
async function resolveSuites(db: DB, projectId: number, cases: RunCaseInput[]): Promise<Map<string, number>> {
  // Collect unique (filePath, levelPath, mode, annotations) — one entry per
  // describe level per unique suitePath across all cases in the batch.
  type SuiteSpec = { filePath: string; levelPath: string; mode: string; annotations: unknown[] };
  const pending = new Map<string, SuiteSpec>(); // key → spec, deduped

  for (const c of cases) {
    const sp = c.suitePath ?? [];
    for (let i = 0; i < sp.length; i++) {
      const levelPath = sp.slice(0, i + 1).join(SUITE_PATH_SEP);
      const key = `${c.filePath}\x00${levelPath}`;
      if (!pending.has(key)) {
        pending.set(key, {
          filePath: c.filePath,
          levelPath,
          mode: c.suiteConfig?.[i]?.mode ?? 'default',
          annotations: c.suiteConfig?.[i]?.annotations ?? [],
        });
      }
    }
  }

  if (pending.size === 0) return new Map();

  const projectSuiteCache = await testSuiteCache.getProjectCache(db, projectId);
  const suiteIdMap = new Map<string, number>();
  const toUpsert: Array<{ key: string } & SuiteSpec> = [];
  const toUpdate: Array<{ id: number; mode: string; annotations: unknown[] }> = [];

  for (const [key, spec] of pending) {
    const cached = projectSuiteCache.get(`${spec.filePath}\x00${spec.levelPath}`);
    if (cached !== undefined) {
      suiteIdMap.set(key, cached);
      toUpdate.push({ id: cached, mode: spec.mode, annotations: spec.annotations });
    } else {
      toUpsert.push({ key, ...spec });
    }
  }

  // Upsert missing suites sequentially to avoid unique-constraint races
  for (const spec of toUpsert) {
    const result = await db
      .insert(testSuites)
      .values({
        projectId,
        filePath: spec.filePath,
        suitePath: spec.levelPath,
        mode: spec.mode,
        annotations: spec.annotations as any,
      })
      .onConflictDoUpdate({
        target: [testSuites.projectId, testSuites.filePath, testSuites.suitePath],
        set: { mode: spec.mode, annotations: spec.annotations as any, updatedAt: new Date() },
      })
      .returning({ id: testSuites.id });

    const id = result[0]?.id;
    if (id !== undefined) {
      suiteIdMap.set(spec.key, id);
      testSuiteCache.add(projectId, spec.filePath, spec.levelPath, id);
    }
  }

  // Fire-and-forget: refresh mode/annotations for cache hits (they can change between runs)
  if (toUpdate.length > 0) {
    Promise.all(
      toUpdate.map(({ id, mode, annotations }) =>
        db
          .update(testSuites)
          .set({ mode, annotations: annotations as any, updatedAt: new Date() })
          .where(eq(testSuites.id, id)),
      ),
    ).catch(() => {});
  }

  return suiteIdMap;
}

/**
 * Get-or-create the shared `test_cases` rows for a batch and insert the per-run
 * `test_runs_cases` rows in a single statement. Network requests, web vitals and
 * console logs are sanitised here (stripping query strings from URLs). Failed
 * cases with error text are fingerprinted and linked to a `failure_clusters`
 * row so failures sharing a root cause can be grouped.
 *
 * Shared by the submit, upload and streaming-events endpoints. Returns the
 * inserted junction rows in input order so callers can link attachments (e.g.
 * trace files) by index.
 *
 * Deduplication is enforced by a DB unique index on
 * `(test_run_id, test_case_id, retries, browser)` — the `ON CONFLICT DO NOTHING`
 * clause silently skips rows that would violate it. This naturally handles both
 * batch retries and same-test-different-browser scenarios.
 */
export async function persistRunCases(
  db: DB,
  projectId: number,
  testRunId: number,
  cases: RunCaseInput[],
): Promise<Array<{ id: number; status: string }>> {
  if (cases.length === 0) return [];

  // --- Step 1: Resolve all suites referenced in this batch ---
  const suiteIdMap = await resolveSuites(db, projectId, cases);

  // --- Step 2: Resolve test case IDs and build junction rows ---

  const projectCache = await testCaseCache.getProjectCache(db, projectId);

  const fingerprintResults = await Promise.all(
    cases.map((c) =>
      c.error && c.status !== 'passed' && c.status !== 'skipped'
        ? computeErrorFingerprint(c.error)
        : Promise.resolve(null),
    ),
  );

  const runCasesRows: Array<typeof testRunsCases.$inferInsert> = [];
  const networkRequestBuilders: Array<{
    items: Array<{
      method: string;
      url: string | null;
      normalizedUrl: string;
      status: number;
      duration: number | null;
      resourceType: string | null;
      serverLogs: unknown;
    }>;
  }> = [];
  const rowFingerprints: Array<ErrorFingerprint | null> = [];
  const pendingClusters = new Map<string, PendingCluster>();

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    const fingerprint = fingerprintResults[i] ?? null;
    const suitePath = joinSuitePath(c.suitePath);
    const cacheKey = `${c.filePath}\x00${suitePath}\x00${c.title}`;

    let caseId = projectCache.get(cacheKey);

    if (caseId === undefined) {
      const suiteId = suitePath ? (suiteIdMap.get(`${c.filePath}\x00${suitePath}`) ?? null) : null;

      const result = await db
        .insert(testCases)
        .values({
          projectId,
          filePath: c.filePath,
          suitePath,
          suiteId,
          title: c.title,
        })
        .returning();
      caseId = result[0]?.id;
      if (caseId !== undefined) {
        testCaseCache.add(projectId, c.filePath, suitePath, c.title, caseId);
      }
    }

    if (caseId === undefined) continue;

    if (fingerprint) {
      const pending = pendingClusters.get(fingerprint.fingerprint);
      if (pending) {
        pending.count++;
      } else {
        pendingClusters.set(fingerprint.fingerprint, { fp: fingerprint, sampleError: c.error!, count: 1 });
      }
    }
    rowFingerprints.push(fingerprint);

    runCasesRows.push({
      testRunId,
      testCaseId: caseId,
      status: c.status,
      duration: c.duration ?? null,
      error: c.error ?? null,
      retries: c.retries ?? 0,
      line: c.line,
      column: c.column,
      steps: c.steps ?? null,
      stepEvents: c.stepEvents ?? null,
      slowestStep: c.slowestStep ?? null,
      slowestStepDuration: c.slowestStepDuration ?? null,
      wastedTimeMs: c.wastedTimeMs ?? null,
      webVitals: sanitizeWebVitals(c.webVitals as Record<string, unknown> | null | undefined) ?? null,
      consoleLogs: sanitizeConsoleLogs(c.consoleLogs as Array<Record<string, unknown>> | null | undefined) ?? null,
      ariaSnapshot: c.ariaSnapshot ?? null,
      testSource: c.testSource ?? null,
      testAnnotations: (c.testAnnotations as any) ?? null,
      browser: c.browser ?? null,
      browserName: resolveBrowserName(c.browser),
      workerIndex: c.workerIndex ?? null,
      shardIndex: c.shardIndex ?? null,
      startedAt: c.startedAt ? new Date(c.startedAt) : null,
    });

    const nrItems = buildNetworkRequestItems(c.networkRequests as Array<Record<string, unknown>> | null | undefined);
    networkRequestBuilders.push({ items: nrItems as any });
  }

  if (runCasesRows.length === 0) return [];

  const clusterIds = await getOrCreateFailureClusters(db, projectId, testRunId, pendingClusters);
  runCasesRows.forEach((row, i) => {
    const fingerprint = rowFingerprints[i];
    if (fingerprint) row.failureClusterId = clusterIds.get(fingerprint.fingerprint) ?? null;
  });

  const insertedCases = await db
    .insert(testRunsCases)
    .values(runCasesRows)
    .onConflictDoNothing()
    .returning({ id: testRunsCases.id, status: testRunsCases.status });

  const nrValues = buildNetworkRequestInsertValues(networkRequestBuilders, insertedCases, testRunId);
  if (nrValues.length > 0) {
    await db.insert(networkRequests).values(nrValues);
  }

  return insertedCases;
}
