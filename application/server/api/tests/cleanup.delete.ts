import { getDatabase } from '../../database';
import {
  projects,
  testRuns,
  testRunsCases,
  files,
  testCases,
  failureClusters,
  tags,
  projectTags,
} from '../../database/schema';
import { eq, inArray, like } from 'drizzle-orm';
import { requireAuth } from '../../utils/auth';
import { deleteFileRow } from '../../utils/delete-run-files';
import { TEST_PROJECT_NAMES } from '../../../shared/test-project-names';

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Clean up test data',
    description:
      'Deletes all test projects and test tags by known names. Only available in non-production environments with administrator role.',
  },
});

export default eventHandler(async (event) => {
  // This endpoint is only intended for test suites — guard against accidental
  // use in production by requiring administrator role AND a non-production env
  await requireAuth(event, ['administrator']);

  if (process.env.NODE_ENV === 'production') {
    throw createError({
      statusCode: 403,
      message: 'Cleanup endpoint is disabled in production',
    });
  }

  const db = await getDatabase();

  // Delete test projects by name
  const projectRows = await db.select().from(projects).where(inArray(projects.name, TEST_PROJECT_NAMES));

  for (const project of projectRows) {
    // Get all runs for this project
    const runRows = await db.select().from(testRuns).where(eq(testRuns.projectId, project.id));

    for (const run of runRows) {
      // Get all files for this run
      const fileRows = await db.select().from(files).where(eq(files.testRunId, run.id));

      // Get test run cases
      const runsCases = await db
        .select({ id: testRunsCases.id })
        .from(testRunsCases)
        .where(eq(testRunsCases.testRunId, run.id));
      const caseIds = runsCases.map((c) => c.id);

      // Delete trace files linked to cases from storage
      if (caseIds.length > 0) {
        const traceFiles = await db.select().from(files).where(inArray(files.testRunsCaseId, caseIds));
        for (const trace of traceFiles) {
          await deleteFileRow(trace);
        }
        await db.delete(files).where(inArray(files.testRunsCaseId, caseIds));
      }

      // Delete test run cases
      await db.delete(testRunsCases).where(eq(testRunsCases.testRunId, run.id));

      // Delete report files from storage
      for (const file of fileRows) {
        await deleteFileRow(file);
      }
      await db.delete(files).where(eq(files.testRunId, run.id));

      // Delete the test run
      await db.delete(testRuns).where(eq(testRuns.id, run.id));
    }

    // Delete project_tags associations
    await db.delete(projectTags).where(eq(projectTags.projectId, project.id));

    // Delete failure clusters (after test_runs_cases, which reference them)
    await db.delete(failureClusters).where(eq(failureClusters.projectId, project.id));

    // Delete test_cases for this project
    await db.delete(testCases).where(eq(testCases.projectId, project.id));

    // Delete the project itself
    await db.delete(projects).where(eq(projects.id, project.id));
  }

  // Delete test tags with known prefixes
  const testTagPatterns = ['ui-test-tag%', 'delete-me-tag%'];
  for (const pattern of testTagPatterns) {
    const tagRows = await db.select().from(tags).where(like(tags.text, pattern));
    for (const tag of tagRows) {
      await db.delete(projectTags).where(eq(projectTags.tagId, tag.id));
      await db.delete(tags).where(eq(tags.id, tag.id));
    }
  }

  return {
    success: true,
    projectsDeleted: projectRows.length,
  };
});
