import type { ActiveProject } from './active-project.js';

/**
 * Which branch's locator index "Tested elements" reads for a project: the
 * branch chosen in its panel for this browser session, else the branch the
 * URL mapping names (the one deployed at those URLs), else the project's
 * default branch. `*` asks for every branch together.
 */
const OVERRIDE_KEY = 'piwiLocatorBranchOverride';

/** The panel's choice for a project: a branch, `*`, or `''` for the default branch; undefined when none was made. */
export async function getLocatorBranchOverride(projectId: number): Promise<string | undefined> {
  const stored = await chrome.storage.session.get(OVERRIDE_KEY);
  const value = (stored[OVERRIDE_KEY] as Record<string, unknown> | undefined)?.[String(projectId)];
  return typeof value === 'string' ? value : undefined;
}

export async function setLocatorBranchOverride(projectId: number, branch: string | undefined): Promise<void> {
  const stored = await chrome.storage.session.get(OVERRIDE_KEY);
  const all = { ...(stored[OVERRIDE_KEY] as Record<string, string> | undefined) };
  if (branch === undefined) delete all[String(projectId)];
  else all[String(projectId)] = branch;
  await chrome.storage.session.set({ [OVERRIDE_KEY]: all });
}

/** The branch to read; null for the project's default branch. */
export function resolveLocatorBranch(project: ActiveProject, override: string | undefined): string | null {
  if (override !== undefined) return override.trim() || null;
  return project.branch?.trim() || null;
}
