import { CONTEXT_LIMIT_FIELDS, DEFAULT_CONTEXT_LIMITS, clampLimit } from '#shared/ai-context-limits';
import type { ContextLimits } from '#shared/ai-context-limits';

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

export const CONTEXT_LIMITS_SETTING_KEY = 'ai_context_limits';

function parseEnvInt(name: string): number | null {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** Keys whose value is pinned by an env var (shown read-only in the settings UI). */
export function envManagedLimitKeys(): (keyof ContextLimits)[] {
  return CONTEXT_LIMIT_FIELDS.filter((f) => parseEnvInt(f.envVar) != null).map((f) => f.key);
}

/**
 * Resolve the effective context limits: defaults ← stored settings ← env vars
 * (env wins). Stored/env values are clamped to each field's allowed range.
 */
export async function resolveContextLimits(db: DbClient): Promise<ContextLimits> {
  const stored = (await getAppSetting<Partial<ContextLimits>>(db, CONTEXT_LIMITS_SETTING_KEY)) ?? {};
  const limits: ContextLimits = { ...DEFAULT_CONTEXT_LIMITS };

  for (const field of CONTEXT_LIMIT_FIELDS) {
    const storedVal = clampLimit(field, stored[field.key]);
    if (storedVal != null) limits[field.key] = storedVal;

    const envVal = parseEnvInt(field.envVar);
    if (envVal != null) limits[field.key] = clampLimit(field, envVal) ?? limits[field.key];
  }

  return limits;
}
