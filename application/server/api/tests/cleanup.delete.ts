import { getDatabase } from '../../database'
import { projects, testRuns, testRunsCases, files, testCases, tags, projectTags } from '../../database/schema'
import { eq, inArray, like } from 'drizzle-orm'
import { getStorage } from '../../storage'
import { TEST_PROJECT_NAMES } from '../../../shared/test-project-names'

export default eventHandler(async (_event) => {
  const db = await getDatabase()
  const storage = getStorage()

  // Delete test projects by name
  const projectRows = await db.select()
    .from(projects)
    .where(inArray(projects.name, TEST_PROJECT_NAMES))

  for (const project of projectRows) {
    // Get all runs for this project
    const runRows = await db.select().from(testRuns).where(eq(testRuns.projectId, project.id))

    for (const run of runRows) {
      // Get all files for this run
      const fileRows = await db.select().from(files).where(eq(files.testRunId, run.id))

      // Get test run cases
      const runsCases = await db.select({ id: testRunsCases.id }).from(testRunsCases).where(eq(testRunsCases.testRunId, run.id))
      const caseIds = runsCases.map(c => c.id)

      // Delete trace files linked to cases
      if (caseIds.length > 0) {
        const traceFiles = await db.select().from(files).where(inArray(files.testRunsCaseId, caseIds))
        for (const trace of traceFiles) {
          try {
            await storage.deleteDirectory(trace.path)
          } catch {
            /* ignore */
          }
        }
        await db.delete(files).where(inArray(files.testRunsCaseId, caseIds))
      }

      // Delete test run cases
      await db.delete(testRunsCases).where(eq(testRunsCases.testRunId, run.id))

      // Delete report files from storage and DB
      for (const file of fileRows) {
        try {
          await storage.deleteDirectory(file.path)
        } catch {
          /* ignore */
        }
      }
      await db.delete(files).where(eq(files.testRunId, run.id))

      // Delete the test run
      await db.delete(testRuns).where(eq(testRuns.id, run.id))
    }

    // Delete project_tags associations
    await db.delete(projectTags).where(eq(projectTags.projectId, project.id))

    // Delete test_cases for this project
    await db.delete(testCases).where(eq(testCases.projectId, project.id))

    // Delete the project itself
    await db.delete(projects).where(eq(projects.id, project.id))
  }

  // Delete test tags with known prefixes
  const testTagPatterns = ['ui-test-tag%', 'delete-me-tag%']
  for (const pattern of testTagPatterns) {
    const tagRows = await db.select().from(tags).where(like(tags.text, pattern))
    for (const tag of tagRows) {
      await db.delete(projectTags).where(eq(projectTags.tagId, tag.id))
      await db.delete(tags).where(eq(tags.id, tag.id))
    }
  }

  return {
    success: true,
    projectsDeleted: projectRows.length
  }
})
