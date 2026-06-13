import { getDatabase } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { resolveAiConfig, callAiProvider } from '../../../utils/ai-provider'

export default eventHandler(async (event) => {
  await requireAuth(event, ['administrator'])

  const db = await getDatabase()
  const config = await resolveAiConfig(db)
  if (!config) throw createError({ statusCode: 503, message: 'AI diagnosis is not configured' })

  try {
    const result = await callAiProvider(config, {
      system: 'You are a connectivity check.',
      user: 'Reply with the single word OK.',
      maxTokens: 8
    })
    return { success: true, model: result.model }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { success: false, error }
  }
})
