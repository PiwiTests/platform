/**
 * Conditions on the page's requests, for Slow down or fail a request: a delay
 * before the request goes out, a 500 answer, or a network failure, applied by
 * the main-world script (`request-conditions-main.ts`) to the `fetch` and XHR
 * calls whose method and URL match. Pure: the main world has no `chrome.*`.
 */

export type ConditionKind = 'delay' | 'error' | 'abort';

export interface RequestCondition {
  id: string;
  /** Upper case, as the request was made. */
  method: string;
  /** A Playwright-style glob over the whole URL: `**` spans slashes, `*` does not, everything else is literal. */
  pattern: string;
  kind: ConditionKind;
  /** For a delay, in milliseconds. */
  delayMs: number;
}

/** The conditions on, for one tab and the origin of its page. Kept in session storage under {@link CONDITIONS_KEY}. */
export interface ConditionsState {
  tabId: number;
  origin: string;
  conditions: RequestCondition[];
}

export const CONDITIONS_KEY = 'piwiRequestConditions';

/** Tags the message the isolated-world script posts to the main-world one. */
export const CONDITIONS_MESSAGE_SOURCE = 'piwi-request-conditions';

/** The longest delay a condition may ask for. */
export const MAX_DELAY_MS = 60_000;

export function globRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        source += '.*';
        while (glob[i + 1] === '*') i++;
      } else source += '[^/]*';
    } else source += c.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function isCondition(value: unknown): value is RequestCondition {
  const c = value as Partial<RequestCondition> | null;
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.method === 'string' &&
    typeof c.pattern === 'string' &&
    (c.kind === 'delay' || c.kind === 'error' || c.kind === 'abort') &&
    typeof c.delayMs === 'number' &&
    c.delayMs >= 0 &&
    c.delayMs <= MAX_DELAY_MS
  );
}

/** The first condition for a request, by its method and absolute URL. */
export function conditionFor(
  conditions: readonly RequestCondition[],
  method: string,
  url: string,
): RequestCondition | null {
  const upper = method.toUpperCase();
  for (const condition of conditions) {
    if (condition.method !== upper) continue;
    try {
      if (globRegExp(condition.pattern).test(url)) return condition;
    } catch {
      // A pattern that is no regular expression finds nothing.
    }
  }
  return null;
}
