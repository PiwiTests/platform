/**
 * The `use` options Playwright resolves for each project of a config, read by running the project's own Playwright
 * CLI with the editor service's reporter (`piwi-use-reporter.cjs`): `playwright test --list` with a filter no spec
 * file matches, so Playwright reads the config and loads no test. Cached per config file until it changes.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { USE_LINE } from './use-reporter.js';

export interface ProjectUse {
  name: string;
  testDir: string;
  /** The project's `use` options as Playwright resolved them, without the values JSON cannot hold. */
  use: Record<string, unknown>;
}

export interface ProjectOptions {
  configFile: string;
  rootDir: string;
  projects: ProjectUse[];
}

/** Why a config's options could not be read. */
export type ProjectOptionsFailure = 'playwright-missing' | 'timeout' | 'failed';

export class ProjectOptionsError extends Error {
  constructor(
    readonly reason: ProjectOptionsFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectOptionsError';
  }
}

/** How long Playwright may take to read a config. */
const READ_TIMEOUT_MS = 30_000;

/** A spec filter no file matches: Playwright reads the config and loads no test. */
const NO_SPEC = '__piwi_no_such_spec__';

/** The most output kept from Playwright. */
const MAX_OUTPUT = 8 * 1024 * 1024;

/** The project's own Playwright CLI, resolved from a folder; null when Playwright is not installed there. */
export function resolvePlaywrightCli(dir: string): string | null {
  const require = createRequire(path.join(dir, 'noop.js'));
  for (const id of ['@playwright/test/cli', 'playwright/cli', 'playwright/lib/cli/cli']) {
    try {
      return require.resolve(id);
    } catch {
      // the next candidate
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The options in the reporter's output (its `PIWI_USE` line), checked field by field; null when there is none. */
export function parseUseLine(output: string): ProjectOptions | null {
  const line = output.split(/\r?\n/).find((l) => l.startsWith(USE_LINE));
  if (!line) return null;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(USE_LINE.length));
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.rootDir !== 'string' || !Array.isArray(value.projects)) return null;
  const projects = value.projects.flatMap((p): ProjectUse[] =>
    isRecord(p) && typeof p.name === 'string' && typeof p.testDir === 'string' && isRecord(p.use)
      ? [{ name: p.name, testDir: p.testDir, use: p.use }]
      : [],
  );
  if (!projects.length) return null;
  return { configFile: typeof value.configFile === 'string' ? value.configFile : '', rootDir: value.rootDir, projects };
}

/** The first line of Playwright's output (run without colors), shortened, as the end of a sentence. */
function firstLine(output: string): string {
  const line =
    output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? 'no output';
  const short = line.length > 200 ? `${line.slice(0, 199)}…` : line;
  return /[.!?…]$/.test(short) ? short : `${short}.`;
}

function run(configFile: string, reporter: string, timeoutMs: number): Promise<ProjectOptions> {
  const cwd = path.dirname(configFile);
  const name = path.basename(configFile);
  const cli = resolvePlaywrightCli(cwd);
  if (!cli) {
    return Promise.reject(
      new ProjectOptionsError('playwright-missing', `Playwright is not installed in ${cwd}: run npm install there.`),
    );
  }
  if (!fs.existsSync(reporter)) {
    return Promise.reject(new ProjectOptionsError('failed', `The editor service's reporter is missing: ${reporter}.`));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, 'test', '--list', '--pass-with-no-tests', `--reporter=${reporter}`, '-c', configFile, NO_SPEC],
      { cwd, env: { ...process.env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      settle(() =>
        reject(
          new ProjectOptionsError('timeout', `Playwright did not read ${name} within ${timeoutMs / 1000} seconds.`),
        ),
      );
    }, timeoutMs);
    child.on('error', (error) =>
      settle(() =>
        reject(new ProjectOptionsError('failed', `Playwright could not start: ${firstLine(error.message)}`)),
      ),
    );
    child.on('close', () => {
      const options = parseUseLine(stdout);
      settle(() =>
        options
          ? resolve(options)
          : reject(
              new ProjectOptionsError('failed', `Playwright could not read ${name}: ${firstLine(stderr || stdout)}`),
            ),
      );
    });
  });
}

const cache = new Map<string, { mtimeMs: number; options: Promise<ProjectOptions> }>();

/**
 * The resolved options of a config's projects, read by its own Playwright (resolved from the config's folder, run
 * there with the current Node), with `reporter` (the path of `piwi-use-reporter.cjs`). Kept until the config file
 * changes; a failure is not kept. Rejects with a {@link ProjectOptionsError}.
 */
export function readProjectOptions(
  configFile: string,
  reporter: string,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<ProjectOptions> {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(configFile).mtimeMs;
  } catch {
    return Promise.reject(new ProjectOptionsError('failed', `${configFile} cannot be read.`));
  }
  const cached = cache.get(configFile);
  if (cached?.mtimeMs === mtimeMs) return cached.options;
  const entry = { mtimeMs, options: run(configFile, reporter, timeoutMs) };
  cache.set(configFile, entry);
  entry.options.catch(() => {
    if (cache.get(configFile) === entry) cache.delete(configFile);
  });
  return entry.options;
}
