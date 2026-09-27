import { urlMatches } from '@piwitests/core/function-match';
import type { ConnectionSettings } from './connection-settings.js';
import { sessionArea } from './session-area.js';

/** Where the active project came from: the popup's choice, a pattern kept in this browser, or one of the instance's. */
export type ActiveProjectSource = 'override' | 'local' | 'server';

export interface ActiveProject {
  projectId: number;
  projectLabel: string;
  /** The branch the matching URL mapping names; absent for the project's default branch. */
  branch?: string | null;
  /** The environment the matching server pattern names, if any. */
  environment?: string;
  source?: ActiveProjectSource;
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
  const stored = await sessionArea().get(OVERRIDE_KEY);
  const value = stored[OVERRIDE_KEY];
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ActiveProject>;
  return typeof v.projectId === 'number'
    ? { projectId: v.projectId, projectLabel: String(v.projectLabel ?? `#${v.projectId}`) }
    : null;
}

export async function setActiveProjectOverride(project: ActiveProject | null): Promise<void> {
  if (project) await sessionArea().set({ [OVERRIDE_KEY]: project });
  else await sessionArea().remove(OVERRIDE_KEY);
}

/**
 * Which project applies to `url` right now, in this order: the popup's manual
 * override; then the first pattern kept in this browser (`projectMappings`)
 * that matches, so a local pattern overrides the instance's for this browser;
 * then the first of the instance's own patterns (`serverMappings`, in the order
 * it lists them). `null` when nothing matches (not connected, or this page
 * isn't covered by any pattern).
 */
export function resolveActiveProject(
  settings: ConnectionSettings,
  override: ActiveProject | null,
  url: string,
): ActiveProject | null {
  if (override) return { ...override, source: 'override' };
  for (const mapping of settings.projectMappings) {
    if (urlMatches(mapping.urlPattern, url))
      return {
        projectId: mapping.projectId,
        projectLabel: mapping.projectLabel,
        ...(mapping.branch ? { branch: mapping.branch } : {}),
        source: 'local',
      };
  }
  for (const mapping of settings.serverMappings) {
    if (urlMatches(mapping.urlPattern, url))
      return {
        projectId: mapping.projectId,
        projectLabel: mapping.projectLabel,
        ...(mapping.branch ? { branch: mapping.branch } : {}),
        ...(mapping.environment ? { environment: mapping.environment } : {}),
        source: 'server',
      };
  }
  return null;
}
