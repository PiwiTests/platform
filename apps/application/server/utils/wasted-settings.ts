import { getAppSetting } from './app-settings';
import {
  parseWastedWaitPatterns,
  resolveStoredWastedPatterns,
  WASTED_WAIT_PATTERNS_KEY,
} from '#shared/utils/wasted-waits';
import type { DbClient } from '../database';

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
  return { ...resolveStoredWastedPatterns(stored), envManaged: false };
}
