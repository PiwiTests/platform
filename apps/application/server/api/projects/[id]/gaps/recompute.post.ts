import { desc, eq } from 'drizzle-orm';
import { Role } from '#shared/types';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { projects, testRuns } from '../../../../database/schema';
import { rebuildProjectGraph, resolveRunBranchTag } from '../../../../utils/graph-ingest';
import { computeScenarioGaps } from '#shared/handlers/scenario-gaps';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'Rebuild the feature graph and recompute gaps',
    description:
      'Rebuilds the project’s route and page nodes and reaches edges from its whole history, then recomputes the project-wide scenario gaps (success-only, single-covering-test, surface-drift). Idempotent. Change-time gaps are computed when a pull-request-stamped run finishes.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId, [Role.ADMINISTRATOR, Role.REPORTER]);

  const db = await getDatabase();
  const graph = await rebuildProjectGraph(db, projectId);

  // Scope surface drift to the latest run's branch: canonical rows plus that
  // branch's own, so a pull-request route never drifts onto the default branch.
  const [latest] = await db
    .select({ branch: testRuns.branch, metadata: testRuns.metadata })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.id))
    .limit(1);
  const [project] = await db
    .select({ id: projects.id, defaultBranch: projects.defaultBranch })
    .from(projects)
    .where(eq(projects.id, projectId));
  const branch = project && latest ? await resolveRunBranchTag(db, project, latest.metadata, latest.branch) : null;

  const gaps = await computeScenarioGaps(db, projectId, { branch });
  return { success: true, runsProcessed: graph.runsProcessed, gapsUpserted: gaps.upserted, gapsClosed: gaps.closed };
});
