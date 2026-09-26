/**
 * The optional connection to a Piwi instance — instance URL, API key, and
 * which project applies where. `chrome.storage.local` (same bucket as
 * `storage.ts`'s last-used copy mode): a remembered device setting, not a
 * working session, so it survives the browser restarting. Never sent
 * anywhere except in requests the user's own actions trigger (see
 * `piwi-client.ts` — everything happens from the options page).
 *
 * A single instance can serve more than one site, so the project isn't one
 * fixed value — it's resolved per page from `projectMappings` (see
 * `active-project.ts`'s `resolveActiveProject`), the same `**`/`*` glob
 * syntax as a catalog entry's own `urlPattern` (`@piwitests/core/function-match`'s
 * `urlMatches`), so "which pages does this apply to" means one thing
 * everywhere in this extension.
 */
export interface ProjectMapping {
  urlPattern: string;
  projectId: number;
  /** Cached display label so the popup/options UI doesn't need a network round-trip just to show a name. */
  projectLabel: string;
  /** The branch deployed at these URLs, whose locator index "Tested elements" reads; absent for the project's default branch. */
  branch?: string;
}

export interface ConnectionSettings {
  instanceUrl: string;
  apiKey: string;
  /** Checked in order; the first matching pattern wins — see `resolveActiveProject`. */
  projectMappings: ProjectMapping[];
}

const CONNECTION_KEY = 'piwiConnection';

const EMPTY: ConnectionSettings = { instanceUrl: '', apiKey: '', projectMappings: [] };

function coerceMapping(value: unknown): ProjectMapping | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ProjectMapping>;
  if (typeof v.urlPattern !== 'string' || !v.urlPattern.trim()) return null;
  if (typeof v.projectId !== 'number') return null;
  const branch = typeof v.branch === 'string' ? v.branch.trim() : '';
  return {
    urlPattern: v.urlPattern,
    projectId: v.projectId,
    projectLabel: typeof v.projectLabel === 'string' ? v.projectLabel : `#${v.projectId}`,
    ...(branch ? { branch } : {}),
  };
}

export async function getConnectionSettings(): Promise<ConnectionSettings> {
  const stored = await chrome.storage.local.get(CONNECTION_KEY);
  const value = stored[CONNECTION_KEY];
  if (!value || typeof value !== 'object') return { ...EMPTY };
  const v = value as Partial<ConnectionSettings>;
  return {
    instanceUrl: typeof v.instanceUrl === 'string' ? v.instanceUrl : '',
    apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
    projectMappings: Array.isArray(v.projectMappings)
      ? v.projectMappings.map(coerceMapping).filter((m) => m != null)
      : [],
  };
}

export async function setConnectionSettings(settings: ConnectionSettings): Promise<void> {
  await chrome.storage.local.set({ [CONNECTION_KEY]: settings });
}

export async function clearConnectionSettings(): Promise<void> {
  await chrome.storage.local.remove(CONNECTION_KEY);
}

/** True once there's an instance URL and at least one URL-pattern → project mapping — the minimum needed to fetch a catalog for any page. */
export function isConnected(settings: ConnectionSettings): boolean {
  return settings.instanceUrl.trim().length > 0 && settings.projectMappings.length > 0;
}
