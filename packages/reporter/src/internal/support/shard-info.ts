import type { ShardInfo } from '../../public/options.js';
import { PIWI_SHARD_ENV } from '../config/env.js';

/** Parse an `i/n` shard spec; null when it is malformed or does not split the suite. */
export function parseShardSpec(raw: string | null | undefined): ShardInfo | null {
  const match = raw?.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  return current >= 1 && current <= total && total > 1 ? { current, total } : null;
}

/**
 * The shard this Playwright process runs: Playwright's own `--shard`, else the
 * `i/n` `piwi run --shard` leaves in `PIWI_SHARD`. Null for a run that is not
 * one of several shards.
 */
export function resolveShardInfo(
  config: { shard?: ShardInfo | null },
  env: NodeJS.ProcessEnv = process.env,
): ShardInfo | null {
  const pwShard = config.shard;
  if (pwShard && pwShard.total > 1) return { current: pwShard.current, total: pwShard.total };
  return parseShardSpec(env[PIWI_SHARD_ENV]);
}
