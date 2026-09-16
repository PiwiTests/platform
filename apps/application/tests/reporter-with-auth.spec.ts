import { test, expect } from './fixtures';
import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { existsSync, rmSync } from 'fs';
import { PROJECT } from '#shared/test-project-names';

function safeRmSync(path: string, options?: Parameters<typeof rmSync>[1]) {
  try {
    if (existsSync(path)) rmSync(path, options);
  } catch {
    // File may be locked by another process (e.g. auth server's SQLite on Windows)
  }
}

const AUTH_PORT = 3099;
const AUTH_SERVER_URL = `http://localhost:${AUTH_PORT}`;
const DB_PATH = join(process.cwd(), '.test-temp', 'auth-test.db');
const STORAGE_PATH = join(process.cwd(), '.test-temp', 'auth-test-storage');

/**
 * Run a CommonJS reporter script in a dedicated Node.js subprocess.
 * The reporter package is CommonJS and cannot be imported directly from this
 * ESM test file, so we pipe the script as stdin to `node --input-type=commonjs`.
 */
function runReporterScript(cjsScript: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    const proc = spawn('node', ['--input-type=commonjs'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('close', (code) => resolveP({ exitCode: code ?? 0, stdout, stderr }));
    proc.stdin!.write(cjsScript);
    proc.stdin!.end();
  });
}

test.describe.serial('Reporter with authentication enabled', () => {
  // The auth server (port 3099) is only started by the playwright webServer config
  // when running in CI. Skip all tests in this file when not in CI.
  test.skip(!process.env.CI, 'Auth server tests only run in CI (see playwright.config.ts webServer)');

  test.beforeAll(() => {
    // Clean up test database and storage before running, in case of retries from a previous run
    for (const path of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) safeRmSync(path);
    safeRmSync(STORAGE_PATH, { recursive: true, force: true });
  });

  test.afterAll(() => {
    // Clean up test database and storage created by the auth server
    for (const path of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) safeRmSync(path);
    safeRmSync(STORAGE_PATH, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Auth server sanity checks
  // ---------------------------------------------------------------------------

  test('/api/auth/me should indicate auth is enabled and no user is logged in', async ({ request }) => {
    const res = await request.get(`${AUTH_SERVER_URL}/api/auth/me`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // When auth is enabled and no session exists, authenticated is false
    expect(data.authenticated).toBe(false);
    expect(data.user).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Initial setup — the login page swaps to a first-admin form while the users
  // table is empty, and creating the admin signs them straight in.
  // ---------------------------------------------------------------------------

  test('first-admin setup form creates the admin from the browser', async ({ page }) => {
    await page.goto(`${AUTH_SERVER_URL}/login`);
    await expect(page.getByRole('heading', { name: 'Create the first admin account' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Username*' }).fill('admin');
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Administrator');
    await page.getByRole('textbox', { name: 'Password*', exact: true }).fill('adminpassword123');
    await page.getByRole('textbox', { name: 'Confirm password*' }).fill('adminpassword123');
    await page.getByRole('button', { name: 'Create admin account' }).click();

    // Setup logs the new admin in and lands on the dashboard.
    await expect(page.getByText('Admin account created', { exact: true })).toBeVisible();
    await page.waitForURL(`${AUTH_SERVER_URL}/`);
  });

  test('setup endpoint should reject a second call once users exist', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/auth/setup`, {
      data: { username: 'admin2', password: 'password123' },
    });
    expect(res.status()).toBe(400);
  });

  test('login form rejects a wrong password, then signs in with the right one', async ({ page }) => {
    await page.goto(`${AUTH_SERVER_URL}/login`);
    // With the admin created, the page shows the login card, not the setup card.
    await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Username*' }).fill('admin');
    await page.getByRole('textbox', { name: 'Password*', exact: true }).fill('wrongpassword');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByText('Invalid username or password').first()).toBeVisible();

    await page.getByRole('textbox', { name: 'Password*', exact: true }).fill('adminpassword123');
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(`${AUTH_SERVER_URL}/`);
  });

  test('password-recovery pages are reachable without a session', async ({ page }) => {
    await page.goto(`${AUTH_SERVER_URL}/forgot-password`);
    await expect(page.getByRole('heading', { name: 'Forgot password' })).toBeVisible();
    await expect(page).toHaveURL(`${AUTH_SERVER_URL}/forgot-password`);

    await page.goto(`${AUTH_SERVER_URL}/reset-password`);
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(page).toHaveURL(`${AUTH_SERVER_URL}/reset-password`);
  });

  // ---------------------------------------------------------------------------
  // Login / logout
  // ---------------------------------------------------------------------------

  test('should log in with valid credentials', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.user.username).toBe('admin');
  });

  test('should reject login with invalid credentials', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'wrongpassword' },
    });
    expect(res.status()).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Protected endpoints are blocked without auth
  // ---------------------------------------------------------------------------

  test('submit endpoint should return 401 without authentication', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.REPORTER_AUTH,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      },
    });
    expect(res.status()).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Create a dedicated reporter user
  // ---------------------------------------------------------------------------

  test('admin can create a reporter user', async ({ request }) => {
    // Log in as admin first
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    // Create a reporter user
    const res = await request.post(`${AUTH_SERVER_URL}/api/users`, {
      data: {
        username: 'ci-reporter',
        password: 'reporterpassword123',
        role: 'reporter',
        name: 'CI Reporter',
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.user.username).toBe('ci-reporter');
    expect(data.user.role).toBe('reporter');

    // Grant the reporter global project access. With the project-affectation
    // feature, newly created users have no project access by default, so the
    // reporter must be assigned access before it can create/submit projects.
    const assignRes = await request.put(`${AUTH_SERVER_URL}/api/users/${data.user.id}/projects`, {
      data: { global: true, projectIds: [] },
    });
    expect(assignRes.ok()).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Reporter submits results when authenticated
  // ---------------------------------------------------------------------------

  test('reporter can submit test results after login', async ({ request }) => {
    // Login as reporter user
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    // Submit test results in the same authenticated session
    const submitRes = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.REPORTER_AUTH,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 2,
        passedTests: 2,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'login page loads',
            status: 'passed',
            duration: 1200,
            location: 'tests/login.spec.ts:5:3',
            retries: 0,
          },
          {
            title: 'dashboard shows stats',
            status: 'passed',
            duration: 800,
            location: 'tests/dashboard.spec.ts:10:3',
            retries: 0,
          },
        ],
      },
    });
    expect(submitRes.ok()).toBeTruthy();
    const data = await submitRes.json();
    expect(data.success).toBe(true);
    expect(data.runId).toBeDefined();
    expect(data.projectId).toBeDefined();
  });

  // Roles are enforced from each route's `x-required-roles` OpenAPI meta (the
  // single source of truth). A reporter must be refused an administrator-only
  // route but allowed on an any-authenticated one.
  test('reporter is refused an admin-only route but allowed an any-auth route', async ({ request }) => {
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    // admin-only (x-required-roles: ['administrator'])
    const adminOnly = await request.get(`${AUTH_SERVER_URL}/api/admin/stats`);
    expect(adminOnly.status()).toBe(403);
    const createUser = await request.post(`${AUTH_SERVER_URL}/api/users`, {
      data: { username: 'nope-user', password: 'nopepassword123', role: 'user' },
    });
    expect(createUser.status()).toBe(403);

    // any authenticated user (x-required-roles: ['administrator', 'reporter', 'user'])
    const anyAuth = await request.get(`${AUTH_SERVER_URL}/api/projects`);
    expect(anyAuth.ok()).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Reporter module – login + submit flow (verified via direct HTTP calls)
  // The reporter's upload helpers are CommonJS and cannot be imported from an
  // ESM test file; we verify the same HTTP contract they rely on directly.
  // ---------------------------------------------------------------------------

  test('reporter lib: login endpoint returns a session cookie', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' },
    });
    expect(res.ok()).toBeTruthy();
    // The server must set at least one session cookie
    const headers = res.headers();
    expect(headers['set-cookie']).toBeTruthy();
  });

  test('reporter lib: login endpoint rejects wrong credentials', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'wrongpassword' },
    });
    expect(res.status()).toBe(401);
  });

  test('reporter lib: session cookie allows submit after login', async ({ request }) => {
    // Login first – the request fixture keeps the session cookie for this test
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    // Submit is accepted because the session cookie is sent automatically
    const submitRes = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.REPORTER_AUTH_LIB,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 3000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'submit via session cookie',
            status: 'passed',
            duration: 500,
            location: 'tests/lib.spec.ts:1:1',
            retries: 0,
          },
        ],
      },
    });
    expect(submitRes.ok()).toBeTruthy();
    const data = await submitRes.json();
    expect(data.success).toBe(true);
    expect(data.runId).toBeDefined();
  });

  test('reporter lib: submit without session cookie returns 401', async ({ request }) => {
    // A fresh request context has no session cookie, so submit must be rejected
    const submitRes = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.REPORTER_AUTH_LIB,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      },
    });
    expect(submitRes.status()).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Full PiwiDashboardReporter flow with username/password options
  // The reporter package is CommonJS, so we run it in a dedicated Node.js
  // subprocess using --input-type=commonjs to avoid ESM/CJS interop issues.
  // ---------------------------------------------------------------------------

  test('PiwiDashboardReporter submits results with username/password options', async ({ request }) => {
    const reporterPath = resolve(process.cwd(), '..', '..', 'packages', 'reporter', 'dist', 'index.js');
    const testFilePath = join(resolve(process.cwd()), 'tests', 'home.spec.ts');

    const { exitCode, stderr } = await runReporterScript(`
      const _mod = require(${JSON.stringify(reporterPath)}); const PiwiDashboardReporter = _mod.default ?? _mod;
      const reporter = new PiwiDashboardReporter({
        serverUrl: ${JSON.stringify(AUTH_SERVER_URL)},
        projectName: ${JSON.stringify(PROJECT.REPORTER_FULL_AUTH)},
        uploadReport: false,
        uploadTraces: false,
        collectScmInfo: false,
        collectCiInfo: false,
        collectPerformanceMetrics: false,
        username: 'ci-reporter',
        password: 'reporterpassword123',
        verbose: false
      });
      reporter.onBegin(
        { projects: [], workers: 1, timeout: 30000, fullyParallel: false },
        { allTests: () => [] }
      );
      reporter.onTestEnd(
        { title: 'homepage renders correctly', location: { file: ${JSON.stringify(testFilePath)}, line: 5, column: 3 } },
        { status: 'passed', duration: 900, error: null, retry: 0, attachments: [], steps: [] }
      );
      reporter.onEnd({ status: 'passed' }).then(() => {
        process.exit(0);
      }).catch(err => {
        console.error(err.message);
        process.exit(1);
      });
    `);

    expect(exitCode, `Reporter subprocess failed:\n${stderr}`).toBe(0);

    // Log in to authenticate for the verification call
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    // Verify the project was created
    const projectsRes = await request.get(`${AUTH_SERVER_URL}/api/projects`);
    expect(projectsRes.ok()).toBeTruthy();
    const projects = ((await projectsRes.json()) as { items: Array<{ name: string }> }).items;
    expect(projects.find((p) => p.name === PROJECT.REPORTER_FULL_AUTH)).toBeDefined();
  });

  test('PiwiDashboardReporter fails when auth is required but no credentials given', async () => {
    const reporterPath = resolve(process.cwd(), '..', '..', 'packages', 'reporter', 'dist', 'index.js');

    const { exitCode } = await runReporterScript(`
      const _mod = require(${JSON.stringify(reporterPath)}); const PiwiDashboardReporter = _mod.default ?? _mod;
      const reporter = new PiwiDashboardReporter({
        serverUrl: ${JSON.stringify(AUTH_SERVER_URL)},
        projectName: ${JSON.stringify(PROJECT.REPORTER_NO_AUTH)},
        uploadReport: false,
        uploadTraces: false,
        collectScmInfo: false,
        collectCiInfo: false,
        collectPerformanceMetrics: false,
        verbose: false
      });
      reporter.onBegin(
        { projects: [], workers: 1, timeout: 30000, fullyParallel: false },
        { allTests: () => [] }
      );
      reporter.onEnd({ status: 'passed' }).then(() => {
        process.exit(0);
      }).catch(() => {
        process.exit(1);
      });
    `);

    // Without credentials, the reporter must fail
    expect(exitCode).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // API key management
  // ---------------------------------------------------------------------------

  let reporterApiKey: string | null = null;

  test('admin can create an API key for the reporter user', async ({ request }) => {
    // Login as admin
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    // Get reporter user id
    const usersRes = await request.get(`${AUTH_SERVER_URL}/api/users`);
    expect(usersRes.ok()).toBeTruthy();
    const usersData = await usersRes.json();
    const reporterUser = usersData.items.find((u: { username: string }) => u.username === 'ci-reporter');
    expect(reporterUser).toBeDefined();

    // Create API key
    const createRes = await request.post(`${AUTH_SERVER_URL}/api/users/${reporterUser.id}/api-keys`, {
      data: { name: 'CI Pipeline Key' },
    });
    expect(createRes.ok()).toBeTruthy();
    const keyData = await createRes.json();
    expect(keyData.key).toMatch(/^pd_[0-9a-f]{64}$/);
    expect(keyData.prefix).toHaveLength(8);
    expect(keyData.name).toBe('CI Pipeline Key');

    // Store the key for subsequent tests
    reporterApiKey = keyData.key;
  });

  test('GET api-keys lists the key with prefix but not the full value', async ({ request }) => {
    // Login as reporter
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    const usersRes = await request.get(`${AUTH_SERVER_URL}/api/users`);
    const usersData = await usersRes.json();
    const reporterUser = usersData.items.find((u: { username: string }) => u.username === 'ci-reporter');

    const keysRes = await request.get(`${AUTH_SERVER_URL}/api/users/${reporterUser.id}/api-keys`);
    expect(keysRes.ok()).toBeTruthy();
    const keysData = await keysRes.json();
    expect(keysData.items).toHaveLength(1);
    const listedKey = keysData.items[0];
    expect(listedKey.name).toBe('CI Pipeline Key');
    // Only the prefix is returned – not the full key
    expect(listedKey.keyPrefix).toHaveLength(8);
    expect(listedKey).not.toHaveProperty('keyHash');
    expect(listedKey).not.toHaveProperty('key');
  });

  test('submit endpoint accepts a valid API key via Authorization header', async ({ request }) => {
    expect(reporterApiKey).not.toBeNull();

    const submitRes = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      headers: { Authorization: `Bearer ${reporterApiKey}` },
      data: {
        projectName: PROJECT.API_KEY_SUBMIT,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 2000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'loads homepage',
            status: 'passed',
            duration: 500,
            location: 'tests/home.spec.ts:1:1',
            retries: 0,
          },
        ],
      },
    });
    expect(submitRes.ok()).toBeTruthy();
    const data = await submitRes.json();
    expect(data.success).toBe(true);
  });

  test('submit endpoint accepts a valid API key via X-API-Key header', async ({ request }) => {
    expect(reporterApiKey).not.toBeNull();

    const submitRes = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      headers: { 'X-API-Key': reporterApiKey! },
      data: {
        projectName: PROJECT.API_KEY_SUBMIT,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      },
    });
    expect(submitRes.ok()).toBeTruthy();
    const data = await submitRes.json();
    expect(data.success).toBe(true);
  });

  test('submit endpoint rejects an invalid API key', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      headers: { Authorization: 'Bearer pd_0000000000000000000000000000000000000000000000000000000000000000' },
      data: {
        projectName: PROJECT.INVALID_KEY,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      },
    });
    expect(res.status()).toBe(401);
  });

  test('reporter lib postJSON with API key submits successfully', async ({ request }) => {
    expect(reporterApiKey).not.toBeNull();

    // Test the same HTTP contract the reporter's postJSON helper uses: a Bearer
    // token in the Authorization header must be accepted by the submit endpoint.
    const submitRes = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      headers: { Authorization: `Bearer ${reporterApiKey}` },
      data: {
        projectName: PROJECT.REPORTER_API_KEY_LIB,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'test via api key',
            status: 'passed',
            duration: 300,
            location: 'tests/api-key.spec.ts:1:1',
            retries: 0,
          },
        ],
      },
    });
    expect(submitRes.ok()).toBeTruthy();
    const result = await submitRes.json();
    expect(result.success).toBe(true);
    expect(result.runId).toBeDefined();
  });

  test('PiwiDashboardReporter submits results with apiKey option', async ({ request }) => {
    expect(reporterApiKey).not.toBeNull();

    const reporterPath = resolve(process.cwd(), '..', '..', 'packages', 'reporter', 'dist', 'index.js');
    const testFilePath = join(resolve(process.cwd()), 'tests', 'api-key.spec.ts');

    const { exitCode, stderr } = await runReporterScript(`
      const _mod = require(${JSON.stringify(reporterPath)}); const PiwiDashboardReporter = _mod.default ?? _mod;
      const reporter = new PiwiDashboardReporter({
        serverUrl: ${JSON.stringify(AUTH_SERVER_URL)},
        projectName: ${JSON.stringify(PROJECT.REPORTER_API_KEY_E2E)},
        uploadReport: false,
        uploadTraces: false,
        collectScmInfo: false,
        collectCiInfo: false,
        collectPerformanceMetrics: false,
        apiKey: ${JSON.stringify(reporterApiKey)},
        verbose: false
      });
      reporter.onBegin(
        { projects: [], workers: 1, timeout: 30000, fullyParallel: false },
        { allTests: () => [] }
      );
      reporter.onTestEnd(
        { title: 'api key auth works end to end', location: { file: ${JSON.stringify(testFilePath)}, line: 1, column: 1 } },
        { status: 'passed', duration: 400, error: null, retry: 0, attachments: [], steps: [] }
      );
      reporter.onEnd({ status: 'passed' }).then(() => {
        process.exit(0);
      }).catch(err => {
        console.error(err.message);
        process.exit(1);
      });
    `);

    expect(exitCode, `Reporter subprocess failed:\n${stderr}`).toBe(0);

    // Log in to authenticate for the verification call
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    // Verify project was created
    const projectsRes = await request.get(`${AUTH_SERVER_URL}/api/projects`);
    expect(projectsRes.ok()).toBeTruthy();
    const projects = ((await projectsRes.json()) as { items: Array<{ name: string }> }).items;
    expect(projects.find((p) => p.name === PROJECT.REPORTER_API_KEY_E2E)).toBeDefined();
  });

  test('admin can revoke the API key', async ({ request }) => {
    // Login as admin
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    // Get reporter user id
    const usersRes = await request.get(`${AUTH_SERVER_URL}/api/users`);
    const usersData = await usersRes.json();
    const reporterUser = usersData.items.find((u: { username: string }) => u.username === 'ci-reporter');

    // Get the key id
    const keysRes = await request.get(`${AUTH_SERVER_URL}/api/users/${reporterUser.id}/api-keys`);
    const keysData = await keysRes.json();
    expect(keysData.items).toHaveLength(1);
    const keyId = keysData.items[0].id;

    // Revoke the key
    const revokeRes = await request.delete(`${AUTH_SERVER_URL}/api/users/${reporterUser.id}/api-keys/${keyId}`);
    expect(revokeRes.ok()).toBeTruthy();
    const revokeData = await revokeRes.json();
    expect(revokeData.success).toBe(true);

    // Key list should now be empty
    const keysResAfter = await request.get(`${AUTH_SERVER_URL}/api/users/${reporterUser.id}/api-keys`);
    const keysDataAfter = await keysResAfter.json();
    expect(keysDataAfter.items).toHaveLength(0);
  });

  test('revoked API key is rejected', async ({ request }) => {
    expect(reporterApiKey).not.toBeNull();

    const res = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      headers: { Authorization: `Bearer ${reporterApiKey}` },
      data: {
        projectName: PROJECT.REVOKED_KEY,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 100,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      },
    });
    expect(res.status()).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Share links — the one anonymous read path on an auth-enabled server.
  // ---------------------------------------------------------------------------

  test('a share link renders anonymously while the API stays authenticated', async ({ request, playwright }) => {
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    const submit = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.REPORTER_AUTH,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 900,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'anonymously shared failure',
            status: 'failed',
            duration: 300,
            location: 'tests/shared.spec.ts:3:1',
            error: 'Error: expected banner to be visible',
          },
        ],
      },
    });
    expect(submit.ok()).toBeTruthy();
    const { runId } = await submit.json();
    const run = (await (await request.get(`${AUTH_SERVER_URL}/api/test-runs/${runId}`)).json()) as {
      testCases: Array<{ executionId: number; status: string }>;
    };
    const executionId = run.testCases.find((c) => c.status === 'failed')!.executionId;

    const minted = await (
      await request.post(`${AUTH_SERVER_URL}/api/test-run-cases/${executionId}/share-links`, { data: {} })
    ).json();
    expect(minted.token).toMatch(/^psl_/);

    // A context with no session: the share URL renders, the API refuses.
    const anon = await playwright.request.newContext();
    try {
      const shared = await anon.get(minted.url);
      expect(shared.status()).toBe(200);
      expect(await shared.text()).toContain('anonymously shared failure');

      const api = await anon.get(`${AUTH_SERVER_URL}/api/test-run-cases/${executionId}`);
      expect(api.status()).toBe(401);
      const mint = await anon.post(`${AUTH_SERVER_URL}/api/test-run-cases/${executionId}/share-links`, { data: {} });
      expect(mint.status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  // ---------------------------------------------------------------------------
  // Project members API — administrator-only authorization
  //
  // These checks need a real authenticated non-admin session (a "user" role
  // request must actually be rejected), which only exists on this auth-enabled
  // server — with auth disabled (the default dev/test server) `requireAuth`
  // always returns a synthetic system-admin user and no 403 can ever be
  // observed. See `tests/user-management.spec.ts` for the GET/PUT shape and
  // validation tests that run against the auth-disabled server instead.
  // ---------------------------------------------------------------------------

  let membersProjectId: number;
  let ciUserId: number;
  let ciReporterId: number;

  test('create a dedicated "user"-role account for authorization checks', async ({ request }) => {
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    const res = await request.post(`${AUTH_SERVER_URL}/api/users`, {
      data: { username: 'ci-user', password: 'userpassword123', role: 'user', name: 'CI User' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.user.role).toBe('user');
    ciUserId = data.user.id;

    const usersRes = await request.get(`${AUTH_SERVER_URL}/api/users`);
    const usersData = await usersRes.json();
    ciReporterId = usersData.items.find((u: { username: string }) => u.username === 'ci-reporter').id;
  });

  test('admin creates a project for the members checks', async ({ request }) => {
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    const res = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.AUTH_ROLE_CHECKS,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    membersProjectId = data.projectId;
  });

  test('GET /api/projects/:id/members is rejected for non-admin roles', async ({ request }) => {
    // ci-reporter (role: reporter) has global project access but is not an admin.
    let loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();
    let res = await request.get(`${AUTH_SERVER_URL}/api/projects/${membersProjectId}/members`);
    expect(res.status()).toBe(403);

    // ci-user (role: user, and not yet assigned to any project) is rejected too.
    loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-user', password: 'userpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();
    res = await request.get(`${AUTH_SERVER_URL}/api/projects/${membersProjectId}/members`);
    expect(res.status()).toBe(403);
  });

  test('PUT /api/projects/:id/members is rejected for non-admin roles', async ({ request }) => {
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    const res = await request.put(`${AUTH_SERVER_URL}/api/projects/${membersProjectId}/members`, {
      data: { userIds: [ciReporterId] },
    });
    expect(res.status()).toBe(403);
  });

  test('admin can GET then PUT project members, assigning ci-user and ci-reporter', async ({ request }) => {
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    // ci-reporter already has global access at this point (proven by the
    // "GET rejected for non-admin roles" test above, and required for its
    // earlier submit-as-reporter tests to have worked) — this file's own
    // project-assignments backfill grants any unassigned REPORTER/USER a
    // global row whenever the server (re)initializes, and that can happen
    // more than once across this file's ~450 tests. Reset it to a known,
    // explicit "no access" state so the "before" assertion below is
    // deterministic regardless of that timing.
    const resetReporter = await request.put(`${AUTH_SERVER_URL}/api/users/${ciReporterId}/projects`, {
      data: { global: false, projectIds: [] },
    });
    expect(resetReporter.ok()).toBeTruthy();

    const before = await request.get(`${AUTH_SERVER_URL}/api/projects/${membersProjectId}/members`);
    expect(before.ok()).toBeTruthy();
    const beforeBody = (await before.json()) as { items: Array<{ username: string }> };
    // Only the implicit admin has access before any explicit assignment.
    expect(beforeBody.items.some((u) => u.username === 'ci-user')).toBe(false);
    expect(beforeBody.items.some((u) => u.username === 'ci-reporter')).toBe(false);

    const put = await request.put(`${AUTH_SERVER_URL}/api/projects/${membersProjectId}/members`, {
      data: { userIds: [ciUserId, ciReporterId] },
    });
    expect(put.ok()).toBeTruthy();
    expect(await put.json()).toEqual({ success: true });

    const after = await request.get(`${AUTH_SERVER_URL}/api/projects/${membersProjectId}/members`);
    const afterBody = (await after.json()) as { items: Array<{ username: string; global: boolean }> };
    const ciUserEntry = afterBody.items.find((u) => u.username === 'ci-user');
    const ciReporterEntry = afterBody.items.find((u) => u.username === 'ci-reporter');
    expect(ciUserEntry).toMatchObject({ username: 'ci-user', global: false });
    expect(ciReporterEntry).toMatchObject({ username: 'ci-reporter', global: false });
  });

  test('being assigned as a member does not itself grant access to manage members', async ({ request }) => {
    // ci-user is now an explicit (non-global) member of the project, but members
    // management stays administrator-only — assignment grants data access
    // elsewhere, not membership-management rights.
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-user', password: 'userpassword123' },
    });
    expect(loginRes.ok()).toBeTruthy();

    const res = await request.get(`${AUTH_SERVER_URL}/api/projects/${membersProjectId}/members`);
    expect(res.status()).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // POST /api/failure-clusters/:id/diagnose/stream — required-role enforcement.
  //
  // The route declares `x-required-roles: ['administrator', 'reporter']`, which
  // `requireAuth` enforces from the route meta (the single source of truth). So
  // a "user"-role caller — even one with access to the project — is rejected
  // with 403 before the request reaches the cluster-lookup / AI-config checks.
  // ---------------------------------------------------------------------------

  test('a "user"-role caller with project access is blocked from diagnose/stream', async ({ request }) => {
    // Give ci-user project access via a run + failing test case so we have a cluster.
    const adminLogin = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const submitRes = await request.post(`${AUTH_SERVER_URL}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.AUTH_ROLE_CHECKS,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'role check test',
            status: 'failed',
            duration: 500,
            location: 'tests/role-check.spec.ts:1:1',
            error:
              "TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByTestId('role-check')",
          },
        ],
      },
    });
    expect(submitRes.ok()).toBeTruthy();
    const { runId } = await submitRes.json();

    const run = (await (await request.get(`${AUTH_SERVER_URL}/api/test-runs/${runId}`)).json()) as {
      testCases: Array<{ status: string; failureClusterId?: number }>;
    };
    const clusterId = run.testCases.find((c) => c.status === 'failed')?.failureClusterId;
    expect(clusterId).toBeTruthy();

    // ci-user was already made an explicit member of PROJECT.AUTH_ROLE_CHECKS
    // above, so project-scope access is not in question here — only the role.
    const userLogin = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-user', password: 'userpassword123' },
    });
    expect(userLogin.ok()).toBeTruthy();

    const streamRes = await request.post(`${AUTH_SERVER_URL}/api/failure-clusters/${clusterId}/diagnose/stream`);
    // The "user" role is not in [administrator, reporter], so enforcement from
    // the route meta rejects the request with 403 (before the AI-config check).
    expect(streamRes.status()).toBe(403);
  });
});
