import {
  failureClusters,
  failureDiagnoses,
  testRuns,
  testRunsCases,
  testCases,
  projects,
  entityLinks,
  clusterMergeSuggestions,
} from '../../server/database/schema';
import { eq, and, desc, sql, inArray, or, isNull, lte } from 'drizzle-orm';

import type { DrizzleDB } from './db';
import type { OpenFailureCluster } from '../../types/api';
import { recomputeClusterOccurrences } from './failure-cluster-ops';
import { getQuarantinedCaseIds, listQuarantine, addQuarantine } from './quarantine';
import { clusterClue, computeSnooze, type SnoozeOption } from '../inbox-queues';

type ProjectScope = 'all' | Set<number>;

const VALID_STATUSES = ['open', 'resolved', 'ignored'];

export async function getFailureCluster(db: DrizzleDB, clusterId: number) {
  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const [[countRow], [lastRun], [firstSeenRun], [diag], [project], affectedTestCases, [latestOccurrence]] =
    await Promise.all([
      db
        .select({ affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})` })
        .from(testRunsCases)
        .where(eq(testRunsCases.failureClusterId, clusterId)),

      db
        .select({ status: testRuns.status, startTime: testRuns.startTime })
        .from(testRuns)
        .where(eq(testRuns.id, cluster.lastSeenRunId)),

      db.select({ startTime: testRuns.startTime }).from(testRuns).where(eq(testRuns.id, cluster.firstSeenRunId)),

      db
        .select()
        .from(failureDiagnoses)
        .where(and(eq(failureDiagnoses.clusterId, clusterId), eq(failureDiagnoses.scope, 'cluster'))),

      db
        .select({ id: projects.id, name: projects.name, label: projects.label })
        .from(projects)
        .where(eq(projects.id, cluster.projectId)),

      db
        .select({
          testCaseId: testCases.id,
          title: testCases.title,
          filePath: testCases.filePath,
          owner: testCases.owner,
          runCount: sql<number>`count(${testRunsCases.id})`,
          recentTestRunsCaseId: sql<number>`max(${testRunsCases.id})`,
        })
        .from(testRunsCases)
        .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
        .where(eq(testRunsCases.failureClusterId, clusterId))
        .groupBy(testCases.id, testCases.title, testCases.filePath, testCases.owner)
        .orderBy(desc(sql`count(${testRunsCases.id})`))
        .limit(50),

      // The cluster's latest occurrence: an execution in the last-seen run, so the
      // page can default its evidence and headline to the newest failure rather
      // than the highest execution id (which need not be the most recent run).
      db
        .select({ id: testRunsCases.id, testCaseId: testRunsCases.testCaseId })
        .from(testRunsCases)
        .where(and(eq(testRunsCases.failureClusterId, clusterId), eq(testRunsCases.testRunId, cluster.lastSeenRunId)))
        .orderBy(desc(testRunsCases.id))
        .limit(1),
    ]);

  // Which affected tests are currently quarantined — drives the "Quarantined"
  // chip and the per-test / "Quarantine all affected" actions on the page.
  const quarantinedIds = await getQuarantinedCaseIds(db, cluster.projectId);

  // Known-issue links pinned to this cluster (Jira / GitHub issue, etc.).
  const links = await db.select().from(entityLinks).where(eq(entityLinks.failureClusterId, clusterId));

  // The cluster's owner from the representative test's `piwi:owner` annotation
  // (the most-affected test wins). The server route layers CODEOWNERS on top when
  // no annotation exists, the same as the execution page's verdict owner.
  const annotationOwner = (affectedTestCases[0] as { owner?: string | null } | undefined)?.owner ?? null;
  const owner = annotationOwner
    ? { name: annotationOwner, source: 'annotation' as const }
    : (null as { name: string; source: 'annotation' | 'codeowners' } | null);

  return {
    ...cluster,
    affectedTests: Number(countRow?.affectedTests ?? 0),
    lastSeenRunStatus: lastRun?.status ?? null,
    lastSeenAt: lastRun?.startTime ?? null,
    firstSeenAt: firstSeenRun?.startTime ?? null,
    latestTestRunsCaseId: latestOccurrence?.id ?? null,
    latestTestCaseId: latestOccurrence?.testCaseId ?? null,
    diagnosis: diag
      ? {
          status: diag.status,
          category: diag.category,
          confidence: diag.confidence,
          summary: diag.summary,
        }
      : null,
    project: project ?? null,
    affectedTestCases: affectedTestCases.map((t: any) => ({
      testCaseId: t.testCaseId,
      title: t.title,
      filePath: t.filePath,
      runCount: Number(t.runCount),
      recentTestRunsCaseId: t.recentTestRunsCaseId,
      quarantined: quarantinedIds.has(t.testCaseId),
    })),
    links,
    owner,
  };
}

export async function getClusterDiagnosis(db: DrizzleDB, clusterId: number) {
  const [diag] = await db
    .select()
    .from(failureDiagnoses)
    .where(and(eq(failureDiagnoses.clusterId, clusterId), eq(failureDiagnoses.scope, 'cluster')));
  const [cluster] = await db
    .select({ manualBaseCommit: failureClusters.manualBaseCommit })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  return {
    diagnosis: diag ?? null,
    manualBaseCommit: cluster?.manualBaseCommit ?? null,
  };
}

/**
 * The stored execution-scoped AI diagnosis for a single test-run case, if any.
 * Mirrors `getClusterDiagnosis` but keyed on the execution instead of a cluster,
 * so the test-run-case page can restore a diagnosis after a reload. Shared by the
 * server endpoint and the demo router so the two never drift.
 */
export async function getExecutionDiagnosis(db: DrizzleDB, testRunsCaseId: number) {
  const [diag] = await db
    .select()
    .from(failureDiagnoses)
    .where(and(eq(failureDiagnoses.testRunsCaseId, testRunsCaseId), eq(failureDiagnoses.scope, 'execution')));
  return { diagnosis: diag ?? null };
}

export async function patchClusterStatus(db: DrizzleDB, clusterId: number, status: string, triageNote?: string | null) {
  if (!status || !VALID_STATUSES.includes(status)) {
    return null;
  }

  const [cluster] = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const note = triageNote ?? null;
  await db
    .update(failureClusters)
    .set({ status, triageNote: note, updatedAt: new Date() })
    .where(eq(failureClusters.id, clusterId));

  const [updated] = await db.select().from(failureClusters).where(eq(failureClusters.id, clusterId));
  return { success: true, cluster: updated };
}

/**
 * Assign (or unassign) a cluster. The stored `assignee` overrides the owner the
 * row derives from the test annotation, and drives the *Mine* queue. An empty or
 * whitespace value clears the assignment.
 */
export async function patchClusterAssignee(db: DrizzleDB, clusterId: number, assignee?: string | null) {
  const [cluster] = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const value = typeof assignee === 'string' && assignee.trim() ? assignee.trim() : null;
  await db
    .update(failureClusters)
    .set({ assignee: value, updatedAt: new Date() })
    .where(eq(failureClusters.id, clusterId));

  const [updated] = await db.select().from(failureClusters).where(eq(failureClusters.id, clusterId));
  return { success: true, cluster: updated };
}

/**
 * Snooze a cluster (hiding it from every inbox queue) or, with a null option,
 * unsnooze it. Snooze never touches `status` — a snoozed cluster is still open,
 * just out of sight until its deadline passes or (in "until it recurs" mode) a
 * new run adds an occurrence. Unsnoozing clears the "snoozed, back" marker too.
 */
export async function patchClusterSnooze(
  db: DrizzleDB,
  clusterId: number,
  option: SnoozeOption | null,
  now: Date = new Date(),
) {
  const [cluster] = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const fields = option ? computeSnooze(option, now) : { snoozedUntil: null, snoozeMode: null };
  await db
    .update(failureClusters)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(failureClusters.id, clusterId));

  const [updated] = await db.select().from(failureClusters).where(eq(failureClusters.id, clusterId));
  return { success: true, cluster: updated };
}

/**
 * Quarantine every test currently in a cluster — the "quarantine the cluster's
 * tests" inbox action, applying the same exit-ramp quarantine the cluster page's
 * "Quarantine all affected" button uses, but keyed on the cluster so the inbox
 * need not carry the test-case ids. Idempotent per test.
 */
export async function quarantineClusterTests(
  db: DrizzleDB,
  clusterId: number,
  opts: { createdBy?: number | null; reason?: string } = {},
) {
  const [cluster] = await db
    .select({ id: failureClusters.id, projectId: failureClusters.projectId })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const rows = await db
    .selectDistinct({ testCaseId: testRunsCases.testCaseId })
    .from(testRunsCases)
    .where(eq(testRunsCases.failureClusterId, clusterId));

  let quarantined = 0;
  for (const row of rows) {
    const { created } = await addQuarantine(db, cluster.projectId, row.testCaseId, {
      reason: opts.reason,
      source: 'manual',
      createdBy: opts.createdBy ?? null,
    });
    if (created) quarantined += 1;
  }
  return { success: true, projectId: cluster.projectId, tests: rows.length, quarantined };
}

/** A single bulk-triage action applied to a set of already-authorized clusters. */
export type BulkTriage =
  | { action: 'status'; status: string }
  | { action: 'assign'; assignee: string | null }
  | { action: 'snooze'; snooze: SnoozeOption | null };

/**
 * Apply one triage action to many clusters at once, sharing the validation the
 * single-cluster endpoints use. The caller has already narrowed `ids` to the
 * clusters the user may write. Returns null on an invalid status.
 */
export async function bulkTriageClusters(
  db: DrizzleDB,
  ids: number[],
  patch: BulkTriage,
  now: Date = new Date(),
): Promise<{ updated: number } | null> {
  if (ids.length === 0) return { updated: 0 };

  let set: Record<string, unknown>;
  if (patch.action === 'status') {
    if (!VALID_STATUSES.includes(patch.status)) return null;
    set = { status: patch.status, triageNote: null, updatedAt: new Date() };
  } else if (patch.action === 'assign') {
    const value = typeof patch.assignee === 'string' && patch.assignee.trim() ? patch.assignee.trim() : null;
    set = { assignee: value, updatedAt: new Date() };
  } else {
    const fields = patch.snooze ? computeSnooze(patch.snooze, now) : { snoozedUntil: null, snoozeMode: null };
    set = { ...fields, updatedAt: new Date() };
  }

  await db.update(failureClusters).set(set).where(inArray(failureClusters.id, ids));
  return { updated: ids.length };
}

export async function patchClusterBaseCommit(db: DrizzleDB, clusterId: number, commit?: string | null) {
  const [cluster] = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const manualBaseCommit = typeof commit === 'string' && commit.trim() ? commit.trim() : null;
  await db
    .update(failureClusters)
    .set({ manualBaseCommit, updatedAt: new Date() })
    .where(eq(failureClusters.id, clusterId));

  const [updated] = await db.select().from(failureClusters).where(eq(failureClusters.id, clusterId));
  return { success: true, cluster: updated };
}

// NOTE: The demo SCM (commits/branches/commit-diff) and AI-context endpoints used
// to be no-op stubs here. They now have real, data-grounded demo implementations in
// `app/demo/api/scm.ts` and `app/demo/api/diagnosis-context.ts` (kept out of shared/
// so the canned SCM data never leaks into the server bundle).

export async function extractClusterCases(
  db: DrizzleDB,
  clusterId: number,
  testCaseIds: number[],
  triageNote?: string,
) {
  if (!testCaseIds || !Array.isArray(testCaseIds) || testCaseIds.length === 0) {
    return null;
  }

  const [cluster] = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  await db
    .update(testRunsCases)
    .set({ failureClusterId: null })
    .where(and(eq(testRunsCases.failureClusterId, clusterId), inArray(testRunsCases.testCaseId, testCaseIds)));

  const remainingOccurrences = await recomputeClusterOccurrences(db, clusterId);

  if (triageNote !== undefined) {
    await db
      .update(failureClusters)
      .set({ triageNote, updatedAt: new Date() })
      .where(eq(failureClusters.id, clusterId));
  }

  return { success: true, extractedCount: testCaseIds.length, remainingOccurrences };
}

/**
 * Open failure clusters across every project the caller can see, newest first
 * by last seen — the Home failure inbox. Each row carries everything the inbox
 * queues and rows need in one pass (no N+1): the fields `describeCluster` names
 * a cluster from, the owning project, the affected-test count, first/last seen,
 * the annotation owner (the most-affected test wins, mirroring `getFailureCluster`)
 * and any assignee, a one-line cause hint, the pinned known-issue link, the
 * regression / fix-didn't-hold / quarantine-readiness / merge-suggestion signals
 * the queues filter on, and the snooze state.
 *
 * Currently-snoozed clusters are excluded (they leave every queue until the
 * deadline passes); an "until it recurs" snooze that has recurred returns here
 * with `snoozeMode` still set and `snoozedUntil` cleared, so the card can badge
 * it "snoozed, back".
 */
export async function getOpenFailureClusters(
  db: DrizzleDB,
  scope: ProjectScope = 'all',
  limit = 50,
  now: Date = new Date(),
): Promise<OpenFailureCluster[]> {
  const allowed = scope === 'all' ? 'all' : [...scope];
  if (allowed !== 'all' && allowed.length === 0) return [];

  // Open, and not currently snoozed (null deadline, or a deadline already past —
  // which is how an "until it recurs" wake and an expired timed snooze both read).
  const notSnoozed = or(isNull(failureClusters.snoozedUntil), lte(failureClusters.snoozedUntil, now));
  const where =
    allowed === 'all'
      ? and(eq(failureClusters.status, 'open'), notSnoozed)
      : and(eq(failureClusters.status, 'open'), inArray(failureClusters.projectId, allowed), notSnoozed);

  const clusters: any[] = await db
    .select({
      id: failureClusters.id,
      projectId: failureClusters.projectId,
      title: failureClusters.title,
      signature: failureClusters.signature,
      errorType: failureClusters.errorType,
      selector: failureClusters.selector,
      sampleError: failureClusters.sampleError,
      status: failureClusters.status,
      firstSeenRunId: failureClusters.firstSeenRunId,
      lastSeenRunId: failureClusters.lastSeenRunId,
      occurrences: failureClusters.occurrences,
      assignee: failureClusters.assignee,
      fixVerification: failureClusters.fixVerification,
      snoozedUntil: failureClusters.snoozedUntil,
      snoozeMode: failureClusters.snoozeMode,
    })
    .from(failureClusters)
    .where(where)
    .orderBy(desc(failureClusters.lastSeenRunId))
    .limit(Math.min(200, Math.max(1, limit)));

  if (clusters.length === 0) return [];

  const clusterIds: number[] = clusters.map((c) => c.id);
  const projectIds: number[] = [...new Set(clusters.map((c) => c.projectId))];
  const seenRunIds: number[] = [
    ...new Set(clusters.flatMap((c) => [c.lastSeenRunId, c.firstSeenRunId]).filter((id) => id != null)),
  ];

  const [projectRows, counts, seenRuns, ownerRows, linkRows, regressionRows, mergeRows] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name, label: projects.label, defaultBranch: projects.defaultBranch })
      .from(projects)
      .where(inArray(projects.id, projectIds)),

    db
      .select({
        clusterId: testRunsCases.failureClusterId,
        affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})`,
      })
      .from(testRunsCases)
      .where(inArray(testRunsCases.failureClusterId, clusterIds))
      .groupBy(testRunsCases.failureClusterId),

    db
      .select({ id: testRuns.id, status: testRuns.status, startTime: testRuns.startTime, branch: testRuns.branch })
      .from(testRuns)
      .where(inArray(testRuns.id, seenRunIds)),

    // One row per (cluster, test): the most-affected test names the cluster when
    // the sample error has no frame and supplies the `piwi:owner` annotation. The
    // test-case ids also feed the quarantine-readiness cross-reference below.
    db
      .select({
        clusterId: testRunsCases.failureClusterId,
        testCaseId: testCases.id,
        filePath: testCases.filePath,
        owner: testCases.owner,
        runCount: sql<number>`count(${testRunsCases.id})`,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(inArray(testRunsCases.failureClusterId, clusterIds))
      .groupBy(testRunsCases.failureClusterId, testCases.id, testCases.filePath, testCases.owner),

    db
      .select({
        clusterId: entityLinks.failureClusterId,
        url: entityLinks.url,
        provider: entityLinks.provider,
        key: entityLinks.key,
      })
      .from(entityLinks)
      .where(inArray(entityLinks.failureClusterId, clusterIds))
      .orderBy(desc(entityLinks.id)),

    // Clusters that ever regressed (passed in baseline, then failed) and on which
    // branch — paired below with the cluster's last-seen branch to decide whether
    // it is a regression still failing on the default branch.
    db
      .select({ clusterId: testRunsCases.failureClusterId, branch: testRuns.branch })
      .from(testRunsCases)
      .innerJoin(testRuns, eq(testRuns.id, testRunsCases.testRunId))
      .where(and(inArray(testRunsCases.failureClusterId, clusterIds), eq(testRunsCases.isNewRegression, 1)))
      .groupBy(testRunsCases.failureClusterId, testRuns.branch),

    // Pending merge suggestions touching any of these clusters.
    db
      .select({ a: clusterMergeSuggestions.clusterAId, b: clusterMergeSuggestions.clusterBId })
      .from(clusterMergeSuggestions)
      .where(
        and(
          eq(clusterMergeSuggestions.status, 'pending'),
          or(
            inArray(clusterMergeSuggestions.clusterAId, clusterIds),
            inArray(clusterMergeSuggestions.clusterBId, clusterIds),
          ),
        ),
      ),
  ]);

  const projectById = new Map(projectRows.map((p: any) => [p.id, p]));
  const affectedById = new Map(counts.map((c: any) => [c.clusterId, Number(c.affectedTests)]));
  const runById = new Map(
    seenRuns.map((r: any) => [r.id, { status: r.status, startTime: r.startTime, branch: r.branch }]),
  );

  // Keep the most-affected test per cluster for the name fallback and owner, and
  // collect every affected test-case id per cluster for the quarantine lookup.
  const repByCluster = new Map<number, { filePath: string | null; owner: string | null; runCount: number }>();
  const caseIdsByCluster = new Map<number, number[]>();
  for (const row of ownerRows as any[]) {
    const prev = repByCluster.get(row.clusterId);
    if (!prev || Number(row.runCount) > prev.runCount) {
      repByCluster.set(row.clusterId, {
        filePath: row.filePath ?? null,
        owner: row.owner ?? null,
        runCount: Number(row.runCount),
      });
    }
    const list = caseIdsByCluster.get(row.clusterId) ?? [];
    list.push(row.testCaseId);
    caseIdsByCluster.set(row.clusterId, list);
  }

  // Newest known-issue link wins (rows come back id-descending).
  const issueByCluster = new Map<number, { url: string; provider: string; key: string | null }>();
  for (const row of linkRows as any[]) {
    if (row.clusterId != null && !issueByCluster.has(row.clusterId)) {
      issueByCluster.set(row.clusterId, { url: row.url, provider: row.provider, key: row.key ?? null });
    }
  }

  // The branches each cluster regressed on.
  const regressionBranchesByCluster = new Map<number, Set<string>>();
  for (const row of regressionRows as any[]) {
    if (row.branch == null) continue;
    const set = regressionBranchesByCluster.get(row.clusterId) ?? new Set<string>();
    set.add(row.branch);
    regressionBranchesByCluster.set(row.clusterId, set);
  }

  const mergeSuggestionClusterIds = new Set<number>();
  for (const row of mergeRows as any[]) {
    if (row.a != null) mergeSuggestionClusterIds.add(row.a);
    if (row.b != null) mergeSuggestionClusterIds.add(row.b);
  }

  // Quarantine readiness per project — reuse the exit-ramp streak engine. Only
  // the projects present here are scanned; the map is test-case id → readiness.
  const quarantineByProject = new Map<number, { active: Set<number>; ready: Set<number> }>();
  await Promise.all(
    projectIds.map(async (projectId) => {
      const { entries } = await listQuarantine(db, projectId);
      const active = new Set<number>();
      const ready = new Set<number>();
      for (const entry of entries) {
        active.add(entry.testCaseId);
        if (entry.releaseProposed) ready.add(entry.testCaseId);
      }
      quarantineByProject.set(projectId, { active, ready });
    }),
  );

  return clusters.map((c): OpenFailureCluster => {
    const project = projectById.get(c.projectId);
    const run = runById.get(c.lastSeenRunId) as { status: string; startTime: Date; branch: string | null } | undefined;
    const firstRun = runById.get(c.firstSeenRunId) as { startTime: Date } | undefined;
    const rep = repByCluster.get(c.id);

    // A regression still failing on the default branch: last seen there, and it
    // began as a regression (passed in baseline) on that same branch.
    const effectiveDefault = project?.defaultBranch ?? 'main';
    const regressionOnDefault =
      run?.branch === effectiveDefault && !!regressionBranchesByCluster.get(c.id)?.has(effectiveDefault);

    // Quarantine readiness: a quarantined member test is ready to release when its
    // streak has cleared the threshold, or the cluster's fix has verified as held
    // (its failures stopped) — either way the quarantine is safe to lift.
    const quarantine = quarantineByProject.get(c.projectId);
    const caseIds = caseIdsByCluster.get(c.id) ?? [];
    const fixHeld = c.fixVerification === 'stopped-failing' || c.fixVerification === 'diagnosis-verified';
    const quarantinedCount = quarantine ? caseIds.filter((id) => quarantine.active.has(id)).length : 0;
    const quarantineReadyCount = quarantine
      ? caseIds.filter((id) => quarantine.active.has(id) && (fixHeld || quarantine.ready.has(id))).length
      : 0;

    return {
      id: c.id,
      projectId: c.projectId,
      projectName: project?.name ?? `Project ${c.projectId}`,
      projectLabel: project?.label ?? null,
      title: c.title ?? null,
      signature: c.signature,
      errorType: c.errorType ?? null,
      selector: c.selector ?? null,
      sampleError: c.sampleError ?? null,
      filePath: rep?.filePath ?? null,
      status: c.status,
      affectedTests: affectedById.get(c.id) ?? 0,
      occurrences: c.occurrences ?? 0,
      firstSeenAt: firstRun?.startTime ?? null,
      lastSeenAt: run?.startTime ?? null,
      lastSeenRunId: c.lastSeenRunId,
      lastSeenRunStatus: run?.status ?? null,
      owner: rep?.owner ? { name: rep.owner, source: 'annotation' } : null,
      assignee: c.assignee ?? null,
      issueLink: issueByCluster.get(c.id) ?? null,
      topClue: clusterClue(c),
      fixVerification: c.fixVerification ?? null,
      regressionOnDefault,
      quarantinedCount,
      quarantineReadyCount,
      mergeSuggestionPending: mergeSuggestionClusterIds.has(c.id),
      snoozedUntil: c.snoozedUntil ?? null,
      snoozeMode: c.snoozeMode ?? null,
    };
  });
}
