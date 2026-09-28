/**
 * `piwi bug <id>` — a bug report's failing test, from the dashboard.
 *
 * The dashboard renders the spec with the project's generated-spec settings
 * (test import, bugs folder), its function catalog and the locators its tests
 * already use. Printed by default; `--write` puts it in the bugs folder and
 * runs it once with `playwright test`, so you see the bug reproduce before you
 * fix it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const EXIT_OK = 0;
const EXIT_RUN_FAILED = 1;
const EXIT_ERROR = 2;
const REQUEST_TIMEOUT_MS = 30_000;

const USAGE = `
piwi bug — a bug report's failing test, from the dashboard

Usage:
  npx @piwitests/reporter bug <id> [options]

Prints the spec to commit: the report's steps, test.fail() while the bug
exists, @bug and piwi:bug <id>, written with the project's settings.

Options:
  --write               Write it to the project's bugs folder (tests/bugs by default), then run it once
  --out <file>          Write it to this file instead (then run it once)
  --no-run              With --write or --out: write it without running it
  --force               Replace an existing file
  --run-mode            The spec without test.fail(), as a reproduction runs it
  --server-url <url>    Dashboard URL         (env PIWI_DASHBOARD_URL)
  --api-key <key>       API key               (env PIWI_API_KEY)

Exit codes: 0 printed or written (and, when run, the test behaved as its
test.fail() expects: the bug reproduces), 1 the run did not (the bug may be
fixed, or a step no longer matches the page), 2 the report could not be read
or the file could not be written.
`.trim();

export interface BugArgs {
  id: number;
  write: boolean;
  out: string | null;
  run: boolean;
  force: boolean;
  mode: 'commit' | 'run';
  serverUrl: string;
  apiKey: string | null;
}

const VALUE_FLAGS = new Set(['--out', '--server-url', '--api-key']);

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value !== undefined && !value.startsWith('--') ? value : undefined;
}

export function parseBugArgs(argv: string[], env: NodeJS.ProcessEnv): BugArgs {
  let idText: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith('--')) {
      if (VALUE_FLAGS.has(token)) i++;
      continue;
    }
    idText = token;
    break;
  }
  const id = Number((idText ?? '').replace(/^#/, ''));
  if (!idText || !Number.isInteger(id) || id <= 0) throw new Error('No bug report id — usage: piwi bug <id>');
  for (const flag of VALUE_FLAGS) {
    if (argv.includes(flag) && readOption(argv, flag) === undefined) throw new Error(`${flag} expects a value`);
  }
  const serverUrl = (readOption(argv, '--server-url') ?? env.PIWI_DASHBOARD_URL ?? '').replace(/\/+$/, '');
  if (!serverUrl) throw new Error('No dashboard — pass --server-url or set PIWI_DASHBOARD_URL');
  const out = readOption(argv, '--out') ?? null;
  const write = argv.includes('--write') || out !== null;
  return {
    id,
    write,
    out,
    run: write && !argv.includes('--no-run'),
    force: argv.includes('--force'),
    mode: argv.includes('--run-mode') ? 'run' : 'commit',
    serverUrl,
    apiKey: readOption(argv, '--api-key') ?? env.PIWI_API_KEY ?? null,
  };
}

export interface BugSpec {
  code: string;
  path: string;
  warnings: Array<{ step: number; message: string }>;
}

export async function fetchBugSpec(args: Pick<BugArgs, 'id' | 'mode' | 'serverUrl' | 'apiKey'>): Promise<BugSpec> {
  const url = `${args.serverUrl}/api/bug-reports/${args.id}/spec?mode=${args.mode}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: args.apiKey ? { 'X-API-Key': args.apiKey } : {},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`could not reach ${args.serverUrl} (${(e as Error).message})`);
  }
  if (res.status === 404) throw new Error(`no bug report #${args.id} on ${args.serverUrl}`);
  if (res.status === 401 || res.status === 403) throw new Error(`the dashboard refused the API key (${res.status})`);
  if (!res.ok) throw new Error(`the dashboard answered ${res.status}`);
  const body = (await res.json()) as Partial<BugSpec>;
  if (typeof body.code !== 'string' || typeof body.path !== 'string') throw new Error('the dashboard sent no spec');
  return { code: body.code, path: body.path, warnings: Array.isArray(body.warnings) ? body.warnings : [] };
}

function resolvePlaywrightCli(): string | null {
  const require = createRequire(path.join(process.cwd(), 'noop.js'));
  for (const id of ['playwright/cli', '@playwright/test/cli', 'playwright/lib/cli/cli']) {
    try {
      return require.resolve(id);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function runPlaywright(file: string): Promise<number> {
  const cli = resolvePlaywrightCli();
  const child = cli
    ? spawn(process.execPath, [cli, 'test', file], { stdio: 'inherit' })
    : spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', file], { stdio: 'inherit' });
  return new Promise((resolve) => {
    child.on('error', (err) => {
      console.error(`piwi bug: could not start Playwright — ${err.message}`);
      resolve(EXIT_ERROR);
    });
    child.on('exit', (code) => resolve(code ?? EXIT_ERROR));
  });
}

export async function runBug(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return EXIT_OK;
  }
  let args: BugArgs;
  try {
    args = parseBugArgs(argv, env);
  } catch (e) {
    console.error(`piwi bug: ${(e as Error).message}\n\n${USAGE}`);
    return EXIT_ERROR;
  }

  let spec: BugSpec;
  try {
    spec = await fetchBugSpec(args);
  } catch (e) {
    console.error(`piwi bug: ${(e as Error).message}`);
    return EXIT_ERROR;
  }
  for (const warning of spec.warnings) {
    console.error(`piwi bug: warning: step ${warning.step + 1}: ${warning.message}`);
  }
  if (!args.write) {
    process.stdout.write(spec.code);
    return EXIT_OK;
  }

  const file = args.out ?? spec.path;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, spec.code, { flag: args.force ? 'w' : 'wx' });
  } catch (e) {
    const exists = (e as NodeJS.ErrnoException).code === 'EEXIST';
    console.error(`piwi bug: ${exists ? `${file} exists — pass --force to replace it` : (e as Error).message}`);
    return EXIT_ERROR;
  }
  console.error(`piwi bug: wrote ${file}`);
  if (!args.run) return EXIT_OK;

  const code = await runPlaywright(file);
  if (code === EXIT_ERROR && !resolvePlaywrightCli()) return EXIT_ERROR;
  if (code === 0) {
    console.error(
      args.mode === 'commit'
        ? `piwi bug: the bug reproduces — the spec fails on it, as test.fail() expects. Commit ${file}; remove test.fail() with the fix.`
        : 'piwi bug: the spec passed — the bug does not show here.',
    );
    return EXIT_OK;
  }
  console.error(
    args.mode === 'commit'
      ? 'piwi bug: the spec did not fail as test.fail() expects — the bug may be fixed here, or a step no longer matches the page (see the output above).'
      : 'piwi bug: the spec failed — the bug reproduces here, or a step no longer matches the page (see the output above).',
  );
  return EXIT_RUN_FAILED;
}
