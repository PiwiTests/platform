import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';
import { getAppSetting, setAppSetting, deleteAppSetting } from '../../utils/app-settings';
import { encryptSecret, getEncryptionKey } from '../../utils/crypto';
import { AI_ROLES, storedRoles, readAiSettings, type RawStoredAi, type RawStoredRole } from '../../utils/ai-settings';
import type { AiModelRole, AiProvider } from '~~/types/api';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Save AI settings',
    description:
      'Updates the per-role AI configuration (diagnosis, research, embedding), auto-diagnose toggle, custom instructions, and SCM token. Each role has its own provider/model/baseUrl/apiKey, or `reuse` to inherit another role. Requires administrator role. Not available when AI is managed via environment variables.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

const VALID_PROVIDERS: AiProvider[] = ['anthropic', 'openai'];

/** A role config as submitted by the client (apiKey is plaintext or omitted). */
interface RoleInput {
  provider?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  reuse?: AiModelRole | null;
}

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const runtimeConfig = useRuntimeConfig();
  const envAi = runtimeConfig.ai as { provider?: string } | undefined;

  const body = (await readBody(event)) as {
    roles?: Partial<Record<AiModelRole, RoleInput | null>> | null;
    autoDiagnose?: boolean;
    customInstructions?: string | null;
    scmToken?: string | null;
  };

  const db = await getDatabase();

  // Custom instructions and SCM token are stored independently of the provider config.
  if (body.customInstructions !== undefined) {
    const trimmed = body.customInstructions?.trim() || null;
    if (trimmed) await setAppSetting(db, 'ai_instructions', { value: trimmed });
    else await deleteAppSetting(db, 'ai_instructions');
  }

  if (body.scmToken !== undefined) {
    const trimmed = body.scmToken?.trim() || null;
    if (trimmed) await setAppSetting(db, 'scm_token', { value: encryptSecret(trimmed, getEncryptionKey()) });
    else await deleteAppSetting(db, 'scm_token');
  }

  // Only touch the provider config when the request actually carries it.
  const touchesAi = 'roles' in body || 'autoDiagnose' in body;
  if (touchesAi) {
    if (envAi?.provider) {
      throw createError({
        statusCode: 409,
        message: 'AI configuration is managed by environment variables and cannot be changed via the API',
      });
    }

    if (body.roles === null) {
      await deleteAppSetting(db, 'ai');
      return readAiSettings(db);
    }

    const existing = (await getAppSetting<RawStoredAi>(db, 'ai')) ?? {};
    const existingRoles = storedRoles(existing);
    const input = body.roles ?? {};

    const resolveKey = (provided: string | null | undefined, existingEnc?: string): string | undefined => {
      if (provided === undefined) return existingEnc; // preserve
      if (provided === '' || provided === null) return undefined; // remove
      return encryptSecret(provided, getEncryptionKey());
    };

    const out: Partial<Record<AiModelRole, RawStoredRole>> = {};
    for (const role of AI_ROLES) {
      if (!(role in input)) {
        // Untouched role — keep whatever was stored.
        if (existingRoles[role]) out[role] = existingRoles[role];
        continue;
      }
      const cfg = input[role];
      if (cfg == null) continue; // explicit removal

      if (cfg.reuse) {
        if (cfg.reuse === role) throw createError({ statusCode: 400, message: `Role "${role}" cannot reuse itself` });
        out[role] = { reuse: cfg.reuse, model: cfg.model?.trim() || '' };
        continue;
      }

      const provider = (cfg.provider || '') as AiProvider;
      if (!VALID_PROVIDERS.includes(provider)) {
        throw createError({ statusCode: 400, message: `Role "${role}" has an invalid provider` });
      }
      const model = cfg.model?.trim() || '';
      const baseUrl = cfg.baseUrl?.trim() || '';
      if (provider === 'openai' && (!baseUrl || !model)) {
        throw createError({
          statusCode: 400,
          message: `Role "${role}": OpenAI-compatible provider requires baseUrl and model`,
        });
      }
      const apiKey = resolveKey(cfg.apiKey, existingRoles[role]?.apiKey);
      out[role] = { provider, model, baseUrl, ...(apiKey ? { apiKey } : {}) };
    }

    // The diagnosis role is the required root and cannot reuse another role.
    if (!out.diagnosis || out.diagnosis.reuse) {
      throw createError({ statusCode: 400, message: 'A diagnosis role with its own provider is required' });
    }

    const autoDiagnose = 'autoDiagnose' in body ? Boolean(body.autoDiagnose) : Boolean(existing.autoDiagnose);
    await setAppSetting(db, 'ai', { autoDiagnose, roles: out });
  }

  return readAiSettings(db);
});
