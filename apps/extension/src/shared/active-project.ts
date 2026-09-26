import { urlMatches } from '@piwitests/core/function-match';
import type { ConnectionSettings } from './connection-settings.js';

export interface ActiveProject {
  projectId: number;
  projectLabel: string;
  /** The branch the matching URL mapping names; absent for the project's default branch. */
  branch?: string | null;
}

const OVERRIDE_KEY = 'piwiActiveProjectOverride';

/**
 * A manual "use this project regardless of the URL-pattern mapping" choice,
 * made from the popup's active-project select. `chrome.storage.session` —
 * a for-this-browser-run choice, not a permanent setting; closing the
 * browser goes back to pure pattern matching, same reasoning as the
 * recording/pick-session state in `recording-storage.ts`/`session-storage.ts`.
 */
export async function getActiveProjectOverride(): Promise<ActiveProject | null> {
  const stored = await chrome.storage.session.get(OVERRIDE_KEY);
  const value = stored[OVERRIDE_KEY];
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ActiveProject>;
  return typeof v.projectId === 'number'
    ? { projectId: v.projectId, projectLabel: String(v.projectLabel ?? `#${v.projectId}`) }
    : null;
}

export async function setActiveProjectOverride(project: ActiveProject | null): Promise<void> {
  if (project) await chrome.storage.session.set({ [OVERRIDE_KEY]: project });
  else await chrome.storage.session.remove(OVERRIDE_KEY);
}

/**
 * Which project applies to `url` right now: a manual override wins if set;
 * otherwise the first `projectMappings` entry whose `urlPattern` matches —
 * same first-match-wins order the list is shown in — wins; `null` when
 * nothing matches (not connected, or this page isn't covered by any mapping).
 */
export function resolveActiveProject(
  settings: ConnectionSettings,
  override: ActiveProject | null,
  url: string,
): ActiveProject | null {
  if (override) return override;
  for (const mapping of settings.projectMappings) {
    if (urlMatches(mapping.urlPattern, url))
      return {
        projectId: mapping.projectId,
        projectLabel: mapping.projectLabel,
        ...(mapping.branch ? { branch: mapping.branch } : {}),
      };
  }
  return null;
}
