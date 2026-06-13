import { getDatabase } from '../../database'
import { resolveAiConfig } from '../../utils/ai-provider'

export default eventHandler(async (_event) => {
  const db = await getDatabase()
  const config = await resolveAiConfig(db)

  if (!config) {
    return { configured: false }
  }

  return {
    configured: true,
    provider: config.provider,
    model: config.model || null,
    autoDiagnose: config.autoDiagnose,
    source: config.source
  }
})
