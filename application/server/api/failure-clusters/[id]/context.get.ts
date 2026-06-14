import { getDatabase } from '../../../database'
import { failureClusters } from '../../../database/schema'
import { eq } from 'drizzle-orm'
import { buildClusterDiagnosisContext } from '../../../utils/ai-diagnosis'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' })

  const db = await getDatabase()
  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id))
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' })

  const query = getQuery(event)
  const baseCommit = query.baseCommit as string | undefined
  const selectedCommitShasRaw = query.selectedCommitShas
  const selectedCommitShas = Array.isArray(selectedCommitShasRaw)
    ? selectedCommitShasRaw.map(String)
    : selectedCommitShasRaw ? [String(selectedCommitShasRaw)] : undefined
  const { text, coverage } = await buildClusterDiagnosisContext(db, cluster, { baseCommit, selectedCommitShas })
  return { context: text, coverage }
})
