import { testRuns, testRunsCases, files } from '../../database/schema';
import { eq, inArray } from 'drizzle-orm';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../utils/project-access';
import { Role } from '#shared/types';
import { deleteFileRow } from '../../utils/delete-run-files';
import { recomputeClusterOccurrences } from '#shared/handlers/failure-cluster-ops';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Delete a test run',
    description:
      'Permanently delete a test run and all associated data including reports, traces, files, and failure clusters. Administrator access required.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run', REQUIRED_ROLES);

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
  const testRun = testRunResults[0];

  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found',
    });
  }

  // Collect cluster IDs before cascade deletes so we can recompute counters
  const runsCases = await db
    .select({ id: testRunsCases.id, failureClusterId: testRunsCases.failureClusterId })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, id));
  const caseIds = runsCases.map((c) => c.id);
  const affectedClusterIds = [...new Set(runsCases.filter((c) => c.failureClusterId).map((c) => c.failureClusterId!))];

  // Delete run-level files (reports, etc.) from storage
  const fileRows = await db.select().from(files).where(eq(files.testRunId, id));
  for (const file of fileRows) {
    await deleteFileRow(file);
  }
  await db.delete(files).where(eq(files.testRunId, id));

  // Delete trace files linked to cases from storage
  if (caseIds.length > 0) {
    const traceFiles = await db.select().from(files).where(inArray(files.testRunsCaseId, caseIds));
    for (const trace of traceFiles) {
      await deleteFileRow(trace);
    }
    await db.delete(files).where(inArray(files.testRunsCaseId, caseIds));
  }

  // Delete test run cases
  await db.delete(testRunsCases).where(eq(testRunsCases.testRunId, id));

  // Delete the test run (cascade handles child rows, but we already cleaned up)
  await db.delete(testRuns).where(eq(testRuns.id, id));

  // Recompute cluster occurrence counters now that the cases are gone
  for (const clusterId of affectedClusterIds) {
    await recomputeClusterOccurrences(db, clusterId);
  }

  return { success: true };
});
