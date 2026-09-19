import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { consola } from 'consola';
// Type-only: importing 'nitropack/runtime' at runtime only resolves inside a
// Nitro build, and this module must also load from node_modules when the
// server bundle externalizes it (e.g. dev builds).
import type { NitroAppPlugin } from 'nitropack';
import { verifyProbeHeader, type PiwiProbeSpec } from './probe';
import {
  buildRouteManifest,
  recordObservedRoute,
  collapsePathPattern,
  type ManifestRouteEntry,
} from './manifest';

export {
  verifyProbeHeader,
  signProbeMessage,
  probeSigningMessage,
  PROBE_TTL_MS,
  type PiwiProbeSpec,
  type SignedProbe,
} from './probe';
export { buildRouteManifest, recordObservedRoute, collapsePathPattern, type RouteManifest } from './manifest';

const MAX_ENTRIES = 50;
const MAX_MSG_LENGTH = 500;
const MAX_STACK_FRAMES = 5;
const MAX_SPANS = 100;

export interface PiwiTestLogEntry {
  timestamp: number;
  level: string;
  category: string;
  message: string;
  stack?: string;
}

/**
 * A server-side span for the in-flight request. Rides back to the Piwi reporter
 * in the `X-Piwi-Trace` response header (gzip+base64 JSON array) and is shown in
 * the dashboard next to the network request that produced it. The plugin always
 * emits a root request span; application code can contribute child spans with
 * `recordServerSpan` (e.g. a DB query, a downstream call).
 */
export interface PiwiServerSpan {
  /** Unique span id (hex). */
  id: string;
  /** Parent span id — child spans nest under the request's root span. */
  parentId?: string;
  /** Operation name, e.g. the route or a DB query label. */
  name: string;
  /** Coarse kind hint for display/color, e.g. 'server', 'db', 'client', 'internal'. */
  kind?: string;
  /** Start time, Unix epoch milliseconds. */
  startMs: number;
  /** Duration in milliseconds. */
  durMs: number;
  /** Outcome. */
  status?: 'ok' | 'error';
  /** Shared W3C trace id for the request (set on the root span). */
  traceId?: string;
  /** Small free-form attribute bag. */
  attrs?: Record<string, string | number | boolean>;
}

/** Parse and shrink a JS/TS stack trace: skip internal/node_modules frames, keep max 5. */
function shrinkStack(stack: string): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n');
  const frames: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue; // skip error message line
    if (trimmed.includes('node:internal') || trimmed.includes('node_modules')) continue;
    if (frames.length >= MAX_STACK_FRAMES) break;
    frames.push(trimmed.slice(3).trim());
  }
  return frames.length > 0 ? frames.join('\n') : undefined;
}

/** Extract stack from an unknown error value, shrunk, or undefined. */
function extractStack(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) return shrinkStack(err.stack);
  return undefined;
}

/** Pull the 32-hex trace-id out of a W3C `traceparent` header, if valid. */
function parseTraceparent(tp: string | string[] | undefined): string | undefined {
  const value = Array.isArray(tp) ? tp[0] : tp;
  if (!value) return undefined;
  const parts = value.split('-');
  if (parts.length >= 3 && parts[1] && /^[0-9a-f]{32}$/i.test(parts[1])) return parts[1];
  return undefined;
}

/** Per-request capture buffer, scoped with `als.run()` around the handler chain. */
interface RequestStore {
  logs: PiwiTestLogEntry[];
  spans: PiwiServerSpan[];
  startMs: number;
  /** A verified probe fault for this request, when one was signed and honored. */
  probe?: PiwiProbeSpec;
}

// Links consola calls and recorded spans to the request being handled. The store
// is scoped with als.run() around the whole downstream handler chain —
// enterWith() from a request hook is not reliable here (the binding dies with
// the hook's own async scope, so only the first request after boot would capture).
const als = new AsyncLocalStorage<RequestStore>();

/**
 * Record a server-side span for the in-flight request. Shows up in the Piwi
 * Dashboard test-case view (and AI diagnosis) under the request's root span.
 * No-op outside a request scope or once the per-request span cap is reached.
 */
export function recordServerSpan(span: PiwiServerSpan): void {
  const store = als.getStore();
  if (!store || store.spans.length >= MAX_SPANS) return;
  store.spans.push(span);
}

// The consola reporter is process-global — register it only once.
let reporterAdded = false;

const TEST_LOGS_DISABLED =
  process.env.PIWI_TEST_LOGS_DISABLED === 'true' ||
  (process.env.NODE_ENV === 'production' && process.env.PIWI_TEST_LOGS_DISABLED !== 'false');

/** The shared secret a probe run signs the `X-Piwi-Probe` header with. */
const PROBE_SECRET = process.env.PIWI_PROBE_SECRET || undefined;

/** The declared-surface route path the plugin serves outside production. */
const MANIFEST_PATH = '/__piwi/manifest';

/**
 * Routes the server has matched this process, accumulated for `/__piwi/manifest`.
 * Nitro exposes no runtime route table, so the manifest is built from observation.
 */
const observedRoutes = new Map<string, ManifestRouteEntry>();

/**
 * Server probes stay off unless a project opts in. When off (the default in this
 * milestone) a signed probe header is still verified and recorded, but no fault
 * is applied — only the client-safe subset would ever be, and only once this is
 * on.
 */
const SERVER_PROBES_ENABLED = process.env.PIWI_SERVER_PROBES === 'true';

/**
 * Best-effort source file of the matched route handler, for the root span's
 * `piwi.handler` attribute. Nitro exposes the matched route on the event context
 * on recent versions; when it carries no file, the attribute is omitted and the
 * dashboard falls back to its file-routing convention.
 */
function resolveHandlerFile(event: any): string | undefined {
  const matched = event?.context?.matchedRoute as { file?: unknown; filename?: unknown } | undefined;
  const file = matched?.file ?? matched?.filename;
  return typeof file === 'string' && file ? file : undefined;
}

const piwiTestLogs: NitroAppPlugin = (nitroApp) => {
  if (TEST_LOGS_DISABLED) return;

  if (!reporterAdded) {
    reporterAdded = true;
    consola.addReporter({
      log(logObj) {
        if (logObj.level > 1) return; // Warning (1) and Error/Fatal (0) only
        const store = als.getStore();
        if (!store) return;
        const msg = logObj.args.map(String).join(' ');
        const stack = logObj.args.map(extractStack).find(Boolean);
        store.logs.push({
          timestamp: Date.now(),
          level: logObj.level <= 0 ? 'Error' : 'Warning',
          category: logObj.tag ?? '',
          message: msg.length > MAX_MSG_LENGTH ? `${msg.slice(0, MAX_MSG_LENGTH)}…` : msg,
          stack,
        });
      },
    });
  }

  // Wrap the root h3 handler: both the node listener (dev and node-server
  // production entries) and route dispatch go through h3App.handler, so the
  // als.run() scope covers every hook, middleware, and route handler.
  const originalHandler = nitroApp.h3App.handler;
  nitroApp.h3App.handler = ((event) => {
    // Serve the declared-surface manifest outside production (the plugin already
    // returned early when log capture is disabled). Built from observed routes.
    const requestPath = String(event.path ?? event.node.req.url ?? '').split('?')[0] ?? '';
    if (requestPath === MANIFEST_PATH) {
      const res = event.node.res as any;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(buildRouteManifest(observedRoutes)));
      return;
    }

    const store: RequestStore = { logs: [], spans: [], startMs: Date.now() };
    event.context._piwiLogs = store.logs;
    event.context._piwiSpans = store.spans;

    // Verify a signed probe header, honored only outside production (under the
    // same guard as log capture) and only when a shared secret is configured.
    // Nothing is applied in this milestone — the spec is recorded on the request
    // scope for handlers to read, and a fault is applied only once server probes
    // are turned on (and then only the client-safe subset).
    const probe = verifyProbeHeader(event.node.req.headers['x-piwi-probe'], PROBE_SECRET, Date.now());
    if (probe) {
      store.probe = probe;
      event.context._piwiProbe = probe;
      event.context._piwiProbeApplied = false;
      // SERVER_PROBES_ENABLED is off in this milestone; no fault is applied.
      void SERVER_PROBES_ENABLED;
    }

    // Patch res.end so the X-Piwi-Logs / X-Piwi-Trace headers are injected for
    // ALL responses, including H3 error responses where Nitro bypasses the
    // 'beforeResponse' hook (h3 skips onBeforeResponse once the error handler
    // has called res.end).
    const res = event.node.res as any;
    const originalEnd = res.end.bind(res) as (...args: any[]) => any;
    res.end = (...args: any[]) => {
      if (!res.headersSent) {
        // Collect any unhandled H3/Nitro errors — they are synchronously pushed
        // to event.context.nitro.errors before errorHandler runs, so they're
        // always available here even for error responses.
        const nitroErrors = (event.context.nitro as any)?.errors as
          | Array<{ error: unknown }>
          | undefined;
        if (nitroErrors?.length) {
          for (const { error } of nitroErrors) {
            const msg = error instanceof Error ? (error.message || String(error)) : String(error);
            store.logs.push({
              timestamp: Date.now(),
              level: 'Error',
              category: 'server',
              message: msg.length > MAX_MSG_LENGTH ? `${msg.slice(0, MAX_MSG_LENGTH)}…` : msg,
              stack: extractStack(error),
            });
          }
        }
        const logPayload = store.logs.length > MAX_ENTRIES ? store.logs.slice(0, MAX_ENTRIES) : store.logs;
        res.setHeader('X-Piwi-Logs', gzipSync(Buffer.from(JSON.stringify(logPayload))).toString('base64'));

        // Synthesize the root request span (server-side processing time, route,
        // status), correlate any app-recorded child spans under it, and ship the
        // whole tree. When the caller sent a W3C traceparent, reuse its trace id
        // so the spans line up with an external tracing backend.
        const endMs = Date.now();
        const method = String(event.method ?? event.node.req.method ?? 'GET');
        const path = String(event.path ?? event.node.req.url ?? '').split('?')[0] ?? '';
        const statusCode = Number(res.statusCode) || 0;
        const traceId =
          parseTraceparent(event.node.req.headers['traceparent']) ?? randomBytes(16).toString('hex');
        const handlerFile = resolveHandlerFile(event);

        // Record this route for the declared-surface manifest. Prefer the matched
        // route's own pattern; fall back to collapsing the concrete path.
        const matchedPattern = (event.context?.matchedRoute as { route?: unknown; path?: unknown } | undefined)?.route;
        const pattern = typeof matchedPattern === 'string' && matchedPattern ? matchedPattern : collapsePathPattern(path);
        recordObservedRoute(observedRoutes, { method, pattern, handler: handlerFile });

        const rootSpan: PiwiServerSpan = {
          id: randomBytes(8).toString('hex'),
          name: `${method} ${path}`.trim(),
          kind: 'server',
          startMs: store.startMs,
          durMs: Math.max(0, endMs - store.startMs),
          status: statusCode >= 500 ? 'error' : 'ok',
          traceId,
          attrs: {
            'http.method': method,
            'http.route': path,
            'http.status_code': statusCode,
            ...(handlerFile ? { 'piwi.handler': handlerFile } : {}),
          },
        };
        for (const s of store.spans) if (!s.parentId) s.parentId = rootSpan.id;
        const spanPayload = [rootSpan, ...store.spans].slice(0, MAX_SPANS);
        res.setHeader('X-Piwi-Trace', gzipSync(Buffer.from(JSON.stringify(spanPayload))).toString('base64'));
      }
      return originalEnd(...args);
    };

    return als.run(store, () => originalHandler(event));
  }) as typeof originalHandler;
};

export default piwiTestLogs;
