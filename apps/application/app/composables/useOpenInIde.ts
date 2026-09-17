/**
 * "Open in IDE" — turns a repo-relative source path into a launch into the
 * user's local editor (VS Code family via `vscode://`, JetBrains via the
 * `jetbrains://` navigate URL, or the JetBrains built-in local server / IDE
 * Remote Control plugin).
 *
 * Preferences (which method, the local workspace root that maps a repo-relative
 * path to an absolute one, the VS Code flavor, the JetBrains product/port) are a
 * per-browser client setting kept in `localStorage` — NOT server-backed and NOT
 * part of the DB/env `SETTINGS_PAGES` registry (the source lives on the visitor's
 * machine, so the mapping is inherently per-device). Configure them in
 * `OpenInIdeSettingsModal`.
 *
 * Only the JetBrains local-server method is detectable (a `fetch` reaches it);
 * the URL schemes are fire-and-forget, so "Auto" probes the local server first
 * and otherwise falls back to a single scheme launch it cannot confirm.
 */
import {
  buildJetbrainsHttpUrl,
  buildJetbrainsNavigateUrl,
  buildVscodeUrl,
  joinWorkspacePath,
  VSCODE_CLI_COMMANDS,
  type IdeFamily,
  type VscodeScheme,
} from '~/utils/ide-links';

export type IdeMethod = 'auto' | 'vscode' | 'jetbrains-url' | 'jetbrains-http';

export interface IdePrefs {
  method: IdeMethod;
  vscodeScheme: VscodeScheme;
  jetbrainsProduct: string;
  jetbrainsPort: number;
  /** Send a content-root-relative path to the local server instead of an absolute one. */
  jetbrainsHttpUsesRelativePath: boolean;
  /** Global local checkout root; '' when unset. */
  defaultRoot: string;
  /** Piwi project id → absolute root override (monorepo / multiple checkouts). */
  projectRoots: Record<string, string>;
  /** Piwi project id → IDE project name override (for the jetbrains:// URL). */
  jetbrainsProjectNames: Record<string, string>;
}

export interface OpenTarget {
  filePath: string;
  line?: number | null;
  column?: number | null;
  /** Piwi project id — selects the per-project root/name override. */
  projectKey?: string | number | null;
  /** Piwi project name — default IDE project name for the jetbrains:// URL. */
  projectName?: string | null;
  /** Per-call method override from the chooser; omit to use the stored default. */
  method?: IdeMethod;
}

export interface IdeSettingsContext {
  projectKey?: string | null;
  projectName?: string | null;
}

const STORAGE_KEY = 'piwi-ide-prefs';

const DEFAULT_PREFS: IdePrefs = {
  method: 'auto',
  vscodeScheme: 'vscode',
  jetbrainsProduct: 'idea',
  jetbrainsPort: 63342,
  jetbrainsHttpUsesRelativePath: false,
  defaultRoot: '',
  projectRoots: {},
  jetbrainsProjectNames: {},
};

export const VSCODE_SCHEME_LABELS: Record<VscodeScheme, string> = {
  vscode: 'VS Code',
  'vscode-insiders': 'VS Code Insiders',
  vscodium: 'VSCodium',
  cursor: 'Cursor',
};

export const IDE_METHOD_LABELS: Record<IdeMethod, string> = {
  auto: 'Auto (try all)',
  vscode: 'VS Code',
  'jetbrains-url': 'JetBrains (URL)',
  'jetbrains-http': 'JetBrains (local server)',
};

/** Common JetBrains product tags for the `jetbrains://<product>/…` URL. */
export const JETBRAINS_PRODUCTS = [
  'idea',
  'webstorm',
  'pycharm',
  'phpstorm',
  'goland',
  'rubymine',
  'clion',
  'rider',
  'rustrover',
] as const;

export function useOpenInIde() {
  const prefs = useLocalStorage<IdePrefs>(STORAGE_KEY, DEFAULT_PREFS, { mergeDefaults: true });
  const toast = useToast();

  // A single global settings modal, toggled via shared state (useState keys are
  // shared across every component that calls this composable).
  const settingsOpen = useState('piwi-ide-settings-open', () => false);
  const settingsContext = useState<IdeSettingsContext>('piwi-ide-settings-context', () => ({}));

  function projectKeyOf(projectKey?: string | number | null): string | null {
    if (projectKey == null || projectKey === '') return null;
    return String(projectKey);
  }

  function openSettings(ctx: IdeSettingsContext = {}) {
    settingsContext.value = { projectKey: ctx.projectKey ?? null, projectName: ctx.projectName ?? null };
    settingsOpen.value = true;
  }

  function resolveRoot(projectKey?: string | number | null): string {
    const k = projectKeyOf(projectKey);
    const perProject = k ? prefs.value.projectRoots[k] : undefined;
    return (perProject || prefs.value.defaultRoot || '').trim();
  }

  function resolveJbProjectName(projectKey?: string | number | null, projectName?: string | null): string {
    const k = projectKeyOf(projectKey);
    const perProject = k ? prefs.value.jetbrainsProjectNames[k] : undefined;
    return (perProject || projectName || '').trim();
  }

  /** Absolute path for a repo-relative file, or null when no root is configured. */
  function resolveAbsPath(filePath: string, projectKey?: string | number | null): string | null {
    const root = resolveRoot(projectKey);
    return root ? joinWorkspacePath(root, filePath) : null;
  }

  /**
   * Which command-line launchers the desktop shell should try for a method, in
   * order. VS Code flavors map to their `code`/`cursor`/… commands; JetBrains
   * uses the product tag, which is also the launcher name Toolbox generates
   * (`idea`, `rider`, `webstorm`, …). Auto tries JetBrains first — the family
   * whose URL scheme is the most fragile — then VS Code.
   */
  function desktopAttempts(method: IdeMethod): Array<{ family: IdeFamily; command: string; label: string }> {
    const vscode = {
      family: 'vscode' as const,
      command: VSCODE_CLI_COMMANDS[prefs.value.vscodeScheme],
      label: VSCODE_SCHEME_LABELS[prefs.value.vscodeScheme],
    };
    const product = prefs.value.jetbrainsProduct.trim();
    const jetbrains = product ? [{ family: 'jetbrains' as const, command: product, label: 'JetBrains' }] : [];
    if (method === 'vscode') return [vscode];
    if (method === 'jetbrains-url' || method === 'jetbrains-http') return jetbrains;
    return [...jetbrains, vscode];
  }

  const isConfigured = computed(
    () =>
      !!prefs.value.defaultRoot?.trim() ||
      Object.keys(prefs.value.projectRoots).length > 0 ||
      Object.keys(prefs.value.jetbrainsProjectNames).length > 0,
  );

  /**
   * Hand off a custom-scheme URL to the OS without navigating the top frame (a
   * hidden iframe avoids `beforeunload` and losing SPA state). Safari can block
   * custom schemes inside iframes, so fall back to a transient anchor click.
   */
  function launchScheme(url: string) {
    if (!import.meta.client) return;
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 1000);
    } catch {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => anchor.remove(), 1000);
    }
  }

  /**
   * Probe the JetBrains local server. With `no-cors` we get an opaque response we
   * can't read, so a resolved promise means "reachable" (best available signal),
   * a rejection means refused/blocked (incl. HTTPS mixed-content).
   */
  async function probeJetbrainsHttp(path: string, line?: number | null, column?: number | null): Promise<boolean> {
    if (!import.meta.client) return false;
    const url = buildJetbrainsHttpUrl({ port: prefs.value.jetbrainsPort, path, line, column });
    try {
      await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(1200) });
      return true;
    } catch {
      return false;
    }
  }

  async function openInIde(target: OpenTarget) {
    if (!import.meta.client) return;

    const method = target.method ?? prefs.value.method;
    const rel = target.filePath;
    const line = target.line ?? null;
    const column = target.column ?? null;
    // Desktop shell: a project's linked folder stands in for an unconfigured
    // workspace root, so IDE links work with zero setup.
    let root = resolveRoot(target.projectKey);
    if (!root) {
      const linked = await getDesktopProjectLink(target.projectKey);
      if (linked?.exists) root = linked.path;
    }
    const jbName = resolveJbProjectName(target.projectKey, target.projectName);
    const ctx: IdeSettingsContext = {
      projectKey: projectKeyOf(target.projectKey),
      projectName: target.projectName ?? null,
    };
    const configureAction = { label: 'Configure', color: 'info' as const, onClick: () => openSettings(ctx) };

    const openVscode = (): boolean => {
      if (!root) {
        toast.add({
          title: 'Set a workspace root',
          description: 'VS Code needs the local folder that contains this file.',
          color: 'info',
          icon: 'i-lucide-folder-cog',
          actions: [configureAction],
        });
        return false;
      }
      launchScheme(
        buildVscodeUrl({ scheme: prefs.value.vscodeScheme, absPath: joinWorkspacePath(root, rel), line, column }),
      );
      toast.add({
        title: `Opening ${VSCODE_SCHEME_LABELS[prefs.value.vscodeScheme]}…`,
        description: 'If nothing opens, the editor may not be installed or the workspace root is wrong.',
        color: 'neutral',
        icon: 'i-lucide-external-link',
      });
      return true;
    };

    const openJetbrainsUrl = (): boolean => {
      if (!jbName) {
        toast.add({
          title: 'Set a JetBrains project name',
          description: 'The jetbrains:// link needs the open IDE project name.',
          color: 'info',
          icon: 'i-lucide-folder-cog',
          actions: [configureAction],
        });
        return false;
      }
      launchScheme(
        buildJetbrainsNavigateUrl({
          product: prefs.value.jetbrainsProduct,
          projectName: jbName,
          relPath: rel,
          line,
          column,
        }),
      );
      toast.add({
        title: 'Opening JetBrains…',
        description: 'If nothing opens, JetBrains Toolbox may not be installed or the project is not open.',
        color: 'neutral',
        icon: 'i-lucide-external-link',
      });
      return true;
    };

    const openJetbrainsHttp = async (): Promise<boolean> => {
      const path = prefs.value.jetbrainsHttpUsesRelativePath ? rel : root ? joinWorkspacePath(root, rel) : rel;
      const ok = await probeJetbrainsHttp(path, line, column);
      toast.add(
        ok
          ? { title: 'Opened in JetBrains', color: 'success', icon: 'i-lucide-check' }
          : {
              title: 'JetBrains not reachable',
              description: `Nothing responded on localhost:${prefs.value.jetbrainsPort}. Start the IDE with the Remote Control plugin (and "Allow unsigned requests").`,
              color: 'error',
              icon: 'i-lucide-plug-zap',
            },
      );
      return ok;
    };

    // Desktop shell: spawn the IDE's command-line launcher first. It opens the
    // file at the line reliably and reports whether it actually started, where
    // the URL schemes below are fire-and-forget. On a machine with no matching
    // launcher on the PATH this falls through to those schemes unchanged.
    if (tauriCore() && root) {
      const abs = joinWorkspacePath(root, rel);
      for (const attempt of desktopAttempts(method)) {
        const res = await openFileInDesktopIde({
          family: attempt.family,
          command: attempt.command,
          absPath: abs,
          line,
          column,
        });
        if (res.ok) {
          toast.add({ title: `Opened in ${attempt.label}`, color: 'success', icon: 'i-lucide-check' });
          return;
        }
        if (res.reason) {
          // A real error (a missing file, a bad path) — a URL scheme won't help.
          toast.add({
            title: 'Could not open in IDE',
            description: res.reason,
            color: 'error',
            icon: 'i-lucide-triangle-alert',
            actions: [configureAction],
          });
          return;
        }
        // Otherwise the launcher was not on the PATH — try the next / fall through.
      }
    }

    if (method === 'vscode') {
      openVscode();
      return;
    }
    if (method === 'jetbrains-url') {
      openJetbrainsUrl();
      return;
    }
    if (method === 'jetbrains-http') {
      await openJetbrainsHttp();
      return;
    }

    // Auto: probe the detectable JetBrains local server first (a refused localhost
    // connection rejects near-instantly, so this rarely waits the full timeout),
    // then fall back to exactly one URL-scheme launch that can't report success.
    const canProbeHttp = prefs.value.jetbrainsHttpUsesRelativePath || !!root;
    if (canProbeHttp) {
      const path = prefs.value.jetbrainsHttpUsesRelativePath ? rel : joinWorkspacePath(root, rel);
      if (await probeJetbrainsHttp(path, line, column)) {
        toast.add({ title: 'Opened in JetBrains', color: 'success', icon: 'i-lucide-check' });
        return;
      }
    }
    if (root) {
      openVscode();
      return;
    }
    if (jbName) {
      openJetbrainsUrl();
      return;
    }
    toast.add({
      title: 'Set up "Open in IDE"',
      description: 'Add your local workspace folder (for VS Code) or a JetBrains project name to open files from here.',
      color: 'info',
      icon: 'i-lucide-folder-cog',
      actions: [configureAction],
    });
  }

  return {
    prefs,
    isConfigured,
    openInIde,
    openInVscode: (t: Omit<OpenTarget, 'method'>) => openInIde({ ...t, method: 'vscode' }),
    openViaJetbrainsUrl: (t: Omit<OpenTarget, 'method'>) => openInIde({ ...t, method: 'jetbrains-url' }),
    openViaJetbrainsHttp: (t: Omit<OpenTarget, 'method'>) => openInIde({ ...t, method: 'jetbrains-http' }),
    resolveRoot,
    resolveJbProjectName,
    resolveAbsPath,
    settingsOpen,
    settingsContext,
    openSettings,
  };
}
