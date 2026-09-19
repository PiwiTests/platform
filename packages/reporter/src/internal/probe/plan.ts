/**
 * Probe plan matching (client side). Pure helpers the probe command and the
 * interception layer share: match a running test to its plan item, decide which
 * request to mutate (after the first navigation, the Nth match only), and stamp
 * a probe run so the dashboard never counts it as real.
 */

import type { ProbeFault } from './faults.js';

/** One (test, route, fault) pair the server's plan asks this run to apply. */
export interface ProbePlanItem {
  testCaseId: number;
  testTitle: string;
  location: string | null;
  routeKey: string;
  fault: ProbeFault;
  nth: number;
}

export interface ProbePlan {
  budget: number;
  items: ProbePlanItem[];
}

/**
 * The run-metadata stamp that marks a probe run. Merged into the run metadata so
 * the server routes the run to its silent path (no clusters, regression signals,
 * notifications or pull-request feedback). Must match the server's
 * `PROBE_RUN_METADATA_KEY`.
 */
export function probeRunMetadata(base: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...base, piwiProbe: true };
}

/** Split a route key `METHOD /pattern` into its method and path pattern. */
function parseRouteKey(routeKey: string): { method: string; pattern: string } {
  const space = routeKey.indexOf(' ');
  if (space < 0) return { method: '', pattern: routeKey };
  return { method: routeKey.slice(0, space).toUpperCase(), pattern: routeKey.slice(space + 1) };
}

/** A route pattern's path as a regex: `:id`/`:uuid`/`:param` match one segment. */
function patternToRegex(pattern: string): RegExp {
  const path = pattern.split('?')[0] ?? pattern;
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z0-9_]+/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

/**
 * Match a running test to a plan item by location (preferred) or title. Returns
 * the first matching item, or null when none matches this test.
 */
export function matchProbeItem(
  plan: ProbePlan,
  test: { location?: string | null; title?: string | null },
): ProbePlanItem | null {
  for (const item of plan.items) {
    if (item.location && test.location && item.location === test.location) return item;
  }
  for (const item of plan.items) {
    if (item.testTitle && test.title && item.testTitle === test.title) return item;
  }
  return null;
}

/** True when a request's method and path match a plan item's route. */
export function requestMatchesRoute(method: string, url: string, routeKey: string): boolean {
  const { method: rm, pattern } = parseRouteKey(routeKey);
  if (rm && rm !== method.toUpperCase()) return false;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split('?')[0] ?? url;
  }
  return patternToRegex(pattern).test(path);
}

/** Mutable per-test probe state: first-navigation flag and per-route match count. */
export interface ProbeState {
  navigated: boolean;
  matches: number;
}

export function createProbeState(): ProbeState {
  return { navigated: false, matches: 0 };
}

/** Record that the first navigation happened; requests before it are never mutated. */
export function markNavigated(state: ProbeState): void {
  state.navigated = true;
}

/**
 * Decide whether this matching request is the one to mutate: only after the
 * first navigation, and only the Nth match (default the first). Advances the
 * match counter, so it returns true exactly once per test.
 */
export function shouldMutate(state: ProbeState, item: ProbePlanItem): boolean {
  if (!state.navigated) return false;
  state.matches += 1;
  return state.matches === Math.max(1, item.nth ?? 1);
}
