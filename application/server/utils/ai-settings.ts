/**
 * Helpers for the role-based AI settings surface (GET/PUT /api/settings/ai).
 *
 * Storage: the `ai` app-setting holds `{ autoDiagnose, roles }` where each role
 * (`diagnosis` | `research` | `embedding`) has its own provider config, or a
 * `reuse` pointer to inherit another role's provider/key/baseUrl. Installs saved
 * before this refactor used flat fields (`provider`, `model`, `researchModel`,
 * …) — `storedRoles()` migrates those on read so nothing breaks.
 */

import { getAppSetting } from './app-settings';
import type { AiModelRole, AiProvider, AiRoleSettings, AiSettings } from '~~/types/api';

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

export const AI_ROLES: AiModelRole[] = ['diagnosis', 'research', 'embedding'];

/** Stored shape of a single role (apiKey encrypted at rest). */
export interface RawStoredRole {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  reuse?: AiModelRole | null;
}

/** Stored shape of the `ai` app-setting (new `roles` shape or legacy flat fields). */
export interface RawStoredAi {
  autoDiagnose?: boolean;
  roles?: Partial<Record<AiModelRole, RawStoredRole>>;
  // Legacy flat fields (pre-roles installs)
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  researchModel?: string;
  researchProvider?: string;
  researchBaseUrl?: string;
  researchApiKey?: string;
}

/** Map legacy flat storage (or env vars in the same shape) onto the role map. */
export function rolesFromLegacy(flat: {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  researchModel?: string;
  researchProvider?: string;
  researchBaseUrl?: string;
  researchApiKey?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
}): Partial<Record<AiModelRole, RawStoredRole>> {
  const roles: Partial<Record<AiModelRole, RawStoredRole>> = {};
  if (flat.provider) {
    roles.diagnosis = { provider: flat.provider, model: flat.model, baseUrl: flat.baseUrl, apiKey: flat.apiKey };
  }
  if (flat.researchModel) {
    roles.research = flat.researchProvider
      ? {
          provider: flat.researchProvider,
          model: flat.researchModel,
          baseUrl: flat.researchBaseUrl,
          apiKey: flat.researchApiKey || flat.apiKey,
        }
      : { reuse: 'diagnosis', model: flat.researchModel };
  }
  if (flat.embeddingProvider) {
    roles.embedding = {
      provider: flat.embeddingProvider,
      model: flat.embeddingModel,
      baseUrl: flat.embeddingBaseUrl,
      apiKey: flat.embeddingApiKey,
    };
  }
  return roles;
}

/** Read the stored role map, migrating legacy flat storage on the fly. */
export function storedRoles(stored: RawStoredAi | null | undefined): Partial<Record<AiModelRole, RawStoredRole>> {
  if (!stored) return {};
  if (stored.roles) return stored.roles;
  return rolesFromLegacy(stored);
}

/** Client-facing settings for one role (omits the secret). */
export function toRoleSettings(raw?: RawStoredRole | null): AiRoleSettings | null {
  if (!raw || (!raw.provider && !raw.reuse)) return null;
  return {
    provider: (raw.provider as AiProvider) || null,
    model: raw.model || null,
    baseUrl: raw.baseUrl || null,
    reuse: raw.reuse ?? null,
    hasApiKey: Boolean(raw.apiKey),
  };
}

/** Build the full client-facing Ai settings from env vars (if managed) or DB. */
export async function readAiSettings(db: DbClient): Promise<AiSettings> {
  const runtimeConfig = useRuntimeConfig();
  const envAi = runtimeConfig.ai as Record<string, string | boolean | undefined> | undefined;
  const envManaged = Boolean(envAi?.provider);

  const [instructions, scmTokenSetting] = await Promise.all([
    getAppSetting<{ value?: string }>(db, 'ai_instructions'),
    getAppSetting<{ value?: string }>(db, 'scm_token'),
  ]);
  const customInstructions = instructions?.value || null;
  const hasScmToken = Boolean(scmTokenSetting?.value);

  let roleMap: Partial<Record<AiModelRole, RawStoredRole>>;
  let autoDiagnose: boolean;

  if (envManaged) {
    roleMap = rolesFromLegacy(envAi as Parameters<typeof rolesFromLegacy>[0]);
    autoDiagnose = String(envAi!.autoDiagnose) === 'true';
  } else {
    const stored = await getAppSetting<RawStoredAi>(db, 'ai');
    roleMap = storedRoles(stored);
    autoDiagnose = Boolean(stored?.autoDiagnose);
  }

  return {
    roles: {
      diagnosis: toRoleSettings(roleMap.diagnosis),
      research: toRoleSettings(roleMap.research),
      embedding: toRoleSettings(roleMap.embedding),
    },
    autoDiagnose,
    hasScmToken,
    envManaged,
    customInstructions,
  };
}
