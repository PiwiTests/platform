import { getDatabase } from '../../database'
import { projects, testRuns, files, tags, projectTags } from '../../database/schema'
import { eq, desc, inArray, and } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid project ID'
    })
  }

  const db = await getDatabase()

  const projectResults = await db.select().from(projects).where(eq(projects.id, id))
  const project = projectResults[0]

  if (!project) {
    throw createError({
      statusCode: 404,
      message: 'Project not found'
    })
  }

  const runs = await db.select().from(testRuns)
    .where(eq(testRuns.projectId, id))
    .orderBy(desc(testRuns.startTime))

  // Fetch reports for all runs in a single query
  const runIds = runs.map(r => r.id)
  const reportResults = runIds.length > 0
    ? await db.select().from(files)
        .where(and(inArray(files.testRunId, runIds), eq(files.type, 'report')))
    : []

  const reportsByRunId = new Map<number, { id: number, type: string, label: string, path: string, size: number | null }[]>()
  for (const r of reportResults) {
    const list = reportsByRunId.get(r.testRunId!) ?? []
    list.push({ id: r.id, type: r.subtype || r.type, label: r.label || r.type, path: r.path, size: r.size })
    reportsByRunId.set(r.testRunId!, list)
  }

  // Get tags for this project
  const projectTagRows = await db
    .select({ tag: tags })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(eq(projectTags.projectId, id))

  return {
    ...project,
    tags: projectTagRows.map(r => r.tag),
    testRuns: runs.map(r => ({
      ...r,
      reports: reportsByRunId.get(r.id) ?? []
    }))
  }
})
