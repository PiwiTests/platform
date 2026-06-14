import { getDatabase } from '../../database'
import { resolveAiConfig } from '../../utils/ai-provider'

defineRouteMeta({
  openAPI: {
    tags: ['AI'],
    summary: 'Get AI configuration status',
    description: 'Returns public AI configuration status including whether AI diagnosis is configured, the provider, model, and auto-diagnose setting.'
  }
})

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
