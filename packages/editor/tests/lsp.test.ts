import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node';
import { createConnection } from 'vscode-languageserver/node';
import type { LocatorIndex } from '@piwitests/core/locator-index';
import { buildSession, type RecordedStep } from '@piwitests/core/recording';
import { toStepsDocument } from '@piwitests/core/steps';
import { startServer } from '../src/server';
import type {
  FailuresResult,
  FileSummary,
  McpServersResult,
  PageCandidatesResult,
  RecordResult,
  RecordingUpdate,
  RenderStepsResult,
  RunCommand,
  RunStatusResult,
  ScreenshotResult,
  StatusResult,
  TestsForFile,
  TraceResult,
} from '../src/protocol';
import type { LaunchRequest, ServiceToLauncher } from '../src/recorder/ipc';
import type { LauncherEvents } from '../src/recorder/sessions';

const use = (test: number, site: string, actions = ['click']) => ({
  test,
  actions,
  callSites: [site],
  projects: ['chromium'],
  branches: ['main'],
});

const INDEX: LocatorIndex = {
  projectId: 7,
  projectName: 'Acme Mugs',
  branch: null,
  defaultBranch: 'main',
  branches: [],
  builtAt: null,
  generatedAt: '2026-09-27T00:00:00Z',
  testIdAttributes: null,
  pages: ['/checkout'],
  tests: [
    { id: 1, title: 'pays', file: 'tests/checkout.spec.ts', suite: [], status: 'passed' },
    { id: 2, title: 'pays by card', file: 'tests/checkout.spec.ts', suite: [], status: 'flaky' },
    { id: 3, title: 'removes a row', file: 'tests/rows.spec.ts', suite: [], status: 'failed' },
  ],
  locators: [
    {
      locator: "getByRole('button', { name: 'Pay now' })",
      lastSeenAt: '',
      uses: [
        { ...use(0, 'tests/pages/checkout.page.ts:4:21'), pages: [0] },
        { ...use(1, 'tests/pages/checkout.page.ts:4:21'), pages: [0] },
      ],
    },
    {
      locator: "locator('.cart-row').nth(2)",
      lastSeenAt: '',
      uses: [{ ...use(2, 'tests/pages/checkout.page.ts:5:21'), pages: [0] }],
    },
  ],
  truncated: false,
};

const PAGE_OBJECT = [
  "import type { Page } from '@playwright/test';",
  'export class CheckoutPage {',
  '  constructor(private readonly page: Page) {}',
  '  pay = () => this.page.getByRole(\'button\', { name: "Pay now" });',
  "  row = () => this.page.locator('.cart-row').nth(2);",
  '}',
  '',
].join('\n');

const SPEC = ["import { test } from '@playwright/test';", '', "test('pays', async ({ page }) => {});", ''].join('\n');

/** The spec of the test that failed: through `checkout.row()` on line 7 (0-based 6), into the page object. */
const FAILING_SPEC = [
  "import { test } from '@playwright/test';",
  "import { CheckoutPage } from './pages/checkout.page';",
  '',
  "test('removes a row', async ({ page }) => {",
  '  const checkout = new CheckoutPage(page);',
  "  await page.goto('/checkout');",
  '  await checkout.row().click();',
  '});',
  '',
].join('\n');

const COMPONENT = '<template>\n  <button class="pay">\n    Pay now\n  </button>\n</template>\n';

/** The latest complete run on main: a CI run. */
const MAIN_RUN = {
  id: 41,
  status: 'failed',
  branch: 'main',
  startTime: '2026-09-27T10:00:00.000Z',
  totalTests: 3,
  passedTests: 1,
  failedTests: 1,
  flakyTests: 1,
  skippedTests: 0,
};

/** Its failure: through `checkout.row()` in the spec, into the page object. */
const ROW_FAILURE = {
  executionId: 900,
  testCaseId: 3,
  clusterId: 77,
  title: 'removes a row',
  file: 'tests/rows.spec.ts',
  line: 4,
  status: 'failed',
  headline: "locator('.cart-row').nth(2) was not found",
  location: '/ci/work/tests/pages/checkout.page.ts:5:21',
  message: "Error: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for locator('.cart-row').nth(2)",
  frames: ['/ci/work/tests/pages/checkout.page.ts:5:21', '/ci/work/tests/rows.spec.ts:7:18'],
  traces: ['traces/900.zip'],
  screenshot: 'shots/900.png',
};

/** What the instance answers with the runs laid over run #41, once a test sets it; with none laid over it otherwise. */
let laidOver: unknown = null;

let dir = '';
let server: http.Server;
let url = '';
let client: MessageConnection;
let stop: () => void;
const runStatuses: RunStatusResult[] = [];
const diagnostics = new Map<
  string,
  Array<{ message: string; code?: string; severity?: number; range: unknown; data?: unknown; source?: string }>
>();

function write(file: string, text: string): string {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

const uri = (file: string) => pathToFileURL(path.join(dir, file)).href;

async function waitFor<T>(read: () => T | undefined | Promise<T | undefined>, ms = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const u = req.url ?? '';
    if (u === '/api/projects/menu') return res.end(JSON.stringify({ items: [{ id: 7, name: 'Acme Mugs' }] }));
    if (u.startsWith('/api/projects/7/locator-index')) return res.end(JSON.stringify(INDEX));
    if (u.startsWith('/api/projects/7/code-index')) {
      return res.end(
        JSON.stringify({
          files: ['src/components/CheckoutButton.vue'],
          tests: [INDEX.tests[0], INDEX.tests[1]],
          reach: [{ file: 0, tests: [0, 1], origin: 'client' }],
          builtAt: null,
          truncated: false,
        }),
      );
    }
    if (u === '/api/projects/7/test-cases?limit=1000') {
      return res.end(JSON.stringify({ items: [{ tags: ['smoke', 'checkout'], feature: 'Payments' }] }));
    }
    if (u === '/api/projects/7/test-cases?limit=1000&file=tests%2Frows.spec.ts') {
      return res.end(
        JSON.stringify({
          items: [
            {
              id: 3,
              title: 'removes a row',
              filePath: 'tests/rows.spec.ts',
              status: 'failed',
              totalRuns: 9,
              passedRuns: 6,
            },
          ],
        }),
      );
    }
    if (u.startsWith('/api/projects/7/test-cases')) {
      return res.end(
        JSON.stringify({
          items: [
            {
              id: 1,
              title: 'pays',
              filePath: 'tests/checkout.spec.ts',
              status: 'passed',
              totalRuns: 50,
              passedRuns: 48,
            },
          ],
        }),
      );
    }
    if (u.startsWith('/api/projects/7/locator-alternatives')) {
      return res.end(
        JSON.stringify({
          items: [
            {
              testCaseId: 3,
              location: 'tests/pages/checkout.page.ts:5:21',
              method: 'locator',
              lastSeenAt: '2026-09-26T00:00:00Z',
              alternatives: [
                { locator: "locator('.cart-row').nth(2)", method: 'locator', args: {}, score: 20 },
                { locator: "getByRole('row', { name: /Mug/ })", method: 'getByRole', args: {}, score: 85 },
              ],
            },
          ],
        }),
      );
    }
    if (u.startsWith('/api/projects/7/branch-failures?')) {
      const query = new URL(u, url).searchParams;
      const laid = query.get('overlays') === '1';
      if (query.get('branch') !== 'main') {
        return res.end(
          JSON.stringify(laid ? { run: null, overlays: [], failures: [], resolved: [] } : { run: null, failures: [] }),
        );
      }
      const latest = { run: MAIN_RUN, failures: [ROW_FAILURE] };
      return res.end(JSON.stringify(laid ? (laidOver ?? { ...latest, overlays: [], resolved: [] }) : latest));
    }
    if (u === '/api/failure-clusters/77/fix-plan') {
      return res.end(
        JSON.stringify({
          cluster: { id: 77, title: 'Cart row not found', signature: 'sig' },
          diagnosis: {
            summary: 'The cart rows lost their class.',
            patch: [
              '--- a/tests/pages/checkout.page.ts',
              '+++ b/tests/pages/checkout.page.ts',
              '@@ -4,2 +4,2 @@',
              '   pay = () => this.page.getByRole(\'button\', { name: "Pay now" });',
              "-  row = () => this.page.locator('.cart-row').nth(2);",
              "+  row = () => this.page.getByRole('row').nth(2);",
              '',
            ].join('\n'),
            patchValidation: { status: 'applies', errors: [] },
          },
          edits: [],
          verify: { command: 'npx playwright test tests/checkout.spec.ts:3', expectation: 'The cluster resolves.' },
        }),
      );
    }
    if (u === '/api/failure-clusters/77/fix-plan?format=markdown') {
      res.setHeader('Content-Type', 'text/markdown');
      return res.end('# Fix plan — Cart row not found\n\nRun `npx playwright test tests/checkout.spec.ts:3`.\n');
    }
    if (u === '/api/test-run-cases/900/locator-healing') {
      return res.end(
        JSON.stringify({
          recommendation: { recommended: { locator: "getByRole('row', { name: /Mug/ })" } },
          edit: {
            filePath: 'tests/pages/checkout.page.ts',
            line: 5,
            oldLine: "  row = () => this.page.locator('.cart-row').nth(2);",
            newLine: "  row = () => this.page.getByRole('row', { name: /Mug/ });",
            unifiedDiff: null,
          },
        }),
      );
    }
    if (u === '/api/files/traces/900.zip' || u === '/api/files/shots/900.png') {
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.end(Buffer.from('PK-stub'));
    }
    if (u === '/api/links?entityType=failure_cluster&entityId=77') {
      return res.end(
        JSON.stringify({
          items: [
            {
              url: 'https://jira.test/browse/SHOP-12',
              key: 'SHOP-12',
              title: 'Cart rows missing',
              statusText: 'In Progress',
            },
          ],
        }),
      );
    }
    if (u.startsWith('/api/links')) return res.end(JSON.stringify({ items: [] }));
    if (u === '/api/projects/7/quarantine?candidates=false') {
      return res.end(
        JSON.stringify({
          entries: [{ testCaseId: 1, ageMs: 5 * 86_400_000, consecutivePasses: 3, releaseProposed: false }],
          releaseAfterConsecutivePasses: 10,
        }),
      );
    }
    if (u === '/api/projects/7/selections') {
      return res.end(
        JSON.stringify({
          items: [
            { key: 'smoke', name: 'Smoke' },
            { key: 'failed', name: null },
          ],
        }),
      );
    }
    if (u === '/api/projects/7/selections/smoke/resolve') {
      return res.end(
        JSON.stringify({
          tests: [{ testCaseId: 1 }],
          materialization: {
            args: ['tests/checkout.spec.ts:3'],
            command: 'npx playwright test tests/checkout.spec.ts:3',
          },
        }),
      );
    }
    if (u === '/api/projects/7/selections/failed/resolve') {
      return res.end(
        JSON.stringify({
          tests: [{ testCaseId: 3 }],
          materialization: { args: [], command: 'npx playwright test --grep x' },
        }),
      );
    }
    if (u === '/api/projects/7/timeout-opportunities') {
      return res.end(
        JSON.stringify({
          items: [
            {
              testCaseId: 1,
              kind: 'stale-slow',
              timeout: 90000,
              p95: 4100,
              recommendedTimeout: null,
              estimatedSavingMs: 0,
            },
          ],
        }),
      );
    }
    if (u.startsWith('/api/projects/7/flake-lab?')) {
      return res.end(
        JSON.stringify({
          tests: [
            {
              testCaseId: 1,
              state: 'reproduced',
              nextCommand: 'npx @piwitests/reporter flake verify 1',
              flaky: true,
              reproducedBy: 'delay GET /api/cart 1.8 s',
              flakeRate: 0.18,
              suspect: {
                id: 'slow-route:GET /api/cart',
                label: 'slow GET /api/cart',
                standing: 'reproduced',
                lab: 'reproduced 7 of 10',
              },
            },
            {
              testCaseId: 3,
              state: 'untested',
              nextCommand: 'npx @piwitests/reporter flake 3',
              flaky: false,
              reproducedBy: null,
              flakeRate: null,
              suspect: {
                id: 'slow-route:GET /api/rows',
                label: 'slow GET /api/rows',
                standing: 'untested',
                lab: 'untested',
              },
              untestedSuspects: 2,
            },
          ],
        }),
      );
    }
    if (u.startsWith('/api/projects/7/flaky-tests')) {
      return res.end(
        JSON.stringify({ items: [{ testCaseId: 1, score: 42, wastedCiMinutes: 12.4, rootCause: 'timing' }] }),
      );
    }
    if (u === '/api/projects/7/test-functions') {
      const entry = (id: number, name: string, urlPattern: string | null) => ({
        id,
        name,
        kind: 'page-object-method',
        module: 'tests/pages/checkout.page.ts',
        receiver: 'checkoutPage',
        importName: 'CheckoutPage',
        params: [{ name: 'amount', type: 'string' }],
        urlPattern,
        steps: [{ action: 'fill', target: { testId: 'not-on-the-page' } }],
        paramSources: [],
      });
      return res.end(
        JSON.stringify({
          testFunctions: [{ entry: entry(1, 'pay', '**/checkout') }, { entry: entry(2, 'login', '**/login') }],
        }),
      );
    }
    if (u === '/api/projects/7/feature-map') return res.end(JSON.stringify({ features: [{ key: 'Cart' }] }));
    if (u === '/api/projects/7/selections/preview') {
      return res.end(
        JSON.stringify({
          materialization: {
            args: ['tests/checkout.spec.ts:3'],
            command: 'npx playwright test tests/checkout.spec.ts:3',
          },
        }),
      );
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-editor-')));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
      cwd: dir,
      stdio: 'ignore',
    });
  git('init', '-q', '-b', 'main');
  write('playwright.config.ts', 'export default {};\n');
  write('src/components/CheckoutButton.vue', COMPONENT);
  write('tests/pages/checkout.page.ts', PAGE_OBJECT);
  write('tests/checkout.spec.ts', SPEC);
  write('tests/rows.spec.ts', FAILING_SPEC);
  write('src/unreached.ts', "export const x = 'y';\n");
  write('app/pages/checkout.vue', '<template><div /></template>\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');

  const toServer = new PassThrough();
  const toClient = new PassThrough();
  stop = startServer(createConnection(toServer, toClient), {
    env: { PIWI_DASHBOARD_URL: url, PIWI_PROJECT_NAME: 'Acme Mugs', PIWI_DESKTOP_CONFIG: '/nonexistent' },
    debounceMs: 10,
  });
  client = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
  client.onNotification('textDocument/publishDiagnostics', (p: { uri: string; diagnostics: never[] }) => {
    diagnostics.set(p.uri, p.diagnostics);
  });
  client.onNotification('piwi/runStatusChanged', (p: RunStatusResult) => {
    runStatuses.push(p);
  });
  client.listen();
  const init = await client.sendRequest('initialize', {
    processId: null,
    rootUri: null,
    capabilities: {},
    workspaceFolders: [{ uri: pathToFileURL(dir).href, name: 'shop' }],
  });
  expect(init).toMatchObject({ capabilities: { hoverProvider: true } });
  await client.sendNotification('initialized', {});
  // The indexes are fetched in the background: wait until the status says so.
  await waitFor(() => (connected ? true : undefined));
});

let connected = false;
const pollStatus = setInterval(async () => {
  if (!client || connected) return;
  const status = (await client.sendRequest('piwi/status').catch(() => null)) as StatusResult | null;
  connected = !!status?.contexts[0]?.connected;
}, 30);

afterAll(async () => {
  clearInterval(pollStatus);
  stop?.();
  client?.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

function open(file: string, text: string, version = 1) {
  diagnostics.delete(uri(file));
  return client.sendNotification('textDocument/didOpen', {
    textDocument: { uri: uri(file), languageId: file.endsWith('.vue') ? 'vue' : 'typescript', version, text },
  });
}

describe('the Piwi language server', () => {
  test('reports its context', async () => {
    const status = (await client.sendRequest('piwi/status')) as StatusResult;
    expect(status.contexts).toEqual([
      expect.objectContaining({
        root: dir,
        connected: true,
        source: 'environment',
        projectName: 'Acme Mugs',
        branch: 'main',
        locators: 2,
        reachedFiles: 1,
      }),
    ]);
  });

  test('warns on the line of an unsaved rename that breaks locators, and fixes the call sites', async () => {
    await open('src/components/CheckoutButton.vue', COMPONENT.replace('Pay now', 'Pay'));
    const diags = await waitFor(() => diagnostics.get(uri('src/components/CheckoutButton.vue')));
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({
      source: 'Piwi',
      code: 'locator-break',
      severity: 2,
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 7 } },
    });
    expect(diags[0]!.message).toBe(
      `2 tests find an element by "Pay now" ("Pay now" → "Pay"): getByRole('button', { name: 'Pay now' })`,
    );

    const actions = (await client.sendRequest('textDocument/codeAction', {
      textDocument: { uri: uri('src/components/CheckoutButton.vue') },
      range: diags[0]!.range,
      context: { diagnostics: diags },
    })) as Array<{
      title: string;
      edit: { changes: Record<string, Array<{ newText: string; range: { start: { line: number } } }>> };
    }>;
    expect(actions.map((a) => a.title)).toEqual(['Update 1 locator in checkout.page.ts']);
    const edits = actions[0]!.edit.changes[uri('tests/pages/checkout.page.ts')]!;
    expect(edits).toEqual([
      expect.objectContaining({
        newText: '  pay = () => this.page.getByRole(\'button\', { name: "Pay" });',
        range: expect.objectContaining({ start: { line: 3, character: 0 } }),
      }),
    ]);

    const hover = (await client.sendRequest('textDocument/hover', {
      textDocument: { uri: uri('src/components/CheckoutButton.vue') },
      position: { line: 2, character: 5 },
    })) as { contents: { value: string } };
    expect(hover.contents.value).toContain("→ `getByRole('button', { name: 'Pay' })`");
  });

  test('a rename the locators still match is not a warning', async () => {
    await open('src/components/CheckoutButton.vue', COMPONENT.replace('Pay now', 'Pay now!'), 2);
    const diags = await waitFor(() => diagnostics.get(uri('src/components/CheckoutButton.vue')));
    expect(diags).toEqual([]);
  });

  test('flags a brittle locator in a page object, with the stored stable alternative as the fix', async () => {
    await open('tests/pages/checkout.page.ts', PAGE_OBJECT);
    const diags = await waitFor(() => diagnostics.get(uri('tests/pages/checkout.page.ts')));
    const brittle = diags.find((d) => d.code === 'brittle')!;
    expect(brittle).toMatchObject({ severity: 2, range: { start: { line: 4, character: 24 } } });
    expect(brittle.message).toMatch(/^Brittle: .* · 1 test$/);
    const actions = (await client.sendRequest('textDocument/codeAction', {
      textDocument: { uri: uri('tests/pages/checkout.page.ts') },
      range: brittle.range,
      context: { diagnostics: [brittle] },
    })) as Array<{ title: string; edit: { changes: Record<string, Array<{ newText: string }>> } }>;
    expect(actions[0]!.title).toBe("Use getByRole('row', { name: /Mug/ }) (as of the last passing run)");
    expect(actions[0]!.edit.changes[uri('tests/pages/checkout.page.ts')]![0]!.newText).toBe(
      "  row = () => this.page.getByRole('row', { name: /Mug/ });",
    );

    const hover = (await client.sendRequest('textDocument/hover', {
      textDocument: { uri: uri('tests/pages/checkout.page.ts') },
      position: { line: 3, character: 30 },
    })) as { contents: { value: string } };
    expect(hover.contents.value).toContain("**`getByRole('button', { name: 'Pay now' })`** · 2 tests · click");
    expect(hover.contents.value).toContain('Pages: `/checkout`');
  });

  test('lists the latest run’s failures at their failing line, with the heal, the trace and the page', async () => {
    const all = await waitFor(() => diagnostics.get(uri('tests/pages/checkout.page.ts')));
    const failure = all.find((d) => d.code === 'ci-failure')!;
    expect(failure).toMatchObject({
      severity: 1,
      source: 'Piwi',
      message: "locator('.cart-row').nth(2) was not found (removes a row, run #41)",
      range: { start: { line: 4, character: 2 } },
      codeDescription: { href: `${url}/test-run-cases/900` },
    });
    const actions = (await client.sendRequest('textDocument/codeAction', {
      textDocument: { uri: uri('tests/pages/checkout.page.ts') },
      range: failure.range,
      context: { diagnostics: [failure] },
    })) as Array<{
      title: string;
      edit?: { changes: Record<string, Array<{ newText: string }>> };
      command?: { command: string; arguments: unknown[] };
    }>;
    expect(actions.map((a) => a.title)).toEqual([
      "Heal: use getByRole('row', { name: /Mug/ })",
      'Open the trace',
      'Apply the fix plan (1 file), then run its verification',
      'Copy context for agent',
      'Open the failure in the dashboard',
    ]);
    const apply = actions[2] as unknown as {
      edit: { changes: Record<string, Array<{ newText: string }>> };
      command: { command: string; arguments: unknown[] };
    };
    expect(apply.edit.changes[uri('tests/pages/checkout.page.ts')]![0]!.newText).toBe(
      PAGE_OBJECT.replace("this.page.locator('.cart-row').nth(2)", "this.page.getByRole('row').nth(2)"),
    );
    expect(apply.command).toEqual({
      title: 'Run the verification',
      command: 'piwi.runCommand',
      arguments: [
        { cwd: dir, command: 'npx playwright test tests/checkout.spec.ts:3', env: { PIWI_ORIGIN: 'editor' } },
      ],
    });
    const context = (actions[3]!.command!.arguments[0] as string).split('\n');
    expect(context.slice(0, 3)).toEqual([
      '# Failing test: removes a row',
      '',
      "locator('.cart-row').nth(2) was not found",
    ]);
    expect(context).toContain("Replace the failing locator with `getByRole('row', { name: /Mug/ })`:");
    expect(context).toContain('# Fix plan — Cart row not found');
    expect(actions[0]!.edit!.changes[uri('tests/pages/checkout.page.ts')]![0]!.newText).toBe(
      "  row = () => this.page.getByRole('row', { name: /Mug/ });",
    );
    expect(actions[1]!.command).toEqual({
      title: 'Open the trace',
      command: 'piwi.openTrace',
      arguments: [{ uri: uri('tests/pages/checkout.page.ts'), executionId: 900 }],
    });
    // A client that previews annotated edits gets the plan as a confirmed change; this one does not.
    expect(JSON.stringify(actions[2])).not.toContain('annotationId');

    const hover = (await client.sendRequest('textDocument/hover', {
      textDocument: { uri: uri('tests/pages/checkout.page.ts') },
      position: { line: 4, character: 30 },
    })) as { contents: { value: string } };
    expect(hover.contents.value).toContain(`**CI failure** · [removes a row](${url}/test-run-cases/900) · run #41`);
    expect(hover.contents.value).toMatch(/!\[Failure screenshot\]\(file:\/\/.*900\.png\)/);
    expect(hover.contents.value).toContain(
      'Known issue: [SHOP-12 Cart rows missing](https://jira.test/browse/SHOP-12) · In Progress',
    );
    expect(hover.contents.value).toContain("**`locator('.cart-row').nth(2)`**");

    const trace = (await client.sendRequest('piwi/trace', {
      uri: uri('tests/pages/checkout.page.ts'),
      executionId: 900,
    })) as TraceResult;
    expect(trace.cwd).toBe(dir);
    expect(fs.readFileSync(trace.path, 'utf-8')).toBe('PK-stub');
    expect(trace.command).toBe(`npx playwright show-trace "${trace.path}"`);
  });

  test('reports the run status, and pushes it when it changes', async () => {
    const status = (await client.sendRequest('piwi/runStatus')) as RunStatusResult;
    expect(status.contexts).toEqual([
      {
        root: dir,
        branch: 'main',
        checkedOut: 'main',
        run: expect.objectContaining({ id: 41, status: 'failed', failedTests: 1, url: `${url}/test-runs/41` }),
        failures: 1,
        failingTests: 1,
        resolved: 0,
        overlays: 0,
      },
    ]);
    expect(runStatuses[runStatuses.length - 1]).toEqual(status);
  });

  test('lists the failures where they show, for clients that list them natively', async () => {
    const failures = (await client.sendRequest('piwi/failures')) as FailuresResult;
    expect(failures.items).toEqual([
      {
        uri: uri('tests/pages/checkout.page.ts'),
        line: 4,
        title: 'removes a row',
        headline: "locator('.cart-row').nth(2) was not found",
        executionId: 900,
        runId: 41,
        url: `${url}/test-run-cases/900`,
        hasTrace: true,
        source: 'ci',
        state: 'failing',
        browserName: null,
      },
    ]);
  });

  test('renders a flow recorded in Piwi Picker as the body of a test', async () => {
    const target = {
      tagName: 'button',
      role: 'button',
      accessibleName: 'Pay now',
      testId: null,
      text: 'Pay now',
      alternatives: [{ locator: "getByRole('button', { name: 'Pay now' })", method: 'getByRole', score: 90 }],
    };
    const session = buildSession(
      [
        {
          action: 'goto',
          target: null,
          value: 'https://shop.test/cart',
          redacted: false,
          pageUrl: 'https://shop.test/cart',
          timestamp: 1,
        },
        { action: 'click', target, value: null, redacted: false, pageUrl: 'https://shop.test/cart', timestamp: 2 },
      ],
      1_000,
    );
    const rendered = (await client.sendRequest('piwi/renderSteps', {
      uri: uri('tests/checkout.spec.ts'),
      steps: toStepsDocument(session),
    })) as RenderStepsResult;
    expect(rendered.warnings).toEqual([]);
    expect(rendered.code).not.toContain('import');
    expect(rendered.code).toContain("await page.getByRole('button', { name: 'Pay now' }).click();");

    const invalid = (await client.sendRequest('piwi/renderSteps', {
      uri: uri('tests/checkout.spec.ts'),
      steps: 'x',
    })) as RenderStepsResult;
    expect(invalid).toEqual({ code: '', warnings: ['not valid JSON'] });
  });

  test('offers Piwi’s MCP server with the connection it has', async () => {
    const mcp = (await client.sendRequest('piwi/mcp')) as McpServersResult;
    expect(mcp.servers).toEqual([{ label: `Piwi (${new URL(url).host})`, url: `${url}/mcp`, headers: {} }]);
  });

  test('completes page. with the chains the suite uses on the pages this file’s tests visit', async () => {
    const text = SPEC.replace('async ({ page }) => {}', 'async ({ page }) => {\n  await page.get\n}');
    await open('tests/checkout.spec.ts', text);
    const items = (await client.sendRequest('textDocument/completion', {
      textDocument: { uri: uri('tests/checkout.spec.ts') },
      position: { line: 3, character: '  await page.get'.length },
    })) as Array<{ label: string; detail: string; textEdit: { range: { start: { character: number } } } }>;
    expect(items.map((i) => i.label)).toEqual([
      "getByRole('button', { name: 'Pay now' })",
      "locator('.cart-row').nth(2)",
    ]);
    expect(items[0]!.detail).toBe('2 tests · /checkout');
    expect(items[1]!.detail).toMatch(/^1 test · \/checkout · brittle: /);
    expect(items[0]!.textEdit.range.start.character).toBe('  await page.'.length);
  });

  test('advises on a test whose timeout could be tighter, and fixes it', async () => {
    const text = SPEC.replace('async ({ page }) => {}', 'async ({ page }) => {\n  test.slow();\n}');
    await open('tests/checkout.spec.ts', text, 5);
    const diags = await waitFor(() => diagnostics.get(uri('tests/checkout.spec.ts')));
    const advice = diags.find((d) => d.code === 'timeout')!;
    expect(advice).toMatchObject({ severity: 3, range: { start: { line: 2 } } });
    expect(advice.message).toBe('test.slow() is no longer needed: its p95 is 4.1 s against a 90 s timeout');
    const actions = (await client.sendRequest('textDocument/codeAction', {
      textDocument: { uri: uri('tests/checkout.spec.ts') },
      range: advice.range,
      context: { diagnostics: [advice] },
    })) as Array<{
      title: string;
      edit: {
        changes: Record<string, Array<{ newText: string; range: { start: { line: number }; end: { line: number } } }>>;
      };
    }>;
    expect(actions[0]!.title).toBe('Remove test.slow()');
    expect(actions[0]!.edit.changes[uri('tests/checkout.spec.ts')]).toEqual([
      { range: { start: { line: 3, character: 0 }, end: { line: 4, character: 0 } }, newText: '' },
    ]);
  });

  test('completes the project’s functions for this file’s pages, and piwi: annotations and tags', async () => {
    fs.writeFileSync(path.join(dir, 'CODEOWNERS'), '* @acme/web\ntests/ @acme/qa qa@acme.test\n');
    const text = [
      "import { test } from '@playwright/test';",
      '',
      "test('pays', { tag: ['@sm'], annotation: { type: 'piwi:owner', description: '@' } }, async ({ page }) => {",
      '  ',
      '});',
      '',
    ].join('\n');
    await open('tests/checkout.spec.ts', text, 6);
    const at = (line: number, character: number) =>
      client.sendRequest('textDocument/completion', {
        textDocument: { uri: uri('tests/checkout.spec.ts') },
        position: { line, character },
      }) as Promise<Array<{ label: string; textEdit: { newText: string } }>>;
    const functions = await at(3, 2);
    expect(functions.map((i) => [i.label, i.textEdit.newText])).toEqual([
      ['checkoutPage.pay', 'await checkoutPage.pay(${1:amount})'],
    ]);
    const line = text.split('\n')[2]!;
    expect((await at(2, line.indexOf("'@sm'") + 4)).map((i) => i.label)).toEqual(['@checkout', '@smoke']);
    expect((await at(2, line.indexOf("'piwi:owner'") + 1)).map((i) => i.label)).toEqual([
      'piwi:owner',
      'piwi:priority',
      'piwi:feature',
      'piwi:link',
    ]);
    expect((await at(2, line.indexOf("'@'") + 2)).map((i) => i.label)).toEqual([
      '@acme/qa',
      '@acme/web',
      'qa@acme.test',
    ]);
  });

  test('lists the saved selections and the command that runs one', async () => {
    const selections = (await client.sendRequest('piwi/selections', { uri: uri('tests/checkout.spec.ts') })) as {
      items: unknown[];
    };
    expect(selections.items).toEqual([
      { key: 'smoke', name: 'Smoke', count: 1, includesFile: true },
      { key: 'failed', name: 'failed', count: 1, includesFile: false },
    ]);
    expect(await client.sendRequest('piwi/runSelection', { uri: uri('tests/checkout.spec.ts'), key: 'smoke' })).toEqual(
      {
        cwd: dir,
        command: 'npx playwright test tests/checkout.spec.ts:3',
        args: [],
        env: { PIWI_ORIGIN: 'editor' },
      },
    );
  });

  test('summarizes a page object, a spec and an application file', async () => {
    const pageObject = (await client.sendRequest('piwi/fileSummary', {
      uri: uri('tests/pages/checkout.page.ts'),
    })) as FileSummary;
    expect(pageObject.lines.map((l) => [l.line, l.title])).toEqual([
      [3, '2 tests · click · 1 flaky'],
      [4, '1 test · click · 1 failing'],
    ]);
    expect(pageObject.lines[0]!.command).toMatchObject({ command: 'piwi.runTests', arguments: [{ testIds: [1, 2] }] });

    const spec = (await client.sendRequest('piwi/fileSummary', { uri: uri('tests/checkout.spec.ts') })) as FileSummary;
    expect(spec.file?.title).toBe('1 test in Piwi');
    expect(spec.lines).toEqual([
      {
        line: 2,
        title:
          'passed 48/50 · quarantined 5 d · 3/10 passes toward release · flaky score 42 · 12 CI min wasted · timing · in Smoke',
        command: { title: 'Open in dashboard', command: 'piwi.openInDashboard', arguments: [`${url}/test-cases/1`] },
        // The document as the earlier tests left it: the test's body spans two more lines.
        status: 'passed',
        endLine: 4,
      },
      {
        line: 2,
        title: 'flaky 18% · top suspect: slow GET /api/cart (reproduced 7 of 10)',
        command: {
          title: 'Open its Flakiness tab',
          command: 'piwi.openInDashboard',
          arguments: [`${url}/test-cases/1?tab=flakiness`],
        },
      },
      {
        line: 2,
        title: 'Reproduce this flake',
        command: {
          title: 'Reproduce this flake',
          command: 'piwi.runCommand',
          arguments: [{ cwd: dir, command: 'npx @piwitests/reporter flake 1', env: { PIWI_ORIGIN: 'editor' } }],
        },
      },
      {
        line: 2,
        title: 'Verify the flake fix',
        command: {
          title: 'Verify the flake fix',
          command: 'piwi.runCommand',
          arguments: [{ cwd: dir, command: 'npx @piwitests/reporter flake verify 1', env: { PIWI_ORIGIN: 'editor' } }],
        },
      },
    ]);

    const app = (await client.sendRequest('piwi/fileSummary', {
      uri: uri('src/components/CheckoutButton.vue'),
    })) as FileSummary;
    expect(app.file?.title).toBe('Reached by 2 tests · 1 flaky');
    const page = (await client.sendRequest('piwi/fileSummary', { uri: uri('app/pages/checkout.vue') })) as FileSummary;
    expect(page.file?.title).toBe('Page /checkout: 3 tests act on it · 2 locators · 1 brittle · 1 failing · 1 flaky');
    expect(page.file?.command).toMatchObject({ command: 'piwi.runTests', arguments: [{ testIds: [1, 2, 3] }] });
    const none = (await client.sendRequest('piwi/fileSummary', { uri: uri('src/unreached.ts') })) as FileSummary;
    expect(none).toEqual({ file: null, lines: [] });
  });

  test('marks where and why a test failed, with its evidence above the line', async () => {
    const spec = (await client.sendRequest('piwi/fileSummary', { uri: uri('tests/rows.spec.ts') })) as FileSummary;
    const evidence = { uri: uri('tests/rows.spec.ts'), executionId: 900 };
    expect(spec.lines).toEqual([
      expect.objectContaining({
        line: 3,
        status: 'failed',
        endLine: 7,
        failure: {
          line: 6,
          headline: "locator('.cart-row').nth(2) was not found",
          message:
            "Error: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for locator('.cart-row').nth(2)",
          executionId: 900,
          url: `${url}/test-run-cases/900`,
        },
      }),
      {
        line: 6,
        title: "✗ locator('.cart-row').nth(2) was not found",
        command: {
          title: 'Open the failure in the dashboard',
          command: 'piwi.openInDashboard',
          arguments: [`${url}/test-run-cases/900`],
        },
      },
      {
        line: 6,
        title: 'Screenshot',
        command: { title: 'Open the failure screenshot', command: 'piwi.openScreenshot', arguments: [evidence] },
      },
      {
        line: 6,
        title: 'Trace',
        command: { title: 'Open the trace', command: 'piwi.openTrace', arguments: [evidence] },
      },
    ]);

    // The spec's line in the failing call chain shows the failure, with the message and the chain.
    const hover = (await client.sendRequest('textDocument/hover', {
      textDocument: { uri: uri('tests/rows.spec.ts') },
      position: { line: 6, character: 10 },
    })) as { contents: { value: string } };
    expect(hover.contents.value).toContain(`**CI failure** · [removes a row](${url}/test-run-cases/900) · run #41`);
    expect(hover.contents.value).toContain('```text\nError: locator.click: Timeout 5000ms exceeded.\nCall log:');
    expect(hover.contents.value).toContain(
      `Called from [checkout.page.ts:5](${uri('tests/pages/checkout.page.ts')}#L5) ← [rows.spec.ts:7](${uri('tests/rows.spec.ts')}#L7)`,
    );
    const elsewhere = await client.sendRequest('textDocument/hover', {
      textDocument: { uri: uri('tests/rows.spec.ts') },
      position: { line: 5, character: 10 },
    });
    expect(elsewhere).toBeNull();

    const shot = (await client.sendRequest('piwi/screenshot', evidence)) as ScreenshotResult;
    expect(fs.readFileSync(shot.path, 'utf-8')).toBe('PK-stub');
    expect(await client.sendRequest('piwi/screenshot', { ...evidence, executionId: 1 })).toBeNull();
  });

  test('lists the tests of a file and the command that runs them', async () => {
    const reached = (await client.sendRequest('piwi/testsForFile', {
      uri: uri('src/components/CheckoutButton.vue'),
    })) as TestsForFile;
    expect(reached.basis).toBe('reach');
    expect(reached.tests.map((t) => t.title)).toEqual(['pays', 'pays by card']);
    const defined = (await client.sendRequest('piwi/testsForFile', {
      uri: uri('tests/checkout.spec.ts'),
    })) as TestsForFile;
    expect(defined).toMatchObject({ basis: 'defined', tests: [{ id: 1, title: 'pays', status: 'passed' }] });
    const command = (await client.sendRequest('piwi/runArgs', {
      uri: uri('tests/checkout.spec.ts'),
      testIds: [1],
    })) as RunCommand;
    expect(command).toEqual({
      cwd: dir,
      args: ['tests/checkout.spec.ts:3'],
      command: 'npx playwright test tests/checkout.spec.ts:3',
      env: { PIWI_ORIGIN: 'editor' },
    });
  });
});

describe('local runs over the latest CI run', () => {
  test('a test re-run from the editor clears the failure it fixed, and one it broke shows as a local failure', async () => {
    const overlay = {
      id: 42,
      status: 'failed',
      origin: 'editor',
      isFullRun: false,
      startTime: '2026-09-27T10:30:00.000Z',
      commit: 'a1b2c3d',
      totalTests: 2,
      passedTests: 1,
      failedTests: 1,
      flakyTests: 0,
      skippedTests: 0,
    };
    laidOver = {
      run: { ...MAIN_RUN, origin: 'ci', commit: 'a1b2c3d' },
      overlays: [overlay],
      failures: [
        {
          executionId: 950,
          testCaseId: 1,
          clusterId: null,
          title: 'pays',
          file: 'tests/checkout.spec.ts',
          line: 3,
          status: 'failed',
          headline: "getByRole('button', { name: 'Pay now' }) was not visible",
          location: '/home/dev/shop/tests/pages/checkout.page.ts:4:21',
          message: "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('button', { name: 'Pay now' })",
          frames: ['/home/dev/shop/tests/pages/checkout.page.ts:4:21'],
          traces: [],
          screenshot: null,
          source: 'overlay',
          runId: 42,
          browserName: 'chromium',
          duration: 1200,
          isNew: true,
          clusterTitle: null,
          owner: null,
        },
      ],
      resolved: [
        {
          testCaseId: 3,
          title: 'removes a row',
          file: 'tests/rows.spec.ts',
          line: 4,
          browserName: 'chromium',
          runId: 42,
          executionId: 951,
          baselineExecutionId: 900,
        },
      ],
    };
    try {
      const pushed = runStatuses.length;
      await client.sendRequest('piwi/refresh');
      const onPage = await waitFor(() => {
        const all = diagnostics.get(uri('tests/pages/checkout.page.ts')) ?? [];
        return all.some((d) => d.message.includes('local run #42')) ? all : undefined;
      });
      const failures = onPage.filter((d) => d.code === 'ci-failure');
      expect(failures).toEqual([
        expect.objectContaining({
          message: "getByRole('button', { name: 'Pay now' }) was not visible (pays, local run #42)",
          range: expect.objectContaining({ start: { line: 3, character: 2 } }),
          codeDescription: { href: `${url}/test-run-cases/950` },
        }),
      ]);

      const hover = (await client.sendRequest('textDocument/hover', {
        textDocument: { uri: uri('tests/pages/checkout.page.ts') },
        position: { line: 3, character: 30 },
      })) as { contents: { value: string } };
      expect(hover.contents.value).toContain(`**Local failure** · [pays](${url}/test-run-cases/950) · local run #42`);

      const rows = (await client.sendRequest('piwi/fileSummary', { uri: uri('tests/rows.spec.ts') })) as FileSummary;
      const fixed = rows.lines.find((l) => l.status !== undefined)!;
      expect(fixed).toMatchObject({ line: 3, status: 'passed' });
      expect(fixed.title).toMatch(/^passed 6\/9 · fixed locally in run #42 \(failing in run #41\)/);
      expect(fixed.failure).toBeUndefined();
      expect(rows.lines.filter((l) => l.title.startsWith('✗'))).toEqual([]);

      const listed = (await client.sendRequest('piwi/failures')) as FailuresResult;
      expect(listed.items).toEqual([
        expect.objectContaining({
          uri: uri('tests/pages/checkout.page.ts'),
          line: 3,
          title: 'pays',
          executionId: 950,
          runId: 42,
          source: 'local',
          state: 'failing',
          browserName: 'chromium',
        }),
        {
          uri: uri('tests/rows.spec.ts'),
          line: 3,
          title: 'removes a row',
          headline: null,
          executionId: 951,
          runId: 42,
          url: `${url}/test-run-cases/951`,
          hasTrace: false,
          source: 'local',
          state: 'fixed-locally',
          browserName: 'chromium',
        },
      ]);

      const status = (await client.sendRequest('piwi/runStatus')) as RunStatusResult;
      expect(status.contexts[0]).toMatchObject({
        run: { id: 41 },
        failures: 1,
        failingTests: 1,
        resolved: 1,
        overlays: 1,
      });
      expect(runStatuses.length).toBeGreaterThan(pushed);
      expect(runStatuses[runStatuses.length - 1]).toEqual(status);
    } finally {
      laidOver = null;
      await client.sendRequest('piwi/refresh');
    }
    const restored = await waitFor(() =>
      diagnostics
        .get(uri('tests/pages/checkout.page.ts'))
        ?.find((d) => d.code === 'ci-failure' && d.message.includes('run #41')),
    );
    expect(restored.message).toBe("locator('.cart-row').nth(2) was not found (removes a row, run #41)");
  });
});

describe('the desktop app', () => {
  test('is picked up when it starts, with the project linked to the folder, and offered to Connect', async () => {
    const desktopFile = path.join(dir, '.desktop.json');
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const stopDesktop = startServer(createConnection(toServer, toClient), {
      env: { PIWI_DESKTOP_CONFIG: desktopFile },
      debounceMs: 10,
      desktopWatchMs: 20,
    });
    const desktopClient = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
    desktopClient.listen();
    try {
      await desktopClient.sendRequest('initialize', {
        processId: null,
        rootUri: null,
        capabilities: {},
        workspaceFolders: [{ uri: pathToFileURL(dir).href, name: 'shop' }],
      });
      await desktopClient.sendNotification('initialized', {});
      const before = await waitFor(async () => {
        const s = (await desktopClient.sendRequest('piwi/status')) as StatusResult;
        return s.contexts[0]?.problem ? s : undefined;
      });
      expect(before.contexts[0]).toMatchObject({ connected: false, source: null });
      expect(await desktopClient.sendRequest('piwi/desktop')).toEqual({ url: null, projects: [], linked: null });

      fs.writeFileSync(desktopFile, JSON.stringify({ url, token: 'pd_desktop', projects: [{ id: 7, path: dir }] }));
      const after = await waitFor(async () => {
        const s = (await desktopClient.sendRequest('piwi/status')) as StatusResult;
        return s.contexts[0]?.connected ? s : undefined;
      });
      expect(after.contexts[0]).toMatchObject({ source: 'desktop', projectName: 'Acme Mugs', serverUrl: url });
      expect(await desktopClient.sendRequest('piwi/desktop')).toEqual({
        url,
        projects: [{ id: 7, name: 'Acme Mugs' }],
        linked: { id: 7, name: 'Acme Mugs' },
      });
    } finally {
      fs.rmSync(desktopFile, { force: true });
      stopDesktop();
      desktopClient.dispose();
    }
  });
});

describe('a branch with no run yet', () => {
  test('shows the default branch’s latest run, and says which branch it is', async () => {
    const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-editor-branch-')));
    fs.cpSync(dir, other, { recursive: true, filter: (src) => !src.split(path.sep).includes('.git') });
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
        cwd: other,
        stdio: 'ignore',
      });
    git('init', '-q', '-b', 'feature/new-cart');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const stopBranch = startServer(createConnection(toServer, toClient), {
      env: { PIWI_DASHBOARD_URL: url, PIWI_PROJECT_NAME: 'Acme Mugs', PIWI_DESKTOP_CONFIG: '/nonexistent' },
      debounceMs: 10,
    });
    const branchClient = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
    const published = new Map<string, Array<{ message: string }>>();
    branchClient.onNotification('textDocument/publishDiagnostics', (p: { uri: string; diagnostics: [] }) => {
      published.set(p.uri, p.diagnostics);
    });
    branchClient.listen();
    try {
      await branchClient.sendRequest('initialize', {
        processId: null,
        rootUri: null,
        capabilities: {},
        workspaceFolders: [{ uri: pathToFileURL(other).href, name: 'shop' }],
      });
      await branchClient.sendNotification('initialized', {});
      const status = await waitFor(async () => {
        const s = (await branchClient.sendRequest('piwi/runStatus')) as RunStatusResult;
        return s.contexts[0]?.run ? s : undefined;
      });
      expect(status.contexts[0]).toMatchObject({ branch: 'main', checkedOut: 'feature/new-cart', run: { id: 41 } });
      const onPage = await waitFor(() =>
        published.get(pathToFileURL(path.join(other, 'tests/pages/checkout.page.ts')).href),
      );
      expect(onPage[0]?.message).toContain('run #41 on main');
    } finally {
      stopBranch();
      branchClient.dispose();
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('the desktop app chosen with Connect', () => {
  test('comes before the instance the environment names, which the status keeps, and says so', async () => {
    const desktopFile = path.join(dir, '.desktop-chosen.json');
    fs.writeFileSync(desktopFile, JSON.stringify({ url, token: 'pd_desktop', projects: [{ id: 7, path: dir }] }));
    // The team's instance, not reachable from here.
    const team = 'http://127.0.0.1:9';
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const stopChosen = startServer(createConnection(toServer, toClient), {
      env: { PIWI_DASHBOARD_URL: team, PIWI_DESKTOP_CONFIG: desktopFile },
      debounceMs: 10,
    });
    const chosenClient = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
    const notified: StatusResult[] = [];
    chosenClient.onNotification('piwi/statusChanged', (s: StatusResult) => {
      notified.push(s);
    });
    chosenClient.listen();
    try {
      await chosenClient.sendRequest('initialize', {
        processId: null,
        rootUri: null,
        capabilities: {},
        workspaceFolders: [{ uri: pathToFileURL(dir).href, name: 'shop' }],
      });
      await chosenClient.sendNotification('initialized', {});
      const before = await waitFor(() => notified.find((s) => s.contexts[0]?.problem));
      expect(before.contexts[0]).toMatchObject({ source: 'environment', serverUrl: team, connected: false });
      expect(before.desktopUrl).toBe(url);

      await chosenClient.sendNotification('piwi/setCredentials', { desktop: true });
      const after = await waitFor(() => notified.find((s) => s.contexts[0]?.connected));
      expect(after.contexts[0]).toMatchObject({
        source: 'desktop',
        serverUrl: url,
        projectName: 'Acme Mugs',
        instance: { serverUrl: team, source: 'environment' },
      });
    } finally {
      fs.rmSync(desktopFile, { force: true });
      stopChosen();
      chosenClient.dispose();
    }
  });
});

describe('jobs for the desktop app running beside a team instance', () => {
  test('offer Flake Lab on a flaky test and on a failure whose test has an untested suspect', async () => {
    const desktopFile = path.join(dir, '.desktop-beside.json');
    // The app runs, but the environment names the team instance, which the context reads.
    fs.writeFileSync(desktopFile, JSON.stringify({ url: 'http://127.0.0.1:9', token: 'pd_desktop', projects: [] }));
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const stopBeside = startServer(createConnection(toServer, toClient), {
      env: { PIWI_DASHBOARD_URL: url, PIWI_PROJECT_NAME: 'Acme Mugs', PIWI_DESKTOP_CONFIG: desktopFile },
      debounceMs: 10,
    });
    const beside = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
    const published = new Map<string, Array<{ code?: string; range: unknown; source?: string }>>();
    beside.onNotification('textDocument/publishDiagnostics', (p: { uri: string; diagnostics: never[] }) => {
      published.set(p.uri, p.diagnostics);
    });
    beside.listen();
    const openHere = (file: string, text: string) =>
      beside.sendNotification('textDocument/didOpen', {
        textDocument: { uri: uri(file), languageId: 'typescript', version: 1, text },
      });
    try {
      await beside.sendRequest('initialize', {
        processId: null,
        rootUri: null,
        capabilities: {},
        workspaceFolders: [{ uri: pathToFileURL(dir).href, name: 'shop' }],
      });
      await beside.sendNotification('initialized', {});
      await openHere('tests/checkout.spec.ts', fs.readFileSync(path.join(dir, 'tests/checkout.spec.ts'), 'utf8'));
      await openHere('tests/pages/checkout.page.ts', PAGE_OBJECT);

      const lines = await waitFor(async () => {
        const summary = (await beside.sendRequest('piwi/fileSummary', {
          uri: uri('tests/checkout.spec.ts'),
        })) as FileSummary;
        return summary.lines.some((l) => l.command?.command === 'piwi.desktopJob') ? summary.lines : undefined;
      });
      expect(lines.map((l) => l.title).slice(-4)).toEqual([
        'flaky 18% · top suspect: slow GET /api/cart (reproduced 7 of 10)',
        'Reproduce this flake',
        'Reproduce this flake in the desktop app',
        'Verify the flake fix',
      ]);
      expect(lines.find((l) => l.command?.command === 'piwi.desktopJob')!.command).toEqual({
        title: 'Reproduce this flake in the desktop app',
        command: 'piwi.desktopJob',
        arguments: [{ root: dir, testCaseId: 1, kind: 'flake-lab' }],
      });

      const failure = await waitFor(() =>
        published.get(uri('tests/pages/checkout.page.ts'))?.find((d) => d.code === 'ci-failure'),
      );
      const actions = (await beside.sendRequest('textDocument/codeAction', {
        textDocument: { uri: uri('tests/pages/checkout.page.ts') },
        range: failure.range,
        context: { diagnostics: [failure] },
      })) as Array<{ title: string; command?: { command: string; arguments: unknown[] } }>;
      const jobs = actions.filter((a) => a.command?.command === 'piwi.desktopJob');
      expect(jobs.map((a) => [a.title, a.command!.arguments[0]])).toEqual([
        ['Reproduce in the desktop app', { root: dir, executionId: 900, kind: 'reproduce' }],
        ['Find the breaking commit in the desktop app', { root: dir, executionId: 900, kind: 'bisect' }],
        [
          'Run Flake Lab on its untested suspects in the desktop app',
          { root: dir, executionId: 900, testCaseId: 3, kind: 'flake-lab' },
        ],
      ]);
    } finally {
      fs.rmSync(desktopFile, { force: true });
      stopBeside();
      beside.dispose();
    }
  });
});

describe('recording from the editor', () => {
  const pay = (pageUrl: string): RecordedStep => ({
    action: 'fill',
    target: {
      tagName: 'input',
      role: 'textbox',
      accessibleName: 'Amount',
      testId: 'not-on-the-page',
      text: null,
      alternatives: [{ locator: "getByTestId('not-on-the-page')", method: 'getByTestId', score: 100 }],
    },
    value: '42',
    redacted: false,
    pageUrl,
    timestamp: 2,
  });
  const goto = (url: string): RecordedStep => ({
    action: 'goto',
    target: null,
    value: url,
    redacted: false,
    pageUrl: url,
    timestamp: 1,
  });
  const payNow: RecordedStep = {
    action: 'click',
    target: {
      tagName: 'button',
      role: 'button',
      accessibleName: 'Pay now',
      testId: null,
      text: 'Pay now',
      alternatives: [{ locator: "getByRole('button', { name: 'Pay now' })", method: 'getByRole', score: 90 }],
    },
    value: null,
    redacted: false,
    pageUrl: 'https://shop.test/checkout',
    timestamp: 3,
  };

  let recorder: MessageConnection;
  let stopRecorder: () => void;
  let distDir = '';
  const updates: RecordingUpdate[] = [];
  const launchers: Array<{ cwd: string; events: LauncherEvents; sent: ServiceToLauncher[] }> = [];
  const optionsRead: string[] = [];

  beforeAll(async () => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-editor-dist-'));
    fs.writeFileSync(path.join(distDir, 'record-ide.js'), '');
    fs.writeFileSync(path.join(distDir, 'record-ide-messages.json'), JSON.stringify({ en: { a: { message: 'A' } } }));
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    stopRecorder = startServer(createConnection(toServer, toClient), {
      env: { PIWI_DASHBOARD_URL: url, PIWI_PROJECT_NAME: 'Acme Mugs', PIWI_DESKTOP_CONFIG: '/nonexistent' },
      debounceMs: 10,
      distDir,
      readProjectOptions: async (configFile) => {
        optionsRead.push(configFile);
        return {
          configFile,
          rootDir: dir,
          projects: [{ name: 'chromium', testDir: path.join(dir, 'tests'), use: { baseURL: 'https://shop.test/' } }],
        };
      },
      launchRecorder: (cwd, events) => {
        const launcher = { cwd, events, sent: [] as ServiceToLauncher[] };
        launchers.push(launcher);
        return { send: (m) => launcher.sent.push(m), kill: () => {} };
      },
    });
    recorder = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
    recorder.onNotification('piwi/recordingChanged', (u: RecordingUpdate) => {
      updates.push(u);
    });
    recorder.listen();
    await recorder.sendRequest('initialize', {
      processId: null,
      rootUri: null,
      capabilities: {},
      workspaceFolders: [{ uri: pathToFileURL(dir).href, name: 'shop' }],
    });
    await recorder.sendNotification('initialized', {});
    await waitFor(async () => {
      const s = (await recorder.sendRequest('piwi/status')) as StatusResult;
      return s.contexts[0]?.connected ? s : undefined;
    });
  });

  afterAll(() => {
    stopRecorder?.();
    recorder?.dispose();
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  const openHere = (file: string, text: string) =>
    recorder.sendNotification('textDocument/didOpen', {
      textDocument: { uri: uri(file), languageId: 'typescript', version: 1, text },
    });

  test('offers the page expressions at the caret, and where it is', async () => {
    const text = [
      "import { test } from '@playwright/test';",
      "test('approves', async ({ adminPage, userPage }) => {",
      "  await userPage.goto('/inbox');",
      '',
      '});',
    ].join('\n');
    await openHere('tests/approve.spec.ts', text);
    const result = (await recorder.sendRequest('piwi/pageCandidates', {
      uri: uri('tests/approve.spec.ts'),
      line: 3,
      character: 0,
    })) as PageCandidatesResult;
    expect(result).toEqual({
      context: 'test',
      default: 'userPage',
      candidates: [
        { expression: 'userPage', reason: 'used on line 3' },
        { expression: 'adminPage', reason: 'fixture of this test' },
      ],
    });
    const atTop = (await recorder.sendRequest('piwi/pageCandidates', {
      uri: uri('tests/approve.spec.ts'),
      line: 0,
      character: 0,
    })) as PageCandidatesResult;
    expect(atTop).toMatchObject({ context: 'file', default: 'userPage' });
  });

  test('renders steps on the page expression at the caret, with their imports apart when asked', async () => {
    const steps = toStepsDocument(
      buildSession([goto('https://shop.test/checkout'), pay('https://shop.test/checkout')], 1),
    );
    const inPageObject = (await recorder.sendRequest('piwi/renderSteps', {
      uri: uri('tests/pages/checkout.page.ts'),
      steps: toStepsDocument(buildSession([goto('https://shop.test/checkout'), payNow], 1)),
      line: 2,
      character: 0,
    })) as RenderStepsResult;
    expect(inPageObject.code).toContain("  await this.page.getByRole('button', { name: 'Pay now' }).click();");
    expect(inPageObject.code).toContain("  await this.page.goto('/checkout');");
    expect(inPageObject.imports).toBeUndefined();

    const separate = (await recorder.sendRequest('piwi/renderSteps', {
      uri: uri('tests/checkout.spec.ts'),
      steps,
      imports: 'separate',
    })) as RenderStepsResult;
    expect(separate.imports).toEqual(["import { CheckoutPage } from 'tests/pages/checkout.page.ts';"]);
    expect(separate.code).not.toContain('// Needs:');
    expect(separate.code).toContain("  await checkoutPage.pay('');");

    const comments = (await recorder.sendRequest('piwi/renderSteps', {
      uri: uri('tests/checkout.spec.ts'),
      steps,
    })) as RenderStepsResult;
    expect(comments.code).toContain("  // Needs: import { CheckoutPage } from 'tests/pages/checkout.page.ts';");
    expect(comments.imports).toBeUndefined();
  });

  test('renders steps without the imports the open file has, nor a page object the test declares already', async () => {
    const text = [
      "import { test } from '@playwright/test';",
      'import {',
      '  CheckoutPage,',
      '} from "tests/pages/checkout.page.ts"',
      "test('pays', async ({ page }) => {",
      '  const checkoutPage = new CheckoutPage(page);',
      '',
      '});',
    ].join('\n');
    await openHere('tests/declared.spec.ts', text);
    const rendered = (await recorder.sendRequest('piwi/renderSteps', {
      uri: uri('tests/declared.spec.ts'),
      steps: toStepsDocument(buildSession([goto('https://shop.test/checkout'), pay('https://shop.test/checkout')], 1)),
      line: 6,
      character: 0,
      imports: 'separate',
    })) as RenderStepsResult;
    expect(rendered.imports).toEqual([]);
    expect(rendered.code).not.toContain('new CheckoutPage');
    expect(rendered.code).toContain("  await checkoutPage.pay('');");
  });

  test('writes paths only when the flow was recorded on the baseURL’s origin', async () => {
    const elsewhere = (await recorder.sendRequest('piwi/renderSteps', {
      uri: uri('tests/checkout.spec.ts'),
      steps: toStepsDocument(buildSession([goto('https://staging.shop.test/cart')], 1)),
    })) as RenderStepsResult;
    expect(elsewhere.code).toContain("await page.goto('https://staging.shop.test/cart');");
    const onBase = (await recorder.sendRequest('piwi/renderSteps', {
      uri: uri('tests/checkout.spec.ts'),
      steps: toStepsDocument(buildSession([goto('https://shop.test/cart')], 1)),
    })) as RenderStepsResult;
    expect(onBase.code).toContain("await page.goto('/cart');");
    expect(optionsRead).toContain(path.join(dir, 'playwright.config.ts'));
  });

  test('records into a file through the launcher: the block, pause and resume, and Stop', async () => {
    const text = ["import { test } from '@playwright/test';", "test('pays', async ({ page }) => {", '', '});', ''].join(
      '\n',
    );
    await openHere('tests/recorded.spec.ts', text);
    const result = (await recorder.sendRequest('piwi/record', {
      uri: uri('tests/recorded.spec.ts'),
      line: 2,
      character: 0,
      into: 'steps',
      startUrl: '/checkout',
      language: 'fr',
    })) as RecordResult;
    expect(result).toMatchObject({ ok: true, placement: { line: 2, newLine: false, indent: '  ' } });
    const launcher = launchers[launchers.length - 1]!;
    expect(launcher.cwd).toBe(dir);
    const start = launcher.sent[0] as { type: 'start'; request: LaunchRequest };
    expect(start.request).toMatchObject({
      startUrl: 'https://shop.test/checkout',
      settings: { file: 'recorded.spec.ts', testIdAttribute: null },
      language: { code: 'fr', messages: { a: { message: 'A' } } },
    });

    const count = updates.length;
    launcher.events.message({ type: 'started' });
    launcher.events.message({
      type: 'event',
      event: {
        kind: 'navigate',
        target: null,
        value: 'https://shop.test/checkout',
        checked: null,
        inputType: null,
        isPasswordField: false,
        pageUrl: 'https://shop.test/checkout',
        timestamp: Date.now(),
      },
    });
    const latest = await waitFor(() => (updates.length >= count + 2 ? updates[updates.length - 1] : undefined));
    expect(latest).toMatchObject({
      sessionId: result.sessionId,
      uri: uri('tests/recorded.spec.ts'),
      into: 'steps',
      state: 'recording',
      code: "await page.goto('/checkout');",
    });

    await recorder.sendRequest('piwi/recordingCommand', { sessionId: result.sessionId, command: 'pause' });
    await recorder.sendRequest('piwi/recordingCommand', { sessionId: result.sessionId, command: 'resume' });
    await waitFor(() => (updates.length >= count + 4 ? true : undefined));
    expect(updates[count + 2]).toMatchObject({ state: 'paused', code: "await page.goto('/checkout');" });
    expect(updates[count + 3]).toMatchObject({ state: 'recording', code: "await page.goto('/checkout');" });

    const stopping = recorder.sendRequest('piwi/stopRecording', { sessionId: result.sessionId });
    await waitFor(() =>
      updates.some((u) => u.sessionId === result.sessionId && u.state === 'stopped') ? true : undefined,
    );
    expect(launcher.sent.map((m) => m.type)).toEqual(['start', 'pause', 'pause', 'stop']);
    launcher.events.exit(0, null);
    expect(await stopping).toBeNull();
  });

  test('a new test between the lines of a file; closing the file stops its recording', async () => {
    const text = "import { test } from '@playwright/test';\n\n";
    await openHere('tests/closing.spec.ts', text);
    const result = (await recorder.sendRequest('piwi/record', {
      uri: uri('tests/closing.spec.ts'),
      line: 1,
      character: 0,
      into: 'test',
    })) as RecordResult;
    expect(result).toMatchObject({ ok: true, placement: { line: 1, newLine: false, indent: '' } });
    const launcher = launchers[launchers.length - 1]!;
    launcher.events.message({ type: 'started' });
    await recorder.sendNotification('textDocument/didClose', { textDocument: { uri: uri('tests/closing.spec.ts') } });
    const last = await waitFor(() => updates.find((u) => u.sessionId === result.sessionId && u.state === 'stopped'));
    expect(last.message).toBe('The file was closed: the recording stopped.');
    expect(last.code).toBe("test('recorded flow', async ({ page }) => {\n});");
  });

  test('a file outside every Playwright config cannot be recorded into', async () => {
    const outside = (await recorder.sendRequest('piwi/record', {
      uri: pathToFileURL(path.join(os.tmpdir(), 'nowhere.spec.ts')).href,
      line: 0,
      character: 0,
      into: 'file',
    })) as RecordResult;
    expect(outside).toEqual({
      ok: false,
      message: 'No Playwright config holds this file: open the folder of its playwright.config.ts.',
    });
  });
});

describe('the bundle', () => {
  test('answers initialize over stdio', async (ctx) => {
    const bundle = path.join(__dirname, '..', 'dist', 'piwi-language-server.cjs');
    if (!fs.existsSync(bundle)) return ctx.skip();
    const child = spawn(process.execPath, [bundle, '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!),
    );
    connection.listen();
    const result = (await connection.sendRequest('initialize', {
      processId: null,
      rootUri: null,
      capabilities: {},
    })) as {
      serverInfo: { name: string };
    };
    expect(result.serverInfo.name).toBe('Piwi');
    connection.dispose();
    child.kill();
  });
});
