import { getDatabase } from '../database';
import { projects, testRuns, testRunsCases, files, testCases } from '../database/schema';
import { eq, inArray } from 'drizzle-orm';
import { getStorage } from '../storage';

/**
 * Permanently delete a project and all its associated data.
 *
 * Deletes storage first (entire project-{id}/ directory), then clears DB rows
 * in FK order. Tables with onDelete: cascade (projectTags, failureClusters,
 * failureDiagnoses, traceBlobs, traceResources) are handled automatically when
 * the project row is removed.
 */
export async function deleteProject(projectId: number): Promise<void> {
  const db = await getDatabase();
  const storage = getStorage();

  // Delete all project files in one shot — covers reports, blobs, trace-resources
  await storage.deleteDirectory(`project-${projectId}`);

  // Get all run IDs to cascade-delete dependent rows that lack DB-level cascade
  const runRows = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.projectId, projectId));
  const runIds = runRows.map((r) => r.id);

  if (runIds.length > 0) {
    const caseRows = await db
      .select({ id: testRunsCases.id })
      .from(testRunsCases)
      .where(inArray(testRunsCases.testRunId, runIds));
    const caseIds = caseRows.map((c) => c.id);

    if (caseIds.length > 0) {
      await db.delete(files).where(inArray(files.testRunsCaseId, caseIds));
    }

    await db.delete(files).where(inArray(files.testRunId, runIds));
    await db.delete(testRunsCases).where(inArray(testRunsCases.testRunId, runIds));
    await db.delete(testRuns).where(eq(testRuns.projectId, projectId));
  }

  await db.delete(testCases).where(eq(testCases.projectId, projectId));

  // Deleting the project row cascades to: projectTags, failureClusters,
  // failureDiagnoses, traceBlobs, traceResources
  await db.delete(projects).where(eq(projects.id, projectId));
}
