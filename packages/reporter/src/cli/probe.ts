/**
 * `piwi probe` — run the dashboard's probe plan.
 *
 * Fetches the (test, route, fault) pairs the dashboard wants probed, runs
 * `playwright test` with the capture fixtures in probe mode (each fault applied
 * at `page.route`), and posts the outcomes back. The run is stamped as a probe
 * run, so the dashboard never counts it as a real run.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveProjectId } from '../internal/support/selection-client.js';
import type { ProbePlan } from '../internal/probe/plan.js';
import type { ProbeOutcomeLine } from '../internal/probe/mode.js';

const EXIT_OK = 0;
const EXIT_ERROR = 2;

const USAGE = `
piwi probe — run the dashboard's probe plan and record what the suite noticed

Usage:
  npx @piwitests/reporter probe [options] [-- <playwright args>]

Options:
  --server-url <url>   Dashboard URL (or PIWI_DASHBOARD_URL)
  --api-key <key>      Reporter API key (or PIWI_API_KEY)
  --project <name|id>  Project name or id (or PIWI_PROJECT_NAME)
  --budget <n>         Max pairs to probe this run (default the server's)

Everything after \`--\` is passed to \`playwright test\`.
`.trim();

function readOption(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function spawnPlaywright(playwrightArgs: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const cli = resolvePlaywrightCli();
  const child = cli
    ? spawn(process.execPath, [cli, 'test', ...playwrightArgs], { stdio: 'inherit', env })
    : spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', ...playwrightArgs], {
        stdio: 'inherit',
        env,
      });
  return new Promise((resolve) => {
    child.on('error', (err) => {
      console.error(`piwi probe: could not start Playwright — ${err.message}`);
      resolve(EXIT_ERROR);
    });
    child.on('exit', (code) => resolve(code ?? EXIT_ERROR));
  });
}

export async function runProbe(argv: string[]): Promise<number> {
  const sep = argv.indexOf('--');
  const own = sep < 0 ? argv : argv.slice(0, sep);
  const playwrightArgs = sep < 0 ? [] : argv.slice(sep + 1);
  if (own.includes('-h') || own.includes('--help')) {
    console.log(USAGE);
    return EXIT_OK;
  }

  const env = process.env;
  const serverUrl = (readOption(own, '--server-url') ?? env.PIWI_DASHBOARD_URL ?? '').replace(/\/$/, '');
  if (!serverUrl) {
    console.error('piwi probe: no dashboard URL — pass --server-url or set PIWI_DASHBOARD_URL');
    return EXIT_ERROR;
  }
  const apiKey = readOption(own, '--api-key') ?? env.PIWI_API_KEY ?? null;
  const project = readOption(own, '--project') ?? env.PIWI_PROJECT_NAME ?? '';
  const budget = readOption(own, '--budget');

  let projectId: number;
  try {
    projectId = await resolveProjectId({ serverUrl, apiKey, project, key: '' });
  } catch (e) {
    console.error(`piwi probe: ${(e as Error).message}`);
    return EXIT_ERROR;
  }

  const authHeaders = apiKey ? { 'X-API-Key': apiKey } : {};
  const planUrl = `${serverUrl}/api/projects/${projectId}/probes/plan${budget ? `?budget=${encodeURIComponent(budget)}` : ''}`;
  let plan: ProbePlan;
  try {
    const res = await fetch(planUrl, { headers: authHeaders });
    if (!res.ok) throw new Error(`dashboard returned ${res.status}`);
    plan = (await res.json()) as ProbePlan;
  } catch (e) {
    console.error(`piwi probe: could not fetch the probe plan — ${(e as Error).message}`);
    return EXIT_ERROR;
  }

  if (!plan.items || plan.items.length === 0) {
    console.error('piwi probe: nothing to probe — the plan is empty.');
    return EXIT_OK;
  }
  console.error(`piwi probe: ${plan.items.length} pair(s) to probe (budget ${plan.budget}).`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-probe-'));
  const planFile = path.join(dir, 'plan.json');
  const resultsFile = path.join(dir, 'results.jsonl');
  fs.writeFileSync(planFile, JSON.stringify(plan));
  fs.writeFileSync(resultsFile, '');

  // Narrow the run to the probed tests when their titles are known; probe mode
  // only acts on matched tests, but a filter keeps the run cheap.
  const grep = plan.items
    .map((i) => i.testTitle)
    .filter(Boolean)
    .map(escapeRegex)
    .join('|');
  const pwArgs = [...playwrightArgs];
  if (grep && !playwrightArgs.includes('--grep') && !playwrightArgs.includes('-g')) pwArgs.push('--grep', grep);

  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    PIWI_PROBE: '1',
    PIWI_PROBE_PLAN: planFile,
    PIWI_PROBE_RESULTS: resultsFile,
  };
  // A probe run's tests fail by design when they notice the fault, so Playwright
  // exiting non-zero is expected and is not treated as a command error.
  await spawnPlaywright(pwArgs, childEnv);

  const lines = fs.readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean);
  const results: ProbeOutcomeLine[] = [];
  for (const line of lines) {
    try {
      results.push(JSON.parse(line) as ProbeOutcomeLine);
    } catch {
      // skip a malformed line
    }
  }
  if (results.length === 0) {
    console.error('piwi probe: no probe outcomes were recorded (are the Piwi capture fixtures active?).');
    return EXIT_OK;
  }

  try {
    const res = await fetch(`${serverUrl}/api/projects/${projectId}/probes/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ results }),
    });
    if (!res.ok) throw new Error(`dashboard returned ${res.status}`);
    const body = (await res.json()) as { recorded?: number };
    const noticed = results.filter((r) => r.outcome === 'noticed').length;
    const notNoticed = results.filter((r) => r.outcome === 'not-noticed').length;
    console.error(
      `piwi probe: recorded ${body.recorded ?? results.length} outcome(s) — ${noticed} noticed, ${notNoticed} not noticed.`,
    );
  } catch (e) {
    console.error(`piwi probe: could not post probe results — ${(e as Error).message}`);
    return EXIT_ERROR;
  }
  return EXIT_OK;
}
