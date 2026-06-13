import { getDatabase } from '../../../database'
import { failureClusters, failureDiagnoses } from '../../../database/schema'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../../utils/auth'
import { resolveAiConfig } from '../../../utils/ai-provider'
import type { AiAttachedImage } from '../../../utils/ai-provider'
import { runClusterDiagnosis, isDiagnosisRunning, isDiagnosisStale } from '../../../utils/ai-diagnosis'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' })

  await requireAuth(event)

  const force = getQuery(event).force === 'true'
  const body = await readBody(event).catch(() => null) as {
    additionalContext?: string
    images?: AiAttachedImage[]
    baseCommit?: string
  } | null

  const db = await getDatabase()

  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id))
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' })

  const config = await resolveAiConfig(db)
  if (!config) throw createError({ statusCode: 503, message: 'AI diagnosis is not configured' })

  // Check if already running
  if (isDiagnosisRunning(id)) {
    throw createError({ statusCode: 409, message: 'Diagnosis is already running for this cluster' })
  }

  // Return existing completed diagnosis if not forcing
  if (!force) {
    const existingRows = await db.select().from(failureDiagnoses).where(eq(failureDiagnoses.clusterId, id))
    const existing = existingRows[0]
    if (existing) {
      if (existing.status === 'running' && !isDiagnosisStale(existing)) {
        throw createError({ statusCode: 409, message: 'Diagnosis is already running for this cluster' })
      }
      if (existing.status === 'completed') {
        return existing
      }
    }
  }

  return runClusterDiagnosis(db, cluster, config, {
    force,
    additionalContext: body?.additionalContext,
    images: body?.images,
    baseCommit: body?.baseCommit
  })
})
