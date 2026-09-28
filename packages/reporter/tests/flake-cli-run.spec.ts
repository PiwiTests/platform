import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flakeErrorSignature } from '@piwitests/core/flake-plan';
import { startServer, type FakeServer } from './_helpers.js';

/**
 * `piwi flake` end to end through the built package: a fixture suite whose
 * test fails when `/api/slow` takes over a second, against an app server that
 * answers at once, and a stand-in dashboard serving the plan and taking the
 * results. The delay arm reproduces while the control stays clean; after the
 * test is fixed, `piwi flake verify` holds.
 */

const pkgRoot = path.join(import.meta.dirname, '..');
const dist = path.join(pkgRoot, 'dist');
const project = path.join(pkgRoot, 'tests', `.flake-cli-run-${process.pid}`);
const ERROR = 'Error: the slow call had not answered after a second';

let app: FakeServer;
let dashboard: FakeServer;
let verifyAvailable = false;

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
  fs.writeFileSync(path.join(project, file), text);
}

function spec(fixed: boolean): string {
  const wait = fixed
    ? `await page.evaluate(() => fetch('/api/slow').then((r) => r.text()));`
    : `const answered = await page.evaluate(() =>
      Promise.race([
        fetch('/api/slow').then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
      ]),
    );
    if (!answered) throw new Error(${JSON.stringify(ERROR.replace(/^Error: /, ''))});`;
  return `const { test } = require('../fixture.cjs');
test.describe('checkout', () => {
  test('shows the total', async ({ page }) => {
    await page.goto(${JSON.stringify(`${'APP'}/`)}.replace('APP', process.env.APP_URL));
    ${wait}
  });
});
`;
}

const arm = (id: string, conditions: unknown[], runs: number, stopAt: number | null, rank: number | null) => ({
  id,
  label: id === 'control' ? 'control' : 'delay GET /api/slow 1.5 s',
  suspectId: id === 'control' ? null : 'slow-route:GET /api/slow',
  rank,
  conditions,
  runs,
  stopAt,
});
const DELAY = [{ kind: 'delay', route: 'GET /api/slow', ms: 1500, match: 'all' }];

function plan(kind: 'reproduce' | 'verify', experimentId: string) {
  return {
    version: 1,
    experimentId,
    kind,
    projectId: 3,
    testCaseId: 42,
    test: { file: 'tests/checkout.spec.cjs', title: 'shows the total', suite: ['checkout'], project: null },
    displayTitle: 'checkout › shows the total',
    windowDays: 30,
    failures: 6,
    passes: 30,
    failureCommit: null,
    medianDurationMs: 400,
    errorSignatures: [flakeErrorSignature(ERROR)],
    suspects: [
      {
        rank: 1,
        id: 'slow-route:GET /api/slow',
        label: 'GET /api/slow slower (≥1.2 s)',
        sentence: '',
        counts: { failuresWith: 6, failures: 6, passesWith: 1, passes: 30 },
        conditionLabel: 'delay to 1.5 s',
        skipped: null,
      },
    ],
    control: arm('control', [], kind === 'verify' ? 5 : 6, null, null),
    arms: kind === 'verify' ? [arm('verify', DELAY, 5, 1, null)] : [arm('suspect-1', DELAY, 6, 3, 1)],
    combined: null,
    verifies:
      kind === 'verify'
        ? { experimentId: 1, armId: 2, label: 'delay GET /api/slow 1.5 s', rate: 1, commit: null, finishedAt: null }
        : null,
  };
}

function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, APP_URL: app.url, PIWI_DESKTOP_CONFIG: '/nonexistent' };
    delete env.PIWI_DASHBOARD_URL;
    delete env.PIWI_PROBE;
    execFile(
      process.execPath,
      [path.join(dist, 'cli', 'index.js'), 'flake', ...args, '--server-url', dashboard.url],
      { cwd: project, env, timeout: 240_000 },
      (error, stdout, stderr) => {
        resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr });
      },
    );
  });
}

beforeAll(async () => {
  app = await startServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>shop</title>');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"total":42}');
  });
  dashboard = await startServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url.startsWith('/api/test-cases/42/flake-plan')) {
      const verify = req.url.includes('kind=verify');
      if (verify && !verifyAvailable) return json(409, { message: 'No experiment has reproduced this test yet' });
      return json(200, plan(verify ? 'verify' : 'reproduce', verify ? '2' : '1'));
    }
    if (req.method === 'POST' && req.url === '/api/projects/3/flake-lab/results') return json(200, { ok: true });
    json(404, { message: 'not found' });
  });

  write(
    'fixture.cjs',
    `const { test: base, expect } = require('@playwright/test');
const { extendPiwiFixtures } = require(${JSON.stringify(path.join(dist, 'index.js'))});
exports.test = extendPiwiFixtures(base);
exports.expect = expect;
`,
  );
  write(
    'playwright.config.cjs',
    `const { defineConfig } = require('@playwright/test');
const { wrapConfig } = require(${JSON.stringify(path.join(dist, 'index.js'))});
module.exports = wrapConfig(defineConfig({ testDir: './tests', retries: 2, timeout: 60_000, reporter: 'line' }));
`,
  );
  write('tests/checkout.spec.cjs', spec(false));
  write(
    'tests/other.spec.cjs',
    `const { test } = require('../fixture.cjs');\ntest('shows the total twice', async () => {});\n`,
  );
}, 30_000);

afterAll(async () => {
  fs.rmSync(project, { recursive: true, force: true });
  await app?.close();
  await dashboard?.close();
});

describe('piwi flake on a test that fails when /api/slow is slow', () => {
  it('reproduces with the delay arm while the control stays clean, and posts the counts', async () => {
    const { code, stdout, stderr } = await run(['42']);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(stdout).toMatch(/piwi flake · checkout › shows the total · 6 failures in 30 days/);
    expect(stdout).toMatch(/Estimate: up to/);
    expect(stdout).toMatch(/ {2}control +0\/6/);
    expect(stdout).toMatch(/1 {2}delay GET \/api\/slow 1\.5 s +3\/3 +stopped at 3 · same error as in CI +reproduced/);
    expect(stdout).toMatch(/Verdict: reproduced by delay GET \/api\/slow 1\.5 s \(3\/3 against 0\/6, p = 0\.012\)/);
    expect(stdout).toMatch(/After your fix: npx @piwitests\/reporter flake verify 42/);

    const planRequest = dashboard.requests.find((r) => r.url.startsWith('/api/test-cases/42/flake-plan'))!;
    expect(planRequest.url).toMatch(/record=true/);
    const post = dashboard.requests.find((r) => r.method === 'POST')!;
    const body = JSON.parse(post.body);
    expect(body.experimentId).toBe('1');
    expect(body.arms).toEqual([
      // A clean control has no matching failure; one under load failing some other way is counted apart.
      expect.objectContaining({ id: 'control', runs: 6, matchingFailures: 0 }),
      expect.objectContaining({ id: 'suspect-1', runs: 3, matchingFailures: 3, suspectId: 'slow-route:GET /api/slow' }),
    ]);
  }, 240_000);

  it('verify holds once the test waits for the response', async () => {
    write('tests/checkout.spec.cjs', spec(true));
    verifyAvailable = true;
    const { code, stdout, stderr } = await run(['verify', '42', '--json']);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ kind: 'verify', verdict: 'verified', uploaded: true, exitCode: 0 });
    expect(report.arms).toEqual([
      expect.objectContaining({ id: 'control', runs: 5, matchingFailures: 0 }),
      expect.objectContaining({ id: 'verify', runs: 5, matchingFailures: 0, verdict: 'verified' }),
    ]);
  }, 240_000);

  it('exits 1 when nothing reproduces, and keeps results off the dashboard with --no-upload', async () => {
    const posts = dashboard.requests.filter((r) => r.method === 'POST').length;
    const { code, stdout } = await run(['42', '--no-upload', '--runs', '3']);
    expect(code).toBe(1);
    expect(stdout).toMatch(/Verdict: not reproduced/);
    expect(dashboard.requests.filter((r) => r.method === 'POST')).toHaveLength(posts);
    expect(dashboard.requests[dashboard.requests.length - 1]!.url).toMatch(/record=false/);
  }, 240_000);
});
