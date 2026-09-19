import { testCases, testRunsCases, testSuites, networkRequests } from '../database/schema';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import {
  buildNetworkRequestItems,
  buildNetworkRequestInsertValues,
  type NetworkRequestBuilder,
} from './network-request-helpers';
import {
  capArray,
  capSteps,
  capConsoleLogs,
  capErrorText,
  capSourceFrames,
  capText,
  sanitizeWebVitals,
  sanitizeConsoleLogs,
  sanitizeDialogs,
  sanitizePageState,
  sanitizeAiUsage,
} from './sanitize';
import { resolveIngestLimits } from './ingest-limits';
import { normalizeTestCaseStatus } from '#shared/utils/test-counts';
import { upsertCasePayloads } from './case-payloads';
import { GREEN_SAMPLE_MAX_AGE_MS } from '#shared/handlers/aria-sampling';
import { computeErrorFingerprint, type ErrorFingerprint } from '#shared/error-fingerprint';
import {
  normalizeTestLocks,
  normalizeTestTags,
  parseTestMetadata,
  sanitizeTestMetadata,
  type TestMetadata,
} from '@piwitests/core/test-meta';
import { testCaseCache } from './test-case-cache';
import { testSuiteCache } from './test-suite-cache';
import { SUITE_PATH_SEP, joinSuitePath } from '#shared/utils/suites';
import { getOrCreateFailureClusters, type PendingCluster } from '#shared/handlers/failure-cluster-ops';
import { upsertLocatorSnapshots } from './locator-healing';
import { ingestRunGraph, collectRunGraphReaches } from './graph-ingest';
import type { LocatorSnapshot } from '#shared/locator-healing.types';
import type { DbClient as DB } from '../database';

/** Apply the canonical per-case status spelling to each attempt entry. */
function normalizeAttemptStatuses(attempts: unknown): unknown {
  if (!Array.isArray(attempts)) return attempts;
  return attempts.map((attempt) => {
    if (!attempt || typeof attempt !== 'object') return attempt;
    const status = (attempt as { status?: unknown }).status;
    if (typeof status !== 'string') return attempt;
    return { ...attempt, status: normalizeTestCaseStatus(status) };
  });
}

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
  /** Tags declared on the test — re-normalized here, so raw reporter input is fine. */
  tags?: unknown;
  /** Lock names the execution held — re-normalized here, so raw reporter input is fine. */
  locks?: unknown;
  /** `piwi:` metadata; re-derived from `testAnnotations` when absent. */
  testMeta?: unknown;
  title: string;
  status: string;
  duration?: number | null;
  /** Effective per-test timeout in ms (`TestCase.timeout`); `0` means unbounded, null when unknown. */
  timeout?: number | null;
  error?: string | null;
  retries?: number | null;
  /** Per-attempt outcomes `{ retry, status, duration, startedAt }`, oldest first. */
  attempts?: unknown;
  line: number | null;
  column: number | null;
  steps?: unknown;
  stepEvents?: unknown;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  wastedTimeMs?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  pageState?: unknown;
  aiUsage?: unknown;
  consoleLogs?: unknown;
  dialogs?: unknown;
  ariaSnapshot?: string | null;
  ariaSnapshotJson?: string | null;
  testSource?: string | null;
  testSourceFrames?: unknown;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  browser?: unknown;
  /** Per-element locator snapshots to upsert into locator_snapshots (transient). */
  locatorSnapshots?: LocatorSnapshot[] | null;
  /** Why a `didnotrun` case never executed; null for tests that ran. */
  didNotRunReason?: string | null;
  /** For a `previous-failure` cascade, the location of the failing test that blocked it. */
  blockedBy?: string | null;
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

/** Latest-known tags, locks + `piwi:` metadata for one test case, as stored. */
interface CaseMetaSnapshot {
  tags: string[];
  locks: string[];
  meta: TestMetadata | null;
}

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function sameSnapshot(stored: CaseMetaSnapshot, incoming: CaseMetaSnapshot): boolean {
  if (!sameStringList(stored.tags, incoming.tags)) return false;
  if (!sameStringList(stored.locks, incoming.locks)) return false;
  const a = stored.meta ?? {};
  const b = incoming.meta ?? {};
  return a.owner === b.owner && a.priority === b.priority && a.feature === b.feature && a.link === b.link;
}

/**
 * Mirror each reported test's tags and `piwi:` metadata onto its `test_cases`
 * row, so project-wide views can filter by tag or owner without joining every
 * run. The per-execution values on `test_runs_cases` stay the record of what a
 * given run saw; these columns only track the most recent declaration.
 *
 * Reads the current values first and writes only the rows that actually
 * changed — in steady state a run costs one SELECT and no UPDATEs, and a tag
 * removed from a spec still propagates (the incoming empty value differs from
 * the stored one).
 */
async function syncTestCaseMetadata(db: DB, incoming: Map<number, CaseMetaSnapshot>): Promise<void> {
  if (incoming.size === 0) return;

  const ids = [...incoming.keys()];
  const stored = await db
    .select({
      id: testCases.id,
      tags: testCases.tags,
      locks: testCases.locks,
      owner: testCases.owner,
      priority: testCases.priority,
      feature: testCases.feature,
      link: testCases.link,
    })
    .from(testCases)
    .where(inArray(testCases.id, ids));

  const storedById = new Map<number, CaseMetaSnapshot>(
    stored.map((row) => [
      row.id,
      {
        tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
        locks: Array.isArray(row.locks) ? (row.locks as string[]) : [],
        meta: sanitizeTestMetadata({
          owner: row.owner,
          priority: row.priority,
          feature: row.feature,
          link: row.link,
        }),
      },
    ]),
  );

  for (const [caseId, next] of incoming) {
    const current = storedById.get(caseId);
    if (current && sameSnapshot(current, next)) continue;

    await db
      .update(testCases)
      .set({
        tags: next.tags.length ? next.tags : null,
        locks: next.locks.length ? next.locks : null,
        owner: next.meta?.owner ?? null,
        priority: next.meta?.priority ?? null,
        feature: next.meta?.feature ?? null,
        link: next.meta?.link ?? null,
        updatedAt: new Date(),
      })
      .where(eq(testCases.id, caseId));
  }
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
 * trace files) by index. Each entry also carries the index of the input case
 * that produced it, so the streaming endpoint can attach the persisted
 * execution id to the right `test-completed` event even when duplicates were
 * skipped.
 *
 * Deduplication is enforced by a DB unique index on
 * `(test_run_id, test_case_id, retries, browser)` — the `ON CONFLICT DO NOTHING`
 * clause silently skips rows that would violate it. This naturally handles both
 * batch retries and same-test-different-browser scenarios.
 */
/**
 * Drop redundant green ARIA samples before they reach storage. A passing
 * execution's snapshot is kept only when the test has no other green snapshot
 * from the last {@link GREEN_SAMPLE_MAX_AGE_MS} — both against snapshots already
 * stored and against duplicates within this same batch. Failing snapshots are
 * never touched. Mutates `payloads[i].aria` in place; the rows keep their other
 * evidence, they just stop carrying a duplicate green page.
 */
async function dedupeGreenSamples(
  db: DB,
  rows: Array<typeof testRunsCases.$inferInsert>,
  payloads: Array<{ aria: string | null; ariaJson: string | null; source: string | null; framesJson: string | null }>,
  now: number = Date.now(),
): Promise<void> {
  const cutoff = now - GREEN_SAMPLE_MAX_AGE_MS;
  const seenInBatch = new Set<number>();
  const greenRows: Array<{ index: number; caseId: number }> = [];

  rows.forEach((row, i) => {
    if (row.status !== 'passed' || !payloads[i]!.aria || row.testCaseId == null) return;
    const caseId = row.testCaseId;
    // One green sample per test per batch is enough — drop the rest outright.
    if (seenInBatch.has(caseId)) {
      payloads[i]!.aria = null;
      payloads[i]!.ariaJson = null;
      return;
    }
    seenInBatch.add(caseId);
    greenRows.push({ index: i, caseId });
  });
  if (greenRows.length === 0) return;

  const caseIds = greenRows.map((r) => r.caseId);
  const existing = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      latest: sql<number>`max(${testRunsCases.createdAt})`,
    })
    .from(testRunsCases)
    .where(
      and(
        inArray(testRunsCases.testCaseId, caseIds),
        eq(testRunsCases.status, 'passed'),
        or(isNotNull(testRunsCases.ariaSnapshotPayloadId), isNotNull(testRunsCases.ariaSnapshot)),
      ),
    )
    .groupBy(testRunsCases.testCaseId);

  const freshById = new Map(existing.map((r) => [r.testCaseId, Number(r.latest)]));
  for (const { index, caseId } of greenRows) {
    const latest = freshById.get(caseId);
    if (latest != null && latest >= cutoff) {
      payloads[index]!.aria = null;
      payloads[index]!.ariaJson = null;
    }
  }
}

export async function persistRunCases(
  db: DB,
  projectId: number,
  testRunId: number,
  cases: RunCaseInput[],
): Promise<Array<{ id: number; status: string; testCaseId: number; inputIndex: number }>> {
  if (cases.length === 0) return [];

  const limits = resolveIngestLimits();

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
  // Input index of each row in `runCasesRows`, so inserted rows can be mapped
  // back to the batch entry that produced them after the insert.
  const rowInputIndices: number[] = [];
  // Capped payload strings per row, deduplicated into case_payloads after the
  // loop; the junction rows store only the payload ids (inline columns stay
  // null on new rows — readers coalesce via inlineCasePayloads).
  const rowPayloads: Array<{
    aria: string | null;
    ariaJson: string | null;
    source: string | null;
    framesJson: string | null;
  }> = [];
  const networkRequestBuilders: NetworkRequestBuilder[] = [];
  const rowFingerprints: Array<ErrorFingerprint | null> = [];
  const pendingClusters = new Map<string, PendingCluster>();
  // Locator snapshots to upsert, grouped by resolved test case id; the shared
  // helper handles row building, upsert, and stale-location purge after insert.
  const perCaseLocators: Array<{
    caseId: number;
    snapshots: LocatorSnapshot[] | null | undefined;
    purge?: boolean;
  }> = [];
  // Latest tags/metadata per resolved test case, mirrored onto test_cases once
  // the batch is built. A test appearing twice (retries, browsers) declares the
  // same values, so last-write-wins is safe.
  const caseMetaSnapshots = new Map<number, CaseMetaSnapshot>();

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

    // Re-normalize on arrival: a payload can reach the ingest API without ever
    // passing through the reporter, so the reporter's normalization is a
    // convenience rather than a guarantee. Annotations win over a supplied
    // `testMeta` because they are the declared source.
    const tags = normalizeTestTags(c.tags);
    const locks = normalizeTestLocks(c.locks).slice(0, limits.locks);
    const testMeta = parseTestMetadata(c.testAnnotations) ?? sanitizeTestMetadata(c.testMeta);
    caseMetaSnapshots.set(caseId, { tags, locks, meta: testMeta });

    // Collect locator snapshots; upserted in one batch after the case insert.
    // Only a passed case may purge stale locations — a failed run can stop
    // before reaching later locators (see upsertLocatorSnapshots).
    if (c.locatorSnapshots?.length)
      perCaseLocators.push({ caseId, snapshots: c.locatorSnapshots, purge: c.status === 'passed' });

    if (fingerprint) {
      const pending = pendingClusters.get(fingerprint.fingerprint);
      if (pending) {
        pending.count++;
      } else {
        // The fingerprint is computed from the raw error above; only storage is capped.
        pendingClusters.set(fingerprint.fingerprint, {
          fp: fingerprint,
          sampleError: capText(c.error, limits.sampleErrorChars)!,
          count: 1,
        });
      }
    }
    rowFingerprints.push(fingerprint);

    const aria = capText(c.ariaSnapshot, limits.ariaSnapshotChars);
    const ariaJson = capText(c.ariaSnapshotJson, limits.ariaSnapshotChars);
    const source = capText(c.testSource, limits.testSourceChars);
    const frames = capSourceFrames(c.testSourceFrames, limits);
    rowPayloads.push({ aria, ariaJson, source, framesJson: frames != null ? JSON.stringify(frames) : null });

    runCasesRows.push({
      testRunId,
      testCaseId: caseId,
      status: normalizeTestCaseStatus(c.status),
      duration: c.duration ?? null,
      timeout: c.timeout ?? null,
      error: capErrorText(c.error, limits.errorChars),
      retries: c.retries ?? 0,
      attempts: capArray(normalizeAttemptStatuses(c.attempts), 30),
      line: c.line,
      column: c.column,
      steps: capSteps(c.steps, limits),
      stepEvents: capArray(c.stepEvents, limits.stepEvents),
      slowestStep: c.slowestStep ?? null,
      slowestStepDuration: c.slowestStepDuration ?? null,
      wastedTimeMs: c.wastedTimeMs ?? null,
      webVitals: sanitizeWebVitals(c.webVitals as Record<string, unknown> | null | undefined) ?? null,
      pageState: sanitizePageState(c.pageState),
      aiUsage: sanitizeAiUsage(c.aiUsage),
      consoleLogs:
        capConsoleLogs(
          sanitizeConsoleLogs(c.consoleLogs as Array<Record<string, unknown>> | null | undefined),
          limits,
        ) ?? null,
      dialogs: capArray(sanitizeDialogs(c.dialogs), limits.dialogs) ?? null,
      ariaSnapshot: null,
      ariaSnapshotJson: null,
      testSource: null,
      testSourceFrames: null,
      testAnnotations: (c.testAnnotations as any) ?? null,
      tags: tags.length ? tags : null,
      locks: locks.length ? locks : null,
      testMeta,
      browser: c.browser ?? null,
      browserName: resolveBrowserName(c.browser),
      workerIndex: c.workerIndex ?? null,
      shardIndex: c.shardIndex ?? null,
      startedAt: c.startedAt ?? null,
      didNotRunReason: c.didNotRunReason ?? null,
      blockedBy: c.blockedBy ?? null,
    });
    rowInputIndices.push(i);

    const nrItems = buildNetworkRequestItems(c.networkRequests as Array<Record<string, unknown>> | null | undefined);
    networkRequestBuilders.push({ items: nrItems });
  }

  if (runCasesRows.length === 0) return [];

  // Keep at most one green ARIA sample per test per day: a passing snapshot is
  // dropped when the test already has a recent one, so many runs a day stay bounded.
  await dedupeGreenSamples(db, runCasesRows, rowPayloads);

  // Payloads land first so the junction rows can reference them.
  const payloadIds = await upsertCasePayloads(
    db,
    projectId,
    rowPayloads.flatMap((p) => [p.aria, p.ariaJson, p.source, p.framesJson]),
  );
  runCasesRows.forEach((row, i) => {
    const p = rowPayloads[i]!;
    row.ariaSnapshotPayloadId = p.aria ? (payloadIds.get(p.aria) ?? null) : null;
    row.ariaSnapshotJsonPayloadId = p.ariaJson ? (payloadIds.get(p.ariaJson) ?? null) : null;
    row.testSourcePayloadId = p.source ? (payloadIds.get(p.source) ?? null) : null;
    row.testSourceFramesPayloadId = p.framesJson ? (payloadIds.get(p.framesJson) ?? null) : null;
  });

  const clusterIds = await getOrCreateFailureClusters(db, projectId, testRunId, pendingClusters);
  runCasesRows.forEach((row, i) => {
    const fingerprint = rowFingerprints[i];
    if (fingerprint) row.failureClusterId = clusterIds.get(fingerprint.fingerprint) ?? null;
  });

  const insertedCases = await db.insert(testRunsCases).values(runCasesRows).onConflictDoNothing().returning({
    id: testRunsCases.id,
    status: testRunsCases.status,
    testCaseId: testRunsCases.testCaseId,
    retries: testRunsCases.retries,
    browserName: testRunsCases.browserName,
  });

  // The unique (run, case, retries, browser) index makes this tuple unique
  // within a batch, so each inserted row maps back to exactly one input entry
  // even when ON CONFLICT DO NOTHING skipped duplicates in between.
  const tupleToInputIndex = new Map<string, number>();
  runCasesRows.forEach((row, k) => {
    const tuple = `${row.testCaseId}\x00${row.retries ?? 0}\x00${row.browserName ?? ''}`;
    tupleToInputIndex.set(tuple, rowInputIndices[k]!);
  });

  const result = insertedCases.map((r) => {
    const tuple = `${r.testCaseId}\x00${r.retries ?? 0}\x00${r.browserName ?? ''}`;
    return {
      id: r.id,
      status: r.status,
      testCaseId: r.testCaseId,
      inputIndex: tupleToInputIndex.get(tuple) ?? -1,
    };
  });

  const nrValues = buildNetworkRequestInsertValues(networkRequestBuilders, insertedCases, testRunId);
  if (nrValues.length > 0) {
    await db.insert(networkRequests).values(nrValues);
  }

  await upsertLocatorSnapshots(db, perCaseLocators, testRunId);
  await syncTestCaseMetadata(db, caseMetaSnapshots);

  // Feed the feature graph from the same rows: route nodes from the network
  // requests, page nodes from page state, and a `reaches` edge per test case.
  // A graph failure must never break ingest, so it degrades to a warning.
  try {
    await ingestRunGraph(
      db,
      projectId,
      testRunId,
      collectRunGraphReaches(
        runCasesRows.map((row) => ({ testCaseId: row.testCaseId, pageState: row.pageState })),
        networkRequestBuilders,
      ),
    );
  } catch (err) {
    console.warn('[graph-ingest] failed to update the feature graph', err);
  }

  return result;
}
