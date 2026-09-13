/**
 * Fix verification — closing the loop on "did my fix work?".
 *
 * Piwi already knows a cluster's failing tests, its diagnosis, the files the
 * suggested patch touches, and the last commit it failed at. Until now nothing
 * consumed that afterwards: a cluster went quiet and stayed open forever.
 *
 * After every run this asks two questions about each cluster:
 *
 * - **Did it stop failing?** Every test the cluster covers ran in this run and
 *   passed. That records a fix landing, with the commit and the time it took.
 * - **Did the diagnosis predict it?** The commits between the last failing run
 *   and this one touch a file the suggested patch named. That upgrades the
 *   verdict from "stopped failing" (which a flaky test does by accident) to
 *   "the change we pointed at is the change that fixed it".
 *
 * And one more, in the other direction: a cluster that had a fix recorded and
 * is failing again is marked `regressed`, because a fix that did not hold is
 * worth more than no record at all.
 *
 * The verdict moves the triage status only when the evidence is strong:
 * `diagnosis-verified` resolves an open cluster, `regressed` reopens a resolved
 * one, each appending a system line to the triage note. `stopped-failing`
 * alone changes nothing — a flaky test achieves it by accident. Every recorded
 * fix emits `cluster.fixed`; every regression emits `cluster.regressed`.
 *
 * Every step is best-effort — the run is already stored, and SCM being
 * unreachable must never turn into an ingest error.
 */
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { failureClusters, failureDiagnoses, projects, testRuns, testRunsCases } from '../database/schema';
import { createScmProvider } from './scm';
import { normalizeGitUrl } from './scm/git-url';
import { emitNotification } from './notifications/emit';
import { notifyFixAuthor } from './notifications/fix-author';
import { parseUnifiedDiff, stripAbPrefix } from '#shared/patch';
import type { FixAuthor, NotificationEvent, NotificationPayload } from '#shared/notification-events';
import type { RunMetadata } from './run-json-types';
import { getClusterKnownIssue } from './integrations/known-issue';
import { enqueueFixPolicies, enqueueRegressionPolicies, enqueueStillFailingPolicy } from './integrations/policies';
import type { DbClient } from '../database';

const FAIL_STATUSES = ['failed', 'timedOut', 'timedout'];

/** How a cluster's fix was corroborated. */
export type FixVerification = 'stopped-failing' | 'diagnosis-verified' | 'regressed';

/** One cluster whose fix landed in the run just processed. */
export interface VerifiedFix {
  clusterId: number;
  signature: string;
  title: string | null;
  verification: Exclude<FixVerification, 'regressed'>;
  timeToResolutionMs: number | null;
  /** Tests that were failing and now pass. */
  testCount: number;
}

/** Append a system-written line to a triage note, keeping what a person wrote. */
export function appendTriageNote(existing: string | null | undefined, line: string): string {
  const current = existing?.trim();
  return current ? `${current}\n${line}` : line;
}

/** The files a cluster's completed diagnosis proposed changing, if any. */
async function diagnosedFiles(db: DbClient, clusterId: number): Promise<string[]> {
  const rows = await db
    .select({ details: failureDiagnoses.details })
    .from(failureDiagnoses)
    .where(and(eq(failureDiagnoses.clusterId, clusterId), eq(failureDiagnoses.status, 'completed')))
    .limit(5);

  const files = new Set<string>();
  for (const row of rows) {
    const details = row.details as { suggestedFix?: { patch?: unknown } } | null;
    const patch = details?.suggestedFix?.patch;
    if (typeof patch !== 'string' || !patch.trim()) continue;
    for (const file of parseUnifiedDiff(patch).files) {
      const path = stripAbPrefix(file.newPath) ?? stripAbPrefix(file.oldPath);
      if (path) files.add(path);
    }
  }
  return [...files];
}

/**
 * True when the commits between `fromSha` and `toSha` touch any of `paths`.
 * Returns false on any failure, which downgrades the verdict to
 * "stopped-failing" rather than claiming a verification we could not make.
 */
async function changeTouchedFiles(
  db: DbClient,
  projectId: number,
  repositoryUrl: string,
  fromSha: string,
  toSha: string,
  paths: string[],
): Promise<boolean> {
  if (paths.length === 0 || fromSha === toSha) return false;
  try {
    const provider = await createScmProvider(repositoryUrl, db, projectId);
    if (!provider) return false;
    const changes = await provider.fetchChanges(fromSha, toSha);
    if (!changes?.files?.length) return false;

    const changed = new Set(changes.files.map((file) => file.filename));
    // Compare on suffixes too: the reporter records repo-relative paths, but a
    // monorepo diagnosis may name a path relative to a package root.
    return paths.some((path) => {
      for (const candidate of changed) {
        if (candidate === path || candidate.endsWith(`/${path}`) || path.endsWith(`/${candidate}`)) return true;
      }
      return false;
    });
  } catch {
    return false;
  }
}

/**
 * The author (name + email) of a commit, via the SCM provider when a token
 * resolves one. Best-effort: no repo, no commit, no provider, or a failed
 * lookup all yield undefined, and the notification then carries no author.
 */
async function resolveFixAuthor(
  db: DbClient,
  projectId: number,
  repositoryUrl: string | null,
  sha: string | null,
): Promise<FixAuthor | undefined> {
  if (!repositoryUrl || !sha) return undefined;
  try {
    const provider = await createScmProvider(repositoryUrl, db, projectId);
    if (!provider) return undefined;
    const author = await provider.getCommitAuthor(sha);
    return author ? { name: author.name, email: author.email } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Emit a cluster.fixed / cluster.regressed event, delivering it to the fix
 * author directly (email + targeted browser notification) on top of the normal
 * subscription routing.
 */
async function emitClusterOutcome(db: DbClient, event: NotificationEvent, payload: NotificationPayload): Promise<void> {
  const { targetUserId } = await notifyFixAuthor(db, event, payload);
  await emitNotification(db, event, payload, targetUserId != null ? { targetUserId } : undefined);
}

/**
 * Record fixes and regressions for one finished run. Returns the fixes that
 * landed, so the pull-request comment can report them.
 */
export async function verifyClusterFixes(db: DbClient, runId: number): Promise<VerifiedFix[]> {
  const [run] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
  if (!run) return [];

  // A partial run can still verify a cluster — but only by the same rule a full
  // run is held to below: every test the cluster covers ran in this run and
  // passed. A `--grep` that re-ran exactly the affected tests then closes the
  // cluster; one that skipped even one of them still does not, because a test
  // that did not execute has not been shown to pass. There is no separate
  // `isFullRun` gate: the per-cluster check is the honest one either way.

  const meta = (run.metadata as RunMetadata | null) ?? null;
  const currentCommit = meta?.scm?.commit ?? null;
  const repositoryUrl = normalizeGitUrl(meta?.scm?.remoteUrl ?? null);

  // What this run saw, per test case: any pass, and any failure.
  const caseRows = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      clusterId: testRunsCases.failureClusterId,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, runId));

  const passedCaseIds = new Set<number>();
  const executedCaseIds = new Set<number>();
  const clustersSeenNow = new Set<number>();
  for (const row of caseRows) {
    executedCaseIds.add(row.testCaseId);
    if (row.status === 'passed') passedCaseIds.add(row.testCaseId);
    if (row.clusterId != null && FAIL_STATUSES.includes(row.status)) clustersSeenNow.add(row.clusterId);
  }

  const [project] = await db
    .select({ name: projects.name, label: projects.label })
    .from(projects)
    .where(eq(projects.id, run.projectId));
  const projectName = project?.label || project?.name || `Project #${run.projectId}`;

  // Clusters that regressed this run, so the still-failing policy below does not
  // also comment "still failing" on a ticket it just told about the regression.
  const regressedIds = new Set<number>();

  // ── Regressions: a recorded fix that did not hold ─────────────────────────
  if (clustersSeenNow.size > 0) {
    const regressing = await db
      .select({
        id: failureClusters.id,
        signature: failureClusters.signature,
        title: failureClusters.title,
        status: failureClusters.status,
        triageNote: failureClusters.triageNote,
        fixLandedRunId: failureClusters.fixLandedRunId,
        fixCommit: failureClusters.fixCommit,
      })
      .from(failureClusters)
      .where(
        and(
          inArray(failureClusters.id, [...clustersSeenNow]),
          isNotNull(failureClusters.fixLandedRunId),
          ne(failureClusters.fixVerification, 'regressed'),
        ),
      );

    for (const cluster of regressing) {
      // A person's "resolved" was contradicted by the runs, so the cluster goes
      // back to open with the reason on record; "ignored" is left alone.
      const reopened = cluster.status === 'resolved';
      await db
        .update(failureClusters)
        .set({
          fixVerification: 'regressed',
          updatedAt: new Date(),
          ...(reopened
            ? {
                status: 'open',
                triageNote: appendTriageNote(cluster.triageNote, `Reopened automatically: regressed in run #${runId}`),
              }
            : {}),
        })
        .where(eq(failureClusters.id, cluster.id));

      // The regression reaches the author of the fix that did not hold.
      const fixAuthor = await resolveFixAuthor(db, run.projectId, repositoryUrl, cluster.fixCommit);
      const knownIssue = (await getClusterKnownIssue(db, cluster.id).catch(() => null)) ?? undefined;
      await emitClusterOutcome(db, 'cluster.regressed', {
        clusterId: cluster.id,
        projectId: run.projectId,
        projectName,
        signature: cluster.signature,
        title: cluster.title,
        runId,
        fixLandedRunId: cluster.fixLandedRunId,
        reopened,
        fixAuthor,
        knownIssue: knownIssue ? { key: knownIssue.key, url: knownIssue.url } : undefined,
      });

      // Comment on (and optionally reopen) the ticket per the binding's policy.
      await enqueueRegressionPolicies(db, {
        clusterId: cluster.id,
        projectId: run.projectId,
        runId,
      }).catch((e) => console.error('[integrations] regression policy failed', e));
      regressedIds.add(cluster.id);
    }
  }

  // ── Candidates: clusters that were failing and are quiet in this run ──────
  const candidates = await db
    .select({
      id: failureClusters.id,
      signature: failureClusters.signature,
      title: failureClusters.title,
      createdAt: failureClusters.createdAt,
      firstSeenRunId: failureClusters.firstSeenRunId,
      lastSeenRunId: failureClusters.lastSeenRunId,
      status: failureClusters.status,
      triageNote: failureClusters.triageNote,
    })
    .from(failureClusters)
    .where(
      and(
        eq(failureClusters.projectId, run.projectId),
        ne(failureClusters.lastSeenRunId, runId),
        or(isNull(failureClusters.fixLandedRunId), eq(failureClusters.fixVerification, 'regressed')),
      ),
    );

  if (candidates.length === 0) return [];

  const candidateIds = candidates.map((cluster) => cluster.id);
  const affected = await db
    .select({ clusterId: testRunsCases.failureClusterId, testCaseId: testRunsCases.testCaseId })
    .from(testRunsCases)
    .where(inArray(testRunsCases.failureClusterId, candidateIds));

  const casesByCluster = new Map<number, Set<number>>();
  for (const row of affected) {
    if (row.clusterId == null) continue;
    let set = casesByCluster.get(row.clusterId);
    if (!set) casesByCluster.set(row.clusterId, (set = new Set()));
    set.add(row.testCaseId);
  }

  // The commit the cluster last failed at — the "from" end of the diff that
  // supposedly fixed it.
  const referencedRunIds = [...new Set(candidates.flatMap((c) => [c.lastSeenRunId, c.firstSeenRunId]))];
  const referencedRuns = referencedRunIds.length
    ? await db
        .select({ id: testRuns.id, metadata: testRuns.metadata, startTime: testRuns.startTime })
        .from(testRuns)
        .where(inArray(testRuns.id, referencedRunIds))
    : [];
  const commitByRunId = new Map<number, string | null>(
    referencedRuns.map((row) => [row.id, ((row.metadata as RunMetadata | null)?.scm?.commit ?? null) as string | null]),
  );
  const startTimeByRunId = new Map<number, Date | null>(
    referencedRuns.map((row) => [row.id, row.startTime instanceof Date ? row.startTime : null]),
  );

  const fixed: VerifiedFix[] = [];

  for (const cluster of candidates) {
    const clusterCases = casesByCluster.get(cluster.id);
    if (!clusterCases || clusterCases.size === 0) continue;

    // Every affected test must have run here and passed. One unexecuted test
    // is enough to say nothing.
    let allGreen = true;
    for (const caseId of clusterCases) {
      if (!executedCaseIds.has(caseId) || !passedCaseIds.has(caseId)) {
        allGreen = false;
        break;
      }
    }
    if (!allGreen) continue;

    let verification: VerifiedFix['verification'] = 'stopped-failing';
    const fromCommit = commitByRunId.get(cluster.lastSeenRunId) ?? null;
    if (repositoryUrl && fromCommit && currentCommit) {
      const files = await diagnosedFiles(db, cluster.id);
      if (await changeTouchedFiles(db, run.projectId, repositoryUrl, fromCommit, currentCommit, files)) {
        verification = 'diagnosis-verified';
      }
    }

    // Both ends are run start times, so the number means "how long the suite
    // was broken" rather than mixing a wall-clock row timestamp with a reported
    // run time — which goes negative the moment runs are backfilled or imported.
    // The cluster's own createdAt is the fallback, since runs are deleted
    // independently and clusters outlive them.
    const landedAt = run.startTime instanceof Date ? run.startTime : new Date();
    const brokeAt =
      startTimeByRunId.get(cluster.firstSeenRunId) ?? (cluster.createdAt instanceof Date ? cluster.createdAt : null);
    const timeToResolutionMs = brokeAt ? Math.max(0, landedAt.getTime() - brokeAt.getTime()) : null;

    // The diagnosis pointing at the change that fixed it is strong enough to
    // close the triage; "stopped failing" alone is not.
    const resolved = verification === 'diagnosis-verified' && cluster.status === 'open';
    await db
      .update(failureClusters)
      .set({
        fixLandedRunId: runId,
        fixLandedAt: landedAt,
        fixCommit: currentCommit,
        timeToResolutionMs,
        fixVerification: verification,
        updatedAt: new Date(),
        ...(resolved
          ? {
              status: 'resolved',
              triageNote: appendTriageNote(
                cluster.triageNote,
                `Resolved automatically: diagnosis verified in run #${runId}`,
              ),
            }
          : {}),
      })
      .where(eq(failureClusters.id, cluster.id));

    fixed.push({
      clusterId: cluster.id,
      signature: cluster.signature,
      title: cluster.title,
      verification,
      timeToResolutionMs,
      testCount: clusterCases.size,
    });

    // The fix reaches the person whose commit landed it.
    const fixAuthor = await resolveFixAuthor(db, run.projectId, repositoryUrl, currentCommit);
    const knownIssue = (await getClusterKnownIssue(db, cluster.id).catch(() => null)) ?? undefined;
    await emitClusterOutcome(db, 'cluster.fixed', {
      clusterId: cluster.id,
      projectId: run.projectId,
      projectName,
      signature: cluster.signature,
      title: cluster.title,
      runId,
      verification,
      commit: currentCommit,
      timeToResolutionMs,
      testCount: clusterCases.size,
      resolved,
      fixAuthor,
      knownIssue: knownIssue ? { key: knownIssue.key, url: knownIssue.url } : undefined,
    });

    // Comment on (and optionally transition) the ticket per the binding's policy.
    await enqueueFixPolicies(db, {
      clusterId: cluster.id,
      projectId: run.projectId,
      runId,
      commit: currentCommit,
      verification,
    }).catch((e) => console.error('[integrations] fix policy failed', e));
  }

  // ── Still failing: new occurrences on an open ticket ──────────────────────
  // A cluster that failed again this run (and did not regress or get fixed) may
  // earn a once-a-day "still failing" note on its ticket.
  const stillFailingIds = [...clustersSeenNow].filter((id) => !regressedIds.has(id));
  if (stillFailingIds.length > 0) {
    const openWithCounts = await db
      .select({ id: failureClusters.id, occurrences: failureClusters.occurrences, status: failureClusters.status })
      .from(failureClusters)
      .where(and(inArray(failureClusters.id, stillFailingIds), eq(failureClusters.status, 'open')));
    for (const cluster of openWithCounts) {
      await enqueueStillFailingPolicy(db, {
        clusterId: cluster.id,
        projectId: run.projectId,
        latestRunId: runId,
        occurrences: cluster.occurrences ?? 0,
      }).catch((e) => console.error('[integrations] still-failing policy failed', e));
    }
  }

  return fixed;
}
