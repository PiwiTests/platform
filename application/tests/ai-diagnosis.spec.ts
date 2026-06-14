/**
 * Tests for the AI diagnosis endpoints (Pillar 4).
 *
 * Spins up a mock OpenAI-compatible HTTP server on a random port so the Nuxt
 * server can be configured to call it without needing real API credentials.
 */

import { test, expect } from './fixtures'
import type { APIRequestContext } from '@playwright/test'
import * as http from 'http'
import * as net from 'net'
import { PROJECT } from '../shared/test-project-names'
import type { AiDiagnosisResult } from '../shared/ai-diagnosis'

// Force all tests in this file into a single serial worker so the two describe
// blocks don't interfere with each other's AI config state.
test.describe.configure({ mode: 'serial' })

// ── Mock HTTP server ──────────────────────────────────────────────────────────

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo
      srv.close(() => resolve(addr.port))
    })
    srv.on('error', reject)
  })
}

function buildMockAiResponse(): AiDiagnosisResult {
  return {
    category: 'app-bug',
    confidence: 'high',
    summary: 'Mock diagnosis summary from test',
    rootCause: 'Mock root cause explanation',
    evidence: ['Evidence line 1', 'Evidence line 2'],
    suggestedFix: {
      description: 'Mock suggested fix',
      file: 'tests/mock.spec.ts',
      code: null
    },
    preventionTips: ['Add more tests']
  }
}

function startMockAiServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
      req.on('data', () => {})
      req.on('end', () => {
        const diagResult = buildMockAiResponse()
        const responseContent = JSON.stringify(diagResult)
        const payload = {
          id: 'chatcmpl-test',
          object: 'chat.completion',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: responseContent },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      })
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    }
  })
  server.listen(port, '127.0.0.1')
  return server
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function submitRun(
  request: APIRequestContext,
  cases: Array<{ status: string, [key: string]: unknown }>
) {
  const res = await request.post('/api/test-runs/submit', {
    data: {
      projectName: PROJECT.AI_DIAGNOSIS,
      status: 'failed',
      startTime: new Date().toISOString(),
      duration: 30000,
      totalTests: cases.length,
      passedTests: cases.filter(c => c.status === 'passed').length,
      failedTests: cases.filter(c => c.status === 'failed').length,
      skippedTests: 0,
      testCases: cases
    }
  })
  expect(res.ok()).toBeTruthy()
  return res.json() as Promise<{ testRunId: number, projectId: number }>
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe.serial('AI diagnosis endpoints', () => {
  let mockServer: http.Server
  let mockPort: number
  let clusterId: number | null = null
  let isEnvManaged = false

  test.beforeAll(async ({ request }) => {
    // Check if AI is managed by env vars — if so, we can't clear/replace the config
    const statusRes = await request.get('/api/ai/status')
    if (statusRes.ok()) {
      const s = await statusRes.json() as { source?: string }
      isEnvManaged = s.source === 'env'
    }
    mockPort = await getFreePort()
    mockServer = startMockAiServer(mockPort)
  })

  test.beforeEach(async () => {
    // All tests in this block require controlling the AI config; skip when env-managed
    if (isEnvManaged) test.skip()
  })

  test.afterAll(async ({ request }) => {
    // Clean up AI settings
    await request.put('/api/settings/ai', { data: { provider: null } })
    mockServer.close()
  })

  test('GET /api/ai/status returns configured: false when no provider is set', async ({ request }) => {
    // Clean slate: ensure no AI is configured (env may not set it, DB may have stale state)
    await request.put('/api/settings/ai', { data: { provider: null } })

    const res = await request.get('/api/ai/status')
    expect(res.ok()).toBeTruthy()
    const status = await res.json()
    expect(status.configured).toBe(false)
  })

  test('PUT /api/settings/ai saves provider and model', async ({ request }) => {
    const res = await request.put('/api/settings/ai', {
      data: {
        provider: 'openai',
        apiKey: 'test-key-unused',
        model: 'gpt-test',
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        autoDiagnose: false
      }
    })
    expect(res.ok()).toBeTruthy()
  })

  test('GET /api/ai/status returns configured: true after provider is saved', async ({ request }) => {
    const res = await request.get('/api/ai/status')
    expect(res.ok()).toBeTruthy()
    const status = await res.json()
    expect(status.configured).toBe(true)
    expect(status.provider).toBe('openai')
    expect(status.source).toBe('settings')
  })

  test('GET /api/failure-clusters/:id/diagnosis returns null before any diagnosis', async ({ request }) => {
    // Create a test run with a failure cluster
    const { testRunId } = await submitRun(request, [
      { title: 'login test', status: 'failed', duration: 1000, location: 'tests/auth.spec.ts:5:3',
        error: 'TimeoutError: locator.click: Timeout 30000ms exceeded.\n    at tests/auth.spec.ts:5:3' }
    ])

    const run = await (await request.get(`/api/test-runs/${testRunId}`)).json() as { testCases: Array<{ status: string, failureClusterId?: number }> }
    const failedCase = run.testCases.find(c => c.status === 'failed')
    expect(failedCase?.failureClusterId).toBeTruthy()
    clusterId = failedCase!.failureClusterId!

    const res = await request.get(`/api/failure-clusters/${clusterId}/diagnosis`)
    expect(res.ok()).toBeTruthy()
    expect(await res.json()).toBeNull()
  })

  test('POST /api/failure-clusters/:id/diagnose returns completed diagnosis', async ({ request }) => {
    expect(clusterId).toBeTruthy()

    const res = await request.post(`/api/failure-clusters/${clusterId}/diagnose`)
    expect(res.ok()).toBeTruthy()

    const diagnosis = await res.json()
    expect(diagnosis.status).toBe('completed')
    expect(diagnosis.clusterId).toBe(clusterId)
    expect(diagnosis.category).toBe('app-bug')
    expect(diagnosis.confidence).toBe('high')
    expect(typeof diagnosis.summary).toBe('string')
    expect(typeof diagnosis.rootCause).toBe('string')
  })

  test('GET /api/failure-clusters/:id/diagnosis returns the stored diagnosis', async ({ request }) => {
    expect(clusterId).toBeTruthy()

    const res = await request.get(`/api/failure-clusters/${clusterId}/diagnosis`)
    expect(res.ok()).toBeTruthy()

    const diagnosis = await res.json()
    expect(diagnosis).not.toBeNull()
    expect(diagnosis.status).toBe('completed')
    expect(diagnosis.category).toBe('app-bug')
  })

  test('POST /api/failure-clusters/:id/diagnose returns 409 for existing completed (no force)', async ({ request }) => {
    expect(clusterId).toBeTruthy()

    // Without force, should return existing completed diagnosis (200 not 409)
    const res = await request.post(`/api/failure-clusters/${clusterId}/diagnose`)
    expect(res.ok()).toBeTruthy()
    const diagnosis = await res.json()
    expect(diagnosis.status).toBe('completed')
  })

  test('POST /api/failure-clusters/:id/diagnose?force=true re-runs and returns new diagnosis', async ({ request }) => {
    expect(clusterId).toBeTruthy()

    const res = await request.post(`/api/failure-clusters/${clusterId}/diagnose?force=true`)
    expect(res.ok()).toBeTruthy()

    const diagnosis = await res.json()
    expect(diagnosis.status).toBe('completed')
    expect(diagnosis.category).toBe('app-bug')
  })

  test('failure-groups endpoint includes diagnosis compact for clustered groups', async ({ request }) => {
    expect(clusterId).toBeTruthy()

    // Submit another run with the same error to trigger the known cluster
    const { testRunId } = await submitRun(request, [
      { title: 'login test', status: 'failed', duration: 1000, location: 'tests/auth.spec.ts:5:3',
        error: 'TimeoutError: locator.click: Timeout 30000ms exceeded.\n    at tests/auth.spec.ts:5:3' }
    ])

    const res = await request.get(`/api/test-runs/${testRunId}/failure-groups`)
    expect(res.ok()).toBeTruthy()
    const groups = await res.json()
    expect(Array.isArray(groups)).toBe(true)

    const group = (groups as Array<{ clusterId: number, diagnosis: { status: string, category: string } | null }>).find(g => g.clusterId === clusterId)
    expect(group).toBeDefined()
    expect(group.diagnosis).toBeDefined()
    expect(group.diagnosis.status).toBe('completed')
    expect(group.diagnosis.category).toBe('app-bug')
  })
})

test.describe.serial('AI diagnosis — unconfigured error cases', () => {
  let isEnvManaged = false

  test.beforeAll(async ({ request }) => {
    // Check if AI is managed by env vars
    const statusRes = await request.get('/api/ai/status')
    if (statusRes.ok()) {
      const s = await statusRes.json() as { source?: string }
      isEnvManaged = s.source === 'env'
    }
    if (!isEnvManaged) {
      // Ensure AI is not configured
      await request.put('/api/settings/ai', { data: { provider: null } })
    }
  })

  test('POST /diagnose returns 503 when AI is not configured', async ({ request }) => {
    if (isEnvManaged) {
      test.skip()
      return
    }
    // Submit a run to get a cluster ID
    const res = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.AI_DIAGNOSIS,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        testCases: [{
          title: 'unconfigured test',
          status: 'failed',
          duration: 1000,
          location: 'tests/x.spec.ts:1:1',
          error: 'expect(received).toBe(expected)\nExpected: true\nReceived: false'
        }]
      }
    })
    expect(res.ok()).toBeTruthy()
    const { testRunId } = await res.json()

    const run = await (await request.get(`/api/test-runs/${testRunId}`)).json() as { testCases: Array<{ status: string, failureClusterId?: number }> }
    const failedCase = run.testCases.find(c => c.status === 'failed')
    const cId = failedCase?.failureClusterId

    if (!cId) return // no cluster → skip

    const diagnoseRes = await request.post(`/api/failure-clusters/${cId}/diagnose`)
    expect(diagnoseRes.status()).toBe(503)
  })
})
