import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';
import { getAppSetting, setAppSetting, deleteAppSetting } from '../../utils/app-settings';
import { encryptSecret, getEncryptionKey } from '../../utils/crypto';
import type { AiProvider } from '~~/types/api';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Save AI settings',
    description:
      'Updates AI provider configuration, model, API key, base URL, auto-diagnose toggle, custom instructions, and SCM token. Requires administrator role. Not available when AI is managed via environment variables.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

const VALID_PROVIDERS: AiProvider[] = ['anthropic', 'openai'];

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

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
    researchModel?: string | null;
    researchProvider?: string | null;
    researchBaseUrl?: string | null;
    researchApiKey?: string | null;
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
      await setAppSetting(db, 'scm_token', { value: encryptSecret(trimmed, getEncryptionKey()) });
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
      researchModel: null,
      researchProvider: null,
      researchBaseUrl: null,
      hasResearchApiKey: false,
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

  // Retrieve existing stored value to preserve secrets if not provided
  const existing = (await getAppSetting<{ apiKey?: string; researchApiKey?: string }>(db, 'ai')) ?? {};

  let apiKey: string | undefined;
  if (body.apiKey === undefined) {
    // Preserve the existing encrypted value as-is
    apiKey = existing.apiKey;
  } else if (body.apiKey === '') {
    apiKey = undefined;
  } else {
    apiKey = encryptSecret(body.apiKey, getEncryptionKey());
  }

  let researchApiKey: string | undefined;
  if (body.researchApiKey === undefined) {
    researchApiKey = existing.researchApiKey;
  } else if (body.researchApiKey === '' || body.researchApiKey === null) {
    researchApiKey = undefined;
  } else {
    researchApiKey = encryptSecret(body.researchApiKey, getEncryptionKey());
  }

  const value = {
    provider: body.provider,
    model: body.model || '',
    baseUrl: body.baseUrl || '',
    autoDiagnose: Boolean(body.autoDiagnose),
    researchModel: body.researchModel?.trim() || '',
    researchProvider: body.researchProvider?.trim() || '',
    researchBaseUrl: body.researchBaseUrl?.trim() || '',
    ...(apiKey ? { apiKey } : {}),
    ...(researchApiKey ? { researchApiKey } : {}),
  };

  await setAppSetting(db, 'ai', value);

  return {
    provider: value.provider,
    model: value.model || null,
    baseUrl: value.baseUrl || null,
    autoDiagnose: value.autoDiagnose,
    researchModel: value.researchModel || null,
    researchProvider: (value.researchProvider || null) as AiProvider | null,
    researchBaseUrl: value.researchBaseUrl || null,
    hasResearchApiKey: Boolean(researchApiKey),
    hasApiKey: Boolean(apiKey),
    hasScmToken,
    envManaged: false,
    customInstructions,
  };
});
