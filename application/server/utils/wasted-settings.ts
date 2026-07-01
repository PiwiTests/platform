import { getAppSetting } from './app-settings';
import { DEFAULT_WASTED_WAIT_PATTERNS, parseWastedWaitPatterns } from '#shared/utils/wasted-waits';

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

/** App-settings key under which the wasted-wait patterns are stored. */
export const WASTED_WAIT_PATTERNS_KEY = 'wasted_wait_patterns';

export interface ResolvedWastedSettings {
  /** The effective allowlist of glob patterns. */
  patterns: string[];
  /** True when the patterns come from `PIWI_WASTED_WAIT_PATTERNS` and the UI must be read-only. */
  envManaged: boolean;
  /** True when no setting/env override exists and the built-in default is in effect. */
  isDefault: boolean;
}

/**
 * Resolve the effective wasted-wait patterns. Precedence:
 *   1. `PIWI_WASTED_WAIT_PATTERNS` env var (locks the UI)
 *   2. the `wasted_wait_patterns` app setting (may be an empty list = nothing wasted)
 *   3. the built-in default ({@link DEFAULT_WASTED_WAIT_PATTERNS})
 */
export async function resolveWastedSettings(db: DbClient): Promise<ResolvedWastedSettings> {
  const runtimeConfig = useRuntimeConfig();
  const envRaw = (runtimeConfig.wastedWaitPatterns as string | undefined)?.trim();
  if (envRaw) {
    return { patterns: parseWastedWaitPatterns(envRaw), envManaged: true, isDefault: false };
  }

  const stored = await getAppSetting<{ value: string[] }>(db, WASTED_WAIT_PATTERNS_KEY);
  if (stored && Array.isArray(stored.value)) {
    // An explicitly-saved empty array means "nothing is wasted" — respect it.
    return { patterns: parseWastedWaitPatterns(stored.value), envManaged: false, isDefault: false };
  }

  return { patterns: [...DEFAULT_WASTED_WAIT_PATTERNS], envManaged: false, isDefault: true };
}

/** Convenience: just the effective patterns (for read-path recomputation). */
export async function resolveWastedPatterns(db: DbClient): Promise<string[]> {
  return (await resolveWastedSettings(db)).patterns;
}
