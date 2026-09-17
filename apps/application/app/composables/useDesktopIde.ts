/**
 * Open a source file in a local IDE through the desktop shell's command-line
 * launcher (desktop shell only).
 *
 * Spawning the launcher — `code --goto <file>:<line>`, `rider --line <n> <file>`
 * — is the reliable way to open a file at a line: it needs no `vscode://` /
 * `jetbrains://` protocol handler, no JetBrains Toolbox, no open-project name to
 * match and no "allow unsigned requests", and unlike a fire-and-forget URL
 * scheme it reports whether the launcher was actually found and started. The
 * shell resolves the command on the `PATH`, so the launcher must be there
 * (JetBrains Toolbox's "Generate shell scripts", VS Code's "Install 'code'
 * command in PATH").
 *
 * Resolves `{ ok: false }` without the bridge or when the launcher is missing,
 * so a browser build and an unconfigured machine both fall back to a URL scheme.
 */
import type { IdeFamily } from '~/utils/ide-links';

export interface DesktopIdeOpenResult {
  /** The launcher opened the file. */
  ok: boolean;
  /**
   * No launcher was available (no bridge, or the command is not on the PATH) —
   * the caller should fall back to a URL scheme rather than report a failure.
   */
  fallback?: boolean;
  /**
   * A hard error worth showing (the file does not exist, a bad path): a URL
   * scheme would fare no better, so the caller should surface this and stop.
   */
  reason?: string;
}

export async function openFileInDesktopIde(o: {
  family: IdeFamily;
  /** Bare launcher command resolved on the PATH (e.g. `code`, `rider`). */
  command: string;
  /** Absolute path to the file on this machine. */
  absPath: string;
  line?: number | null;
  column?: number | null;
}): Promise<DesktopIdeOpenResult> {
  const core = tauriCore();
  if (!core || !o.command.trim() || !o.absPath) return { ok: false, fallback: true };
  try {
    // The command resolves `true` when the launcher started, `false` when it is
    // not on the PATH (so a URL scheme can still be tried), and rejects on a
    // real error such as a missing file.
    const launched = await core.invoke<boolean>('desktop_open_in_ide', {
      command: o.command.trim(),
      family: o.family,
      path: o.absPath,
      line: o.line ?? null,
      column: o.column ?? null,
    });
    return launched ? { ok: true } : { ok: false, fallback: true };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}
