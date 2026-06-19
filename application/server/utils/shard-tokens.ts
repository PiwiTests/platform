import { testRuns } from '../database/schema';
import { eq } from 'drizzle-orm';
import type { getDatabase } from '../database';

type DB = Awaited<ReturnType<typeof getDatabase>>;

/**
 * Read shard tokens from a test run's metadata JSON column.
 * Returns undefined when the run has no stored shard tokens.
 */
export function readShardTokensFromMeta(metadata: unknown): Set<string> | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const meta = metadata as Record<string, unknown>;
  const tokens = meta.shardTokens;
  if (!Array.isArray(tokens)) return undefined;
  const strTokens = tokens.filter((t): t is string => typeof t === 'string');
  return strTokens.length > 0 ? new Set(strTokens) : undefined;
}

/**
 * Append a shard token to a test run's stored metadata in the database.
 * Reads current metadata, appends the token, writes back via Drizzle JSON serialization.
 */
export async function persistShardToken(db: DB, runId: number, token: string, existingMetadata?: Record<string, unknown> | null): Promise<void> {
  let meta: Record<string, unknown>;
  if (existingMetadata) {
    meta = { ...existingMetadata };
  } else {
    const row = await db
      .select({ metadata: testRuns.metadata })
      .from(testRuns)
      .where(eq(testRuns.id, runId));
    meta = (row[0]?.metadata as Record<string, unknown>) ?? {};
  }

  const tokens: string[] = Array.isArray(meta.shardTokens) ? [...meta.shardTokens] : [];
  if (tokens.includes(token)) return;
  tokens.push(token);
  meta.shardTokens = tokens;

  await db
    .update(testRuns)
    .set({ metadata: meta, updatedAt: new Date() })
    .where(eq(testRuns.id, runId));
}

/**
 * Remove a shard token from a test run's stored metadata in the database.
 */
export async function removeStoredShardToken(db: DB, runId: number, token: string): Promise<void> {
  const row = await db
    .select({ metadata: testRuns.metadata })
    .from(testRuns)
    .where(eq(testRuns.id, runId));

  const meta = (row[0]?.metadata as Record<string, unknown>) ?? {};
  const tokens: string[] = Array.isArray(meta.shardTokens) ? meta.shardTokens : [];
  const filtered = tokens.filter((t) => t !== token);
  if (filtered.length === tokens.length) return;

  if (filtered.length > 0) {
    meta.shardTokens = filtered;
  } else {
    delete meta.shardTokens;
  }

  await db
    .update(testRuns)
    .set({ metadata: meta, updatedAt: new Date() })
    .where(eq(testRuns.id, runId));
}
