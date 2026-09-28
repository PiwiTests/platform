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
import { buildSession } from '@piwitests/core/recording';
import { toStepsDocument } from '@piwitests/core/steps';
import { startServer } from '../src/server';
import type {
  FailuresResult,
  FileSummary,
  McpServersResult,
  RenderStepsResult,
  RunCommand,
  RunStatusResult,
  StatusResult,
  TestsForFile,
  TraceResult,
} from '../src/protocol';

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
    { id: 3, title: 'removes a row', file: 'tests/checkout.spec.ts', suite: [], status: 'failed' },
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

const COMPONENT = '<template>\n  <button class="pay">\n    Pay now\n  </button>\n</template>\n';

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

async function waitFor<T>(read: () => T | undefined, ms = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = read();
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
    if (u === '/api/projects/7/branch-failures?branch=main') {
      return res.end(
        JSON.stringify({
          run: {
            id: 41,
            status: 'failed',
            branch: 'main',
            startTime: '2026-09-27T10:00:00.000Z',
            totalTests: 3,
            passedTests: 1,
            failedTests: 1,
            flakyTests: 1,
            skippedTests: 0,
          },
          failures: [
            {
              executionId: 900,
              testCaseId: 3,
              clusterId: 77,
              title: 'removes a row',
              file: 'tests/checkout.spec.ts',
              line: 3,
              status: 'failed',
              headline: "locator('.cart-row').nth(2) was not found",
              location: '/ci/work/tests/pages/checkout.page.ts:5:21',
              traces: ['traces/900.zip'],
              screenshot: 'shots/900.png',
            },
          ],
        }),
      );
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
      arguments: [{ cwd: dir, command: 'npx playwright test tests/checkout.spec.ts:3' }],
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
        run: expect.objectContaining({ id: 41, status: 'failed', failedTests: 1, url: `${url}/test-runs/41` }),
        failures: 1,
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
