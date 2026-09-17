/**
 * Pure builders for the URLs/endpoints that open a source file in a local IDE,
 * plus the workspace-root → absolute-path join. Kept free of Vue/DOM so it can
 * be unit-tested in isolation; the reactive prefs and the actual launching live
 * in `useOpenInIde`.
 *
 * Three mechanisms are supported (see `docs/ide-integration.md`):
 *  - VS Code family via the `vscode://file/<abs>:<line>:<col>` URL scheme
 *  - JetBrains via the `jetbrains://<product>/navigate/reference` URL scheme
 *  - JetBrains via the built-in local web server / IDE Remote Control plugin
 */
import { toPosixPath } from './retry-command';

export { parseLocation } from '#shared/parse-location';

export type VscodeScheme = 'vscode' | 'vscode-insiders' | 'vscodium' | 'cursor';

/** IDE argument dialect for the desktop command-line launcher. */
export type IdeFamily = 'vscode' | 'jetbrains';

/**
 * Command-line launcher names each VS Code flavor installs on the `PATH` (the
 * `code`/`cursor`/… commands). The desktop shell spawns these directly — a far
 * more reliable open than a `vscode://` URL, and one it can confirm started.
 */
export const VSCODE_CLI_COMMANDS: Record<VscodeScheme, string> = {
  vscode: 'code',
  'vscode-insiders': 'code-insiders',
  vscodium: 'codium',
  cursor: 'cursor',
};

/** `:line` when a line is present, `:line:col` when a column is too, else ''. */
function positionSuffix(line?: number | null, column?: number | null): string {
  if (line == null) return '';
  if (column == null) return `:${line}`;
  return `:${line}:${column}`;
}

/**
 * Percent-encode only the characters that would break URL parsing (space, `#`,
 * `?`, `%`), leaving `/` (separators) and `:` (the Windows drive letter and the
 * position suffix) intact. Per-segment `encodeURIComponent` is deliberately NOT
 * used — it would turn `C:` into `C%3A` and corrupt the path.
 */
export function encodePathForUrl(posixPath: string): string {
  return posixPath
    .replace(/%/g, '%25') // must run first so we don't double-encode below
    .replace(/ /g, '%20')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F');
}

/**
 * Join a user-configured absolute workspace root with a repo-relative path into
 * a single POSIX absolute path. Trims a trailing slash on the root and a leading
 * `./` or `/` on the relative part; normalizes backslashes on both.
 * e.g. ('/home/me/repo', 'tests/a.spec.ts') → '/home/me/repo/tests/a.spec.ts'.
 */
export function joinWorkspacePath(root: string, relPath: string): string {
  const posixRoot = toPosixPath(root).replace(/\/+$/, '');
  const posixRel = toPosixPath(relPath).replace(/^\.?\/+/, '');
  if (!posixRoot) return posixRel;
  return `${posixRoot}/${posixRel}`;
}

/** `vscode://file/<abs>:<line>:<col>` (and insiders/vscodium/cursor variants). */
export function buildVscodeUrl(o: {
  scheme: VscodeScheme;
  absPath: string;
  line?: number | null;
  column?: number | null;
}): string {
  const encoded = encodePathForUrl(toPosixPath(o.absPath));
  // Exactly one slash after `file`: Unix abs paths already start with '/',
  // Windows (`C:/…`) does not, so add one → `vscode://file/C:/…`.
  const withSlash = encoded.startsWith('/') ? encoded : `/${encoded}`;
  return `${o.scheme}://file${withSlash}${positionSuffix(o.line, o.column)}`;
}

/**
 * `jetbrains://<product>/navigate/reference?project=<name>&path=<rel>:<line>:<col>`.
 * Uses the IDE project name + a project-relative path, so no absolute root is
 * needed. Line/column are appended to the `path` value with literal colons
 * (JetBrains does not accept separate line/column query params).
 */
export function buildJetbrainsNavigateUrl(o: {
  product: string;
  projectName: string;
  relPath: string;
  line?: number | null;
  column?: number | null;
}): string {
  const path = encodePathForUrl(toPosixPath(o.relPath)) + positionSuffix(o.line, o.column);
  return `jetbrains://${o.product}/navigate/reference?project=${encodeURIComponent(o.projectName)}&path=${path}`;
}

/**
 * `http://localhost:<port>/api/file/<path>:<line>:<col>` — the JetBrains built-in
 * web server / IDE Remote Control plugin endpoint. `path` may be absolute (giving
 * the expected `/api/file//abs/...` double slash) or content-root-relative.
 */
export function buildJetbrainsHttpUrl(o: {
  port: number;
  path: string;
  line?: number | null;
  column?: number | null;
}): string {
  const encoded = encodePathForUrl(toPosixPath(o.path));
  return `http://localhost:${o.port}/api/file/${encoded}${positionSuffix(o.line, o.column)}`;
}
