/**
 * Node-free trace event parsing: turn the JSONL event streams inside a
 * Playwright trace ZIP into structured actions / console / network / DOM
 * snapshot data. Lives in its own module (like `dom-snapshot-aria.ts`) so the
 * browser demo can parse the committed demo trace with the exact same code the
 * server uses — only ZIP inflation differs per runtime (node zlib in
 * `trace-zip.ts`, DecompressionStream in the demo).
 *
 * We only parse what is useful for the diagnosis context and DOM snapshots.
 */

export interface TraceAction {
  callId: string;
  apiName: string;
  class?: string;
  method?: string;
  params?: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  error?: { message?: string; stack?: string };
  pageId?: string;
  wallTime?: number;
  log?: string[];
  snapshotName?: string;
  beforeSnapshot?: string;
  afterSnapshot?: string;
  /**
   * Trace-relative path of the aria-tree JSON captured before / after this
   * action (`aria/<callId>-<phase>.json`), present when the trace was recorded
   * with `snapshots.aria` (Playwright 1.63+).
   */
  ariaSnapshotBefore?: string;
  ariaSnapshotAfter?: string;
  /**
   * Trace-relative path of the PNG captured before / after this action
   * (`screenshots/<callId>-<phase>.png`), present when the trace was recorded
   * with `snapshots.screen`.
   */
  screenshotBefore?: string;
  screenshotAfter?: string;
}

export interface TraceConsoleEntry {
  type: string;
  text: string;
  timestamp: number;
  /** Legacy traces carry a preformatted string; modern ones a structured location. */
  location?: string | { url?: string; lineNumber?: number; columnNumber?: number };
}

export interface TraceNetworkRequest {
  url: string;
  method: string;
  statusCode?: number;
  headers?: Record<string, string>;
  startTime: number;
  endTime?: number;
}

/**
 * One `frame-snapshot` event from the trace: the serialized DOM Playwright
 * captured before/after an action. `html` is the internal node-array format
 * (`[TAG, {attrs}, ...children]`, back-references as `[[snapshotsAgo, nodeIndex]]`)
 * rendered by `renderSnapshotHtml` (dom-snapshot-render.ts).
 */
export interface TraceFrameSnapshot {
  callId?: string;
  snapshotName?: string;
  pageId?: string;
  frameId?: string;
  frameUrl?: string;
  doctype?: string;
  html: unknown;
  isMainFrame?: boolean;
  /** The page's viewport size when the snapshot was taken (for scaled rendering). */
  viewport?: { width: number; height: number };
}

/**
 * A `context-options` header. Every trace opens with one per recorded context:
 * `origin: 'testRunner'` carries the test-level facts (timeout, start), while
 * `origin: 'library'` carries the browser context (name, viewport, locale) and
 * the display title `file:line › suite › … › test`.
 */
export interface TraceContextOptions {
  origin?: string;
  browserName?: string;
  title?: string;
  /** Epoch ms when the context opened — the anchor for the monotonic clock. */
  wallTime?: number;
  /** Monotonic ms at the same instant as `wallTime`. */
  monotonicTime?: number;
  playwrightVersion?: string;
  platform?: string;
  testTimeout?: number;
  options?: Record<string, unknown>;
}

/** A top-level `error` event: the failure the trace was recorded for. */
export interface TraceErrorEvent {
  message?: string;
  stack?: Array<{ file?: string; line?: number; column?: number }>;
}

export interface ParsedTraceData {
  actions: TraceAction[];
  consoleEntries: TraceConsoleEntry[];
  networkRequests: TraceNetworkRequest[];
  /** DOM snapshots in trace order (back-references resolve against earlier ones). */
  frameSnapshots: TraceFrameSnapshot[];
  /** The action that had an error, if any. */
  failingAction: TraceAction | null;
  /** Failing action index in `actions` array for nearby context. */
  failingActionIndex: number;
  /** `context-options` headers in trace order (runner context first). */
  contexts: TraceContextOptions[];
  /** Top-level `error` events — present when the trace recorded a failure. */
  errors: TraceErrorEvent[];
  /** All parsed events (raw), for building the summary. */
  eventCount: number;
  /** True when the failing action was identified by timeout fallback (no action had an error). */
  timeoutFallback: boolean;
  /**
   * Largest timestamp observed anywhere in the trace, in the same timebase as
   * action startTime/endTime. 0 when no timestamp was found.
   */
  traceEndTime: number;
}

/**
 * Order the trace event files: the runner-level `test.trace` first, then the
 * per-context files (`0-trace.trace`, `1-trace.trace`, …) in numeric order, then
 * anything else. Keeps the action timeline coherent when several files are
 * concatenated; snapshot back-references resolve per-frame so cross-file order
 * never affects DOM rendering.
 */
export function traceFileRank(name: string): number {
  if (name === 'test.trace' || name === 'trace.trace') return -1;
  const m = name.match(/^(\d+)-trace\.trace$/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Parse the decoded text of one or more `*.trace` JSONL files (already ordered
 * by `traceFileRank`) into structured trace data. Unparseable lines are
 * skipped, never thrown on.
 */
export function parseTraceTexts(texts: string[]): ParsedTraceData {
  const events = texts
    .flatMap((text) => text.split('\n'))
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Record<string, unknown>[];

  return extractFromEvents(events);
}

/** A captured response body: the content hash naming its stored file, plus its recorded MIME type. */
export interface TraceResource {
  /** The `_sha1` filename in the project's shared `trace-resources` pool. */
  sha1: string;
  /** The recorded `Content-Type` (`response.content.mimeType`), when known — names the data: URI. */
  mimeType?: string;
}

/**
 * Map every resource URL captured in a trace's `.network` stream to the stored
 * body naming it (`_sha1`) and its MIME type. Used to inline a DOM snapshot's
 * external assets: a `<link href>` (or a CSS `url(...)`) resolves to a URL here,
 * whose `_sha1` names the file in the project's shared `trace-resources` pool.
 * Later snapshots win on duplicate URLs. Node-free (shared with the browser
 * demo, which reads `resources/<sha1>` straight from the ZIP). Unparseable lines
 * are skipped.
 */
export function parseResourceSnapshots(texts: string[]): Map<string, TraceResource> {
  const map = new Map<string, TraceResource>();
  for (const text of texts) {
    for (const line of text.split('\n')) {
      if (!line) continue;
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      if (!evt || evt.type !== 'resource-snapshot') continue;
      const snapshot = evt.snapshot as Record<string, unknown> | undefined;
      const request = snapshot?.request as { url?: unknown } | undefined;
      const content = (snapshot?.response as { content?: { _sha1?: unknown; mimeType?: unknown } } | undefined)
        ?.content;
      const url = request?.url;
      const sha1 = content?._sha1;
      if (typeof url === 'string' && url && typeof sha1 === 'string' && sha1) {
        map.set(url, { sha1, mimeType: typeof content?.mimeType === 'string' ? content.mimeType : undefined });
      }
    }
  }
  return map;
}

function extractFromEvents(events: Record<string, unknown>[]): ParsedTraceData {
  const actions: TraceAction[] = [];
  const consoleEntries: TraceConsoleEntry[] = [];
  const networkRequests: TraceNetworkRequest[] = [];
  const frameSnapshots: TraceFrameSnapshot[] = [];
  const contexts: TraceContextOptions[] = [];
  const errors: TraceErrorEvent[] = [];

  // Map callId → beforeSnapshot/afterSnapshot from before/after events
  const beforeSnapshots = new Map<string, string>();
  const afterSnapshots = new Map<string, string>();

  // Modern traces split each call into a `before` event (opens the action) and
  // an `after` event (closes it with endTime/error), with standalone `log`
  // events in between; legacy traces carry one self-contained `action` event.
  // Open modern actions are keyed here until their `after` arrives — an action
  // left unclosed (test killed mid-call) keeps `endTime` undefined, which is
  // exactly what the timeout fallback below looks for.
  const openActions = new Map<string, TraceAction>();

  // Largest timestamp seen across all events, in the trace's own timebase.
  let traceEndTime = 0;

  for (const evt of events) {
    const type = evt.type as string;

    // Fold in any timestamp this event carries so traceEndTime tracks the last
    // moment the trace recorded (used as an upper bound for timed-out actions).
    for (const key of ['time', 'startTime', 'endTime'] as const) {
      const ts = evt[key];
      if (typeof ts === 'number' && Number.isFinite(ts) && ts > traceEndTime) {
        traceEndTime = ts;
      }
    }

    if (type === 'before') {
      const callId = evt.callId as string;
      if (!callId) continue;
      const pointers = (evt.pointers ?? {}) as Record<string, string>;
      const beforeSnapshot = (evt.beforeSnapshot as string) || pointers.beforeSnapshot;
      if (beforeSnapshot) beforeSnapshots.set(callId, beforeSnapshot);
      const cls = evt.class as string | undefined;
      const method = evt.method as string | undefined;
      const action: TraceAction = {
        callId,
        apiName: (evt.apiName as string) || (cls && method ? `${cls}.${method}` : method || 'unknown'),
        class: cls,
        method,
        params: evt.params as Record<string, unknown> | undefined,
        startTime: (evt.startTime as number) ?? 0,
        pageId: evt.pageId as string | undefined,
        beforeSnapshot,
      };
      openActions.set(callId, action);
      actions.push(action);
    }

    if (type === 'after') {
      const callId = evt.callId as string;
      const action = callId ? openActions.get(callId) : undefined;
      if (action) {
        if (typeof evt.endTime === 'number') action.endTime = evt.endTime;
        const error = unwrapAfterError(evt.error);
        if (error) action.error = error;
        const afterSnapshot =
          (evt.afterSnapshot as string) || ((evt.pointers as Record<string, string> | undefined)?.afterSnapshot ?? '');
        if (afterSnapshot) {
          action.afterSnapshot = afterSnapshot;
          afterSnapshots.set(callId, afterSnapshot);
        }
      }
    }

    if (type === 'log') {
      const callId = evt.callId as string;
      const message = evt.message as string | undefined;
      const action = callId ? openActions.get(callId) : undefined;
      if (action && message) (action.log ??= []).push(message);
    }

    if (type === 'context-options') {
      contexts.push(evt as TraceContextOptions);
    }

    if (type === 'error' && (typeof evt.message === 'string' || Array.isArray(evt.stack))) {
      errors.push(evt as TraceErrorEvent);
    }

    if (type === 'frame-snapshot' && evt.snapshot && typeof evt.snapshot === 'object') {
      frameSnapshots.push(evt.snapshot as TraceFrameSnapshot);
    }

    // 1.63 aria / screen snapshots: one file per action per phase, keyed to the
    // action's callId (the `before` event opened the action just before). The
    // recorder emits `before`, an optional input-time `action`, and `after`; the
    // `action` and `after` phases both stand for "after the action" — `after`
    // wins because it arrives last in the stream.
    if (type === 'aria-snapshot' || type === 'screenshot') {
      const callId = evt.callId as string;
      const file = evt.file as string | undefined;
      const phase = evt.phase as string | undefined;
      const action = callId ? openActions.get(callId) : undefined;
      if (action && file) {
        if (phase === 'before') {
          if (type === 'aria-snapshot') action.ariaSnapshotBefore = file;
          else action.screenshotBefore = file;
        } else if (phase === 'action' || phase === 'after') {
          if (type === 'aria-snapshot') action.ariaSnapshotAfter = file;
          else action.screenshotAfter = file;
        }
      }
    }

    // Modern traces emit console messages as their own top-level event; older
    // ones wrap them in a generic `event` with `method: 'console'` (below).
    if (type === 'console') {
      const text =
        (evt.text as string) ??
        (Array.isArray(evt.args)
          ? (evt.args as Array<Record<string, unknown>>).map((a) => String(a?.value ?? a?.preview ?? '')).join(' ')
          : '');
      if (text) {
        consoleEntries.push({
          type: (evt.messageType as string) || 'log',
          text,
          timestamp: (evt.time as number) ?? 0,
          location: evt.location as TraceConsoleEntry['location'],
        });
      }
    }

    if (type === 'action') {
      const callId = evt.callId as string;
      if (!callId) continue;
      const pointers = (evt.pointers ?? {}) as Record<string, string>;
      const action: TraceAction = {
        callId,
        apiName: (evt.apiName as string) || (evt.method as string) || 'unknown',
        class: evt.class as string,
        method: evt.method as string,
        params: evt.params as Record<string, unknown> | undefined,
        startTime: (evt.startTime as number) ?? 0,
        endTime: evt.endTime as number | undefined,
        error: evt.error as { message?: string; stack?: string } | undefined,
        pageId: evt.pageId as string,
        log: evt.log as string[] | undefined,
        snapshotName: (pointers.snapshot as string) || pointers.afterSnapshot,
        beforeSnapshot: beforeSnapshots.get(callId) || (pointers.beforeSnapshot as string),
        afterSnapshot: pointers.afterSnapshot as string,
      };
      // A trace that carries both a `before` and an `action` for the same call
      // gets the self-contained event's defined fields folded into the open
      // action rather than a duplicate row.
      const open = openActions.get(callId);
      if (open) {
        for (const [key, value] of Object.entries(action)) {
          if (value !== undefined) (open as unknown as Record<string, unknown>)[key] = value;
        }
      } else {
        actions.push(action);
      }

      // Track after-snapshot for nearby context
      if (pointers.afterSnapshot) afterSnapshots.set(callId, pointers.afterSnapshot);
    }

    if (type === 'event') {
      const method = evt.method as string;
      const eventData = evt.event as Record<string, unknown> | undefined;
      if (!eventData) continue;
      const timestamp = (evt.time as number) ?? (evt.startTime as number) ?? 0;

      if (method === 'console') {
        const text =
          (eventData.text as string) ??
          (Array.isArray(eventData.args) ? eventData.args.map((a: unknown) => String(a ?? '')).join(' ') : '');
        if (text) {
          consoleEntries.push({
            type: (eventData.type as string) || 'log',
            text,
            timestamp,
            location: eventData.location as string | undefined,
          });
        }
      }

      if (method === '__create__' || method === '__update__') {
        const url = eventData.url as string;
        if (url) {
          const existing = networkRequests.find((nr) => nr.url === url && nr.method === (eventData.method as string));
          if (existing) {
            if (eventData.response) {
              const resp = eventData.response as Record<string, unknown>;
              existing.statusCode = (resp.status as number) ?? (resp.statusCode as number);
              existing.endTime = timestamp;
            }
          } else {
            networkRequests.push({
              url,
              method: (eventData.method as string) || 'GET',
              statusCode:
                (eventData.statusCode as number) ??
                ((eventData.response as Record<string, unknown> | undefined)?.status as number | undefined),
              headers: eventData.headers as Record<string, string> | undefined,
              startTime: timestamp,
              endTime: timestamp,
            });
          }
        }
      }
    }
  }

  // Find the failing action: error-bearing action first, then timeout fallback.
  let failingIndex = actions.findIndex((a) => a.error);
  let failingAction: TraceAction | null = failingIndex >= 0 ? actions[failingIndex]! : null;
  let timeoutFallback = false;

  // Timeout fallback: when no action has an error, the test was killed
  // mid-action. The interrupted action has no endTime and no error entry —
  // its log tail (e.g. "waiting for locator(…)") is the most diagnostic fact.
  if (!failingAction && actions.length > 0) {
    failingIndex = actions.length - 1;
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i]!.endTime == null && !actions[i]!.error) {
        failingIndex = i;
        break;
      }
    }
    failingAction = actions[failingIndex]!;
    timeoutFallback = true;
  }

  return {
    actions,
    consoleEntries,
    networkRequests,
    frameSnapshots,
    contexts,
    errors,
    failingAction,
    failingActionIndex: failingAction ? failingIndex : -1,
    eventCount: events.length,
    timeoutFallback,
    traceEndTime,
  };
}

/**
 * `after` events carry the failure either flat (`{ message, stack }`) or, in
 * some Playwright versions, nested one level (`{ error: { message, stack } }`).
 */
function unwrapAfterError(raw: unknown): { message?: string; stack?: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const outer = raw as Record<string, unknown>;
  if (typeof outer.message === 'string' || typeof outer.stack === 'string') {
    return outer as { message?: string; stack?: string };
  }
  const inner = outer.error;
  if (inner && typeof inner === 'object') {
    const e = inner as Record<string, unknown>;
    if (typeof e.message === 'string' || typeof e.stack === 'string') {
      return e as { message?: string; stack?: string };
    }
  }
  return undefined;
}
