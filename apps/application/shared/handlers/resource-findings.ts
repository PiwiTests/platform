import { and, desc, eq, inArray, isNull, lt, ne, or, type SQL } from 'drizzle-orm';
import { resourceFindings, resourceOccurrences, testRuns } from '../../server/database/schema';
import type { DrizzleDB } from './db';
import { isPassiveCapabilityDeclined } from './capabilities';
import { readProjectDefaultBranch, resolveFallbackBranch } from './baseline-scope';
import { resolveRunBranch } from '../../server/utils/run-branch';
import { readStoredResourceReport } from '#shared/resource-report';
import { resourceFingerprint } from '#shared/resource-fingerprint.mjs';
import type { WireResourceFinding, WireResourceReport } from '#shared/types';

/**
 * A project's resource findings across runs, the way failure clusters are kept:
 * each finding has an identity (`#shared/resource-fingerprint.mjs`), the runs
 * it first and last showed in, and a fix. Five full runs of the default branch
 * without it, with the capture fixtures on, record it fixed from the first of
 * them; it reopens when it shows again. A finding is new to a branch when no
 * earlier run of the branch the run compares with (the pull request's target,
 * else the default branch) showed it, which is what the gate's `maxNewLeaks`
 * and the pull-request comment read.
 */

/** Full default-branch runs without a finding that record it fixed. */
export const FIXED_AFTER_CLEAN_RUNS = 5;

/** One finding of a run, its shards folded together. */
export interface RunFinding {
  fingerprint: string;
  finding: WireResourceFinding;
}

/** The findings of a run's report, one per identity, its shards folded together. */
export function runFindings(parts: WireResourceReport[]): RunFinding[] {
  const byFingerprint = new Map<string, WireResourceFinding>();
  for (const part of parts) {
    for (const finding of part.findings) {
      const key = resourceFingerprint(finding);
      const seen = byFingerprint.get(key);
      if (!seen) {
        byFingerprint.set(key, { ...finding });
        continue;
      }
      seen.count += finding.count;
      seen.tests += finding.tests;
      if (finding.heldMs != null) seen.heldMs = Math.max(seen.heldMs ?? 0, finding.heldMs);
      if (finding.pages) seen.pages = (seen.pages ?? 0) + finding.pages;
      if (finding.afterTestCpuMs) seen.afterTestCpuMs = (seen.afterTestCpuMs ?? 0) + finding.afterTestCpuMs;
      if (finding.untilWorkerEnd) seen.untilWorkerEnd = true;
    }
  }
  return [...byFingerprint].map(([fingerprint, finding]) => ({ fingerprint, finding }));
}

/** The capture fixtures counted the run's objects, so its report could show any finding but a probable one. */
function ledgerRan(parts: WireResourceReport[]): boolean {
  return parts.some(
    (part) =>
      part.workerHealth !== null || part.workers.length > 0 || part.findings.some((f) => f.verdict !== 'probable'),
  );
}

interface RunFacts {
  id: number;
  projectId: number;
  startTime: Date;
  parts: WireResourceReport[];
  branch: string | null;
  metadata: unknown;
  isFullRun: boolean;
}

async function readRun(db: DrizzleDB, runId: number): Promise<RunFacts | null> {
  const [run] = await db
    .select({
      id: testRuns.id,
      projectId: testRuns.projectId,
      startTime: testRuns.startTime,
      resourceReport: testRuns.resourceReport,
      branch: testRuns.branch,
      metadata: testRuns.metadata,
      isFullRun: testRuns.isFullRun,
    })
    .from(testRuns)
    .where(eq(testRuns.id, runId));
  if (!run) return null;
  return {
    id: run.id,
    projectId: run.projectId,
    startTime: run.startTime,
    parts: readStoredResourceReport(run.resourceReport).parts,
    branch: run.branch ?? resolveRunBranch(run.metadata),
    metadata: run.metadata,
    isFullRun: run.isFullRun === 1,
  };
}

export interface RecordedFindings {
  /** Findings this run showed. */
  seen: number;
  /** Findings this run made fixed: the fifth clean run since each last showed. */
  fixed: number[];
  /** Findings that were fixed and showed again in this run. */
  reopened: number[];
}

/**
 * Record a finished run's findings in its project's history, and count it as a
 * clean run for the open findings it did not show. Safe to call again for the
 * same run (a sharded run calls it once per shard's finish): its occurrences are
 * replaced, and a run counts as clean for a finding once.
 */
export async function recordRunResourceFindings(db: DrizzleDB, runId: number): Promise<RecordedFindings> {
  const none: RecordedFindings = { seen: 0, fixed: [], reopened: [] };
  const run = await readRun(db, runId);
  if (!run || run.parts.length === 0) return none;
  if (await isPassiveCapabilityDeclined(db, run.projectId, 'resources')) return none;

  const found = runFindings(run.parts);
  const fingerprints = found.map((f) => f.fingerprint);
  const existing = fingerprints.length
    ? await db
        .select()
        .from(resourceFindings)
        .where(and(eq(resourceFindings.projectId, run.projectId), inArray(resourceFindings.fingerprint, fingerprints)))
    : [];
  const byFingerprint = new Map(existing.map((row) => [row.fingerprint, row]));
  const recorded = new Set(
    (
      await db
        .select({ findingId: resourceOccurrences.findingId })
        .from(resourceOccurrences)
        .where(eq(resourceOccurrences.runId, runId))
    ).map((row) => row.findingId),
  );

  const now = new Date();
  const reopened: number[] = [];
  const seenIds = new Set<number>();
  for (const { fingerprint, finding } of found) {
    const row = byFingerprint.get(fingerprint);
    let findingId: number;
    if (!row) {
      const [inserted] = await db
        .insert(resourceFindings)
        .values({
          projectId: run.projectId,
          fingerprint,
          verdict: finding.verdict,
          kind: finding.kind,
          place: finding.where,
          site: finding.site ?? null,
          firstSeenRunId: runId,
          lastSeenRunId: runId,
          firstSeenAt: run.startTime,
          lastSeenAt: run.startTime,
          occurrences: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: resourceFindings.id });
      findingId = inserted!.id;
    } else {
      findingId = row.id;
      const latest = run.startTime >= row.lastSeenAt;
      const comesBack = latest && row.status === 'fixed';
      if (comesBack) reopened.push(row.id);
      await db
        .update(resourceFindings)
        .set({
          ...(latest && {
            place: finding.where,
            site: finding.site ?? null,
            lastSeenRunId: runId,
            lastSeenAt: run.startTime,
          }),
          ...(run.startTime < row.firstSeenAt && { firstSeenRunId: runId, firstSeenAt: run.startTime }),
          occurrences: row.occurrences + (recorded.has(row.id) ? 0 : 1),
          ...(latest && { cleanRuns: 0, ...(row.status === 'open' && { fixedRunId: null }) }),
          ...(comesBack && { status: 'open', reopenedRunId: runId, fixedRunId: null, fixedAt: null }),
          updatedAt: now,
        })
        .where(eq(resourceFindings.id, row.id));
    }
    seenIds.add(findingId);
    const values = {
      branch: run.branch,
      count: finding.count,
      tests: finding.tests,
      heldMs: finding.heldMs ?? null,
      afterTestCpuMs: finding.afterTestCpuMs ?? null,
      pages: finding.pages ?? null,
    };
    if (recorded.has(findingId)) {
      await db
        .update(resourceOccurrences)
        .set(values)
        .where(and(eq(resourceOccurrences.findingId, findingId), eq(resourceOccurrences.runId, runId)));
    } else {
      await db.insert(resourceOccurrences).values({ findingId, runId, ...values });
    }
  }

  const fixed = await countCleanRun(db, run, seenIds, now);
  return { seen: seenIds.size, fixed, reopened };
}

/**
 * Count the run as clean for each open finding of its project it did not show,
 * when it can vouch for it: a full run of the default branch whose report could
 * have shown that finding, started after the finding last showed.
 */
async function countCleanRun(db: DrizzleDB, run: RunFacts, seenIds: Set<number>, now: Date): Promise<number[]> {
  if (!run.isFullRun) return [];
  const defaultBranch = await readProjectDefaultBranch(db, run.projectId, run.metadata);
  if (run.branch && run.branch !== defaultBranch) return [];
  const withLedger = ledgerRan(run.parts);

  const open = await db
    .select()
    .from(resourceFindings)
    .where(
      and(
        eq(resourceFindings.projectId, run.projectId),
        eq(resourceFindings.status, 'open'),
        lt(resourceFindings.lastSeenAt, run.startTime),
      ),
    );
  const fixed: number[] = [];
  for (const row of open) {
    if (seenIds.has(row.id)) continue;
    if (row.lastCheckedRunId === run.id) continue;
    if (row.verdict !== 'probable' && !withLedger) continue;
    const cleanRuns = row.cleanRuns + 1;
    const firstClean = row.fixedRunId ?? run.id;
    const isFixed = cleanRuns >= FIXED_AFTER_CLEAN_RUNS;
    if (isFixed) fixed.push(row.id);
    await db
      .update(resourceFindings)
      .set({
        cleanRuns,
        lastCheckedRunId: run.id,
        fixedRunId: firstClean,
        ...(isFixed && { status: 'fixed', fixedAt: now }),
        updatedAt: now,
      })
      .where(eq(resourceFindings.id, row.id));
  }
  return fixed;
}

/** A run's finding, and whether the branch it compares with had shown it before. */
export interface RunFindingNovelty extends RunFinding {
  isNew: boolean;
}

export interface RunFindingsNovelty {
  /** The branch the run compares with: the pull request's target, else the default branch. */
  baseBranch: string;
  findings: RunFindingNovelty[];
}

/**
 * The run's findings, each new when no run of the base branch that started
 * before it showed it. Reads the run's own report and the history of earlier runs only, so it
 * holds before the run's own findings are recorded. Null when the run sent no
 * report.
 */
export async function runFindingsNovelty(db: DrizzleDB, runId: number): Promise<RunFindingsNovelty | null> {
  const run = await readRun(db, runId);
  if (!run || run.parts.length === 0) return null;
  const defaultBranch = await readProjectDefaultBranch(db, run.projectId, run.metadata);
  const baseBranch = resolveFallbackBranch(run.metadata, defaultBranch).branch;
  const found = runFindings(run.parts);
  if (found.length === 0) return { baseBranch, findings: [] };

  // A run with no branch counts as a run of the default branch.
  const onBase: SQL =
    baseBranch === defaultBranch
      ? or(eq(resourceOccurrences.branch, baseBranch), isNull(resourceOccurrences.branch))!
      : eq(resourceOccurrences.branch, baseBranch);
  const seenBefore = new Set(
    (
      await db
        .selectDistinct({ fingerprint: resourceFindings.fingerprint })
        .from(resourceOccurrences)
        .innerJoin(resourceFindings, eq(resourceFindings.id, resourceOccurrences.findingId))
        .innerJoin(testRuns, eq(testRuns.id, resourceOccurrences.runId))
        .where(
          and(
            eq(resourceFindings.projectId, run.projectId),
            inArray(
              resourceFindings.fingerprint,
              found.map((f) => f.fingerprint),
            ),
            ne(resourceOccurrences.runId, run.id),
            lt(testRuns.startTime, run.startTime),
            onBase,
          ),
        )
    ).map((row) => row.fingerprint),
  );
  return {
    baseBranch,
    findings: found.map((f) => ({ ...f, isNew: !seenBefore.has(f.fingerprint) })),
  };
}

/** A finding as its history reads, for the tab, the tools and the comment. */
export interface ResourceFindingHistory {
  id: number;
  fingerprint: string;
  verdict: string;
  kind: string;
  where: string;
  site: string | null;
  status: 'open' | 'fixed';
  firstSeenRunId: number;
  lastSeenRunId: number;
  /** Runs it showed in. */
  runs: number;
  /** Full default-branch runs without it since it last showed. */
  cleanRuns: number;
  /** The first of those runs; the run it was fixed in once it is fixed. */
  fixedRunId: number | null;
  fixedAt: Date | null;
  reopenedRunId: number | null;
}

function toHistory(row: typeof resourceFindings.$inferSelect): ResourceFindingHistory {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    verdict: row.verdict,
    kind: row.kind,
    where: row.place,
    site: row.site,
    status: row.status === 'fixed' ? 'fixed' : 'open',
    firstSeenRunId: row.firstSeenRunId,
    lastSeenRunId: row.lastSeenRunId,
    runs: row.occurrences,
    cleanRuns: row.cleanRuns,
    fixedRunId: row.fixedRunId,
    fixedAt: row.fixedAt,
    reopenedRunId: row.reopenedRunId,
  };
}

/** The history of the findings with these identities in a project, by identity. */
export async function findingHistoryByFingerprint(
  db: DrizzleDB,
  projectId: number,
  fingerprints: string[],
): Promise<Map<string, ResourceFindingHistory>> {
  if (fingerprints.length === 0) return new Map();
  const rows = await db
    .select()
    .from(resourceFindings)
    .where(and(eq(resourceFindings.projectId, projectId), inArray(resourceFindings.fingerprint, fingerprints)));
  return new Map(rows.map((row) => [row.fingerprint, toHistory(row)]));
}

/** A project's findings, the most recently seen first. */
export async function listResourceFindings(
  db: DrizzleDB,
  projectId: number,
  opts: { status?: 'open' | 'fixed' | 'all'; verdict?: string; limit?: number } = {},
): Promise<ResourceFindingHistory[]> {
  const status = opts.status ?? 'open';
  const conditions: SQL[] = [eq(resourceFindings.projectId, projectId)];
  if (status !== 'all') conditions.push(eq(resourceFindings.status, status));
  if (opts.verdict) conditions.push(eq(resourceFindings.verdict, opts.verdict));
  const rows = await db
    .select()
    .from(resourceFindings)
    .where(and(...conditions))
    .orderBy(desc(resourceFindings.lastSeenAt), desc(resourceFindings.id))
    .limit(Math.min(200, Math.max(1, opts.limit ?? 50)));
  return rows.map(toHistory);
}

/** The latest occurrence of each finding, for what it held the last time it showed. */
export async function latestOccurrences(
  db: DrizzleDB,
  findingIds: number[],
): Promise<Map<number, typeof resourceOccurrences.$inferSelect>> {
  if (findingIds.length === 0) return new Map();
  const rows = await db
    .select({ occurrence: resourceOccurrences })
    .from(resourceOccurrences)
    .innerJoin(testRuns, eq(testRuns.id, resourceOccurrences.runId))
    .where(inArray(resourceOccurrences.findingId, findingIds))
    .orderBy(desc(testRuns.startTime), desc(resourceOccurrences.runId));
  const out = new Map<number, typeof resourceOccurrences.$inferSelect>();
  for (const { occurrence } of rows) if (!out.has(occurrence.findingId)) out.set(occurrence.findingId, occurrence);
  return out;
}
