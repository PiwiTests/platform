import * as path from 'node:path';
import { errorMessage } from '../internal/support/errors.js';
import * as fs from 'node:fs';
import type { PiwiDashboardOptions, ShardInfo } from './options.js';
import { resolveOptions } from '../internal/config/env.js';
import { HttpClient } from '../internal/transport/http-client.js';
import { Logger } from '../internal/support/logger.js';
import { computeInstanceId } from '../internal/support/instance-id.js';
import { detectCiRunLabel } from '../internal/support/ci.js';
import { resolveScmBranch } from '../internal/collect/metadata-collector.js';
import { getSetupFilePath } from '../internal/support/setup-file.js';
import { ariaSampleIdentity, clearAriaSampleFile, writeAriaSampleFile } from '../internal/support/aria-sampling.js';
import { isUiMode, isListMode } from '../internal/support/run-mode.js';
import {
  readCommittedManifest,
  fetchInstrumentationManifest,
  configDirFromConfig,
  baseUrlFromConfig,
} from '../internal/manifest/collect.js';

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
    // tsup bundles this into `dist/index.js` and `dist/global-setup-module.js`,
    // so at runtime __dirname is `dist/` and the package entry sits alongside.
    const piwiReporterPath = path.resolve(__dirname, './index.js');

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

    // In Playwright's UI mode the reporter never runs to finish a registered
    // run, so registering here would leave orphaned "initializing" runs (one at
    // UI launch, one per manual run). Skip registration but still chain
    // userSetup so the user's own setup keeps working under the UI.
    if (isUiMode()) {
      logger.debug('UI mode detected — skipping run registration.');
      if (userSetup) return userSetup(config);
      return;
    }

    // `playwright test --list` runs globalSetup but executes no tests, so
    // registering here would leave an empty phantom run on the dashboard. Skip
    // registration but still chain userSetup so the user's own setup keeps working.
    if (isListMode()) {
      logger.debug('List mode detected — skipping run registration.');
      if (userSetup) return userSetup(config);
      return;
    }

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
        logger.debug(`Global setup: initializing run #${response.runId}`);
      }

      // A prior run's ARIA sample set is always cleared first so a stale file
      // never leaks in — even when sampling is off this run.
      if (opts.projectName) clearAriaSampleFile(opts.projectName);

      // Determine what needs the project id before fetching the menu, so a run
      // with neither ARIA sampling nor a manifest makes no extra request.
      const wantsAria = opts.sampleAriaOnPass !== false && !!opts.projectName;
      const committedManifest =
        opts.uploadManifest !== false ? readCommittedManifest(configDirFromConfig(config)) : null;
      const manifestBaseUrl = opts.uploadManifest !== false ? baseUrlFromConfig(config) : null;
      const wantsManifest =
        opts.uploadManifest !== false && !!opts.projectName && (!!committedManifest || !!manifestBaseUrl);

      let projectId: number | undefined;
      if ((wantsAria || wantsManifest) && opts.projectName) {
        const menu = await httpClient.getJSON('/api/projects/menu', auth);
        projectId = (menu?.items as Array<{ id: number; name: string }> | undefined)?.find(
          (p) => p.name.toLowerCase() === opts.projectName!.toLowerCase(),
        )?.id;
      }

      // Ask the server which tests are due a fresh green ARIA sample this run
      // and stash the answer for the worker fixtures. An old server or a failed
      // call leaves no file, and the fixtures then sample nothing.
      if (wantsAria && projectId != null) {
        const sampling = await httpClient.getJSON(`/api/projects/${projectId}/aria-sampling`, auth);
        const tests = Array.isArray(sampling?.tests) ? (sampling.tests as Array<Record<string, unknown>>) : null;
        if (tests) {
          const identities = tests
            .filter((t) => typeof t.filePath === 'string' && typeof t.title === 'string')
            .map((t) => ariaSampleIdentity(t.filePath as string, t.title as string));
          writeAriaSampleFile(opts.projectName!, identities);
          logger.debug(`Green ARIA sampling: ${identities.length} test(s) due a sample.`);
        }
      }

      // Declared surface: upload a committed `piwi.manifest.json` and, when the
      // app under test carries an instrumentation header, its `/__piwi/manifest`.
      if (wantsManifest && projectId != null) {
        // The run's branch, so the dashboard tags a route added on a pull-request
        // branch instead of writing it to the default-branch surface.
        const branch = resolveScmBranch(process.env) ?? null;
        if (committedManifest) {
          await httpClient
            .putJSON(
              `/api/projects/${projectId}/surface/manifest`,
              { source: 'committed', branch, manifest: committedManifest },
              auth,
            )
            .catch((e: unknown) => logger.debug(`Manifest upload (committed) skipped: ${errorMessage(e)}`));
        }
        if (manifestBaseUrl) {
          const declared = await fetchInstrumentationManifest(manifestBaseUrl);
          if (declared) {
            await httpClient
              .putJSON(
                `/api/projects/${projectId}/surface/manifest`,
                { source: 'instrumentation', branch, manifest: declared },
                auth,
              )
              .catch((e: unknown) => logger.debug(`Manifest upload (instrumentation) skipped: ${errorMessage(e)}`));
          }
        }
      }
    } catch (error) {
      logger.warn(`Could not register global setup: ${errorMessage(error)}`);
    }

    if (userSetup) return userSetup(config);
  };
}
