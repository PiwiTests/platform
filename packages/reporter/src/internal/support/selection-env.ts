import { PIWI_SELECTION_ENV } from '../config/env.js';
import type { SelectionStamp } from '../../types.js';

/**
 * Read the selection stamp `piwi run` left in the environment, if any. Returns
 * null unless a selection key is present with a well-formed version, hash and
 * count — a partial or hand-set environment must not produce a bogus stamp.
 */
export function readSelectionStamp(env: NodeJS.ProcessEnv = process.env): SelectionStamp | null {
  const key = env[PIWI_SELECTION_ENV.key];
  if (!key) return null;

  const version = Number(env[PIWI_SELECTION_ENV.version]);
  const resolvedCount = Number(env[PIWI_SELECTION_ENV.count]);
  const resolvedHash = env[PIWI_SELECTION_ENV.hash] ?? '';
  if (!Number.isFinite(version) || !Number.isFinite(resolvedCount) || !resolvedHash) return null;

  return { key, version, resolvedHash, resolvedCount };
}
