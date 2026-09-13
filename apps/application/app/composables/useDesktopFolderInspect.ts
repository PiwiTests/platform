/**
 * Read-only inspection of a folder on this machine (desktop shell only): the
 * Piwi project name it would report under and whether Playwright and the
 * `@piwitests/reporter` package are set up. Backs "new project from a folder"
 * and the setup status shown next to a project's linked folder. Every helper
 * feature-detects the IPC bridge and resolves `null` in a plain browser.
 */

export interface DesktopFolderInspection {
  path: string;
  exists: boolean;
  packageName: string | null;
  /** Name the folder would report under: config `projectName` → package name → folder name. */
  suggestedName: string | null;
  /** File name of the Playwright config found at the folder root. */
  playwrightConfig: string | null;
  playwrightInstalled: boolean;
  reporterInstalled: boolean;
  /** The Playwright config references `@piwitests/reporter`. */
  reporterConfigured: boolean;
  /** `projectName` parsed out of the Playwright config, when set as a literal. */
  configuredProjectName: string | null;
  /** The Playwright config declares a `webServer` — Playwright starts the app itself. */
  webServer: boolean;
}

/** Open the native folder picker. `null` on cancel or without the bridge. */
export async function pickDesktopFolder(): Promise<string | null> {
  const core = tauriCore();
  if (!core) return null;
  return await core.invoke<string | null>('desktop_pick_folder');
}

/** Inspect an absolute folder path; `null` without the bridge or on failure. */
export async function inspectDesktopFolder(path: string): Promise<DesktopFolderInspection | null> {
  const core = tauriCore();
  if (!core || !path) return null;
  try {
    return await core.invoke<DesktopFolderInspection>('desktop_inspect_folder', { path });
  } catch {
    return null;
  }
}

/** A folder is ready when Playwright and the reporter are installed and wired up. */
export function isFolderPiwiReady(inspection: DesktopFolderInspection | null): boolean {
  return (
    !!inspection &&
    inspection.exists &&
    inspection.playwrightConfig != null &&
    inspection.playwrightInstalled &&
    inspection.reporterInstalled &&
    inspection.reporterConfigured
  );
}

/** One importable Playwright archive found on disk: a blob report or a trace. */
export interface DesktopLocalArchive {
  /** Absolute path to the `.zip` on this machine. */
  path: string;
  /** File name (basename). */
  name: string;
  /** Size in bytes. */
  size: number;
  /**
   * `'blob'` for a Playwright blob report (a whole run), `'trace'` for a trace
   * file (one execution); `null` for a hand-picked file, whose kind the server
   * decides when it opens it.
   */
  kind: 'blob' | 'trace' | null;
}

/**
 * Importable archives left in a checkout by previous Playwright runs — blob
 * reports under `blob-report/` and traces under `test-results/`. Empty without
 * the bridge, on failure, or when the folder has none.
 */
export async function findDesktopImportableRuns(path: string): Promise<DesktopLocalArchive[]> {
  const core = tauriCore();
  if (!core || !path) return [];
  try {
    return (await core.invoke<DesktopLocalArchive[] | null>('desktop_find_importable_runs', { path })) ?? [];
  } catch {
    return [];
  }
}

/**
 * Open the native multi-select picker for import archives, filtered to `.zip`
 * and starting at `defaultPath` (the linked project folder) when given. Empty
 * on cancel or without the bridge.
 */
export async function pickDesktopImportFiles(defaultPath?: string | null): Promise<DesktopLocalArchive[]> {
  const core = tauriCore();
  if (!core) return [];
  try {
    return (
      (await core.invoke<DesktopLocalArchive[] | null>('desktop_pick_import_files', {
        defaultPath: defaultPath ?? null,
      })) ?? []
    );
  } catch {
    return [];
  }
}
