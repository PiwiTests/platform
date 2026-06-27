import { parseZip } from './trace-zip';
import { getStorage } from '../storage';
import { getAppSetting, setAppSetting } from './app-settings';
import type { ContextLimits } from '#shared/ai-context-limits';

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

const TRACE_CACHE_SETTING_KEY = 'trace_parse_cache';

interface TraceCacheEntry {
  text: string;
  parsedAt: number;
}

async function readTraceCache(db: DbClient): Promise<Record<string, TraceCacheEntry>> {
  try {
    const cached = await getAppSetting<Record<string, TraceCacheEntry>>(db, TRACE_CACHE_SETTING_KEY);
    return cached ?? {};
  } catch {
    return {};
  }
}

async function writeTraceCache(db: DbClient, cache: Record<string, TraceCacheEntry>): Promise<void> {
  try {
    await setAppSetting(db, TRACE_CACHE_SETTING_KEY, cache);
  } catch {
    // Cache write failure is non-critical
  }
}

/**
 * Get the cached failing-action section text for a blob path, if fresh.
 * Returns null when not cached or expired.
 */
async function getCachedTraceSection(db: DbClient, blobPath: string, ttlMs: number): Promise<string | null> {
  const cache = await readTraceCache(db);
  const entry = cache[blobPath];
  if (!entry) return null;
  if (Date.now() - entry.parsedAt > ttlMs) return null;
  return entry.text;
}

/**
 * Cache a parsed failing-action section for a blob path.
 */
async function setCachedTraceSection(db: DbClient, blobPath: string, text: string): Promise<void> {
  const cache = await readTraceCache(db);
  cache[blobPath] = { text, parsedAt: Date.now() };
  // Keep cache bounded to 500 entries
  const keys = Object.keys(cache);
  if (keys.length > 500) {
    const sorted = keys.sort((a, b) => (cache[a]?.parsedAt ?? 0) - (cache[b]?.parsedAt ?? 0));
    for (const oldKey of sorted.slice(0, sorted.length - 500)) delete cache[oldKey];
  }
  await writeTraceCache(db, cache);
}

/**
 * Parse a trace for the failing action context, using the DB cache.
 * Returns the formatted section text, or null if parsing fails or trace is empty.
 */
export async function getTraceFailingActionSection(
  db: DbClient,
  blobPath: string,
  limits: ContextLimits,
): Promise<string | null> {
  if (limits.maxTraceActions <= 0) return null;

  // Check cache first (1 hour TTL)
  const cached = await getCachedTraceSection(db, blobPath, 3_600_000);
  if (cached) return cached;

  const data = await loadAndParseTrace(blobPath);
  if (!data) return null;

  const text = formatFailingActionSection(data, limits.maxTraceActions, limits.traceDomChars);
  if (!text) return null;

  // Cache asynchronously (don't block on write)
  setCachedTraceSection(db, blobPath, text).catch(() => {});
  return text;
}

/**
 * Minimal trace event types extracted from a Playwright trace ZIP.
 * We only parse what is useful for the diagnosis context.
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
}

export interface TraceConsoleEntry {
  type: string;
  text: string;
  timestamp: number;
  location?: string;
}

export interface TraceNetworkRequest {
  url: string;
  method: string;
  statusCode?: number;
  headers?: Record<string, string>;
  startTime: number;
  endTime?: number;
}

export interface ParsedTraceData {
  actions: TraceAction[];
  consoleEntries: TraceConsoleEntry[];
  networkRequests: TraceNetworkRequest[];
  /** The action that had an error, if any. */
  failingAction: TraceAction | null;
  /** Failing action index in `actions` array for nearby context. */
  failingActionIndex: number;
  /** All parsed events (raw), for building the summary. */
  eventCount: number;
}

/** Parse trace events from a loaded slim ZIP buffer. Returns null on failure. */
export async function parseTraceEvents(zipData: Buffer): Promise<ParsedTraceData | null> {
  try {
    const entries = await parseZip(zipData);
    const traceEntry = entries.find((e) => e.name === 'trace.trace');
    if (!traceEntry) return null;

    const lines = traceEntry.data.toString('utf8').split('\n').filter(Boolean);
    const events = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Record<string, unknown>[];

    return extractFromEvents(events);
  } catch {
    return null;
  }
}

function extractFromEvents(events: Record<string, unknown>[]): ParsedTraceData {
  const actions: TraceAction[] = [];
  const consoleEntries: TraceConsoleEntry[] = [];
  const networkRequests: TraceNetworkRequest[] = [];

  // Map callId → beforeSnapshot/afterSnapshot from before/after events
  const beforeSnapshots = new Map<string, string>();
  const afterSnapshots = new Map<string, string>();

  for (const evt of events) {
    const type = evt.type as string;

    if (type === 'before') {
      const callId = evt.callId as string;
      if (callId && evt.pointers) {
        const pointers = evt.pointers as Record<string, string>;
        if (pointers.beforeSnapshot) beforeSnapshots.set(callId, pointers.beforeSnapshot);
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
      actions.push(action);

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

  // Find the failing action
  const failingIndex = actions.findIndex((a) => a.error);
  const failingAction = failingIndex >= 0 ? actions[failingIndex]! : null;

  return {
    actions,
    consoleEntries,
    networkRequests,
    failingAction,
    failingActionIndex: failingIndex >= 0 ? failingIndex : -1,
    eventCount: events.length,
  };
}

/**
 * Build a human-readable failing-action section from parsed trace data.
 */
export function formatFailingActionSection(
  data: ParsedTraceData,
  maxTraceActions: number,
  traceDomChars: number,
): string | null {
  if (!data.failingAction) return null;

  const lines: string[] = ['## Failing Action (from Trace)'];
  const action = data.failingAction;

  lines.push(`- Action: ${action.apiName}`);
  if (action.method) lines.push(`- Method: ${action.class ?? ''}.${action.method}`);
  if (action.params?.selector) lines.push(`- Selector: \`${String(action.params.selector)}\``);
  if (action.params?.url) lines.push(`- URL: ${String(action.params.url)}`);
  if (action.params?.values) {
    const vals = action.params.values;
    if (Array.isArray(vals)) lines.push(`- Values: ${vals.map(String).join(', ')}`);
  }
  if (action.startTime) {
    const duration = action.endTime ? action.endTime - action.startTime : 0;
    lines.push(`- Duration: ${Math.round(duration)}ms`);
  }
  if (action.error) {
    lines.push(`- Error: ${(action.error.message ?? '').slice(0, 500)}`);
    if (action.error.stack) {
      const stackLines = action.error.stack
        .split('\n')
        .slice(0, 5)
        .map((l) => `  ${l}`);
      lines.push('- Stack (top frames):', ...stackLines);
    }
  }

  // Nearby actions (before the failing one)
  const startIdx = Math.max(0, data.failingActionIndex - maxTraceActions);
  const nearbyActions = data.actions.slice(startIdx, data.failingActionIndex + 1);
  if (nearbyActions.length > 1) {
    lines.push('', '### Actions Leading to Failure');
    for (const a of nearbyActions) {
      const marker = a === data.failingAction ? ' ← FAILED' : '';
      lines.push(`- ${a.apiName}${marker}`);
    }
  }

  // Console entries near the failure (within the time window of the failing action)
  if (data.consoleEntries.length > 0 && action.startTime) {
    const windowStart = action.startTime - 2000;
    const windowEnd = (action.endTime ?? action.startTime) + 1000;
    const nearby = data.consoleEntries
      .filter((c) => c.timestamp >= windowStart && c.timestamp <= windowEnd)
      .slice(0, 10);

    if (nearby.length > 0) {
      lines.push('', '### Console Around Failure');
      for (const c of nearby) {
        const text = c.text.length > 200 ? c.text.slice(0, 200) + '…' : c.text;
        lines.push(`- [${c.type}] ${text}`);
      }
    }
  }

  // Network requests near the failure
  if (data.networkRequests.length > 0 && action.startTime) {
    const windowStart = action.startTime - 5000;
    const windowEnd = (action.endTime ?? action.startTime) + 2000;
    const nearby = data.networkRequests
      .filter((nr) => nr.startTime >= windowStart && nr.startTime <= windowEnd)
      .slice(0, 8);

    if (nearby.length > 0) {
      lines.push('', '### Network Requests Around Failure');
      for (const nr of nearby) {
        const status = nr.statusCode ? ` → ${nr.statusCode}` : '';
        const dur = nr.endTime ? ` (${Math.round(nr.endTime - nr.startTime)}ms)` : '';
        lines.push(`- ${nr.method} ${nr.url}${status}${dur}`);
      }
    }
  }

  // Action log entries (Playwright's verbose log for this action)
  if (action.log?.length) {
    const shown = action.log.slice(0, 10).map((l) => (l.length > traceDomChars ? l.slice(0, traceDomChars) + '…' : l));
    lines.push('', `### Action Log (${action.log.length} entries)`);
    for (const l of shown) lines.push(`  ${l}`);
  }

  return lines.join('\n');
}

/**
 * Load a slim ZIP from storage by the blob path and parse the trace events.
 * Caching is the caller's responsibility.
 */
export async function loadAndParseTrace(blobPath: string): Promise<ParsedTraceData | null> {
  try {
    const storage = getStorage();
    const data = await storage.readFile(blobPath);
    return parseTraceEvents(data);
  } catch {
    return null;
  }
}
