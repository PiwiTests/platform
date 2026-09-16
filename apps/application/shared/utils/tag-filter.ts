/**
 * SQL predicate for "this JSON string array contains this exact value".
 *
 * Tags live in a JSON column (`text` on SQLite, `jsonb` on PostgreSQL) rather
 * than a junction table, so membership is tested against the serialized text.
 * `CAST(col AS TEXT)` is the one spelling both dialects accept, and matching the
 * JSON-encoded element — `"smoke"`, quotes included — rather than the bare word
 * keeps `smoke` from matching `smoke-test`. `JSON.stringify` produces exactly
 * the bytes the driver wrote, so a tag containing a quote still matches.
 *
 * The tradeoff is that this cannot use an index. Tag filters run against one
 * project's cases, which is a small enough set that a scan is fine; if that
 * stops being true, the fix is a `test_case_tags` junction table, not a
 * cleverer LIKE.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { SQLWrapper } from 'drizzle-orm';

/** Escape the characters LIKE treats as wildcards, for use with `ESCAPE '\'`. */
function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

/** Predicate matching rows whose JSON array column contains `value`. */
export function jsonArrayContains(column: SQLWrapper, value: string): SQL {
  const pattern = `%${escapeLikePattern(JSON.stringify(value))}%`;
  return sql`CAST(${column} AS TEXT) LIKE ${pattern} ESCAPE '\\'`;
}

/** Predicate matching rows whose JSON array column contains **every** value. */
export function jsonArrayContainsAll(column: SQLWrapper, values: string[]): SQL[] {
  return values.map((value) => jsonArrayContains(column, value));
}

/**
 * Split a comma-separated tag query parameter into normalized tags. Mirrors the
 * storage form (leading `@` stripped) so `?tags=@smoke` and `?tags=smoke` mean
 * the same thing.
 */
export function parseTagFilter(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const tag = part.trim().replace(/^@+/, '').trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/**
 * Split a comma-separated lock query parameter into lock names. Locks are stored
 * verbatim (no `@` convention, unlike tags), so parsing only trims and dedupes.
 */
export function parseLockFilter(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const lock = part.trim();
    if (lock) seen.add(lock);
  }
  return [...seen];
}
