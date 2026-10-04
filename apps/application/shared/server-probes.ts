/**
 * Server probes (Test Map, level two) — the per-project gate and fault
 * vocabulary. The whole level stays behind a per-project flag that defaults to
 * off. When on, only allow-listed fault classes and routes are probed, and
 * dependency faults on state-changing routes are off unless explicitly enabled.
 *
 * Pure and dependency-free so the plan builder, the guards and the demo share it.
 */

/** The server-side fault classes the instrumentation can apply to one request. */
export const SERVER_PROBE_FAULTS = [
  'throw',
  'status',
  'delay',
  'dependency',
  'data',
  'extreme',
  'replay',
  'auth',
  'slow-first',
] as const;
export type ServerProbeFault = (typeof SERVER_PROBE_FAULTS)[number];

/** True when a fault name is one of the server-side classes. */
export function isServerProbeFault(fault: string): fault is ServerProbeFault {
  return (SERVER_PROBE_FAULTS as readonly string[]).includes(fault);
}

/** HTTP methods that change server state — dependency faults on these are gated. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** True when a route key (`METHOD /pattern`) names a state-changing method. */
export function isStateChangingRoute(routeKey: string): boolean {
  const method = routeKey.split(' ', 1)[0]?.toUpperCase() ?? '';
  return STATE_CHANGING_METHODS.has(method);
}

/** A project's server-probe configuration, stored as a JSON column on `projects`. */
export interface ServerProbeSettings {
  /** The whole level is off unless this is true. Defaults off. */
  enabled: boolean;
  /** Fault classes allowed on this project; empty means none. */
  faults: ServerProbeFault[];
  /** Route-key patterns (`METHOD /pattern`) allowed; empty means all reached routes. */
  routes: string[];
  /** Dependency faults on state-changing routes can leave partial writes; off by default. */
  dependencyOnStateChanging: boolean;
}

/** The safe default: the level is off, nothing allow-listed. */
export const DEFAULT_SERVER_PROBE_SETTINGS: ServerProbeSettings = {
  enabled: false,
  faults: [],
  routes: [],
  dependencyOnStateChanging: false,
};

/** Normalize a stored/blob value into {@link ServerProbeSettings}, dropping junk. */
export function resolveServerProbeSettings(raw: unknown): ServerProbeSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SERVER_PROBE_SETTINGS };
  const obj = raw as Partial<ServerProbeSettings>;
  const faults = Array.isArray(obj.faults)
    ? obj.faults.filter((f): f is ServerProbeFault => isServerProbeFault(f))
    : [];
  const routes = Array.isArray(obj.routes) ? obj.routes.filter((r): r is string => typeof r === 'string' && !!r) : [];
  return {
    enabled: obj.enabled === true,
    faults: [...new Set(faults)],
    routes: [...new Set(routes)],
    dependencyOnStateChanging: obj.dependencyOnStateChanging === true,
  };
}

/**
 * True when a project's settings permit probing this route with this fault. A
 * disabled project permits nothing; an empty route allow-list permits every
 * reached route; a dependency fault on a state-changing route needs the extra
 * opt-in.
 */
export function serverProbeAllowed(settings: ServerProbeSettings, routeKey: string, fault: ServerProbeFault): boolean {
  if (!settings.enabled) return false;
  if (!settings.faults.includes(fault)) return false;
  if (settings.routes.length > 0 && !settings.routes.includes(routeKey)) return false;
  if (fault === 'dependency' && isStateChangingRoute(routeKey) && !settings.dependencyOnStateChanging) return false;
  return true;
}
