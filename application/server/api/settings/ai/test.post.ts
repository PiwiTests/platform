import { getDatabase } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { resolveAiConfig, callAiProvider } from '../../../utils/ai-provider'
import { getAppSetting } from '../../../utils/app-settings'
import type { AiConfig, AiProvider } from '~~/types/api'

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Test AI provider connection',
    description: 'Sends a connectivity test to the configured AI provider. Accepts optional provider, apiKey, model, and baseUrl in the request body. Requires administrator role.'
  }
})

export default eventHandler(async (event) => {
  await requireAuth(event, ['administrator'])

  const body = await readBody(event).catch(() => null) as {
    provider?: string
    apiKey?: string
    model?: string
    baseUrl?: string
  } | null

  const db = await getDatabase()

  let config: AiConfig | null

  if (!body?.provider) {
    config = await resolveAiConfig(db)
  } else {
    let apiKey = body.apiKey || ''
    if (!apiKey) {
      // User didn't type a new key — fall back to whatever is currently active
      // (env var key via resolveAiConfig, or stored DB key)
      const existing = await resolveAiConfig(db)
      apiKey = existing?.apiKey || ''
      if (!apiKey) {
        // Last resort: read raw stored value (handles case where existing config is invalid)
        const stored = await getAppSetting<{ apiKey?: string }>(db, 'ai')
        apiKey = stored?.apiKey || ''
      }
    }
    config = {
      provider: body.provider as AiProvider,
      apiKey,
      model: body.model || '',
      baseUrl: body.baseUrl || null,
      autoDiagnose: false,
      source: 'settings'
    }
  }

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
