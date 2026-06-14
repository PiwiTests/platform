import { getDatabase } from '../../database'
import { projects, tags, projectTags } from '../../database/schema'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireAuth } from '../../utils/auth'

const updateProjectSchema = z.object({
  label: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  diagnosisInstructions: z.string().optional().nullable(),
  scmToken: z.string().optional().nullable(),
  tagIds: z.array(z.number()).optional()
})

export default eventHandler(async (event) => {
  // Require administrator role for updating projects
  await requireAuth(event, ['administrator'])

  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid project ID'
    })
  }

  const db = await getDatabase()

  // Check if project exists
  const projectResults = await db.select().from(projects).where(eq(projects.id, id))
  if (!projectResults[0]) {
    throw createError({
      statusCode: 404,
      message: 'Project not found'
    })
  }

  // Parse and validate request body
  const body = await readBody(event)
  const validation = updateProjectSchema.safeParse(body)

  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues
    })
  }

  const { label, description, diagnosisInstructions, scmToken, tagIds } = validation.data

  // Update project
  await db.update(projects)
    .set({
      label,
      description,
      diagnosisInstructions: diagnosisInstructions ?? undefined,
      scmToken: scmToken !== undefined ? scmToken : undefined,
      updatedAt: new Date()
    })
    .where(eq(projects.id, id))

  // Update project tags if provided
  if (tagIds !== undefined) {
    // Remove all existing tags for this project
    await db.delete(projectTags).where(eq(projectTags.projectId, id))

    if (tagIds.length > 0) {
      // Validate that all tag IDs exist
      const existingTags = await db.select().from(tags).where(inArray(tags.id, tagIds))
      if (existingTags.length !== tagIds.length) {
        throw createError({
          statusCode: 400,
          message: 'One or more tag IDs are invalid'
        })
      }

      // Insert new tag associations
      await db.insert(projectTags).values(
        tagIds.map(tagId => ({ projectId: id, tagId }))
      )
    }
  }

  // Get updated project with tags
  const updatedProject = await db.select().from(projects).where(eq(projects.id, id))
  const projectTagRows = await db
    .select({ tag: tags })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(eq(projectTags.projectId, id))

  return {
    ...updatedProject[0],
    tags: projectTagRows.map(r => r.tag)
  }
})
