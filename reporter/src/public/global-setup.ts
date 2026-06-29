import * as path from 'node:path';
import { errorMessage } from '../internal/support/errors.js';
import * as fs from 'node:fs';
import type { PiwiDashboardOptions, ShardInfo } from './options.js';
import { resolveOptions } from '../internal/config/env.js';
import { HttpClient } from '../internal/transport/http-client.js';
import { Logger } from '../internal/support/logger.js';
import { computeInstanceId } from '../internal/support/instance-id.js';
import { detectCiRunLabel } from '../internal/support/ci.js';
import { getSetupFilePath } from '../internal/support/setup-file.js';

/**
 * Create a Playwright `globalSetup` function that registers a test run on the
 * Piwi Dashboard server at the start of the run.  An optional `userSetup` is
 * called afterward so existing setup logic is preserved.
 *
 * The server-run ID and a one-time token are written to a temp file so the
 * reporter instance can pick them up during the streaming handshake.
 *
 * @param options   Piwi Dashboard options (uses `serverUrl`, `projectName`, …).
 * @param userSetup An existing global setup to chain after the Piwi registration.
 */
export function createGlobalSetup(
  options?: PiwiDashboardOptions,
  userSetup?: (config: any) => any,
): (config: any) => Promise<any> {
  return async function globalSetupFn(config: any) {
    // This module compiles to `dist/public/global-setup.js`; the package entry
    // point is `dist/index.js`, one level up.
    const piwiReporterPath = path.resolve(__dirname, '../index.js');

    // Extract options from the Piwi reporter entry in the Playwright config so
    // that serverUrl / projectName etc. set inline in the reporters array are
    // visible here without requiring PIWI_* env vars or a separate wrapConfig call.
    let inlineReporterOptions: Record<string, any> = {};
    if (Array.isArray(config?.reporter)) {
      for (const r of config.reporter) {
        if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
        const isPiwi =
          r[0].toLowerCase().includes('piwi') ||
          (() => {
            try {
              return path.resolve(require.resolve(r[0])) === piwiReporterPath;
            } catch {
              return false;
            }
          })();
        if (isPiwi && r[1] && typeof r[1] === 'object') {
          inlineReporterOptions = r[1];
          break;
        }
      }
    }

    const opts = resolveOptions({ ...inlineReporterOptions, ...options } as Record<string, any>);
    const logger = new Logger(opts.verbose ?? false);

    if (opts.enabled === false || !opts.serverUrl) {
      logger.info('Not enabled — set PIWI_DASHBOARD_URL or serverUrl to enable.');
      if (userSetup) return userSetup(config);
      return;
    }

    const hasPiwi =
      Object.keys(inlineReporterOptions).length > 0 ||
      (Array.isArray(config?.reporter) &&
        config.reporter.some((r: any) => {
          if (!Array.isArray(r) || typeof r[0] !== 'string') return false;
          if (r[0].toLowerCase().includes('piwi')) return true;
          try {
            return path.resolve(require.resolve(r[0])) === piwiReporterPath;
          } catch {
            return false;
          }
        }));

    if (!hasPiwi) {
      logger.debug('Not reporting — Piwi is not in the Playwright reporters list.');
      if (userSetup) return userSetup(config);
      return;
    }

    const httpClient = new HttpClient(opts.serverUrl, logger);

    try {
      const auth = await httpClient.resolveAuth(opts);
      const runLabel = opts.runLabel || detectCiRunLabel();

      // Detect shard info from Playwright config (--shard=1/3)
      const pwShard = (config as any).shard as ShardInfo | null | undefined;
      const shardIndex = pwShard?.current;
      const shardTotal = pwShard?.total;

      const response = await httpClient.postJSON(
        '/api/test-runs/setup',
        {
          projectName: opts.projectName,
          projectDescription: opts.projectDescription,
          environment: opts.environment || null,
          label: opts.label || null,
          startTime: new Date().toISOString(),
          instanceId: computeInstanceId(opts.projectName!, runLabel),
          shardIndex,
          shardTotal,
        },
        auth,
      );

      if (response?.runId && response?.setupToken) {
        fs.writeFileSync(
          getSetupFilePath(opts.projectName!),
          JSON.stringify({
            runId: response.runId,
            setupToken: response.setupToken,
            projectName: opts.projectName,
          }),
        );
        logger.debug(`Global setup: initialising run #${response.runId}`);
      }
    } catch (error) {
      logger.warn(`Could not register global setup: ${errorMessage(error)}`);
    }

    if (userSetup) return userSetup(config);
  };
}
