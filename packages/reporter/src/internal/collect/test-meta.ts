/**
 * Read a test's declared tags and `piwi:` ownership metadata off Playwright's
 * `TestCase` / `TestResult`.
 *
 * Both normalizers live in `@piwitests/core` so the server can re-run them on
 * ingest; this module is only the Playwright-shaped adapter around them.
 */
import { normalizeTestLocks, normalizeTestTags, parseTestMetadata, type TestMetadata } from '@piwitests/core/test-meta';
import type { TestAnnotation } from '../../types.js';

/** The slice of `TestCase` this module reads. */
interface TaggedTestCase {
  /**
   * Playwright folds `@tag` tokens in the title and the `{ tag: [...] }` test
   * option into one array. Optional here because a `TestCase` from an older
   * Playwright than the peer range can reach the reporter through a
   * hand-rolled harness.
   */
  tags?: readonly string[];
}

/** Tags declared on a test, normalized for storage. Empty array when none. */
export function collectTestTags(test: TaggedTestCase): string[] {
  return normalizeTestTags(test.tags);
}

/**
 * Lock names declared on a test or its `describe` (`{ lock: 'db' }`), read off
 * the private `TestCase._locks` array Playwright populates only for in-process
 * reporters. There is no public property and the tele protocol carries none, so
 * blob-imported and merged runs yield nothing here — best effort by design.
 * Anything that is not an array of strings is treated as no locks.
 */
export function collectTestLocks(test: unknown): string[] {
  const locks = (test as { _locks?: unknown })?._locks;
  return normalizeTestLocks(locks);
}

/**
 * Ownership metadata declared via `piwi:` annotations, or `null` when the test
 * declared none. Takes the already-merged annotation list (`mergeAnnotations`)
 * so a `testInfo.annotations.push()` at runtime counts the same as a static
 * `{ annotation: … }` on the test.
 */
export function collectTestMetadata(annotations: TestAnnotation[]): TestMetadata | null {
  return parseTestMetadata(annotations);
}
