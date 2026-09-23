/**
 * Server-probe fault classes (Test Map, level two) — the pure decisions the
 * plugin applies to one signed request. Kept side-effect-free so each class is
 * unit-tested without a running server; the plugin owns the throwing, delaying
 * and outbound-call interception these describe.
 */

/** A verified probe fault instruction for one request. */
export interface ProbeFaultSpec {
  /** Route key `METHOD /pattern` the fault targets, when scoped to one route. */
  route?: string;
  /** The fault class to apply. */
  fault: string;
  /** Apply to the Nth matching request (1-based); defaults to 1. */
  nth?: number;
  /** Dependency name a dependency fault targets, when scoped. */
  dependency?: string;
}

const DELAY_MS = 5000;

/** The HTTP status a fault forces on the response, or null when it forces none. */
export function faultStatus(fault: string): number | null {
  switch (fault) {
    case 'status':
    case 'status-500':
      return 500;
    case 'auth':
      return 401;
    default:
      return null;
  }
}

/** The delay (ms) a timing fault adds before the response, or 0 for none. */
export function faultDelayMs(fault: string): number {
  return fault === 'delay' || fault === 'slow' || fault === 'slow-first' ? DELAY_MS : 0;
}

/** A handler fault throws inside the handler so the server's error path runs. */
export function isThrowFault(fault: string): boolean {
  return fault === 'throw';
}

/** An extreme fault returns the handler's empty/default value. */
export function isExtremeFault(fault: string): boolean {
  return fault === 'extreme';
}

/** A data fault mutates the response object before serialization. */
export function isDataFault(fault: string): boolean {
  return fault === 'data' || fault === 'drop-field' || fault === 'empty-body';
}

/** A dependency fault fails or delays one outbound call the handler makes. */
export function isDependencyFault(fault: string): boolean {
  return fault === 'dependency';
}

/**
 * Apply a data fault to a response body before serialization: `empty-body`
 * empties it, `drop-field` removes the first own key of an object, `data` nulls
 * the first own key. Anything else is returned unchanged.
 */
export function mutateResponseBody(fault: string, body: unknown): unknown {
  if (fault === 'empty-body') return Array.isArray(body) ? [] : typeof body === 'string' ? '' : {};
  if (!body || typeof body !== 'object') return body;
  if (Array.isArray(body)) return fault === 'drop-field' ? [] : body;
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length === 0) return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  const first = keys[0]!;
  if (fault === 'drop-field') delete clone[first];
  else if (fault === 'data') clone[first] = null;
  return clone;
}

/** Split a route key into method + path pattern (`POST /api/orders` → …). */
function parseRouteKey(routeKey: string): { method: string; pattern: string } {
  const space = routeKey.indexOf(' ');
  if (space < 0) return { method: '', pattern: routeKey };
  return { method: routeKey.slice(0, space).toUpperCase(), pattern: routeKey.slice(space + 1) };
}

/** True when a concrete request matches a route pattern with `:param` segments. */
function pathMatchesPattern(pattern: string, path: string): boolean {
  const p = (pattern.split('?')[0] ?? pattern).split('/').filter(Boolean);
  const a = (path.split('?')[0] ?? path).split('/').filter(Boolean);
  if (p.length !== a.length) return false;
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(':') || (seg.startsWith('[') && seg.endsWith(']')) || (seg.startsWith('{') && seg.endsWith('}')))
      continue;
    if (seg !== a[i]) return false;
  }
  return true;
}

/**
 * True when a probe spec's route targets this request. An unscoped spec (no
 * route) matches every request. The reporter signs the header onto exactly the
 * request it wants faulted, so a route match is the whole selector server-side —
 * the `nth` occurrence is chosen by the reporter, never re-counted here.
 */
export function routeMatchesRequest(spec: ProbeFaultSpec, method: string, path: string): boolean {
  if (!spec.route) return true;
  const { method: m, pattern } = parseRouteKey(spec.route);
  if (m && m !== method.toUpperCase()) return false;
  return pathMatchesPattern(pattern, path);
}

/** True when an outbound call's target names the dependency a fault is scoped to. */
export function dependencyCallMatches(dependency: string | undefined, target: string): boolean {
  if (!dependency) return true;
  if (!target) return false;
  const needle = dependency.toLowerCase();
  const hay = target.toLowerCase();
  if (hay.includes(needle)) return true;
  try {
    return new URL(target).host.toLowerCase().includes(needle);
  } catch {
    return false;
  }
}

/** The label reported in X-Piwi-Trace for the fault the server actually applied. */
export function appliedFaultLabel(spec: ProbeFaultSpec): string {
  return spec.dependency ? `${spec.fault}:${spec.dependency}` : spec.fault;
}
