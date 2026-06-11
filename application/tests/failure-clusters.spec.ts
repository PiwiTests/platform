import { test, expect, type APIRequestContext } from '@playwright/test'
import { PROJECT } from '../shared/test-project-names'
import { computeErrorFingerprint, extractErrorSignature } from '../shared/error-fingerprint'

// ── Fingerprint util ───────────────────────────────────────────────────────

test.describe('Error fingerprinting', () => {
  const timeoutError = (ms: number) =>
    `TimeoutError: locator.click: Timeout ${ms}ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Submit' })`

  test('same timeout error with different durations and ANSI codes shares a fingerprint', async () => {
    const plain = await computeErrorFingerprint(timeoutError(30000))
    const colored = await computeErrorFingerprint(`\u001B[31m${timeoutError(15000)}\u001B[0m`)

    expect(plain.fingerprint).toBe(colored.fingerprint)
    expect(plain.errorType).toBe('timeout')
    expect(plain.selector).toBe('getByRole(\'button\', { name: \'Submit\' })')
    expect(plain.signature).toBe('TimeoutError: locator.click: Timeout <N>ms exceeded.')
  })

  test('assertion errors with different received values share a fingerprint', async () => {
    const error = (received: string) =>
      `Error: expect(locator).toHaveText(expected)\n\nLocator: getByTestId('status')\nExpected string: "Ready"\nReceived string: "${received}"\nCall log:\n  - expect.toHaveText with timeout 5000ms`

    const a = await computeErrorFingerprint(error('Loading'))
    const b = await computeErrorFingerprint(error('Error'))

    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.errorType).toBe('assertion')
    expect(a.selector).toBe('getByTestId(\'status\')')
  })

  test('different selectors produce different fingerprints', async () => {
    const error = (selector: string) =>
      `TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for ${selector}`

    const a = await computeErrorFingerprint(error('getByTestId(\'login-button\')'))
    const b = await computeErrorFingerprint(error('getByTestId(\'logout-button\')'))

    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  test('classifies strict mode violations, navigation and crash errors', () => {
    expect(extractErrorSignature(
      'Error: locator.click: Error: strict mode violation: getByRole(\'button\') resolved to 3 elements'
    ).errorType).toBe('strict-mode')
    expect(extractErrorSignature(
      'Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4000/'
    ).errorType).toBe('navigation')
    expect(extractErrorSignature(
      'Error: page.click: Target page, context or browser has been closed'
    ).errorType).toBe('crash')
  })

  test('stack frame file paths are part of the fingerprint without line numbers', async () => {
    const error = (line: number) =>
      `Error: boom\n    at doLogin (tests/helpers/auth.ts:${line}:11)\n    at node_modules/playwright/lib/runner.js:5:1`

    const a = await computeErrorFingerprint(error(10))
    const b = await computeErrorFingerprint(error(99))

    expect(a.topFrameFile).toBe('tests/helpers/auth.ts')
    expect(a.fingerprint).toBe(b.fingerprint)
  })
})

// ── End-to-end clustering via the submit API ──────────────────────────────

test.describe.serial('Failure clustering', () => {
  const loginTimeout = (ms: number) =>
    `TimeoutError: locator.click: Timeout ${ms}ms exceeded.\nCall log:\n  - waiting for getByTestId('login-button')`
  const cartAssertion
    = `Error: expect(locator).toHaveText(expected)\n\nLocator: getByTestId('cart-total')\nExpected string: "3 items"\nReceived string: "0 items"`

  let firstRunClusterId: number | null = null
  let firstRunId: number | null = null
  let projectId: number | null = null

  async function submitRun(request: APIRequestContext, cases: object[]) {
    const response = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.FAILURE_CLUSTERS,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 60000,
        totalTests: cases.length,
        passedTests: 1,
        failedTests: cases.length - 1,
        skippedTests: 0,
        testCases: cases
      }
    })
    expect(response.ok()).toBeTruthy()
    return await response.json() as { testRunId: number, projectId: number }
  }

  test('groups failures sharing a root cause on submission', async ({ request }) => {
    const { testRunId: runId, projectId: pid } = await submitRun(request, [
      { title: 'login via header', status: 'failed', duration: 31000, location: 'tests/auth.spec.ts:10:5', error: loginTimeout(30000) },
      { title: 'login via modal', status: 'failed', duration: 16000, location: 'tests/auth.spec.ts:30:5', error: loginTimeout(15000) },
      { title: 'cart shows items', status: 'failed', duration: 2000, location: 'tests/cart.spec.ts:12:5', error: cartAssertion },
      { title: 'homepage loads', status: 'passed', duration: 900, location: 'tests/home.spec.ts:5:5' }
    ])

    const run = await (await request.get(`/api/test-runs/${runId}`)).json()
    const byTitle: Record<string, { failureClusterId: number | null }> = Object.fromEntries(
      run.testCases.map((tc: { title: string }) => [tc.title, tc])
    )

    // The two login timeouts share a cluster despite different timeout values
    expect(byTitle['login via header']!.failureClusterId).toEqual(expect.any(Number))
    expect(byTitle['login via modal']!.failureClusterId).toBe(byTitle['login via header']!.failureClusterId)

    // The cart assertion is a different root cause → different cluster
    expect(byTitle['cart shows items']!.failureClusterId).toEqual(expect.any(Number))
    expect(byTitle['cart shows items']!.failureClusterId).not.toBe(byTitle['login via header']!.failureClusterId)

    // Passed cases are never clustered
    expect(byTitle['homepage loads']!.failureClusterId).toBeNull()

    firstRunClusterId = byTitle['login via header']!.failureClusterId
    firstRunId = runId
    projectId = pid
  })

  test('reuses the cluster across runs of the same project', async ({ request }) => {
    const { testRunId: runId } = await submitRun(request, [
      { title: 'login via header', status: 'failed', duration: 31000, location: 'tests/auth.spec.ts:10:5', error: loginTimeout(30000) },
      { title: 'homepage loads', status: 'passed', duration: 900, location: 'tests/home.spec.ts:5:5' }
    ])

    const run = await (await request.get(`/api/test-runs/${runId}`)).json()
    const failed = run.testCases.find((tc: { title: string }) => tc.title === 'login via header')

    expect(failed.failureClusterId).toBe(firstRunClusterId)
  })

  test('failure-groups endpoint classifies known, new and flaky groups', async ({ request }) => {
    const checkoutError = 'Error: page.goto: net::ERR_CONNECTION_REFUSED at https://checkout.example.com/'

    const { testRunId: runId } = await submitRun(request, [
      { title: 'login via header', status: 'failed', duration: 31000, location: 'tests/auth.spec.ts:10:5', error: loginTimeout(30000) },
      // Failed first attempt + passed retry of the same test → flaky signal
      { title: 'checkout works', status: 'failed', duration: 5000, location: 'tests/checkout.spec.ts:8:3', error: checkoutError, retries: 0 },
      { title: 'checkout works', status: 'passed', duration: 4000, location: 'tests/checkout.spec.ts:8:3', retries: 1 },
      { title: 'homepage loads', status: 'passed', duration: 900, location: 'tests/home.spec.ts:5:5' }
    ])

    const response = await request.get(`/api/test-runs/${runId}/failure-groups`)
    expect(response.ok()).toBeTruthy()
    const groups: Array<{
      clusterId: number
      signature: string
      selector: string | null
      caseCount: number
      isNew: boolean
      firstSeenRunId: number
      flaky: boolean
      cases: Array<{ title: string, passedOnRetry: boolean }>
    }> = await response.json()

    expect(groups).toHaveLength(2)

    // The login timeout is a known cluster carried over from the first run
    const loginGroup = groups.find(g => g.signature.includes('TimeoutError'))!
    expect(loginGroup).toBeDefined()
    expect(loginGroup.clusterId).toBe(firstRunClusterId)
    expect(loginGroup.isNew).toBe(false)
    expect(loginGroup.firstSeenRunId).toBe(firstRunId)
    expect(loginGroup.caseCount).toBe(1)
    expect(loginGroup.selector).toBe('getByTestId(\'login-button\')')

    // The checkout failure is new and passed on retry → flagged flaky
    const checkoutGroup = groups.find(g => g.clusterId !== firstRunClusterId)!
    expect(checkoutGroup).toBeDefined()
    expect(checkoutGroup.isNew).toBe(true)
    expect(checkoutGroup.flaky).toBe(true)
    expect(checkoutGroup.caseCount).toBe(1)
    expect(checkoutGroup.cases[0]!.title).toBe('checkout works')
    expect(checkoutGroup.cases[0]!.passedOnRetry).toBe(true)
  })

  test('project failure-clusters endpoint aggregates across runs', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/failure-clusters`)
    expect(response.ok()).toBeTruthy()
    const clusters: Array<{
      id: number
      errorType: string | null
      occurrences: number
      affectedTests: number
      lastSeenRunId: number
      lastSeenAt: string | null
    }> = await response.json()

    const login = clusters.find(c => c.id === firstRunClusterId)!
    expect(login).toBeDefined()
    expect(login.errorType).toBe('timeout')
    // Two distinct tests ever hit this cluster (login via header + login via modal)
    expect(login.affectedTests).toBe(2)
    // Rows across runs 1-3: 2 + 1 + 1
    expect(login.occurrences).toBe(4)
    expect(login.lastSeenAt).not.toBeNull()

    // Unknown project → 404, matching the other project endpoints
    const missing = await request.get('/api/projects/999999/failure-clusters')
    expect(missing.status()).toBe(404)
  })

  test('cluster status defaults to open and is exposed in project endpoint', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/failure-clusters`)
    const clusters: Array<{ id: number, status: string, triageNote: string | null }> = await response.json()

    const login = clusters.find(c => c.id === firstRunClusterId)!
    expect(login).toBeDefined()
    expect(login.status).toBe('open')
    expect(login.triageNote).toBeNull()
  })

  test('PATCH cluster status updates status and triage note', async ({ request }) => {
    const note = 'Investigated — flaky test infrastructure'
    const patchRes = await request.patch(`/api/failure-clusters/${firstRunClusterId}/status`, {
      data: { status: 'resolved', triageNote: note }
    })
    expect(patchRes.ok()).toBeTruthy()
    const patch = await patchRes.json()
    expect(patch.status).toBe('resolved')
    expect(patch.triageNote).toBe(note)

    // Verify the update is persisted
    const getRes = await request.get(`/api/projects/${projectId}/failure-clusters`)
    const clusters: Array<{ id: number, status: string, triageNote: string | null }> = await getRes.json()
    const login = clusters.find(c => c.id === firstRunClusterId)!
    expect(login.status).toBe('resolved')
    expect(login.triageNote).toBe(note)
  })

  test('PATCH cluster status rejects invalid status values', async ({ request }) => {
    const res = await request.patch(`/api/failure-clusters/${firstRunClusterId}/status`, {
      data: { status: 'invalid' }
    })
    expect(res.status()).toBe(400)
  })

  test('status filter on project clusters endpoint', async ({ request }) => {
    // After the previous test, the login timeout cluster is resolved
    const resolved = await request.get(`/api/projects/${projectId}/failure-clusters?status=resolved`)
    expect(resolved.ok()).toBeTruthy()
    const resolvedClusters: Array<{ id: number }> = await resolved.json()
    expect(resolvedClusters.some(c => c.id === firstRunClusterId)).toBeTruthy()

    const open = await request.get(`/api/projects/${projectId}/failure-clusters?status=open`)
    expect(open.ok()).toBeTruthy()
    const openClusters: Array<{ id: number }> = await open.json()
    expect(openClusters.some(c => c.id === firstRunClusterId)).toBeFalsy()
  })

  test('failure-groups endpoint exposes cluster status', async ({ request }) => {
    const { testRunId: runId } = await submitRun(request, [
      { title: 'login via header', status: 'failed', duration: 31000, location: 'tests/auth.spec.ts:10:5', error: loginTimeout(30000) },
      { title: 'homepage loads', status: 'passed', duration: 900, location: 'tests/home.spec.ts:5:5' }
    ])

    const groupsRes = await request.get(`/api/test-runs/${runId}/failure-groups`)
    const groups: Array<{ status: string, triageNote: string | null }> = await groupsRes.json()
    expect(groups[0]).toBeDefined()
    expect(groups[0].status).toBe('resolved')
    expect(groups[0].triageNote).toBe('Investigated — flaky test infrastructure')
  })
})
