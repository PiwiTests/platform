// Integration tests: VS Code (downloaded by @vscode/test-electron) opens a
// fixture repository with the built extension, against a stub Piwi instance
// served from this process. Under Linux without a display, run it through
// `xvfb-run -a`.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(here, '..', '..');

const test = (id, title, file, status) => ({ id, title, file, suite: [], status });
const use = (t, site) => ({
  test: t,
  actions: ['click'],
  callSites: [site],
  projects: ['chromium'],
  branches: ['main'],
});
const INDEX = {
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
    test(1, 'pays', 'tests/checkout.spec.ts', 'passed'),
    test(3, 'removes a row', 'tests/checkout.spec.ts', 'failed'),
  ],
  locators: [
    {
      locator: "getByRole('button', { name: 'Pay now' })",
      lastSeenAt: '',
      uses: [use(0, 'tests/pages/checkout.page.ts:4:21')],
    },
    { locator: "locator('.cart-row').nth(2)", lastSeenAt: '', uses: [use(1, 'tests/pages/checkout.page.ts:5:21')] },
  ],
  truncated: false,
};
const FAILURES = {
  run: {
    id: 41,
    status: 'failed',
    branch: 'main',
    startTime: '2026-09-27T10:00:00.000Z',
    totalTests: 2,
    passedTests: 1,
    failedTests: 1,
    flakyTests: 0,
    skippedTests: 0,
  },
  failures: [
    {
      executionId: 900,
      testCaseId: 3,
      title: 'removes a row',
      file: 'tests/checkout.spec.ts',
      line: 3,
      status: 'failed',
      headline: "locator('.cart-row').nth(2) was not found",
      location: '/ci/work/tests/pages/checkout.page.ts:5:21',
      traces: ['traces/900.zip'],
      screenshot: null,
    },
  ],
};
const HEALING = {
  recommendation: { recommended: { locator: "getByRole('row', { name: /Mug/ })" } },
  edit: {
    filePath: 'tests/pages/checkout.page.ts',
    line: 5,
    oldLine: "  row = () => this.page.locator('.cart-row').nth(2);",
    newLine: "  row = () => this.page.getByRole('row', { name: /Mug/ });",
    unifiedDiff: null,
  },
};

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const u = req.url ?? '';
  const answer = (body) => res.end(JSON.stringify(body));
  if (u === '/api/projects/menu') return answer({ items: [{ id: 7, name: 'Acme Mugs' }] });
  if (u.startsWith('/api/projects/7/locator-index')) return answer(INDEX);
  if (u.startsWith('/api/projects/7/code-index'))
    return answer({ files: [], tests: [], reach: [], builtAt: null, truncated: false });
  if (u.startsWith('/api/projects/7/test-cases'))
    return answer({
      items: [
        { id: 1, title: 'pays', filePath: 'tests/checkout.spec.ts', status: 'passed', totalRuns: 50, passedRuns: 48 },
      ],
    });
  if (u.startsWith('/api/projects/7/locator-alternatives')) return answer({ items: [] });
  if (u.startsWith('/api/projects/7/branch-failures')) return answer(FAILURES);
  if (u === '/api/projects/7/test-functions') return answer({ testFunctions: [] });
  if (u === '/api/test-run-cases/900/locator-healing') return answer(HEALING);
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;

const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-vscode-')));
const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
  fs.writeFileSync(path.join(workspace, file), text);
};
write('playwright.config.ts', 'export default {};\n');
write(
  'tests/pages/checkout.page.ts',
  [
    "import type { Page } from '@playwright/test';",
    'export class CheckoutPage {',
    '  constructor(private readonly page: Page) {}',
    "  pay = () => this.page.getByRole('button', { name: 'Pay now' });",
    "  row = () => this.page.locator('.cart-row').nth(2);",
    '}',
    '',
  ].join('\n'),
);
write('tests/checkout.spec.ts', "import { test } from '@playwright/test';\n\ntest('pays', async ({ page }) => {});\n");
const git = (...args) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: workspace,
    stdio: 'ignore',
  });
git('init', '-q', '-b', 'main');
git('add', '.');
git('commit', '-q', '-m', 'init');

let code = 0;
try {
  await runTests({
    version: process.env.VSCODE_TEST_VERSION || 'stable',
    extensionDevelopmentPath: extensionPath,
    extensionTestsPath: path.join(here, 'suite.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome'],
    extensionTestsEnv: {
      PIWI_DASHBOARD_URL: url,
      PIWI_PROJECT_NAME: 'Acme Mugs',
      PIWI_DESKTOP_CONFIG: path.join(workspace, 'no-desktop.json'),
      PIWI_TEST_WORKSPACE: workspace,
    },
  });
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  server.close();
  fs.rmSync(workspace, { recursive: true, force: true });
}
process.exit(code);
