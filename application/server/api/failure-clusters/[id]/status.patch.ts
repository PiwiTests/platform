import { getDatabase } from '../../../database'
import { failureClusters } from '../../../database/schema'
import { eq } from 'drizzle-orm'

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Update failure cluster status',
    description: 'Updates the status (open, resolved, ignored) and optional triage note for a failure cluster.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }]
  }
})

const VALID_STATUSES = ['open', 'resolved', 'ignored']

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid cluster ID' })
  }

  const body = await readBody(event)
  const status = body?.status

  if (!status || !VALID_STATUSES.includes(status)) {
    throw createError({ statusCode: 400, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` })
  }

  const db = await getDatabase()

  const [cluster] = await db.select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, id))

  if (!cluster) {
    throw createError({ statusCode: 404, message: 'Failure cluster not found' })
  }

  const triageNote = body?.triageNote ?? null

  await db.update(failureClusters)
    .set({ status, triageNote, updatedAt: new Date() })
    .where(eq(failureClusters.id, id))

  return { success: true, id, status, triageNote }
})
