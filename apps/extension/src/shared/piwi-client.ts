import type { TestFunctionEntry } from '@piwitests/core/function-match';
import type { ConnectionSettings } from './connection-settings';

/**
 * Talks to a Piwi instance — the only place in this extension that makes a
 * network call. Called from the options page (on save) and the background
 * service worker (`piwi-refresh-catalog`) only, never from a content script,
 * so the API key is never reachable from a web page's JS context (matches
 * `extension/AGENTS.md`'s standalone stance: connected mode is opt-in and
 * clearly separated).
 *
 * These requests need a host permission for the instance's origin: the
 * dashboard API sends no CORS headers, and `X-API-Key` makes them non-simple
 * so the browser preflights them. The options page requests that permission
 * inside its own click handler — the worker has no user gesture to do so.
 */

export interface ProjectOption {
  id: number;
  name: string;
  label: string | null;
}

/** Exported so anything building a link into the dashboard (not just this client's own fetches) normalizes the same way — e.g. `projectCatalogUrl` below. */
export function normalizeBaseUrl(instanceUrl: string): string {
  return instanceUrl.trim().replace(/\/+$/, '');
}

/** Deep link to a project's "Test functions" catalog page in the dashboard — used by `test-function-panel.ts`'s "Manage catalog" link. */
export function projectCatalogUrl(instanceUrl: string, projectId: number): string {
  return `${normalizeBaseUrl(instanceUrl)}/projects/${projectId}/test-functions`;
}

/** The list a dashboard list endpoint answers: `{ items }`, or a bare array. */
function listItems<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  const items = (body as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

function authHeaders(settings: ConnectionSettings): HeadersInit {
  return settings.apiKey.trim() ? { 'X-API-Key': settings.apiKey.trim() } : {};
}

/**
 * How long to wait on an instance before giving up.
 *
 * Every call here is either something the user is watching (the options page's
 * Test connection / Save) or a background revalidation whose caller has already
 * rendered from cache. Neither has anything to gain from waiting indefinitely,
 * and an unresponsive host — a stale URL, a VPN-only address, a hung server —
 * used to leave the options page's status stuck on "Testing…" with no way
 * forward but a reload.
 */
const REQUEST_TIMEOUT_MS = 10_000;

function timeout(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

export type ConnectionCheckResult = { ok: true } | { ok: false; error: string };

/** Hits `/api/projects/menu` — cheap, always available, and exercises auth the same way the rest of the client does. */
export async function testConnection(settings: ConnectionSettings): Promise<ConnectionCheckResult> {
  if (!settings.instanceUrl.trim()) return { ok: false, error: 'Enter an instance URL first.' };
  try {
    const res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/projects/menu`, {
      headers: authHeaders(settings),
      signal: timeout(),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Rejected — check the API key.' };
    if (!res.ok) return { ok: false, error: `Instance responded with ${res.status}.` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach that instance — check the URL and that it's running." };
  }
}

export async function fetchProjects(settings: ConnectionSettings): Promise<ProjectOption[]> {
  if (!settings.instanceUrl.trim()) return [];
  const res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/projects/menu`, {
    headers: authHeaders(settings),
    signal: timeout(),
  });
  if (!res.ok) throw new Error(`Failed to list projects (${res.status})`);
  return listItems<ProjectOption>(await res.json());
}

/**
 * One project's function catalog, ready to hand to
 * `rankFunctionMatches`/`matchFunctionAt`/`renderSpec`. Takes `projectId`
 * explicitly rather than reading it off `settings` — a connection now maps
 * many projects (`ConnectionSettings.projectMappings`), so the caller (the
 * options page, once per distinct mapped project) decides which one.
 */
export async function fetchCatalog(settings: ConnectionSettings, projectId: number): Promise<TestFunctionEntry[]> {
  if (!settings.instanceUrl.trim()) return [];
  const res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/projects/${projectId}/test-functions`, {
    headers: authHeaders(settings),
    signal: timeout(),
  });
  if (!res.ok) throw new Error(`Failed to fetch the function catalog (${res.status})`);
  const body = (await res.json()) as { testFunctions?: unknown };
  const rows = listItems<{ entry: TestFunctionEntry }>(Array.isArray(body.testFunctions) ? body.testFunctions : body);
  return rows.map((row) => row.entry).filter(Boolean);
}
