/**
 * The editor's breakpoints a test run started from Piwi pauses at: the enabled
 * line breakpoints (`vscode.debug.breakpoints`) in JavaScript or TypeScript
 * files under a Playwright config's folder. The service turns them into the
 * run's `PIWI_PAUSE_AT`. No VS Code API here: the breakpoints are read through
 * their shape, so the selection is tested without an editor.
 */
import * as path from 'node:path';
import type { EditorBreakpoint } from '@piwitests/editor/protocol';

/** What the selection reads of a breakpoint: a `vscode.SourceBreakpoint` has a location, a function breakpoint none. */
export interface BreakpointLike {
  enabled: boolean;
  location?: {
    uri: { scheme: string; fsPath: string; toString(): string };
    range: { start: { line: number } };
  };
}

/** A file a test or a page object can be written in. */
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/i;

/** Whether `file` is inside `root`. */
export function isUnder(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** The enabled line breakpoints in script files under one of `roots` (the Playwright configs' folders), 0-based. */
export function runBreakpoints(breakpoints: readonly BreakpointLike[], roots: readonly string[]): EditorBreakpoint[] {
  const out: EditorBreakpoint[] = [];
  for (const b of breakpoints) {
    const location = b.location;
    if (!b.enabled || !location || location.uri.scheme !== 'file') continue;
    const file = location.uri.fsPath;
    if (!SCRIPT_FILE.test(file) || !roots.some((root) => isUnder(root, file))) continue;
    out.push({ uri: location.uri.toString(), line: location.range.start.line });
  }
  return out;
}

/**
 * The environment a terminal is told apart by, for reusing it: everything but the run's ref, which the service follows
 * through the terminal's first ref when it is shared. Two runs with other breakpoints need two terminals.
 */
export function terminalEnvKey(env: Record<string, string> | undefined): string {
  const entries = Object.entries(env ?? {}).filter(([key]) => key !== 'PIWI_ORIGIN_REF');
  return JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)));
}
