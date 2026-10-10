import { parseZipDirectory, decompressEntry } from './trace-zip';
import { loadTraceEvidenceStreams } from './trace-evidence';
import { actionHolds, parseTraceTexts, traceFileRank, type ParsedTraceData } from './trace-events';
import { getAppSetting, setAppSetting } from './app-settings';
import type { ContextLimits } from '#shared/ai-context-limits';
import type { DbClient } from '../database';

// The event model and JSONL parsing live in the node-free `trace-events.ts`
// (shared with the browser demo, which inflates the ZIP with
// DecompressionStream instead); this module adds the node-only pieces — ZIP
// inflation, storage access and the DB-backed parse cache. No re-exports:
// Nitro auto-imports every server/utils export, and duplicates would shadow
// each other — import the shared types from `trace-events.ts` directly.

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
 * Get a cached trace-derived section text by cache key, if fresh. Keys are
 * `blobPath` for the failing-action section (kept unprefixed so existing
 * cache entries stay warm) and `<kind>:<blobPath>` for other sections.
 * Returns null when not cached or expired.
 */
export async function getCachedTraceSection(db: DbClient, cacheKey: string, ttlMs: number): Promise<string | null> {
  const cache = await readTraceCache(db);
  const entry = cache[cacheKey];
  if (!entry) return null;
  if (Date.now() - entry.parsedAt > ttlMs) return null;
  return entry.text;
}

/**
 * Cache a trace-derived section text under a cache key. One bounded pool
 * (500 entries, oldest evicted) shared by every section kind.
 */
export async function setCachedTraceSection(db: DbClient, cacheKey: string, text: string): Promise<void> {
  const cache = await readTraceCache(db);
  cache[cacheKey] = { text, parsedAt: Date.now() };
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
 * Parse trace events from a loaded slim ZIP buffer. Returns null on failure.
 *
 * A `@playwright/test` trace ZIP holds several event streams — the runner's
 * `test.trace` plus one `{n}-trace.trace` per browser context — and the DOM
 * `frame-snapshot` events live in the context files, not the runner one. Older
 * single-context traces use a lone `trace.trace`. We aggregate every `*.trace`
 * entry so snapshots (and actions) are found regardless of the layout.
 */
export async function parseTraceEvents(zipData: Buffer): Promise<ParsedTraceData | null> {
  try {
    // Only the event streams are inflated: the snapshots and screencast that make
    // up most of a trace's bytes are never read here.
    const traceMetas = parseZipDirectory(zipData)
      .filter((m) => m.name.endsWith('.trace'))
      .sort((a, b) => traceFileRank(a.name) - traceFileRank(b.name));
    const traceTexts: string[] = [];
    for (const meta of traceMetas) {
      try {
        traceTexts.push((await decompressEntry(zipData, meta)).toString('utf8'));
      } catch {
        // Unknown compression or corrupt entry — skip rather than crash
      }
    }
    if (traceTexts.length === 0) return null;

    return parseTraceTexts(traceTexts);
  } catch {
    return null;
  }
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

  if (data.timeoutFallback) {
    lines.push('- **Note**: test timed out during this action — no error struct recorded by Playwright');
  }
  lines.push(`- Action: ${action.apiName}`);
  if (action.method) lines.push(`- Method: ${action.class ?? ''}.${action.method}`);
  if (action.params?.selector) lines.push(`- Selector: \`${String(action.params.selector)}\``);
  if (action.params?.url) lines.push(`- URL: ${String(action.params.url)}`);
  if (action.params?.values) {
    const vals = action.params.values;
    if (Array.isArray(vals)) lines.push(`- Values: ${vals.map(String).join(', ')}`);
  }
  if (action.startTime) {
    const duration = action.endTime ? action.endTime - action.startTime : null;
    if (duration != null) {
      lines.push(`- Duration: ${Math.round(duration)}ms`);
    } else if (data.timeoutFallback && data.traceEndTime > action.startTime) {
      // Killed mid-action: no endTime was recorded. Use the last timestamp seen
      // in the trace (same timebase as startTime) as a lower bound on how long
      // the action had been running before the process was torn down.
      lines.push(`- Duration: ran ≥ ${Math.round(data.traceEndTime - action.startTime)}ms before the test was killed`);
    }
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

  // Nearby actions (before the failing one). An earlier errored action that
  // does not hold the failing one raised an error the test caught.
  const startIdx = Math.max(0, data.failingActionIndex - maxTraceActions);
  const nearbyActions = data.actions.slice(startIdx, data.failingActionIndex + 1);
  if (nearbyActions.length > 1) {
    lines.push('', '### Actions Leading to Failure');
    for (const a of nearbyActions) {
      const marker =
        a === data.failingAction
          ? ' ← FAILED'
          : a.error && !actionHolds(data.actions, a, action)
            ? ' (error caught, the test continued)'
            : '';
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

  // Action log entries (Playwright's verbose log for this action).
  // For timeout fallbacks the log is the primary signal — show the tail (most
  // recent entries are typically the decisive "waiting for locator(…)" lines).
  if (action.log?.length) {
    const logEntries = data.timeoutFallback ? action.log.slice(-10) : action.log.slice(0, 10);
    const shown = logEntries.map((l) => (l.length > traceDomChars ? l.slice(0, traceDomChars) + '…' : l));
    const label = data.timeoutFallback
      ? `### Action Log — tail (${action.log.length} entries total)`
      : `### Action Log (${action.log.length} entries)`;
    lines.push('', label);
    for (const l of shown) lines.push(`  ${l}`);
  }

  return lines.join('\n');
}

/**
 * Load a slim ZIP from storage by the blob path and parse the trace events,
 * sharing the load with the other views of the same trace.
 */
export async function loadAndParseTrace(blobPath: string): Promise<ParsedTraceData | null> {
  return (await loadTraceEvidenceStreams(blobPath))?.parsed ?? null;
}
