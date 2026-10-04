/**
 * A Playwright reporter that prints the configuration Playwright resolved, for the editor service: one line,
 * `PIWI_USE <json>`, with the config file, its root directory, Piwi's section of the config (`'@piwi'`, which
 * Playwright hands to reporters as written) and each project's name, test directory and `use` options, without the
 * functions and other values JSON cannot hold. The service runs it as
 * `playwright test --list` with a filter no spec file matches, so no spec is loaded and nothing runs. Bundled on
 * its own as `dist/piwi-use-reporter.cjs`; it imports nothing at run time.
 */
import type { FullConfig, Reporter } from '@playwright/test/reporter';
import { PIWI_CONFIG_KEY } from '@piwitests/core/piwi-config';

/** What the reporter's line starts with. */
export const USE_LINE = 'PIWI_USE ';

/** How deep `use` options are kept. */
const MAX_DEPTH = 20;

/**
 * A value as JSON holds it: strings, finite numbers, booleans, null, arrays and plain objects. Anything else (a
 * function, a class instance, a cycle) is left out of an object, and null in an array.
 */
function plain(value: unknown, parents: unknown[] = []): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || parents.includes(value) || parents.length >= MAX_DEPTH) return undefined;
  const inner = [...parents, value];
  if (Array.isArray(value)) return value.map((item) => plain(item, inner) ?? null);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const kept = plain(item, inner);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

export default class UseReporter implements Reporter {
  onBegin(config: FullConfig): void {
    const resolved = {
      configFile: config.configFile ?? null,
      rootDir: config.rootDir,
      piwi: plain((config as unknown as Record<string, unknown>)[PIWI_CONFIG_KEY]) ?? null,
      projects: config.projects.map((project) => ({
        name: project.name,
        testDir: project.testDir,
        use: plain(project.use) ?? {},
      })),
    };
    process.stdout.write(`${USE_LINE}${JSON.stringify(resolved)}\n`);
  }

  printsToStdio(): boolean {
    return true;
  }
}
