import { normalizePathPrefix } from '@piwitests/core/page-key';

/**
 * The optional connection to a Piwi instance — instance URL, API key, and
 * which project applies where. `chrome.storage.local` (same bucket as
 * `storage.ts`'s last-used copy mode): a remembered device setting, not a
 * working session, so it survives the browser restarting. Never sent
 * anywhere except in requests the user's own actions trigger (see
 * `piwi-client.ts` — the settings page and the background worker only).
 *
 * A single instance can serve more than one site, so the project isn't one
 * fixed value — it's resolved per page (see `active-project.ts`'s
 * `resolveActiveProject`) from two lists of URL patterns: `projectMappings`,
 * kept in this browser only, and `serverMappings`, the instance's own project
 * URL patterns cached at the last sync. Both use the same `**`/`*` glob syntax
 * as a catalog entry's own `urlPattern` (`@piwitests/core/function-match`'s
 * `urlMatches`), so "which pages does this apply to" means one thing
 * everywhere in this extension.
 */
interface ProjectMapping {
  urlPattern: string;
  projectId: number;
  /** Cached display label so the popup/options UI doesn't need a network round-trip just to show a name. */
  projectLabel: string;
  /** The branch deployed at these URLs, whose locator index "Tested elements" reads; absent for the project's default branch. */
  branch?: string;
  /**
   * The part of the site's path the tests never saw (`/app` when the site serves
   * `/app/checkout` and the tests ran at `/checkout`), normalized by
   * `parsePathPrefix`; absent when the site serves the pages where the tests ran them.
   */
  pathPrefix?: string;
  /**
   * The reverse: the part of the path the tests ran the pages under and the site
   * does not (`/app` when the tests ran `/app/checkout` for the site's `/checkout`).
   */
  testPathPrefix?: string;
}

/** A project URL pattern kept on the instance, as the last sync read it. */
interface ServerMapping extends ProjectMapping {
  /** A label such as `staging`; absent when the pattern names none. */
  environment?: string;
}

/** A project the connected user can see, and whether their role may add URL patterns to it. */
interface ServerProject {
  id: number;
  label: string;
  canEdit: boolean;
}

export interface ConnectionSettings {
  instanceUrl: string;
  apiKey: string;
  /** Kept in this browser only; checked in order before `serverMappings` — see `resolveActiveProject`. */
  projectMappings: ProjectMapping[];
  /** The instance's patterns, in the order it lists them, as of `serverSyncedAt`. */
  serverMappings: ServerMapping[];
  serverProjects: ServerProject[];
  /** Epoch ms of the last successful sync; 0 before the first. */
  serverSyncedAt: number;
  /** The name of the account the key belongs to; empty when the instance has authentication off. */
  connectedAs: string;
}

const CONNECTION_KEY = 'piwiConnection';

const EMPTY: ConnectionSettings = {
  instanceUrl: '',
  apiKey: '',
  projectMappings: [],
  serverMappings: [],
  serverProjects: [],
  serverSyncedAt: 0,
  connectedAs: '',
};

function coerceMapping(value: unknown): ProjectMapping | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ProjectMapping>;
  if (typeof v.urlPattern !== 'string' || !v.urlPattern.trim()) return null;
  if (typeof v.projectId !== 'number') return null;
  const branch = typeof v.branch === 'string' ? v.branch.trim() : '';
  const pathPrefix = typeof v.pathPrefix === 'string' ? normalizePathPrefix(v.pathPrefix) : null;
  const testPathPrefix = typeof v.testPathPrefix === 'string' ? normalizePathPrefix(v.testPathPrefix) : null;
  return {
    urlPattern: v.urlPattern,
    projectId: v.projectId,
    projectLabel: typeof v.projectLabel === 'string' ? v.projectLabel : `#${v.projectId}`,
    ...(branch ? { branch } : {}),
    ...(pathPrefix ? { pathPrefix } : {}),
    ...(testPathPrefix ? { testPathPrefix } : {}),
  };
}

function coerceServerMapping(value: unknown): ServerMapping | null {
  const mapping = coerceMapping(value);
  if (!mapping) return null;
  const environment = (value as { environment?: unknown }).environment;
  return typeof environment === 'string' && environment.trim()
    ? { ...mapping, environment: environment.trim() }
    : mapping;
}

function coerceServerProject(value: unknown): ServerProject | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ServerProject>;
  if (typeof v.id !== 'number') return null;
  return { id: v.id, label: typeof v.label === 'string' ? v.label : `#${v.id}`, canEdit: v.canEdit === true };
}

function coerceList<T>(value: unknown, coerce: (item: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(coerce).filter((item) => item != null) : [];
}

/** Reads stored settings of any age: a field an older version did not write comes back empty. */
export function coerceConnectionSettings(value: unknown): ConnectionSettings {
  if (!value || typeof value !== 'object') return { ...EMPTY };
  const v = value as Partial<Record<keyof ConnectionSettings, unknown>>;
  return {
    instanceUrl: typeof v.instanceUrl === 'string' ? v.instanceUrl : '',
    apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
    projectMappings: coerceList(v.projectMappings, coerceMapping),
    serverMappings: coerceList(v.serverMappings, coerceServerMapping),
    serverProjects: coerceList(v.serverProjects, coerceServerProject),
    serverSyncedAt: typeof v.serverSyncedAt === 'number' ? v.serverSyncedAt : 0,
    connectedAs: typeof v.connectedAs === 'string' ? v.connectedAs : '',
  };
}

export async function getConnectionSettings(): Promise<ConnectionSettings> {
  const stored = await chrome.storage.local.get(CONNECTION_KEY);
  return coerceConnectionSettings(stored[CONNECTION_KEY]);
}

/** What `GET /api/extension/url-patterns` answers. */
export interface ServerPatternsAnswer {
  user: { name: string } | null;
  items: Array<{
    projectId: number;
    projectName?: string;
    projectLabel: string;
    pattern: string;
    environment: string | null;
    branch: string | null;
    /** Absent from an instance older than the path prefix. */
    pathPrefix?: string | null;
    testPathPrefix?: string | null;
  }>;
  projects: ServerProject[];
}

/** `settings` with the instance's patterns, projects and account name from a sync at `now`. */
export function applyServerSync(
  settings: ConnectionSettings,
  answer: ServerPatternsAnswer,
  now: number,
): ConnectionSettings {
  return {
    ...settings,
    serverMappings: coerceList(
      answer.items.map((item) => ({
        urlPattern: item.pattern,
        projectId: item.projectId,
        projectLabel: item.projectLabel,
        branch: item.branch ?? undefined,
        pathPrefix: item.pathPrefix ?? undefined,
        testPathPrefix: item.testPathPrefix ?? undefined,
        environment: item.environment ?? undefined,
      })),
      coerceServerMapping,
    ),
    serverProjects: coerceList(answer.projects, coerceServerProject),
    serverSyncedAt: now,
    connectedAs: answer.user?.name ?? '',
  };
}

/** Every project either list maps, each once, with the label it was first seen under. */
export function mappedProjects(settings: ConnectionSettings): Array<{ projectId: number; projectLabel: string }> {
  const seen = new Map<number, string>();
  for (const m of [...settings.projectMappings, ...settings.serverMappings]) {
    if (!seen.has(m.projectId)) seen.set(m.projectId, m.projectLabel);
  }
  return [...seen].map(([projectId, projectLabel]) => ({ projectId, projectLabel }));
}

export async function setConnectionSettings(settings: ConnectionSettings): Promise<void> {
  await chrome.storage.local.set({ [CONNECTION_KEY]: settings });
}

export async function clearConnectionSettings(): Promise<void> {
  await chrome.storage.local.remove(CONNECTION_KEY);
}

/** True once there's an instance URL and at least one URL pattern, from either list — the minimum needed to fetch a catalog for any page. */
export function isConnected(settings: ConnectionSettings): boolean {
  return settings.instanceUrl.trim().length > 0 && settings.projectMappings.length + settings.serverMappings.length > 0;
}
