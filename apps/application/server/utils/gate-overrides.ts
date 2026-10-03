/**
 * What happened to the pull requests a gate failed on.
 *
 * `refreshGatePullRequests` asks the SCM about the pull requests of failed gate
 * evaluations that are not settled yet. A pull request merged while its last
 * evaluation before the merge failed is an override: that evaluation records
 * the `gate` hand-back as `rejected`. One merged after a later passing or
 * inconclusive evaluation, or closed, records nothing. An open one is looked at
 * again on a later pass.
 *
 * `detectGateEscapes` then reads, for each override of the last
 * `ESCAPE_WINDOW_DAYS`, the eligible default-branch runs started after the
 * merge: the first one where a cluster of the evaluated run's new regressions
 * fails again is the escape, recorded as `regressed` on the same evaluation.
 *
 * Every row looked at has its `checkedAt` moved to the check time, and each
 * pass takes the rows never looked at first, then the least recently checked,
 * so a long-open pull request never holds the batch. Best-effort per row: a
 * project with no SCM token, an unsupported host or a failed lookup leaves the
 * row as it was.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { gateEvaluations, projects, testRuns, testRunsCases } from '../database/schema';
import { recordOutcome } from './outcomes';
import { createScmProvider } from './scm';
import { normalizeGitUrl } from './scm/git-url';
import { resolveDefaultBranch } from './scm/default-branch';
import { eligibleRunSql } from '#shared/run-eligibility';
import { DAY_MS } from '#shared/handlers/analytics/common';
import type { GateOutcomeDetails } from '#shared/handback-outcomes';
import type { RunMetadata } from './run-json-types';
import type { DbClient } from '../database';

/** Evaluations looked at in one pass, per phase. */
export const GATE_SWEEP_BATCH = 50;

/** How long after a merge a cluster failing again on the default branch counts as an escape. */
export const ESCAPE_WINDOW_DAYS = 30;

const FAIL_STATUSES = ['failed', 'timedOut', 'timedout'];

export interface GateSweep {
  /** Pull requests looked up on the SCM. */
  checked: number;
  merged: number;
  closed: number;
  /** Merged while the last evaluation failed. */
  overrides: number;
  /** Overrides whose caught cluster failed again on the default branch. */
  escapes: number;
}

interface SweepOptions {
  projectId?: number;
  limit?: number;
  now?: Date;
}

type EvaluationRow = typeof gateEvaluations.$inferSelect;

/** Never looked at first, then the least recently checked. */
const sweepOrder = [
  asc(sql`CASE WHEN ${gateEvaluations.checkedAt} IS NULL THEN 0 ELSE 1 END`),
  asc(gateEvaluations.checkedAt),
  asc(gateEvaluations.id),
];

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

function outcomeDetails(row: EvaluationRow): GateOutcomeDetails {
  const violations = Array.isArray(row.violations) ? (row.violations as Array<{ rule?: string }>) : [];
  return {
    prNumber: row.prNumber ?? null,
    verdict: row.verdict as GateOutcomeDetails['verdict'],
    rules: [...new Set(violations.map((v) => v.rule).filter((r): r is string => typeof r === 'string'))],
  };
}

/** Read the final state of the pull requests failed gates judged. */
export async function refreshGatePullRequests(db: DbClient, opts: SweepOptions = {}): Promise<GateSweep> {
  const sweep: GateSweep = { checked: 0, merged: 0, closed: 0, overrides: 0, escapes: 0 };
  const now = opts.now ?? new Date();
  const t = gateEvaluations;
  const unsettled = or(isNull(t.prState), eq(t.prState, 'open'));

  const rows = await db
    .select({ evaluation: t, metadata: testRuns.metadata })
    .from(t)
    .innerJoin(testRuns, eq(testRuns.id, t.runId))
    .where(
      and(
        eq(t.verdict, 'failed'),
        isNotNull(t.prNumber),
        unsettled,
        opts.projectId != null ? eq(t.projectId, opts.projectId) : undefined,
      ),
    )
    .orderBy(...sweepOrder)
    .limit(opts.limit ?? GATE_SWEEP_BATCH);

  const seen = new Set<string>();
  for (const { evaluation: row, metadata } of rows) {
    const prNumber = row.prNumber!;
    const prKey = `${row.projectId}:${prNumber}`;
    if (seen.has(prKey)) continue;
    seen.add(prKey);
    const samePr = and(eq(t.projectId, row.projectId), eq(t.prNumber, prNumber));
    await db.update(t).set({ checkedAt: now }).where(and(samePr, unsettled));

    try {
      const repositoryUrl = normalizeGitUrl((metadata as RunMetadata | null)?.scm?.remoteUrl ?? null);
      if (!repositoryUrl) continue;
      const provider = await createScmProvider(repositoryUrl, db, row.projectId);
      if (!provider) continue;
      const pullRequest = await provider.fetchPullRequest(prNumber);
      if (!pullRequest) continue;
      sweep.checked++;
      const state = pullRequest.state;
      if (state !== 'merged' && state !== 'closed') {
        await db
          .update(t)
          .set({ prState: 'open' })
          .where(and(samePr, isNull(t.prState)));
        continue;
      }

      const updatedAt = toDate(pullRequest.updatedAt);
      const settledAt = updatedAt && updatedAt.getTime() <= now.getTime() ? updatedAt : now;
      const settled = await db
        .update(t)
        .set({ prState: state, prSettledAt: settledAt })
        .where(and(samePr, unsettled))
        .returning({ id: t.id });
      if (settled.length === 0) continue;
      sweep[state]++;
      if (state !== 'merged') continue;

      // The last evaluation before the merge decides: a later passing one means the PR was fixed first.
      const [last] = await db
        .select()
        .from(t)
        .where(and(samePr, lte(t.evaluatedAt, settledAt)))
        .orderBy(desc(t.evaluatedAt), desc(t.id))
        .limit(1);
      if (last?.verdict !== 'failed') continue;
      await db.update(t).set({ overridden: true }).where(eq(t.id, last.id));
      await recordOutcome(db, {
        projectId: last.projectId,
        kind: 'gate',
        subjectType: 'gate-evaluation',
        subjectId: last.id,
        outcome: 'rejected',
        runId: last.runId,
        commit: last.commitSha ?? null,
        details: { ...outcomeDetails(last) },
        at: settledAt,
      });
      sweep.overrides++;
    } catch (err) {
      console.error(`[gate] PR state refresh failed for evaluation ${row.id}`, err);
    }
  }

  sweep.escapes = await detectGateEscapes(db, opts);
  return sweep;
}

/**
 * Record an escape for each recent override whose caught cluster failed again
 * on an eligible default-branch run started after the merge. Returns the
 * escapes recorded.
 */
export async function detectGateEscapes(db: DbClient, opts: SweepOptions = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const t = gateEvaluations;
  const rows = await db
    .select({ evaluation: t, metadata: testRuns.metadata })
    .from(t)
    .innerJoin(testRuns, eq(testRuns.id, t.runId))
    .where(
      and(
        eq(t.overridden, true),
        isNull(t.escapedRunId),
        gte(t.prSettledAt, new Date(now.getTime() - ESCAPE_WINDOW_DAYS * DAY_MS)),
        opts.projectId != null ? eq(t.projectId, opts.projectId) : undefined,
      ),
    )
    .orderBy(...sweepOrder)
    .limit(opts.limit ?? GATE_SWEEP_BATCH);

  const defaultBranches = new Map<number, string>();
  let escapes = 0;
  for (const { evaluation: row, metadata } of rows) {
    await db.update(t).set({ checkedAt: now }).where(eq(t.id, row.id));
    const clusterIds = Array.isArray(row.clusterIds) ? (row.clusterIds as number[]) : [];
    const mergedAt = toDate(row.prSettledAt);
    if (clusterIds.length === 0 || !mergedAt) continue;
    try {
      if (!defaultBranches.has(row.projectId)) {
        const [project] = await db
          .select({ id: projects.id, defaultBranch: projects.defaultBranch })
          .from(projects)
          .where(eq(projects.id, row.projectId));
        if (!project) continue;
        defaultBranches.set(row.projectId, await resolveDefaultBranch(db, project, metadata));
      }
      const defaultBranch = defaultBranches.get(row.projectId)!;

      const [escape] = await db
        .select({
          runId: testRuns.id,
          clusterId: testRunsCases.failureClusterId,
          metadata: testRuns.metadata,
          startTime: testRuns.startTime,
        })
        .from(testRunsCases)
        .innerJoin(testRuns, eq(testRuns.id, testRunsCases.testRunId))
        .where(
          and(
            eq(testRuns.projectId, row.projectId),
            eq(testRuns.branch, defaultBranch),
            gte(testRuns.startTime, mergedAt),
            eligibleRunSql('fix-verification'),
            inArray(testRunsCases.failureClusterId, clusterIds),
            inArray(testRunsCases.status, FAIL_STATUSES),
          ),
        )
        .orderBy(asc(testRuns.startTime), asc(testRuns.id))
        .limit(1);
      if (!escape?.clusterId) continue;

      const marked = await db
        .update(t)
        .set({ escapedRunId: escape.runId })
        .where(and(eq(t.id, row.id), isNull(t.escapedRunId)))
        .returning({ id: t.id });
      if (marked.length === 0) continue;
      const details: GateOutcomeDetails = {
        ...outcomeDetails(row),
        clusterId: escape.clusterId,
        escapedRunId: escape.runId,
      };
      await recordOutcome(db, {
        projectId: row.projectId,
        kind: 'gate',
        subjectType: 'gate-evaluation',
        subjectId: row.id,
        outcome: 'regressed',
        runId: escape.runId,
        commit: (escape.metadata as RunMetadata | null)?.scm?.commit ?? null,
        details: { ...details },
        at: toDate(escape.startTime) ?? now,
      });
      escapes++;
    } catch (err) {
      console.error(`[gate] escape check failed for evaluation ${row.id}`, err);
    }
  }
  return escapes;
}
