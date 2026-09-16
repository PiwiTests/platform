import { filterAndCapNetworkRequests } from '#shared/utils/filter-network-requests';
import { maskTokenLike } from '@piwitests/core/mask';
import type { IngestLimits } from '#shared/ingest-limits';

/**
 * URL and network data sanitization helpers.
 *
 * These are used by both submit.post.ts and upload.post.ts to strip sensitive
 * information (query parameters, fragments) from network request URLs and web
 * vitals navigation URLs before they are persisted in the database and exposed
 * through unauthenticated GET endpoints.
 */

/**
 * Strip query string and fragment from a URL, keeping only scheme + host + path.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    // Not a valid absolute URL — return as-is (relative paths, data URIs, etc.)
    return url;
  }
}

/**
 * Sanitize an array of network request objects by stripping query params,
 * filtering to API/document types, and capping to failures + top 50.
 */
export function sanitizeNetworkRequests(requests: unknown[] | null | undefined): Record<string, unknown>[] | null {
  if (!requests || !Array.isArray(requests)) return null;
  const entries = filterAndCapNetworkRequests(requests as any);
  if (entries.length === 0) return null;
  return entries.map((r) => ({
    ...r,
    url: typeof r.url === 'string' ? sanitizeUrl(r.url) : r.url,
  }));
}

/**
 * Sanitize webVitals by stripping the query string from the navigation URL.
 */
export function sanitizeWebVitals(vitals: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!vitals || typeof vitals !== 'object') return null;
  const nav = vitals.navigation as Record<string, unknown> | null | undefined;
  if (!nav) return vitals;
  return {
    ...vitals,
    navigation: {
      ...nav,
      url: typeof nav.url === 'string' ? sanitizeUrl(nav.url) : nav.url,
    },
  };
}

/**
 * Sanitize console log entries by stripping the query string from the URL part
 * of each entry's `location` (formatted as `url:line:column`).
 */
/**
 * Strip userinfo (username:password) from a Git remote URL.
 * Handles `https://token@host/repo` and `https://user:pass@host/repo` patterns.
 * Returns the sanitised URL, or the original string if parsing fails.
 */
export function sanitizeGitRemoteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) {
      parsed.username = '';
      parsed.password = '';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Sanitize run-level metadata by stripping credentials from SCM remote URLs.
 * This prevents token-leakage through public GET endpoints (§1.7).
 */
export function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const meta = { ...metadata };

  // Sanitize scm.remoteUrl
  const scm = meta.scm as Record<string, unknown> | null | undefined;
  if (scm && typeof scm.remoteUrl === 'string') {
    meta.scm = { ...scm, remoteUrl: sanitizeGitRemoteUrl(scm.remoteUrl) };
  }

  return meta;
}

/**
 * Defensive shape-validation of the reporter's page-state payload before it is
 * persisted. The reporter already never captures storage/cookie values — this
 * server-side pass enforces the same contract against arbitrary submitters:
 * only whitelisted fields survive, counts and string lengths are capped.
 */
export function sanitizePageState(state: unknown): Record<string, unknown> | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const s = state as Record<string, unknown>;

  const str = (v: unknown, cap: number): string | null => (typeof v === 'string' ? v.slice(0, cap) : null);
  const storage = (v: unknown): Array<{ key: string; length: number }> =>
    Array.isArray(v)
      ? v
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
          .slice(0, 50)
          .map((e) => ({
            key: typeof e.key === 'string' ? e.key.slice(0, 200) : '',
            length: typeof e.length === 'number' ? e.length : 0,
          }))
      : [];
  const cookies = Array.isArray(s.cookies)
    ? s.cookies
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .slice(0, 30)
        .map((c) => ({
          name: typeof c.name === 'string' ? c.name.slice(0, 200) : '',
          domain: typeof c.domain === 'string' ? c.domain.slice(0, 200) : '',
          path: typeof c.path === 'string' ? c.path.slice(0, 200) : '',
          httpOnly: Boolean(c.httpOnly),
          secure: Boolean(c.secure),
          ...(typeof c.sameSite === 'string' ? { sameSite: c.sameSite.slice(0, 20) } : {}),
          ...(typeof c.expires === 'number' ? { expires: c.expires } : {}),
        }))
    : [];

  const url = str(s.url, 2000);
  if (!url) return null;

  return {
    url: sanitizeUrl(url),
    hash: str(s.hash, 500),
    historyState: str(s.historyState, 2100),
    localStorage: storage(s.localStorage),
    sessionStorage: storage(s.sessionStorage),
    cookies,
  };
}

/** One AI-step intent mapping: the prompt a replayed locator was compiled from. */
export interface AiUsageIntent {
  template: string;
  locator: string;
  kind: 'locator' | 'run';
}

/**
 * Sanitize the AI-step usage manifest — `{ entries: string[], intents?: [...] }`,
 * the committed artifact paths a test replayed plus the natural-language intent
 * behind each compiled locator. Keeps only well-shaped values, bounded in count
 * and length against a verbose or hostile submitter. Returns null when empty.
 */
export function sanitizeAiUsage(usage: unknown): { entries: string[]; intents?: AiUsageIntent[] } | null {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const raw = (usage as Record<string, unknown>).entries;
  if (!Array.isArray(raw)) return null;
  const entries = raw
    .filter((e): e is string => typeof e === 'string')
    .slice(0, 500)
    .map((e) => e.slice(0, 400));
  if (entries.length === 0) return null;

  const rawIntents = (usage as Record<string, unknown>).intents;
  const intents = Array.isArray(rawIntents)
    ? rawIntents
        .filter(
          (i): i is Record<string, unknown> =>
            !!i &&
            typeof i === 'object' &&
            typeof (i as Record<string, unknown>).template === 'string' &&
            typeof (i as Record<string, unknown>).locator === 'string' &&
            ((i as Record<string, unknown>).kind === 'locator' || (i as Record<string, unknown>).kind === 'run'),
        )
        .slice(0, 100)
        .map(
          (i): AiUsageIntent => ({
            template: (i.template as string).slice(0, 300),
            locator: (i.locator as string).slice(0, 400),
            kind: i.kind as AiUsageIntent['kind'],
          }),
        )
    : [];

  return intents.length > 0 ? { entries, intents } : { entries };
}

export function sanitizeConsoleLogs(
  logs: Array<Record<string, unknown>> | null | undefined,
): Array<Record<string, unknown>> | null {
  if (!logs || !Array.isArray(logs)) return null;
  return logs.map((log) => {
    if (typeof log.location !== 'string') return log;
    // location is `url:line:column`; the URL itself contains colons (https://…)
    const match = log.location.match(/^(.*):(\d+):(\d+)$/);
    if (!match) return log;
    return { ...log, location: `${sanitizeUrl(match[1]!)}:${match[2]}:${match[3]}` };
  });
}

/** Max characters kept per stored dialog message / default value. */
const DIALOG_TEXT_CAP = 2000;

/**
 * Keep only the recognized fields of each recorded dialog, mask token-shaped
 * strings in the free text, and bound each string. Anything that is not an
 * array of objects becomes null.
 */
export function sanitizeDialogs(dialogs: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(dialogs)) return null;
  const out = dialogs
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .map((d) => {
      const entry: Record<string, unknown> = {};
      if (typeof d.type === 'string') entry.type = d.type.slice(0, 40);
      if (typeof d.message === 'string') entry.message = maskTokenLike(d.message).slice(0, DIALOG_TEXT_CAP);
      if (typeof d.defaultValue === 'string' && d.defaultValue)
        entry.defaultValue = maskTokenLike(d.defaultValue).slice(0, DIALOG_TEXT_CAP);
      if (typeof d.closedAt === 'number') entry.closedAt = d.closedAt;
      return entry;
    });
  return out.length > 0 ? out : null;
}

/*
 * Ingest storage caps (see `shared/ingest-limits.ts`): bound the size of the
 * per-execution payloads before they are persisted. Applied by
 * `persistRunCases` and the demo reporter mirror.
 */

/** Truncate a string to `maxChars`, appending a truncation marker when cut. */
export function capText(text: string | null | undefined, maxChars: number): string | null {
  if (typeof text !== 'string') return null;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} chars]`;
}

/**
 * Truncate error text keeping both ends — the message/assertion detail lives
 * at the head, the innermost stack frames at the tail.
 */
export function capErrorText(error: string | null | undefined, maxChars: number): string | null {
  if (typeof error !== 'string') return null;
  if (error.length <= maxChars) return error;
  const headChars = Math.floor(maxChars * 0.75);
  const tailChars = maxChars - headChars;
  const dropped = error.length - headChars - tailChars;
  return `${error.slice(0, headChars)}\n… [truncated ${dropped} chars] …\n${error.slice(error.length - tailChars)}`;
}

/** Cap an unknown-typed JSON array payload (steps, step events) to `max` entries. */
export function capArray(value: unknown, max: number): unknown {
  if (!Array.isArray(value) || value.length <= max) return value ?? null;
  return value.slice(0, max);
}

/**
 * Re-cap and re-mask a step's curated `params`: keep primitives, JSON-stringify
 * anything else, mask token-shaped strings, and bound both the key count and
 * each value's length — the server never trusts the reporter's own caps.
 */
function capStepParams(
  raw: Record<string, unknown>,
  limits: IngestLimits,
): Record<string, string | number | boolean> | null {
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= limits.stepParamKeys) break;
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      count++;
    } else if (typeof value === 'string') {
      out[key] = maskTokenLike(value).slice(0, limits.stepParamValueChars);
      count++;
    } else if (value != null) {
      try {
        out[key] = maskTokenLike(JSON.stringify(value)).slice(0, limits.stepParamValueChars);
        count++;
      } catch {
        // Non-serializable (circular) values are dropped.
      }
    }
  }
  return count > 0 ? out : null;
}

/**
 * Cap the stored steps array (count), and re-normalize each step's `subtitle`
 * and `params` against the ingest limits, masking token-shaped strings. Applied
 * on ingest so a payload that skipped the reporter is bounded all the same.
 */
export function capSteps(value: unknown, limits: IngestLimits): unknown {
  if (!Array.isArray(value)) return value ?? null;
  return value.slice(0, limits.steps).map((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
    const s = step as Record<string, unknown>;
    const out: Record<string, unknown> = { ...s };
    if (typeof s.subtitle === 'string') {
      out.subtitle = maskTokenLike(s.subtitle).slice(0, limits.stepParamValueChars);
    }
    if (s.params && typeof s.params === 'object' && !Array.isArray(s.params)) {
      const params = capStepParams(s.params as Record<string, unknown>, limits);
      if (params) out.params = params;
      else delete out.params;
    } else if ('params' in out) {
      delete out.params;
    }
    return out;
  });
}

/**
 * Cap console entries to `limits.consoleEntries`, keeping the first 20 (page
 * setup context) and the newest remainder, with a synthetic marker entry in
 * between. Every entry's text is capped to `limits.consoleEntryChars`.
 */
export function capConsoleLogs(
  logs: Array<Record<string, unknown>> | null | undefined,
  limits: IngestLimits,
): Array<Record<string, unknown>> | null {
  if (!logs || !Array.isArray(logs)) return null;
  const capEntry = (log: Record<string, unknown>): Record<string, unknown> =>
    typeof log.text === 'string' && log.text.length > limits.consoleEntryChars
      ? { ...log, text: `${log.text.slice(0, limits.consoleEntryChars)} [truncated]` }
      : log;

  if (logs.length <= limits.consoleEntries) return logs.map(capEntry);

  const headCount = Math.min(20, limits.consoleEntries - 1);
  const tailCount = limits.consoleEntries - headCount;
  const dropped = logs.length - headCount - tailCount;
  return [
    ...logs.slice(0, headCount).map(capEntry),
    { type: 'info', text: `[${dropped} console entries dropped]` },
    ...logs.slice(logs.length - tailCount).map(capEntry),
  ];
}

/**
 * Cap the source stack frames (count, per-frame snippet chars, path length).
 * Shape-validates against arbitrary submitters: non-object frames are dropped.
 */
export function capSourceFrames(frames: unknown, limits: IngestLimits): unknown {
  if (!Array.isArray(frames)) return frames ?? null;
  const capped = frames
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && !Array.isArray(f))
    .slice(0, limits.sourceFrames)
    .map((f) => ({
      ...f,
      file: typeof f.file === 'string' ? f.file.slice(0, 500) : f.file,
      snippet: typeof f.snippet === 'string' ? (capText(f.snippet, limits.sourceFrameChars) ?? '') : f.snippet,
    }));
  return capped.length > 0 ? capped : null;
}
