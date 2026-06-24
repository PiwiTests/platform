import type { TestStepEvent } from '../types';

/**
 * Default wasted-wait patterns. Only explicit `waitForTimeout` sleeps count as
 * wasted by default — these are deliberate hard-coded pauses, unlike
 * framework-injected waits (load-state, wait-for-function) which are usually
 * unavoidable. Covers both the modern human-readable title ("Wait for timeout")
 * and the legacy api-path titles ("page.waitForTimeout", "frame.waitForTimeout").
 *
 * Operators broaden or narrow this via the "Wasted time" setting or the
 * `PIWI_WASTED_WAIT_PATTERNS` environment variable. Use `*` to count every wait.
 */
export const DEFAULT_WASTED_WAIT_PATTERNS: readonly string[] = ['Wait for timeout*', '*waitForTimeout*'];

/**
 * Parse a raw patterns value (from an env var or free-form text input) into a
 * clean string array. Accepts an array as-is, or a string split on newlines
 * and commas. Blank entries are dropped and each entry is trimmed.
 */
export function parseWastedWaitPatterns(raw: string | string[] | null | undefined): string[] {
  if (raw == null) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(/[\n,]/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Convert a single glob pattern (`*` and `?` wildcards) to an anchored, case-insensitive RegExp. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/** Cache compiled patterns so repeated calls within a request don't re-compile. */
const regexCache = new Map<string, RegExp>();
function compile(pattern: string): RegExp {
  let re = regexCache.get(pattern);
  if (!re) {
    re = globToRegExp(pattern);
    regexCache.set(pattern, re);
  }
  return re;
}

/**
 * Decide whether a single wait step counts as "wasted" given the configured
 * allowlist. A wait is wasted when any pattern matches its title **or** its
 * source location (so framework-injected waits can be selected/excluded by
 * where they originate, e.g. `*node_modules*`). Matching is case-insensitive
 * and globs (`*`, `?`) are supported. An empty pattern list means nothing is
 * wasted.
 */
export function isWastedWait(
  wait: { title?: string | null; location?: string | null },
  patterns: readonly string[],
): boolean {
  if (!patterns || patterns.length === 0) return false;
  const title = wait.title ?? '';
  const location = wait.location ?? '';
  for (const pattern of patterns) {
    const re = compile(pattern);
    if (re.test(title) || (location && re.test(location))) return true;
  }
  return false;
}

/**
 * Sum the duration (ms) of every wait-category step event that counts as
 * wasted under the given allowlist. Non-wait events are ignored.
 */
export function computeWastedMs(stepEvents: TestStepEvent[] | null | undefined, patterns: readonly string[]): number {
  if (!stepEvents || stepEvents.length === 0) return 0;
  let total = 0;
  for (const ev of stepEvents) {
    if (ev.category !== 'wait') continue;
    if (isWastedWait(ev, patterns)) total += ev.duration || 0;
  }
  return total;
}
