import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';
import { getAppSetting } from '../../utils/app-settings';
import type { AiProvider } from '~~/types/api';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get AI settings',
    description:
      'Returns full AI configuration settings including provider, model, API key presence, base URL, auto-diagnose toggle, custom instructions, and SCM token presence. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const runtimeConfig = useRuntimeConfig();
  const envAi = runtimeConfig.ai as
    | {
        provider?: string;
        apiKey?: string;
        model?: string;
        baseUrl?: string;
        autoDiagnose?: boolean | string;
        researchModel?: string;
      }
    | undefined;
  const envManaged = Boolean(envAi?.provider);

  const db = await getDatabase();
  const [instructions, scmTokenSetting] = await Promise.all([
    getAppSetting<{ value?: string }>(db, 'ai_instructions'),
    getAppSetting<{ value?: string }>(db, 'scm_token'),
  ]);
  const customInstructions = instructions?.value || null;
  const hasScmToken = Boolean(scmTokenSetting?.value);

  if (envManaged) {
    return {
      provider: (envAi!.provider || null) as AiProvider | null,
      model: envAi!.model || null,
      baseUrl: envAi!.baseUrl || null,
      autoDiagnose: String(envAi!.autoDiagnose) === 'true',
      researchModel: envAi!.researchModel || null,
      hasApiKey: Boolean(envAi!.apiKey),
      hasScmToken,
      envManaged: true,
      customInstructions,
    };
  }

  const stored = await getAppSetting<{
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    autoDiagnose?: boolean;
    researchModel?: string;
  }>(db, 'ai');

  return {
    provider: (stored?.provider || null) as AiProvider | null,
    model: stored?.model || null,
    baseUrl: stored?.baseUrl || null,
    autoDiagnose: Boolean(stored?.autoDiagnose),
    researchModel: stored?.researchModel || null,
    hasApiKey: Boolean(stored?.apiKey),
    hasScmToken,
    envManaged: false,
    customInstructions,
  };
});
