import { testCases, testRunsCases, failureClusters } from '../database/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { sanitizeNetworkRequests, sanitizeWebVitals, sanitizeConsoleLogs } from './sanitize';
import { computeErrorFingerprint, type ErrorFingerprint } from '../../shared/error-fingerprint';
import { testCaseCache } from './test-case-cache';
import type { getDatabase } from '../database';

type DB = Awaited<ReturnType<typeof getDatabase>>;

/**
 * Normalised test-case data ready to be persisted for a run. `filePath` + `title`
 * identify the shared test case; the remaining fields are stored on the per-run
 * junction row (`test_runs_cases`).
 */
export interface RunCaseInput {
  filePath: string;
  title: string;
  status: string;
  duration?: number | null;
  error?: string | null;
  retries?: number | null;
  line: number | null;
  column: number | null;
  steps?: unknown;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  consoleLogs?: unknown;
  ariaSnapshot?: string | null;
  testSource?: string | null;
  workerIndex?: number | null;
  startedAt?: number | null;
  browser?: unknown;
}

/** Per-fingerprint accumulator for the batch being persisted. */
interface PendingCluster {
  fp: ErrorFingerprint;
  sampleError: string;
  count: number;
}

/**
 * Get-or-create the `failure_clusters` rows for a batch of fingerprints and
 * return fingerprint → cluster id. Existing clusters get their lastSeenRunId
 * and occurrences bumped; new ones start at this run. Insert races with
 * concurrent streaming batches are resolved via the unique
 * (projectId, fingerprint) index + onConflictDoNothing.
 *
 * Bumps and inserts are issued in parallel — the JS event loop interleaves the
 * awaits but each operation touches a distinct fingerprint, so there are no
 * Map write conflicts (JS is single-threaded).
 */
async function getOrCreateFailureClusters(
  db: DB,
  projectId: number,
  testRunId: number,
  pending: Map<string, PendingCluster>,
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  if (pending.size === 0) return ids;

  const bumpExisting = (clusterId: number, count: number) =>
    db
      .update(failureClusters)
      .set({
        lastSeenRunId: testRunId,
        occurrences: sql`${failureClusters.occurrences} + ${count}`,
        updatedAt: new Date(),
      })
      .where(eq(failureClusters.id, clusterId));

  const existing = await db
    .select({ id: failureClusters.id, fingerprint: failureClusters.fingerprint })
    .from(failureClusters)
    .where(and(eq(failureClusters.projectId, projectId), inArray(failureClusters.fingerprint, [...pending.keys()])));

  // Bump all existing clusters in parallel
  await Promise.all(
    existing.map(async (cluster) => {
      const p = pending.get(cluster.fingerprint);
      if (!p) return;
      ids.set(cluster.fingerprint, cluster.id);
      await bumpExisting(cluster.id, p.count);
    }),
  );

  // Insert new clusters in parallel (each fingerprint is unique, no Map conflicts)
  const newFingerprints = [...pending.keys()].filter((fp) => !ids.has(fp));
  await Promise.all(
    newFingerprints.map(async (fingerprint) => {
      const p = pending.get(fingerprint)!;
      const inserted = await db
        .insert(failureClusters)
        .values({
          projectId,
          fingerprint,
          signature: p.fp.signature,
          errorType: p.fp.errorType,
          selector: p.fp.selector,
          sampleError: p.sampleError,
          firstSeenRunId: testRunId,
          lastSeenRunId: testRunId,
          occurrences: p.count,
        })
        .onConflictDoNothing()
        .returning({ id: failureClusters.id });

      if (inserted[0]) {
        ids.set(fingerprint, inserted[0].id);
        return;
      }

      // Lost the insert race — another batch created the cluster; bump it instead
      const winner = await db
        .select({ id: failureClusters.id })
        .from(failureClusters)
        .where(and(eq(failureClusters.projectId, projectId), eq(failureClusters.fingerprint, fingerprint)));
      if (winner[0]) {
        ids.set(fingerprint, winner[0].id);
        await bumpExisting(winner[0].id, p.count);
      }
    }),
  );

  return ids;
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

  // Use the process-level test case cache to avoid a SELECT per batch.
  // On first access for this project it loads all test cases from DB in one query;
  // subsequent calls across all streaming batches hit memory only.
  const projectCache = await testCaseCache.getProjectCache(db, projectId);

  // Compute error fingerprints for all failed cases in parallel
  const fingerprintResults = await Promise.all(
    cases.map((c) =>
      c.error && c.status !== 'passed' && c.status !== 'skipped'
        ? computeErrorFingerprint(c.error)
        : Promise.resolve(null),
    ),
  );

  const runCasesRows: Array<typeof testRunsCases.$inferInsert> = [];
  // Parallel to runCasesRows — null for non-failure cases
  const rowFingerprints: Array<ErrorFingerprint | null> = [];
  const pendingClusters = new Map<string, PendingCluster>();
  const existingCaseIdsToUpdate: number[] = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    const fingerprint = fingerprintResults[i] ?? null;
    const cacheKey = `${c.filePath}::${c.title}`;

    let caseId = projectCache.get(cacheKey);

    if (caseId === undefined) {
      // New test case — insert and warm the cache for future batches
      const result = await db.insert(testCases).values({ projectId, filePath: c.filePath, title: c.title }).returning();
      caseId = result[0]?.id;
      if (caseId !== undefined) {
        testCaseCache.add(projectId, c.filePath, c.title, caseId);
      }
    } else {
      existingCaseIdsToUpdate.push(caseId);
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
      slowestStep: c.slowestStep ?? null,
      slowestStepDuration: c.slowestStepDuration ?? null,
      networkRequests:
        sanitizeNetworkRequests(c.networkRequests as Array<Record<string, unknown>> | null | undefined) ?? null,
      webVitals: sanitizeWebVitals(c.webVitals as Record<string, unknown> | null | undefined) ?? null,
      consoleLogs: sanitizeConsoleLogs(c.consoleLogs as Array<Record<string, unknown>> | null | undefined) ?? null,
      ariaSnapshot: c.ariaSnapshot ?? null,
      testSource: c.testSource ?? null,
      browser: c.browser ?? null,
      workerIndex: c.workerIndex ?? null,
      startedAt: c.startedAt ?? null,
    });
  }

  if (runCasesRows.length === 0) return [];

  // Fire-and-forget: bump updatedAt for pre-existing test cases.
  // This is a cosmetic write that does not affect query correctness,
  // so it runs in the background rather than blocking the hot path.
  if (existingCaseIdsToUpdate.length > 0) {
    db.update(testCases)
      .set({ updatedAt: new Date() })
      .where(inArray(testCases.id, existingCaseIdsToUpdate))
      .catch(() => {});
  }

  const clusterIds = await getOrCreateFailureClusters(db, projectId, testRunId, pendingClusters);
  runCasesRows.forEach((row, i) => {
    const fingerprint = rowFingerprints[i];
    if (fingerprint) row.failureClusterId = clusterIds.get(fingerprint.fingerprint) ?? null;
  });

  return await db
    .insert(testRunsCases)
    .values(runCasesRows)
    .onConflictDoNothing()
    .returning({ id: testRunsCases.id, status: testRunsCases.status });
}
