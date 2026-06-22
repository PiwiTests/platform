import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { PiwiDashboardOptions, ShardInfo } from './config.js';
import { resolveOptions } from './config.js';
import { HttpClient } from './http-client.js';
import { Logger } from './logger.js';

/** Produce a deterministic short SHA-1 hex hash for a project name (used in temp file names) */
export function hashForProject(projectName: string): string {
  return crypto.createHash('sha1').update(projectName).digest('hex').slice(0, 16);
}

/**
 * Extract a worker index from a Playwright `TestResult`, falling back to
 * `parallelIndex` when `workerIndex` is absent. Returns `null` when neither is
 * set. Localizes the `as any` reach into Playwright's result object so the
 * cast lives in exactly one place.
 */
export function workerIndexOf(result: any): number | null {
  if (!result) return null;
  return result.workerIndex ?? result.parallelIndex ?? null;
}

/**
 * Extract positional file/path filters from a Playwright CLI invocation
 * (e.g. `playwright test tests/login.spec.ts auth/`). These narrow a run to
 * specific files and are NOT reflected in `config.grep`, so they're the only
 * signal that a file-filtered run is partial. Returns an empty array when the
 * full suite was requested.
 *
 * Best-effort: skips the values of known value-taking options so they aren't
 * mistaken for file filters. `--flag=value` forms consume no extra token.
 */
const PW_VALUE_FLAGS = new Set([
  '-c',
  '--config',
  '-j',
  '--workers',
  '-g',
  '--grep',
  '--grep-invert',
  '--global-timeout',
  '--max-failures',
  '--output',
  '-p',
  '--project',
  '--repeat-each',
  '--reporter',
  '--retries',
  '--shard',
  '--timeout',
  '--trace',
]);

export function detectCliFileFilters(argv: string[] = process.argv): string[] {
  // Drop the node executable + script path, then start after the `test` subcommand.
  const args = argv.slice(2);
  const testIdx = args.indexOf('test');
  const rest = testIdx >= 0 ? args.slice(testIdx + 1) : args;

  const files: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    if (tok.startsWith('-')) {
      // A bare value-taking flag (no `=`) consumes the next token as its value.
      if (!tok.includes('=') && PW_VALUE_FLAGS.has(tok)) i++;
      continue;
    }
    files.push(tok);
  }
  return files;
}

/** Return the temp-file path used to exchange setup info between globalSetup and the reporter instance */
export function getSetupFilePath(projectName: string): string {
  return path.join(os.tmpdir(), `piwi-dashboard-setup-${hashForProject(projectName)}.json`);
}

/** Derive a unique instance identifier by hashing hostname + projectName (or runLabel + projectName when sharding) */
export function computeInstanceId(projectName: string, runLabel?: string | null): string {
  const seed = runLabel ? `${projectName}|${runLabel}` : `${os.hostname()}|${projectName}`;
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

/** Detect a stable CI run label from well-known environment variables. Returns null outside CI. */
export function detectCiRunLabel(): string | null {
  const env = process.env;
  if (env.GITHUB_ACTIONS && env.GITHUB_RUN_ID) return env.GITHUB_RUN_ID;
  if (env.GITLAB_CI && env.CI_PIPELINE_ID) return env.CI_PIPELINE_ID;
  if (env.CIRCLECI && env.CIRCLE_WORKFLOW_ID) return env.CIRCLE_WORKFLOW_ID;
  if (env.TRAVIS && env.TRAVIS_BUILD_ID) return env.TRAVIS_BUILD_ID;
  if (env.TF_BUILD && env.BUILD_BUILDID) return env.BUILD_BUILDID;
  if (env.JENKINS_URL && env.BUILD_ID) return env.BUILD_ID;
  if (env.BUILDKITE_BUILD_ID) return env.BUILDKITE_BUILD_ID;
  if (env.TEAMCITY_BUILD_ID) return env.TEAMCITY_BUILD_ID;
  if (env.BITBUCKET_BUILD_NUMBER) return env.BITBUCKET_BUILD_NUMBER;
  if (env.SEMAPHORE_WORKFLOW_ID) return env.SEMAPHORE_WORKFLOW_ID;
  if (env.APPVEYOR_BUILD_ID) return env.APPVEYOR_BUILD_ID;
  if (env.DRONE_BUILD_NUMBER) return env.DRONE_BUILD_NUMBER;
  return null;
}

/** Information saved by the global setup for the reporter instance to consume */
export interface SetupInfo {
  /** Server-assigned run ID */
  runId: number;
  /** One-time token used to authenticate the /begin call */
  setupToken: string;
  /** Project name this run belongs to */
  projectName: string;
}

/** Read and delete the setup info file for the given project. Returns `null` when no file exists. */
export function readSetupInfo(projectName: string): SetupInfo | null {
  const setupFile = getSetupFilePath(projectName);
  try {
    if (fs.existsSync(setupFile)) {
      const info = JSON.parse(fs.readFileSync(setupFile, 'utf8'));
      fs.unlinkSync(setupFile);
      if (info.projectName === projectName) return info;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Read a snippet of source code surrounding the given line, returning a formatted string with line numbers. Returns `null` on error. */
export function readSourceSnippet(file: string, line: number, context: number): string | null {
  try {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, line - context - 1);
    const end = Math.min(lines.length, line + context);
    return lines
      .slice(start, end)
      .map((l, i) => {
        const lineNum = start + i + 1;
        const marker = lineNum === line ? '> ' : '  ';
        return `${marker}${String(lineNum).padStart(4)} | ${l}`;
      })
      .join('\n');
  } catch {
    return null;
  }
}

/** Create a concurrency limiter that ensures at most `maxConcurrent` async operations run simultaneously */
export function createLimiter(maxConcurrent: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const limitValue = Math.max(1, Math.floor(maxConcurrent));
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    const run = queue.shift();
    if (run) run();
  };

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        Promise.resolve().then(fn).then(resolve, reject).finally(next);
      };
      if (active < limitValue) run();
      else queue.push(run);
    });
  };
}

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
    const opts = resolveOptions((options ?? {}) as Record<string, any>);
    const logger = new Logger(opts.verbose ?? false);

    if (!opts.serverUrl) {
      logger.info('Not enabled — set PIWI_DASHBOARD_URL or serverUrl to enable.');
      if (userSetup) return userSetup(config);
      return;
    }

    const piwiReporterPath = path.resolve(__dirname, 'index.js');
    const hasPiwi =
      Array.isArray(config?.reporter) &&
      config.reporter.some((r: any) => {
        if (!Array.isArray(r) || typeof r[0] !== 'string') return false;
        if (r[0].toLowerCase().includes('piwi')) return true;
        try {
          return path.resolve(require.resolve(r[0])) === piwiReporterPath;
        } catch {
          return false;
        }
      });

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
    } catch (error: any) {
      logger.warn(`Could not register global setup: ${error.message}`);
    }

    if (userSetup) return userSetup(config);
  };
}
