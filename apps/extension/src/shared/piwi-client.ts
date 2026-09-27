import type { TestFunctionEntry } from '@piwitests/core/function-match';
import type { LocatorIndex } from '@piwitests/core/locator-index';
import type { ConnectionSettings, ServerPatternsAnswer } from './connection-settings';
import type { ClientInfo } from './client-info.js';
import type { ConnectPoll } from './connect-flow.js';
import { t } from './i18n.js';

/**
 * Talks to a Piwi instance — the only place in this extension that makes a
 * network call. Called from the options page (connecting, saving, reading and
 * adding URL patterns) and the background service worker (`piwi-refresh-catalog`, `piwi-refresh-locator-index`,
 * and the bug-report messages: `piwi-send-bug-report` once the reporter has
 * confirmed the preview, `piwi-list-bug-reports`, `piwi-get-bug-report`) only,
 * never from a content script, so the API key is never reachable from a web
 * page's JS context (matches `extension/AGENTS.md`'s standalone stance:
 * connected mode is opt-in and clearly separated).
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

/**
 * Deep link to a project's Locators page, with locators to check prefilled one
 * per line, on `branch` (null for the default branch, `*` for every branch).
 */
export function projectLocatorsUrl(
  instanceUrl: string,
  projectId: number,
  locators: string[] = [],
  branch: string | null = null,
  page: string | null = null,
): string {
  const base = `${normalizeBaseUrl(instanceUrl)}/projects/${projectId}/locators`;
  const query = [
    ...(locators.length ? [`q=${encodeURIComponent(locators.join('\n'))}`] : []),
    ...(branch ? [`branch=${encodeURIComponent(branch)}`] : []),
    ...(page ? [`page=${encodeURIComponent(page)}`] : []),
  ];
  return query.length ? `${base}?${query.join('&')}` : base;
}

/** Deep link to a test case's page in the dashboard. */
export function testCaseUrl(instanceUrl: string, testCaseId: number): string {
  return `${normalizeBaseUrl(instanceUrl)}/test-cases/${testCaseId}`;
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
  if (!settings.instanceUrl.trim()) return { ok: false, error: t('common_enterInstanceUrl') };
  try {
    const res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/projects/menu`, {
      headers: authHeaders(settings),
      signal: timeout(),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: t('common_apiKeyRejected') };
    if (!res.ok) return { ok: false, error: t('common_instanceStatus', { status: res.status }) };
    return { ok: true };
  } catch {
    return { ok: false, error: t('common_instanceUnreachable') };
  }
}

export async function fetchProjects(settings: ConnectionSettings): Promise<ProjectOption[]> {
  if (!settings.instanceUrl.trim()) return [];
  const res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/projects/menu`, {
    headers: authHeaders(settings),
    signal: timeout(),
  });
  if (!res.ok) throw new Error(t('common_projectsFailed', { status: res.status }));
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
  if (!res.ok) throw new Error(t('common_catalogFailed', { status: res.status }));
  const body = (await res.json()) as { testFunctions?: unknown };
  const rows = listItems<{ entry: TestFunctionEntry }>(Array.isArray(body.testFunctions) ? body.testFunctions : body);
  return rows.map((row) => row.entry).filter(Boolean);
}

/**
 * How long the locator index may take: it carries every chain a project's
 * tests used, so it is larger than the other responses. Still bounded — the
 * caller has already rendered whatever was cached.
 */
const LOCATOR_INDEX_TIMEOUT_MS = 30_000;

/**
 * One project's locator index: every chain its tests used, with the tests that
 * use it, as seen on `branch` (null for the default branch, `*` for every
 * branch). An instance older than branch support answers one index mixing
 * every branch, read as such.
 */
export async function fetchLocatorIndex(
  settings: ConnectionSettings,
  projectId: number,
  branch: string | null = null,
): Promise<LocatorIndex> {
  if (!settings.instanceUrl.trim()) throw new Error(t('common_notConnected'));
  const query = branch ? `?branch=${encodeURIComponent(branch)}` : '';
  const res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/projects/${projectId}/locator-index${query}`, {
    headers: authHeaders(settings),
    signal: AbortSignal.timeout(LOCATOR_INDEX_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new Error(t('common_projectKeyRejected'));
  if (res.status === 404) throw new Error(t('common_noLocatorIndex'));
  if (!res.ok) throw new Error(t('common_locatorIndexStatus', { status: res.status }));
  const body = (await res.json()) as LocatorIndex;
  if (!body || !Array.isArray(body.locators) || !Array.isArray(body.tests)) {
    throw new Error(t('common_locatorIndexInvalid'));
  }
  const defaultBranch = typeof body.defaultBranch === 'string' ? body.defaultBranch : '';
  return {
    ...body,
    branch: typeof body.branch === 'string' ? body.branch : null,
    defaultBranch,
    branches: Array.isArray(body.branches) ? body.branches : [],
    locators: body.locators.map((entry) => ({
      ...entry,
      uses: entry.uses.map((use) => ({ ...use, branches: Array.isArray(use.branches) ? use.branches : [] })),
    })),
  };
}

/** What `POST /api/extension/connect` answers: the codes of a new connect request. */
export interface ConnectStart {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresIn: number;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: timeout(),
  });
}

/**
 * Starts connecting: the instance answers the code to show and the page where
 * the user allows it. Throws a message to show when it cannot.
 */
export async function startConnect(instanceUrl: string, client: ClientInfo): Promise<ConnectStart> {
  if (!instanceUrl.trim()) throw new Error(t('common_enterInstanceUrl'));
  let res: Response;
  try {
    res = await postJson(`${normalizeBaseUrl(instanceUrl)}/api/extension/connect`, client);
  } catch {
    throw new Error(t('common_instanceUnreachable'));
  }
  if (res.status === 404 || res.status === 405) throw new Error(t('options_connectUnsupported'));
  if (res.status === 429) throw new Error(t('options_connectTooMany'));
  if (!res.ok) throw new Error(t('common_instanceStatus', { status: res.status }));
  const body = (await res.json()) as Partial<ConnectStart>;
  if (
    typeof body.deviceCode !== 'string' ||
    typeof body.userCode !== 'string' ||
    typeof body.verificationUrl !== 'string' ||
    !/^https?:\/\//i.test(body.verificationUrl)
  ) {
    throw new Error(t('options_connectUnsupported'));
  }
  return {
    deviceCode: body.deviceCode,
    userCode: body.userCode,
    verificationUrl: body.verificationUrl,
    interval: typeof body.interval === 'number' && body.interval > 0 ? body.interval : 5,
    expiresIn: typeof body.expiresIn === 'number' && body.expiresIn > 0 ? body.expiresIn : 600,
  };
}

/** One poll of a connect request. Throws on a network error or an unexpected answer, which the caller retries. */
export async function pollConnect(instanceUrl: string, deviceCode: string): Promise<ConnectPoll> {
  const res = await postJson(`${normalizeBaseUrl(instanceUrl)}/api/extension/connect/token`, { deviceCode });
  if (res.status === 429) return { status: 'slow_down', interval: 30 };
  if (!res.ok) throw new Error(t('common_instanceStatus', { status: res.status }));
  const body = (await res.json()) as { status?: unknown; interval?: unknown; apiKey?: unknown; user?: unknown };
  switch (body.status) {
    case 'pending':
    case 'denied':
    case 'expired':
      return { status: body.status };
    case 'slow_down':
      return { status: 'slow_down', interval: typeof body.interval === 'number' ? body.interval : 10 };
    case 'approved': {
      const name = (body.user as { name?: unknown } | null)?.name;
      return {
        status: 'approved',
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : '',
        user: typeof name === 'string' ? { name } : null,
      };
    }
    default:
      throw new Error(t('options_connectUnsupported'));
  }
}

/** Every URL pattern of the projects the key's user can see, with those projects and the user's name. */
export async function fetchServerPatterns(settings: ConnectionSettings): Promise<ServerPatternsAnswer> {
  if (!settings.instanceUrl.trim()) throw new Error(t('common_enterInstanceUrl'));
  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/extension/url-patterns`, {
      headers: authHeaders(settings),
      signal: timeout(),
    });
  } catch {
    throw new Error(t('common_instanceUnreachable'));
  }
  if (res.status === 401 || res.status === 403) throw new Error(t('common_apiKeyRejected'));
  if (res.status === 404) throw new Error(t('options_serverUnsupported'));
  if (!res.ok) throw new Error(t('common_instanceStatus', { status: res.status }));
  const body = (await res.json()) as Partial<ServerPatternsAnswer>;
  return {
    user: body.user && typeof body.user.name === 'string' ? { name: body.user.name } : null,
    items: Array.isArray(body.items) ? body.items : [],
    projects: Array.isArray(body.projects) ? body.projects : [],
  };
}

/** Adds a URL pattern to a project on the instance. Throws a message to show when it cannot. */
export async function addServerPattern(
  settings: ConnectionSettings,
  projectId: number,
  input: { pattern: string; environment?: string | null; branch?: string | null },
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/projects/${projectId}/url-patterns`, {
      method: 'POST',
      headers: { ...authHeaders(settings), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: timeout(),
    });
  } catch {
    throw new Error(t('common_instanceUnreachable'));
  }
  if (res.ok) return;
  if (res.status === 401) throw new Error(t('common_apiKeyRejected'));
  if (res.status === 403) throw new Error(t('options_addForbidden'));
  if (res.status === 409) throw new Error(t('options_addDuplicate'));
  if (res.status === 400) throw new Error(t('options_addInvalid'));
  throw new Error(t('common_instanceStatus', { status: res.status }));
}

/** Deep link to a bug report's page in the dashboard. */
export function bugReportUrl(instanceUrl: string, id: number): string {
  return `${normalizeBaseUrl(instanceUrl)}/bug-reports/${id}`;
}

/** What Send to Piwi sends: the report as JSON, the language it is written in, and its PNG screenshots. */
export interface BugReportSend {
  report: unknown;
  language: string | null;
  screenshots: Array<{ name: string; bytes: Uint8Array }>;
}

/** The multipart parts of a bug report, as the instance reads them. */
const BUG_REPORT_PARTS = { report: 'report', language: 'language', screenshot: 'screenshot' } as const;

/** Why the instance answered a request the way it did, as a sentence to show. */
async function refusal(res: Response): Promise<string> {
  if (res.status === 401) return t('common_apiKeyRejected');
  if (res.status === 403) return t('common_sendForbidden');
  if (res.status === 404) return t('common_bugReportsUnsupported');
  if (res.status === 413) return t('common_sendTooLarge');
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === 'string' ? body.message.slice(0, 300) : String(res.status);
    return t('common_sendRefused', { error: message });
  }
  return t('common_instanceStatus', { status: res.status });
}

/**
 * Sends a bug report to a project (`POST /api/projects/:id/bug-reports`, multipart).
 * Only the background worker calls it, after the reporter confirmed the preview.
 */
export async function sendBugReport(
  settings: ConnectionSettings,
  projectId: number,
  send: BugReportSend,
): Promise<{ id: number; url: string }> {
  const form = new FormData();
  form.append(BUG_REPORT_PARTS.report, JSON.stringify(send.report));
  if (send.language) form.append(BUG_REPORT_PARTS.language, send.language);
  for (const shot of send.screenshots) {
    form.append(BUG_REPORT_PARTS.screenshot, new Blob([shot.bytes as BlobPart], { type: 'image/png' }), shot.name);
  }
  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/projects/${projectId}/bug-reports`, {
      method: 'POST',
      headers: authHeaders(settings),
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error(t('common_instanceUnreachable'));
  }
  if (!res.ok) throw new Error(await refusal(res));
  const body = (await res.json()) as { id?: unknown };
  if (typeof body.id !== 'number') throw new Error(t('common_instanceStatus', { status: res.status }));
  return { id: body.id, url: bugReportUrl(settings.instanceUrl, body.id) };
}

/** One of a project's bug reports, as Replay lists them. */
export interface BugReportSummary {
  id: number;
  title: string;
  status: string;
  path: string | null;
}

/** A project's bug reports that are still to be fixed: open, test committed, or looking fixed. */
export async function fetchBugReports(settings: ConnectionSettings, projectId: number): Promise<BugReportSummary[]> {
  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/projects/${projectId}/bug-reports`, {
      headers: authHeaders(settings),
      signal: timeout(),
    });
  } catch {
    throw new Error(t('common_instanceUnreachable'));
  }
  if (!res.ok) throw new Error(await refusal(res));
  return listItems<BugReportSummary>(await res.json()).filter(
    (r) => typeof r.id === 'number' && r.status !== 'closed' && r.status !== 'dismissed',
  );
}

/** A bug report's steps document, with the report's title, for Replay. */
export async function fetchBugReportSteps(settings: ConnectionSettings, id: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/bug-reports/${id}`, {
      headers: authHeaders(settings),
      signal: timeout(),
    });
  } catch {
    throw new Error(t('common_instanceUnreachable'));
  }
  if (!res.ok) throw new Error(await refusal(res));
  const body = (await res.json()) as { title?: unknown; steps?: unknown };
  return { ...(body.steps as object), title: typeof body.title === 'string' ? body.title : null };
}
