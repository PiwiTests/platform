/**
 * The project's own Playwright, resolved from the folder of its config: the first of its packages Node finds in a
 * `node_modules` folder there or above it, the test runner's package first, so the CLI that reads the config's
 * options and the library the launcher opens the browser with are the same Playwright. A Playwright Node would only
 * find in a global folder (`NODE_PATH`, `~/.node_modules`) is not the project's.
 */
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

/** The real paths of the `node_modules` folders in `dir` and in each folder above it. */
function nodeModulesOf(dir: string): string[] {
  const found: string[] = [];
  for (let folder = path.resolve(dir); ; folder = path.dirname(folder)) {
    try {
      found.push(fs.realpathSync(path.join(folder, 'node_modules')));
    } catch {
      // none in this folder
    }
    if (path.dirname(folder) === folder) return found;
  }
}

function resolveFirst(dir: string, ids: string[]): string | null {
  const require = createRequire(path.join(dir, 'noop.js'));
  const roots = nodeModulesOf(dir);
  const inProject = (file: string) =>
    roots.some((root) => {
      const relative = path.relative(root, file);
      return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  for (const id of ids) {
    try {
      const file = require.resolve(id);
      if (inProject(file)) return file;
    } catch {
      // the next candidate
    }
  }
  return null;
}

/** The project's Playwright CLI; null when Playwright is not installed there. */
export function resolvePlaywrightCli(dir: string): string | null {
  return resolveFirst(dir, ['@playwright/test/cli', 'playwright/cli', 'playwright/lib/cli/cli']);
}

/** The module of the project's Playwright library (`chromium`, `firefox`, `webkit`, `selectors`); null when none. */
export function resolvePlaywrightLibrary(dir: string): string | null {
  return resolveFirst(dir, ['@playwright/test', 'playwright', 'playwright-core']);
}
