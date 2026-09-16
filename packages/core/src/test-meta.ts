/**
 * Test-level tags and ownership metadata — the shape, the limits, and the
 * normalization rules for both.
 *
 * Two independent sources feed this, both declared in the spec file:
 *
 * - **Tags** come from Playwright itself (`TestCase.tags`), which already folds
 *   together `@tag` tokens in a title and the `{ tag: [...] }` test option.
 * - **Metadata** comes from `piwi:`-prefixed test annotations, e.g.
 *   `test('…', { annotation: { type: 'piwi:owner', description: '@checkout' } })`.
 *
 * Both normalizers are total: they take `unknown`, never throw, and return a
 * value safe to store and render. The reporter runs them at collection time and
 * the ingest endpoints run them again on arrival, because a payload can reach
 * the API without passing through the reporter.
 */

/** Prefix identifying an annotation as Piwi metadata rather than a test mark. */
export const PIWI_ANNOTATION_PREFIX = 'piwi:';

/** Priority levels accepted by `piwi:priority`, most severe first. */
export const TEST_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type TestPriority = (typeof TEST_PRIORITIES)[number];

export const MAX_TEST_TAGS = 20;
export const MAX_TEST_TAG_CHARS = 60;
export const MAX_TEST_LOCKS = 20;
export const MAX_TEST_LOCK_CHARS = 100;
/** Cap for `owner` and `feature`; `link` gets its own, longer cap. */
export const MAX_TEST_META_CHARS = 120;
export const MAX_TEST_LINK_CHARS = 500;

/** Ownership and classification declared on a test via `piwi:` annotations. */
export interface TestMetadata {
  /** Free-form owner — a team handle, a squad name, an email. */
  owner?: string;
  priority?: TestPriority;
  /** Product area this test covers, for grouping across spec files. */
  feature?: string;
  /** Absolute `http(s)` URL to a ticket, spec or runbook. */
  link?: string;
}

const PRIORITY_SET: ReadonlySet<string> = new Set(TEST_PRIORITIES);

function cleanString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxChars);
}

/**
 * Normalize raw tags into the stored form: leading `@` stripped (Playwright
 * reports `@smoke`, we store `smoke` so a tag reads the same however it was
 * declared), blanks dropped, duplicates removed, declaration order preserved.
 */
export function normalizeTestTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const tag = entry.trim().replace(/^@+/, '').trim().slice(0, MAX_TEST_TAG_CHARS);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TEST_TAGS) break;
  }

  return out;
}

/**
 * Normalize raw test locks into the stored form: a lock is a named shared
 * resource the runner serializes holders of, declared verbatim (no `@` prefix
 * to strip, unlike tags). Non-string and blank entries are dropped, duplicates
 * removed, declaration order preserved.
 *
 * Playwright never exposes locks publicly — the reporter reads a private field —
 * so this normalizer is deliberately defensive about its input.
 */
export function normalizeTestLocks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const lock = entry.trim().slice(0, MAX_TEST_LOCK_CHARS);
    if (!lock || seen.has(lock)) continue;
    seen.add(lock);
    out.push(lock);
    if (out.length >= MAX_TEST_LOCKS) break;
  }

  return out;
}

/**
 * A `link` is rendered as an anchor in the dashboard and in pull-request
 * comments, so only absolute `http(s)` URLs are accepted — anything else
 * (`javascript:`, `data:`, a bare word) is dropped rather than stored.
 */
function normalizeLink(value: unknown): string | undefined {
  const raw = cleanString(value, MAX_TEST_LINK_CHARS);
  if (!raw) return undefined;
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:' ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract `piwi:` metadata from a test's annotations. Annotation types are
 * matched case-insensitively; unknown `piwi:` fields and unparseable values are
 * ignored, and a later annotation of the same field wins. Returns `null` when
 * nothing usable was declared, so callers can store a null column rather than
 * an empty object.
 */
export function parseTestMetadata(annotations: unknown): TestMetadata | null {
  if (!Array.isArray(annotations)) return null;

  const meta: TestMetadata = {};

  for (const entry of annotations) {
    if (!entry || typeof entry !== 'object') continue;
    const { type, description } = entry as { type?: unknown; description?: unknown };
    if (typeof type !== 'string') continue;

    const lower = type.trim().toLowerCase();
    if (!lower.startsWith(PIWI_ANNOTATION_PREFIX)) continue;
    const field = lower.slice(PIWI_ANNOTATION_PREFIX.length);

    switch (field) {
      case 'owner': {
        const value = cleanString(description, MAX_TEST_META_CHARS);
        if (value) meta.owner = value;
        break;
      }
      case 'priority': {
        const value = cleanString(description, MAX_TEST_META_CHARS)?.toLowerCase();
        if (value && PRIORITY_SET.has(value)) meta.priority = value as TestPriority;
        break;
      }
      case 'feature': {
        const value = cleanString(description, MAX_TEST_META_CHARS);
        if (value) meta.feature = value;
        break;
      }
      case 'link': {
        const value = normalizeLink(description);
        if (value) meta.link = value;
        break;
      }
      default:
        break;
    }
  }

  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * Validate an already-shaped metadata object (e.g. one that arrived on the wire
 * as `testMeta`) against the same rules `parseTestMetadata` applies, by routing
 * it through the annotation parser. Keeps one definition of what each field
 * accepts instead of two that can drift.
 */
export function sanitizeTestMetadata(raw: unknown): TestMetadata | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const asAnnotations = Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({
    type: `${PIWI_ANNOTATION_PREFIX}${key}`,
    description: typeof value === 'string' ? value : undefined,
  }));
  return parseTestMetadata(asAnnotations);
}

/**
 * True when the annotation belongs to Piwi rather than to Playwright. The
 * dashboard renders test marks (`skip`, `fixme`, `slow`) as chips and would
 * otherwise show the metadata annotations twice.
 */
export function isPiwiAnnotation(type: unknown): boolean {
  return typeof type === 'string' && type.trim().toLowerCase().startsWith(PIWI_ANNOTATION_PREFIX);
}

/** Sort key for a priority, lowest number = most severe. Unknown sorts last. */
export function priorityRank(priority: string | null | undefined): number {
  const index = TEST_PRIORITIES.indexOf(priority as TestPriority);
  return index === -1 ? TEST_PRIORITIES.length : index;
}
