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
    return (await response.json()).testRunId as number
  }

  test('groups failures sharing a root cause on submission', async ({ request }) => {
    const runId = await submitRun(request, [
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
  })

  test('reuses the cluster across runs of the same project', async ({ request }) => {
    const runId = await submitRun(request, [
      { title: 'login via header', status: 'failed', duration: 31000, location: 'tests/auth.spec.ts:10:5', error: loginTimeout(30000) },
      { title: 'homepage loads', status: 'passed', duration: 900, location: 'tests/home.spec.ts:5:5' }
    ])

    const run = await (await request.get(`/api/test-runs/${runId}`)).json()
    const failed = run.testCases.find((tc: { title: string }) => tc.title === 'login via header')

    expect(failed.failureClusterId).toBe(firstRunClusterId)
  })
})
