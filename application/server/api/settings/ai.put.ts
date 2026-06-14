import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { getAppSetting, setAppSetting, deleteAppSetting } from '../../utils/app-settings';
import type { AiProvider } from '~~/types/api';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Save AI settings',
    description:
      'Updates AI provider configuration, model, API key, base URL, auto-diagnose toggle, custom instructions, and SCM token. Requires administrator role. Not available when AI is managed via environment variables.',
  },
});

const VALID_PROVIDERS: AiProvider[] = ['anthropic', 'openai'];

export default eventHandler(async (event) => {
  await requireAuth(event, ['administrator']);

  const runtimeConfig = useRuntimeConfig();
  const envAi = runtimeConfig.ai as { provider?: string } | undefined;
  if (envAi?.provider) {
    throw createError({
      statusCode: 409,
      message: 'AI configuration is managed by environment variables and cannot be changed via the API',
    });
  }

  const body = (await readBody(event)) as {
    provider?: string | null;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    autoDiagnose?: boolean;
    customInstructions?: string | null;
    scmToken?: string | null;
  };

  const db = await getDatabase();

  // Custom instructions and SCM token are stored independently
  if (body.customInstructions !== undefined) {
    const trimmed = body.customInstructions?.trim() || null;
    if (trimmed) {
      await setAppSetting(db, 'ai_instructions', { value: trimmed });
    } else {
      await deleteAppSetting(db, 'ai_instructions');
    }
  }

  if (body.scmToken !== undefined) {
    const trimmed = body.scmToken?.trim() || null;
    if (trimmed) {
      await setAppSetting(db, 'scm_token', { value: trimmed });
    } else {
      await deleteAppSetting(db, 'scm_token');
    }
  }

  const [instructions, scmTokenSetting] = await Promise.all([
    getAppSetting<{ value?: string }>(db, 'ai_instructions'),
    getAppSetting<{ value?: string }>(db, 'scm_token'),
  ]);
  const customInstructions = instructions?.value || null;
  const hasScmToken = Boolean(scmTokenSetting?.value);

  // Clearing the provider configuration
  if (!body.provider) {
    await deleteAppSetting(db, 'ai');
    return {
      provider: null,
      model: null,
      baseUrl: null,
      autoDiagnose: false,
      hasApiKey: false,
      hasScmToken,
      envManaged: false,
      customInstructions,
    };
  }

  if (!VALID_PROVIDERS.includes(body.provider as AiProvider)) {
    throw createError({ statusCode: 400, message: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
  }

  if (body.provider === 'openai' && (!body.baseUrl || !body.model)) {
    throw createError({ statusCode: 400, message: 'OpenAI-compatible provider requires baseUrl and model' });
  }

  // Retrieve existing stored value to preserve apiKey if not provided
  const existing = (await getAppSetting<{ apiKey?: string }>(db, 'ai')) ?? {};

  let apiKey: string | undefined;
  if (body.apiKey === undefined) {
    apiKey = existing.apiKey;
  } else if (body.apiKey === '') {
    apiKey = undefined;
  } else {
    apiKey = body.apiKey;
  }

  const value = {
    provider: body.provider,
    model: body.model || '',
    baseUrl: body.baseUrl || '',
    autoDiagnose: Boolean(body.autoDiagnose),
    ...(apiKey ? { apiKey } : {}),
  };

  await setAppSetting(db, 'ai', value);

  return {
    provider: value.provider,
    model: value.model || null,
    baseUrl: value.baseUrl || null,
    autoDiagnose: value.autoDiagnose,
    hasApiKey: Boolean(apiKey),
    hasScmToken,
    envManaged: false,
    customInstructions,
  };
});
