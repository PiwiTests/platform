import { desc, eq, isNull, or } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { projects, testRuns } from '../../database/schema';
import {
  pruneChangesEdges,
  pruneStaleBranchGraphRows,
  pruneStaleCanonicalNodes,
  rebuildProjectGraph,
} from '../../utils/graph-ingest';
import { resolveDefaultBranch } from '../../utils/scm/default-branch';
import { computeScenarioGaps } from '#shared/handlers/scenario-gaps';

/**
 * Resolve and cache the default branch for projects that lack one, off the
 * ingest hot path where it must never run. When a value is newly cached, rebuild
 * that project's graph so runs ingested while the default branch was unknown —
 * tagged conservatively as their own branch — settle onto canonical rows.
 */
async function backfillDefaultBranches(db: Awaited<ReturnType<typeof getDatabase>>): Promise<number> {
  const rows = await db
    .select({ id: projects.id, defaultBranch: projects.defaultBranch })
    .from(projects)
    .where(or(isNull(projects.defaultBranch), eq(projects.defaultBranch, '')));

  let rebuilt = 0;
  for (const project of rows) {
    const [latest] = await db
      .select({ metadata: testRuns.metadata })
      .from(testRuns)
      .where(eq(testRuns.projectId, project.id))
      .orderBy(desc(testRuns.id))
      .limit(1);
    if (!latest) continue;

    await resolveDefaultBranch(db, { id: project.id }, latest.metadata).catch(() => null);
    // resolveDefaultBranch caches only a value it fetched from the provider, so a
    // token-less project stays null and is left alone; rebuild only when it stuck.
    const [after] = await db
      .select({ defaultBranch: projects.defaultBranch })
      .from(projects)
      .where(eq(projects.id, project.id));
    if (after?.defaultBranch) {
      await rebuildProjectGraph(db, project.id).catch(() => null);
      rebuilt++;
    }
  }
  return rebuilt;
}

export default defineTask({
  meta: {
    name: 'graph:sweep',
    description:
      'Keep the feature graph proportional to a project’s surface: prune changes edges older than 90 days, branch-tagged rows older than 30 days, and canonical nodes unseen for 30 runs whose surface-drift gap is closed. Backfill unknown default branches, then recompute scenario gaps. Independent of PIWI_RETENTION_DAYS.',
  },
  async run() {
    const db = await getDatabase();
    const result: Record<string, number> = {};

    const changesEdgesPruned = await pruneChangesEdges(db);
    if (changesEdgesPruned > 0) result.changesEdgesPruned = changesEdgesPruned;

    const branchRowsPruned = await pruneStaleBranchGraphRows(db);
    if (branchRowsPruned > 0) result.branchRowsPruned = branchRowsPruned;

    const staleNodesPruned = await pruneStaleCanonicalNodes(db);
    if (staleNodesPruned > 0) result.staleNodesPruned = staleNodesPruned;

    const defaultBranchesBackfilled = await backfillDefaultBranches(db);
    if (defaultBranchesBackfilled > 0) result.defaultBranchesBackfilled = defaultBranchesBackfilled;

    // Recompute the project-wide gaps so success-only, single-covering-test and
    // surface-drift stay current between runs, and self-closing keeps up.
    let gapsUpserted = 0;
    let gapsClosed = 0;
    const allProjects = await db.select({ id: projects.id }).from(projects);
    for (const project of allProjects) {
      const gaps = await computeScenarioGaps(db, project.id).catch(() => ({ upserted: 0, closed: 0 }));
      gapsUpserted += gaps.upserted;
      gapsClosed += gaps.closed;
    }
    if (gapsUpserted > 0) result.gapsUpserted = gapsUpserted;
    if (gapsClosed > 0) result.gapsClosed = gapsClosed;

    if (Object.keys(result).length > 0) {
      console.info(`[graph:sweep] ${JSON.stringify(result)}`);
    }
    return { result };
  },
});
