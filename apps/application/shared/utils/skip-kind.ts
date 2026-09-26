/**
 * Kinds of intentional skip. Playwright reports both `test.skip()` and
 * `test.fixme()` with the `skipped` status; the annotation it adds (`skip` or
 * `fixme`) is what tells them apart. A `fixme` skip is counted as a subset of
 * skipped, the way a pass on retry (flaky) is a subset of passed, so the
 * skipped counters stay as they are and `fixme` is carved out for display.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { SQLWrapper } from 'drizzle-orm';

/** The annotation type `test.fixme()` adds to a test. */
export const FIXME_ANNOTATION = 'fixme';

interface AnnotatedCase {
  status: string;
  testAnnotations?: ReadonlyArray<{ type: string }> | null;
}

/** Whether a case was skipped by `test.fixme()` rather than `test.skip()`. */
export function isFixmeSkip(tc: AnnotatedCase): boolean {
  return tc.status === 'skipped' && (tc.testAnnotations ?? []).some((a) => a.type === FIXME_ANNOTATION);
}

/**
 * SQL predicate matching a skipped case that carries a `fixme` annotation.
 *
 * Annotations live in a JSON column (`text` on SQLite, `jsonb` on PostgreSQL),
 * so the entry is matched against the serialized text. SQLite holds the
 * `JSON.stringify` output (`"type":"fixme"`) while PostgreSQL renders jsonb
 * with a space after the colon (`"type": "fixme"`); both spellings are matched.
 * An annotation description is a JSON string, so its quotes are escaped and it
 * can never produce the unescaped `"type":"fixme"` sequence.
 */
export function fixmeSkipPredicate(status: SQLWrapper, annotations: SQLWrapper): SQL {
  const compact = `%"type":"${FIXME_ANNOTATION}"%`;
  const spaced = `%"type": "${FIXME_ANNOTATION}"%`;
  return sql`(${status} = 'skipped' AND (CAST(${annotations} AS TEXT) LIKE ${compact} OR CAST(${annotations} AS TEXT) LIKE ${spaced}))`;
}
