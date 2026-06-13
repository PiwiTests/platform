import { getDatabase } from '../../../database'
import { failureClusters, failureDiagnoses } from '../../../database/schema'
import { eq } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' })

  const db = await getDatabase()

  const [cluster] = await db.select({ id: failureClusters.id }).from(failureClusters).where(eq(failureClusters.id, id))
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' })

  const rows = await db.select().from(failureDiagnoses).where(eq(failureDiagnoses.clusterId, id))
  return rows[0] ?? null
})
