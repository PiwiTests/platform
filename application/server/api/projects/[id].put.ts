import { getDatabase } from '../../database'
import { projects } from '../../database/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

const updateProjectSchema = z.object({
  label: z.string().optional().nullable(),
  description: z.string().optional().nullable()
})

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid project ID'
    })
  }

  const db = getDatabase()

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

  const { label, description } = validation.data

  // Update project
  await db.update(projects)
    .set({
      label,
      description,
      updatedAt: new Date()
    })
    .where(eq(projects.id, id))

  // Get updated project
  const updatedProject = await db.select().from(projects).where(eq(projects.id, id))

  return updatedProject[0]
})
