import { getDatabase } from '../../database'
import { requireAuth } from '../../utils/auth'
import { getAppSetting } from '../../utils/app-settings'

export default eventHandler(async (event) => {
  await requireAuth(event, ['administrator'])

  const runtimeConfig = useRuntimeConfig()
  const envAi = runtimeConfig.ai as { provider?: string, apiKey?: string, model?: string, baseUrl?: string, autoDiagnose?: boolean | string } | undefined
  const envManaged = Boolean(envAi?.provider)

  if (envManaged) {
    return {
      provider: envAi!.provider || null,
      model: envAi!.model || null,
      baseUrl: envAi!.baseUrl || null,
      autoDiagnose: String(envAi!.autoDiagnose) === 'true',
      hasApiKey: Boolean(envAi!.apiKey),
      envManaged: true
    }
  }

  const db = await getDatabase()
  const stored = await getAppSetting<{
    provider?: string
    apiKey?: string
    model?: string
    baseUrl?: string
    autoDiagnose?: boolean
  }>(db, 'ai')

  return {
    provider: stored?.provider || null,
    model: stored?.model || null,
    baseUrl: stored?.baseUrl || null,
    autoDiagnose: Boolean(stored?.autoDiagnose),
    hasApiKey: Boolean(stored?.apiKey),
    envManaged: false
  }
})
