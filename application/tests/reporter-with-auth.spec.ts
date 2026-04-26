import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'child_process'
import { join, resolve } from 'path'
import { existsSync, rmSync } from 'fs'
import http from 'http'

const AUTH_PORT = 3099
const AUTH_SERVER_URL = `http://localhost:${AUTH_PORT}`
const AUTH_SECRET = 'test-auth-secret-key-for-reporter-tests'
const DB_PATH = join(process.cwd(), '.test-temp', 'auth-test.db')
const STORAGE_PATH = join(process.cwd(), '.test-temp', 'auth-test-storage')

// Allow extra time for the auth server to start
const SERVER_START_TIMEOUT = 90000

let authServer: ChildProcess | null = null

/**
 * Wait for the auth server to be ready by polling its /api/auth/me endpoint.
 */
async function waitForServer(url: string, timeoutMs = SERVER_START_TIMEOUT): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`${url}/api/auth/me`, (res) => {
          res.resume()
          resolve()
        })
        req.on('error', reject)
        req.setTimeout(2000, () => {
          req.destroy()
          reject(new Error('timeout'))
        })
      })
      return
    } catch {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw new Error(`Auth server at ${url} did not become ready within ${timeoutMs}ms`)
}

test.describe.serial('Reporter with authentication enabled', () => {
  test.beforeAll(async () => {
    // Remove stale test database so the server starts fresh
    if (existsSync(DB_PATH)) rmSync(DB_PATH)
    if (existsSync(STORAGE_PATH)) rmSync(STORAGE_PATH, { recursive: true, force: true })

    const appDir = resolve(process.cwd())

    authServer = spawn('npm', ['run', 'dev'], {
      cwd: appDir,
      env: {
        ...process.env,
        NUXT_AUTH_ENABLED: 'true',
        NUXT_AUTH_SECRET: AUTH_SECRET,
        DATABASE_PATH: DB_PATH,
        STORAGE_PATH,
        NITRO_PORT: String(AUTH_PORT)
      },
      stdio: 'pipe'
    })

    authServer.stderr?.on('data', (data: Buffer) => {
      if (process.env.DEBUG_AUTH_SERVER) {
        process.stderr.write(`[auth-server] ${data}`)
      }
    })

    authServer.stdout?.on('data', (data: Buffer) => {
      if (process.env.DEBUG_AUTH_SERVER) {
        process.stdout.write(`[auth-server] ${data}`)
      }
    })

    await waitForServer(AUTH_SERVER_URL)
  }, SERVER_START_TIMEOUT + 10000)

  test.afterAll(() => {
    if (authServer) {
      authServer.kill('SIGTERM')
      authServer = null
    }
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
        projectName: 'reporter-auth-test',
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
        projectName: 'reporter-auth-test',
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
  // Reporter module – login + submit flow using the reporter's own upload helpers
  // ---------------------------------------------------------------------------

  test('reporter lib loginUser returns a session cookie', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loginUser } = require('../../../reporter/lib/upload') as {
      loginUser: (serverUrl: string, username: string, password: string, verbose: boolean) => Promise<string>
    }

    const cookie = await loginUser(AUTH_SERVER_URL, 'ci-reporter', 'reporterpassword123', false)
    expect(typeof cookie).toBe('string')
    expect(cookie.length).toBeGreaterThan(0)
  })

  test('reporter lib loginUser rejects wrong credentials', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loginUser } = require('../../../reporter/lib/upload') as {
      loginUser: (serverUrl: string, username: string, password: string, verbose: boolean) => Promise<string>
    }

    await expect(loginUser(AUTH_SERVER_URL, 'ci-reporter', 'wrongpassword', false))
      .rejects.toThrow()
  })

  test('reporter lib postJSON with session cookie submits successfully', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loginUser, postJSON } = require('../../../reporter/lib/upload') as {
      loginUser: (serverUrl: string, username: string, password: string, verbose: boolean) => Promise<string>
      postJSON: (serverUrl: string, pathname: string, payload: object, verbose: boolean, cookie?: string) => Promise<Record<string, unknown>>
    }

    const cookie = await loginUser(AUTH_SERVER_URL, 'ci-reporter', 'reporterpassword123', false)

    const payload = {
      projectName: 'reporter-auth-lib-test',
      status: 'passed',
      startTime: new Date().toISOString(),
      duration: 3000,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      testCases: [
        {
          title: 'submit via lib',
          status: 'passed',
          duration: 500,
          location: 'tests/lib.spec.ts:1:1',
          retries: 0
        }
      ]
    }

    const result = await postJSON(AUTH_SERVER_URL, '/api/test-runs/submit', payload, false, cookie)
    expect(result.success).toBe(true)
    expect(result.testRunId).toBeDefined()
  })

  test('reporter lib postJSON without cookie returns auth error', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { postJSON } = require('../../../reporter/lib/upload') as {
      postJSON: (serverUrl: string, pathname: string, payload: object, verbose: boolean, cookie?: string) => Promise<Record<string, unknown>>
    }

    const payload = {
      projectName: 'reporter-auth-lib-test',
      status: 'passed',
      startTime: new Date().toISOString(),
      duration: 1000,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      testCases: []
    }

    await expect(postJSON(AUTH_SERVER_URL, '/api/test-runs/submit', payload, false))
      .rejects.toThrow('401')
  })

  // ---------------------------------------------------------------------------
  // Full PlaywrightDashboardReporter flow with username/password options
  // ---------------------------------------------------------------------------

  test('PlaywrightDashboardReporter submits results with username/password options', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PlaywrightDashboardReporter = require('../../../reporter/index') as new (opts: object) => {
      onBegin: (config: object, suite: object) => void
      onTestEnd: (test: object, result: object) => void
      onEnd: (result: object) => Promise<void>
    }

    const reporter = new PlaywrightDashboardReporter({
      serverUrl: AUTH_SERVER_URL,
      projectName: 'reporter-full-auth-test',
      uploadReport: false,
      uploadTraces: false,
      collectScmInfo: false,
      collectCiInfo: false,
      collectPerformanceMetrics: false,
      username: 'ci-reporter',
      password: 'reporterpassword123',
      verbose: false
    })

    // Simulate a minimal reporter lifecycle
    reporter.onBegin(
      { projects: [], workers: 1, timeout: 30000, fullyParallel: false },
      { allTests: () => [] }
    )

    reporter.onTestEnd(
      {
        title: 'homepage renders correctly',
        location: { file: join(resolve(process.cwd()), 'tests', 'home.spec.ts'), line: 5, column: 3 }
      },
      {
        status: 'passed',
        duration: 900,
        error: null,
        retry: 0,
        attachments: [],
        steps: []
      }
    )

    await reporter.onEnd({ status: 'passed' })

    // Verify the project was created (GET endpoints are public)
    const projectsRes = await new Promise<{ status: number, body: unknown[] }>((resolve, reject) => {
      http.get(`${AUTH_SERVER_URL}/api/projects`, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) })
          } catch {
            resolve({ status: res.statusCode ?? 0, body: [] })
          }
        })
      }).on('error', reject)
    })

    expect(projectsRes.status).toBe(200)
    const projects = projectsRes.body as Array<{ name: string }>
    const project = projects.find(p => p.name === 'reporter-full-auth-test')
    expect(project).toBeDefined()
  })

  test('PlaywrightDashboardReporter fails when auth is required but no credentials given', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PlaywrightDashboardReporter = require('../../../reporter/index') as new (opts: object) => {
      onBegin: (config: object, suite: object) => void
      onTestEnd: (test: object, result: object) => void
      onEnd: (result: object) => Promise<void>
    }

    const reporter = new PlaywrightDashboardReporter({
      serverUrl: AUTH_SERVER_URL,
      projectName: 'reporter-no-auth-test',
      uploadReport: false,
      uploadTraces: false,
      collectScmInfo: false,
      collectCiInfo: false,
      collectPerformanceMetrics: false,
      verbose: false
    })

    reporter.onBegin(
      { projects: [], workers: 1, timeout: 30000, fullyParallel: false },
      { allTests: () => [] }
    )

    await expect(reporter.onEnd({ status: 'passed' })).rejects.toThrow()
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
        projectName: 'api-key-submit-test',
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
        projectName: 'api-key-submit-test',
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
        projectName: 'invalid-key-test',
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

  test('reporter lib postJSON with API key submits successfully', async () => {
    expect(reporterApiKey).not.toBeNull()

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { postJSON } = require('../../../reporter/lib/upload') as {
      postJSON: (serverUrl: string, pathname: string, payload: object, verbose: boolean, keyOrCookie?: string) => Promise<Record<string, unknown>>
    }

    const payload = {
      projectName: 'reporter-api-key-lib-test',
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

    const result = await postJSON(AUTH_SERVER_URL, '/api/test-runs/submit', payload, false, reporterApiKey!)
    expect(result.success).toBe(true)
    expect(result.testRunId).toBeDefined()
  })

  test('PlaywrightDashboardReporter submits results with apiKey option', async () => {
    expect(reporterApiKey).not.toBeNull()

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PlaywrightDashboardReporter = require('../../../reporter/index') as new (opts: object) => {
      onBegin: (config: object, suite: object) => void
      onTestEnd: (test: object, result: object) => void
      onEnd: (result: object) => Promise<void>
    }

    const reporter = new PlaywrightDashboardReporter({
      serverUrl: AUTH_SERVER_URL,
      projectName: 'reporter-api-key-e2e-test',
      uploadReport: false,
      uploadTraces: false,
      collectScmInfo: false,
      collectCiInfo: false,
      collectPerformanceMetrics: false,
      apiKey: reporterApiKey,
      verbose: false
    })

    reporter.onBegin(
      { projects: [], workers: 1, timeout: 30000, fullyParallel: false },
      { allTests: () => [] }
    )

    reporter.onTestEnd(
      {
        title: 'api key auth works end to end',
        location: { file: join(resolve(process.cwd()), 'tests', 'api-key.spec.ts'), line: 1, column: 1 }
      },
      { status: 'passed', duration: 400, error: null, retry: 0, attachments: [], steps: [] }
    )

    await reporter.onEnd({ status: 'passed' })

    // Verify project was created
    const projectsRes = await new Promise<{ status: number, body: unknown[] }>((resolve, reject) => {
      http.get(`${AUTH_SERVER_URL}/api/projects`, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) })
          } catch {
            resolve({ status: res.statusCode ?? 0, body: [] })
          }
        })
      }).on('error', reject)
    })

    expect(projectsRes.status).toBe(200)
    const projects = projectsRes.body as Array<{ name: string }>
    expect(projects.find(p => p.name === 'reporter-api-key-e2e-test')).toBeDefined()
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
        projectName: 'revoked-key-test',
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
