import type { PlaywrightTestConfig } from '@playwright/test';
import type { PiwiDashboardOptions } from './config.js';

const PIWI_MODULE = '@phenx/piwi-dashboard-reporter';

function isPiwiReporterEntry(entry: unknown): boolean {
  if (typeof entry === 'string') return entry.toLowerCase().includes('piwi');
  if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0].toLowerCase().includes('piwi');
  return false;
}

function injectReporter(
  reporter: PlaywrightTestConfig['reporter'],
  piwiOptions?: PiwiDashboardOptions,
): PlaywrightTestConfig['reporter'] {
  const piwiEntry: [string] | [string, PiwiDashboardOptions] = piwiOptions ? [PIWI_MODULE, piwiOptions] : [PIWI_MODULE];

  if (!reporter) return [piwiEntry];
  if (Array.isArray(reporter)) {
    if (reporter.some(isPiwiReporterEntry)) return reporter;
    return [...reporter, piwiEntry];
  }
  return [[reporter] as [string], piwiEntry];
}

function resolveSetupModule(): string {
  try {
    return require.resolve('./global-setup-module.js');
  } catch {
    return require.resolve('./global-setup-module.ts');
  }
}

/**
 * Wrap a Playwright config to auto-inject the Piwi Dashboard reporter and
 * chain its global setup module. Returns a new config object (shallow merge)
 * without mutating the original.
 *
 * The `globalSetup` field is set to a `string` (or `string[]` if the user
 * already has a global setup) referencing the Piwi global setup module,
 * which registers the run on the server. The original setup path(s) are
 * preserved and executed first.
 *
 * Playwright options required in `globalSetup` are forwarded via environment
 * variables:
 * - `serverUrl` → `PIWI_DASHBOARD_URL`
 * - `projectName` → `PIWI_PROJECT_NAME`
 * - `verbose` → `PIWI_VERBOSE`
 *
 * @param config      The user's Playwright config.
 * @param piwiOptions Optional Piwi Dashboard options (serverUrl, projectName, …).
 */
export function wrapConfig<T extends PlaywrightTestConfig>(config: T, piwiOptions?: PiwiDashboardOptions): T {
  if (piwiOptions?.serverUrl) process.env.PIWI_DASHBOARD_URL = piwiOptions.serverUrl;
  if (piwiOptions?.projectName) process.env.PIWI_PROJECT_NAME = piwiOptions.projectName;
  if (piwiOptions?.verbose !== undefined) process.env.PIWI_VERBOSE = String(piwiOptions.verbose);

  const globalSetupModules: string[] = [];
  if (config.globalSetup) {
    const orig = Array.isArray(config.globalSetup) ? config.globalSetup : [config.globalSetup];
    globalSetupModules.push(...orig);
  }
  globalSetupModules.push(resolveSetupModule());

  return {
    ...config,
    reporter: injectReporter(config.reporter, piwiOptions),
    globalSetup: globalSetupModules.length === 1 ? globalSetupModules[0] : globalSetupModules,
  } as T;
}
