import { test, expect } from '@playwright/test'
import { spawn } from 'child_process'
import { join, resolve } from 'path'
import { existsSync, rmSync } from 'fs'
import { PROJECT } from '../shared/test-project-names'

const AUTH_PORT = 3099
const AUTH_SERVER_URL = `http://localhost:${AUTH_PORT}`
const DB_PATH = join(process.cwd(), '.test-temp', 'auth-test.db')
const STORAGE_PATH = join(process.cwd(), '.test-temp', 'auth-test-storage')

/**
 * Run a CommonJS reporter script in a dedicated Node.js subprocess.
 * The reporter package is CommonJS and cannot be imported directly from this
 * ESM test file, so we pipe the script as stdin to `node --input-type=commonjs`.
 */
function runReporterScript(cjsScript: string): Promise<{ exitCode: number, stdout: string, stderr: string }> {
  return new Promise((resolveP) => {
    const proc = spawn('node', ['--input-type=commonjs'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('close', code => resolveP({ exitCode: code ?? 0, stdout, stderr }))
    proc.stdin!.write(cjsScript)
    proc.stdin!.end()
  })
}

test.describe.serial('Reporter with authentication enabled', () => {
  // The auth server (port 3099) is only started by the playwright webServer config
  // when running in CI. Skip all tests in this file when not in CI.
  test.skip(!process.env.CI, 'Auth server tests only run in CI (see playwright.config.ts webServer)')

  test.beforeAll(() => {
    // Clean up test database and storage before running, in case of retries from a previous run
    if (existsSync(DB_PATH)) rmSync(DB_PATH)
    if (existsSync(STORAGE_PATH)) rmSync(STORAGE_PATH, { recursive: true, force: true })
  })

  test.afterAll(() => {
    // Clean up test database and storage created by the auth server
    if (existsSync(DB_PATH)) rmSync(DB_PATH)
    if (existsSync(STORAGE_PATH)) rmSync(STORAGE_PATH, { recursive: true, force: true })
  })

  // ---------------------------------------------------------------------------
  // Auth server sanity checks
  // ---------------------------------------------------------------------------

  test('/api/auth/me should indicate auth is enabled and no user is logged in', async ({ request }) => {
    const res = await request.get(`${AUTH_SERVER_URL}/api/auth/me`)
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    // When auth is enabled and no session exists, authenticated is false
    expect(data.authenticated).toBe(false)
    expect(data.user).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Initial setup
  // ---------------------------------------------------------------------------

  test('should create admin user via setup endpoint', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/auth/setup`, {
      data: {
        username: 'admin',
        password: 'adminpassword123',
        name: 'Administrator'
      }
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.user.username).toBe('admin')
    expect(data.user.role).toBe('administrator')
  })

  test('setup endpoint should reject a second call once users exist', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/auth/setup`, {
      data: { username: 'admin2', password: 'password123' }
    })
    expect(res.status()).toBe(400)
  })

  // ---------------------------------------------------------------------------
  // Login / logout
  // ---------------------------------------------------------------------------

  test('should log in with valid credentials', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' }
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.user.username).toBe('admin')
  })

  test('should reject login with invalid credentials', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'wrongpassword' }
    })
    expect(res.status()).toBe(401)
  })

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
        testCases: []
      }
    })
    expect(res.status()).toBe(401)
  })

  // ---------------------------------------------------------------------------
  // Create a dedicated reporter user
  // ---------------------------------------------------------------------------

  test('admin can create a reporter user', async ({ request }) => {
    // Log in as admin first
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' }
    })
    expect(loginRes.ok()).toBeTruthy()

    // Create a reporter user
    const res = await request.post(`${AUTH_SERVER_URL}/api/users`, {
      data: {
        username: 'ci-reporter',
        password: 'reporterpassword123',
        role: 'reporter',
        name: 'CI Reporter'
      }
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.user.username).toBe('ci-reporter')
    expect(data.user.role).toBe('reporter')
  })

  // ---------------------------------------------------------------------------
  // Reporter submits results when authenticated
  // ---------------------------------------------------------------------------

  test('reporter can submit test results after login', async ({ request }) => {
    // Login as reporter user
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' }
    })
    expect(loginRes.ok()).toBeTruthy()

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
            retries: 0
          },
          {
            title: 'dashboard shows stats',
            status: 'passed',
            duration: 800,
            location: 'tests/dashboard.spec.ts:10:3',
            retries: 0
          }
        ]
      }
    })
    expect(submitRes.ok()).toBeTruthy()
    const data = await submitRes.json()
    expect(data.success).toBe(true)
    expect(data.testRunId).toBeDefined()
    expect(data.projectId).toBeDefined()
  })

  // ---------------------------------------------------------------------------
  // Reporter module – login + submit flow (verified via direct HTTP calls)
  // The reporter's upload helpers are CommonJS and cannot be imported from an
  // ESM test file; we verify the same HTTP contract they rely on directly.
  // ---------------------------------------------------------------------------

  test('reporter lib: login endpoint returns a session cookie', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' }
    })
    expect(res.ok()).toBeTruthy()
    // The server must set at least one session cookie
    const headers = res.headers()
    expect(headers['set-cookie']).toBeTruthy()
  })

  test('reporter lib: login endpoint rejects wrong credentials', async ({ request }) => {
    const res = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'wrongpassword' }
    })
    expect(res.status()).toBe(401)
  })

  test('reporter lib: session cookie allows submit after login', async ({ request }) => {
    // Login first – the request fixture keeps the session cookie for this test
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' }
    })
    expect(loginRes.ok()).toBeTruthy()

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
        testCases: [{
          title: 'submit via session cookie',
          status: 'passed',
          duration: 500,
          location: 'tests/lib.spec.ts:1:1',
          retries: 0
        }]
      }
    })
    expect(submitRes.ok()).toBeTruthy()
    const data = await submitRes.json()
    expect(data.success).toBe(true)
    expect(data.testRunId).toBeDefined()
  })

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
        testCases: []
      }
    })
    expect(submitRes.status()).toBe(401)
  })

  // ---------------------------------------------------------------------------
  // Full PiwiDashboardReporter flow with username/password options
  // The reporter package is CommonJS, so we run it in a dedicated Node.js
  // subprocess using --input-type=commonjs to avoid ESM/CJS interop issues.
  // ---------------------------------------------------------------------------

  test('PiwiDashboardReporter submits results with username/password options', async ({ request }) => {
    const reporterPath = resolve(process.cwd(), '..', 'reporter', 'dist', 'index.js')
    const testFilePath = join(resolve(process.cwd()), 'tests', 'home.spec.ts')

    const { exitCode, stderr } = await runReporterScript(`
      const PiwiDashboardReporter = require(${JSON.stringify(reporterPath)});
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
    `)

    expect(exitCode, `Reporter subprocess failed:\n${stderr}`).toBe(0)

    // Verify the project was created (GET endpoints are public)
    const projectsRes = await request.get(`${AUTH_SERVER_URL}/api/projects`)
    expect(projectsRes.ok()).toBeTruthy()
    const projects = await projectsRes.json() as Array<{ name: string }>
    expect(projects.find(p => p.name === PROJECT.REPORTER_FULL_AUTH)).toBeDefined()
  })

  test('PiwiDashboardReporter fails when auth is required but no credentials given', async () => {
    const reporterPath = resolve(process.cwd(), '..', 'reporter', 'dist', 'index.js')

    const { exitCode } = await runReporterScript(`
      const PiwiDashboardReporter = require(${JSON.stringify(reporterPath)});
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
    `)

    // Without credentials, the reporter must fail
    expect(exitCode).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // API key management
  // ---------------------------------------------------------------------------

  let reporterApiKey: string | null = null

  test('admin can create an API key for the reporter user', async ({ request }) => {
    // Login as admin
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' }
    })
    expect(loginRes.ok()).toBeTruthy()

    // Get reporter user id
    const usersRes = await request.get(`${AUTH_SERVER_URL}/api/users`)
    expect(usersRes.ok()).toBeTruthy()
    const usersData = await usersRes.json()
    const reporterUser = usersData.users.find((u: { username: string }) => u.username === 'ci-reporter')
    expect(reporterUser).toBeDefined()

    // Create API key
    const createRes = await request.post(`${AUTH_SERVER_URL}/api/users/${reporterUser.id}/api-keys`, {
      data: { name: 'CI Pipeline Key' }
    })
    expect(createRes.ok()).toBeTruthy()
    const keyData = await createRes.json()
    expect(keyData.key).toMatch(/^pd_[0-9a-f]{64}$/)
    expect(keyData.prefix).toHaveLength(8)
    expect(keyData.name).toBe('CI Pipeline Key')

    // Store the key for subsequent tests
    reporterApiKey = keyData.key
  })

  test('GET api-keys lists the key with prefix but not the full value', async ({ request }) => {
    // Login as reporter
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'ci-reporter', password: 'reporterpassword123' }
    })
    expect(loginRes.ok()).toBeTruthy()

    const usersRes = await request.get(`${AUTH_SERVER_URL}/api/users`)
    const usersData = await usersRes.json()
    const reporterUser = usersData.users.find((u: { username: string }) => u.username === 'ci-reporter')

    const keysRes = await request.get(`${AUTH_SERVER_URL}/api/users/${reporterUser.id}/api-keys`)
    expect(keysRes.ok()).toBeTruthy()
    const keysData = await keysRes.json()
    expect(keysData.apiKeys).toHaveLength(1)
    const listedKey = keysData.apiKeys[0]
    expect(listedKey.name).toBe('CI Pipeline Key')
    // Only the prefix is returned – not the full key
    expect(listedKey.keyPrefix).toHaveLength(8)
    expect(listedKey).not.toHaveProperty('keyHash')
    expect(listedKey).not.toHaveProperty('key')
  })

  test('submit endpoint accepts a valid API key via Authorization header', async ({ request }) => {
    expect(reporterApiKey).not.toBeNull()

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
        testCases: [{
          title: 'loads homepage',
          status: 'passed',
          duration: 500,
          location: 'tests/home.spec.ts:1:1',
          retries: 0
        }]
      }
    })
    expect(submitRes.ok()).toBeTruthy()
    const data = await submitRes.json()
    expect(data.success).toBe(true)
  })

  test('submit endpoint accepts a valid API key via X-API-Key header', async ({ request }) => {
    expect(reporterApiKey).not.toBeNull()

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
        testCases: []
      }
    })
    expect(submitRes.ok()).toBeTruthy()
    const data = await submitRes.json()
    expect(data.success).toBe(true)
  })

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
        testCases: []
      }
    })
    expect(res.status()).toBe(401)
  })

  test('reporter lib postJSON with API key submits successfully', async ({ request }) => {
    expect(reporterApiKey).not.toBeNull()

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
        testCases: [{
          title: 'test via api key',
          status: 'passed',
          duration: 300,
          location: 'tests/api-key.spec.ts:1:1',
          retries: 0
        }]
      }
    })
    expect(submitRes.ok()).toBeTruthy()
    const result = await submitRes.json()
    expect(result.success).toBe(true)
    expect(result.testRunId).toBeDefined()
  })

  test('PiwiDashboardReporter submits results with apiKey option', async ({ request }) => {
    expect(reporterApiKey).not.toBeNull()

    const reporterPath = resolve(process.cwd(), '..', 'reporter', 'dist', 'index.js')
    const testFilePath = join(resolve(process.cwd()), 'tests', 'api-key.spec.ts')

    const { exitCode, stderr } = await runReporterScript(`
      const PiwiDashboardReporter = require(${JSON.stringify(reporterPath)});
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
    `)

    expect(exitCode, `Reporter subprocess failed:\n${stderr}`).toBe(0)

    // Verify project was created (GET endpoints are public)
    const projectsRes = await request.get(`${AUTH_SERVER_URL}/api/projects`)
    expect(projectsRes.ok()).toBeTruthy()
    const projects = await projectsRes.json() as Array<{ name: string }>
    expect(projects.find(p => p.name === PROJECT.REPORTER_API_KEY_E2E)).toBeDefined()
  })

  test('admin can revoke the API key', async ({ request }) => {
    // Login as admin
    const loginRes = await request.post(`${AUTH_SERVER_URL}/api/auth/login`, {
      data: { username: 'admin', password: 'adminpassword123' }
    })
    expect(loginRes.ok()).toBeTruthy()

    // Get reporter user id
    const usersRes = await request.get(`${AUTH_SERVER_URL}/api/users`)
    const usersData = await usersRes.json()
    const reporterUser = usersData.users.find((u: { username: string }) => u.username === 'ci-reporter')

    // Get the key id
    const keysRes = await request.get(`${AUTH_SERVER_URL}/api/users/${reporterUser.id}/api-keys`)
    const keysData = await keysRes.json()
    expect(keysData.apiKeys).toHaveLength(1)
    const keyId = keysData.apiKeys[0].id

    // Revoke the key
    const revokeRes = await request.delete(`${AUTH_SERVER_URL}/api/users/${reporterUser.id}/api-keys/${keyId}`)
    expect(revokeRes.ok()).toBeTruthy()
    const revokeData = await revokeRes.json()
    expect(revokeData.success).toBe(true)

    // Key list should now be empty
    const keysResAfter = await request.get(`${AUTH_SERVER_URL}/api/users/${reporterUser.id}/api-keys`)
    const keysDataAfter = await keysResAfter.json()
    expect(keysDataAfter.apiKeys).toHaveLength(0)
  })

  test('revoked API key is rejected', async ({ request }) => {
    expect(reporterApiKey).not.toBeNull()

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
        testCases: []
      }
    })
    expect(res.status()).toBe(401)
  })
})
