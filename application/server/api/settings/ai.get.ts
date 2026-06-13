import { getDatabase } from '../../database'
import { requireAuth } from '../../utils/auth'
import { getAppSetting } from '../../utils/app-settings'
import type { AiProvider } from '~~/types/api'

export default eventHandler(async (event) => {
  await requireAuth(event, ['administrator'])

  const runtimeConfig = useRuntimeConfig()
  const envAi = runtimeConfig.ai as { provider?: string, apiKey?: string, model?: string, baseUrl?: string, autoDiagnose?: boolean | string } | undefined
  const envManaged = Boolean(envAi?.provider)

  const db = await getDatabase()
  const [instructions, scmTokenSetting] = await Promise.all([
    getAppSetting<{ value?: string }>(db, 'ai_instructions'),
    getAppSetting<{ value?: string }>(db, 'scm_token')
  ])
  const customInstructions = instructions?.value || null
  const hasScmToken = Boolean(scmTokenSetting?.value)

  if (envManaged) {
    return {
      provider: (envAi!.provider || null) as AiProvider | null,
      model: envAi!.model || null,
      baseUrl: envAi!.baseUrl || null,
      autoDiagnose: String(envAi!.autoDiagnose) === 'true',
      hasApiKey: Boolean(envAi!.apiKey),
      hasScmToken,
      envManaged: true,
      customInstructions
    }
  }

  const stored = await getAppSetting<{
    provider?: string
    apiKey?: string
    model?: string
    baseUrl?: string
    autoDiagnose?: boolean
  }>(db, 'ai')

  return {
    provider: (stored?.provider || null) as AiProvider | null,
    model: stored?.model || null,
    baseUrl: stored?.baseUrl || null,
    autoDiagnose: Boolean(stored?.autoDiagnose),
    hasApiKey: Boolean(stored?.apiKey),
    hasScmToken,
    envManaged: false,
    customInstructions
  }
})
