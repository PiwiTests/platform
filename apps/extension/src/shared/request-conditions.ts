/**
 * Conditions on the page's requests, for Slow down or fail a request: a delay
 * before the request goes out, a 500 answer, or a network failure. In Chrome
 * and Edge the background worker applies them to every request of the tab
 * through the debugging protocol's `Fetch` domain, with the whole-page network
 * and CPU throttling; elsewhere, the main-world script
 * (`request-conditions-main.ts`) applies them to the `fetch` and XHR calls
 * whose method and URL match. Pure: the main world has no `chrome.*`.
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

/** Whole-page network conditions, as DevTools names its presets. */
export type NetworkThrottle = 'fast-3g' | 'slow-3g' | 'offline';

export const NETWORK_THROTTLES: readonly NetworkThrottle[] = ['fast-3g', 'slow-3g', 'offline'];

/**
 * What `Network.emulateNetworkConditions` gets for each preset: DevTools'
 * own values, latency in milliseconds, throughput in bytes per second.
 */
export const NETWORK_PRESETS: Record<
  NetworkThrottle,
  { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number }
> = {
  'fast-3g': { offline: false, latency: 562.5, downloadThroughput: 180_000, uploadThroughput: 84_375 },
  'slow-3g': { offline: false, latency: 2_000, downloadThroughput: 50_000, uploadThroughput: 50_000 },
  offline: { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
};

/** How many times slower the CPU runs, as DevTools offers it. */
export const CPU_RATES: readonly number[] = [4, 6, 20];

/**
 * How the conditions reach the page: through the debugging protocol (`Fetch`,
 * every request) or through the main-world wrapper (`fetch` and XHR only).
 */
export type ConditionsVia = 'debugger' | 'page';

/** The conditions on, for one tab and the origin of its page. Kept in session storage under {@link CONDITIONS_KEY}. */
export interface ConditionsState {
  tabId: number;
  origin: string;
  conditions: RequestCondition[];
  /** The whole page's network, throttled or offline; null for none. Debugging protocol only. */
  throttle?: NetworkThrottle | null;
  /** The CPU slowed down this many times; null for none. Debugging protocol only. */
  cpuRate?: number | null;
  via?: ConditionsVia;
  /** Why the conditions went back to the page's wrapper: the debugging bar was cancelled, or the session ended. */
  lost?: 'canceled' | 'lost' | null;
}

export function isThrottle(value: unknown): value is NetworkThrottle {
  return NETWORK_THROTTLES.includes(value as NetworkThrottle);
}

export function isCpuRate(value: unknown): value is number {
  return typeof value === 'number' && CPU_RATES.includes(value);
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
