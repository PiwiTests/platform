/**
 * The project's own Playwright, resolved from the folder of its config as Node resolves it there, the test runner's
 * package first: the CLI that reads the config's options and the library the launcher opens the browser with are the
 * same Playwright.
 */
import { createRequire } from 'node:module';
import * as path from 'node:path';

function resolveFirst(dir: string, ids: string[]): string | null {
  const require = createRequire(path.join(dir, 'noop.js'));
  for (const id of ids) {
    try {
      return require.resolve(id);
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
