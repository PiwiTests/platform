import { getDatabase } from '../../database'
import { requireAuth } from '../../utils/auth'
import { getAppSetting, setAppSetting, deleteAppSetting } from '../../utils/app-settings'

const VALID_PROVIDERS = ['anthropic', 'openai']

export default eventHandler(async (event) => {
  await requireAuth(event, ['administrator'])

  const runtimeConfig = useRuntimeConfig()
  const envAi = runtimeConfig.ai as { provider?: string } | undefined
  if (envAi?.provider) {
    throw createError({ statusCode: 409, message: 'AI configuration is managed by environment variables and cannot be changed via the API' })
  }

  const body = await readBody(event) as {
    provider?: string | null
    model?: string
    baseUrl?: string
    apiKey?: string
    autoDiagnose?: boolean
  }

  // Clearing the configuration
  if (!body.provider) {
    const db = await getDatabase()
    await deleteAppSetting(db, 'ai')
    return { provider: null, model: null, baseUrl: null, autoDiagnose: false, hasApiKey: false, envManaged: false }
  }

  if (!VALID_PROVIDERS.includes(body.provider)) {
    throw createError({ statusCode: 400, message: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` })
  }

  if (body.provider === 'openai' && (!body.baseUrl || !body.model)) {
    throw createError({ statusCode: 400, message: 'OpenAI-compatible provider requires baseUrl and model' })
  }

  const db = await getDatabase()

  // Retrieve existing stored value to preserve apiKey if not provided
  const existing = await getAppSetting<{ apiKey?: string }>(db, 'ai') ?? {}

  let apiKey: string | undefined
  if (body.apiKey === undefined) {
    apiKey = existing.apiKey
  } else if (body.apiKey === '') {
    apiKey = undefined
  } else {
    apiKey = body.apiKey
  }

  const value = {
    provider: body.provider,
    model: body.model || '',
    baseUrl: body.baseUrl || '',
    autoDiagnose: Boolean(body.autoDiagnose),
    ...(apiKey ? { apiKey } : {})
  }

  await setAppSetting(db, 'ai', value)

  return {
    provider: value.provider,
    model: value.model || null,
    baseUrl: value.baseUrl || null,
    autoDiagnose: value.autoDiagnose,
    hasApiKey: Boolean(apiKey),
    envManaged: false
  }
})
