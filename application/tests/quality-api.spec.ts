import { test, expect } from '@playwright/test'

test.describe.serial('Quality API Tests', () => {
  let projectId: number

  test('should submit test results including flaky tests', async ({ request }) => {
    // Submit run 1 with flaky tests
    const response = await request.post('/api/test-runs/submit', {
      data: {
        projectName: 'quality-test-project',
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 60000,
        totalTests: 4,
        passedTests: 3,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'stable passing test',
            status: 'passed',
            duration: 1000,
            location: 'tests/stable.spec.ts:1:1',
            retries: 0
          },
          {
            title: 'flaky test',
            status: 'passed',
            duration: 2000,
            location: 'tests/flaky.spec.ts:1:1',
            retries: 2
          },
          {
            title: 'another flaky test',
            status: 'passed',
            duration: 1500,
            location: 'tests/flaky2.spec.ts:1:1',
            retries: 1
          },
          {
            title: 'failing test',
            status: 'failed',
            duration: 5000,
            location: 'tests/failing.spec.ts:1:1',
            error: 'AssertionError: expected true to equal false',
            retries: 0
          }
        ]
      }
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.success).toBe(true)
    projectId = data.projectId

    // Submit run 2 — same project, no flaky, no failures
    await request.post('/api/test-runs/submit', {
      data: {
        projectName: 'quality-test-project',
        status: 'passed',
        startTime: new Date(Date.now() + 60000).toISOString(),
        duration: 55000,
        totalTests: 4,
        passedTests: 4,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'stable passing test',
            status: 'passed',
            duration: 900,
            location: 'tests/stable.spec.ts:1:1',
            retries: 0
          },
          {
            title: 'flaky test',
            status: 'passed',
            duration: 1800,
            location: 'tests/flaky.spec.ts:1:1',
            retries: 0
          },
          {
            title: 'another flaky test',
            status: 'passed',
            duration: 1400,
            location: 'tests/flaky2.spec.ts:1:1',
            retries: 0
          },
          {
            title: 'failing test',
            status: 'passed',
            duration: 4000,
            location: 'tests/failing.spec.ts:1:1',
            retries: 0
          }
        ]
      }
    })
  })

  test('should return quality trend data', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/quality`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()

    // Check response shape
    expect(data).toHaveProperty('trend')
    expect(data).toHaveProperty('summary')
    expect(Array.isArray(data.trend)).toBe(true)
    expect(data.trend.length).toBeGreaterThanOrEqual(2)

    // Each trend point should have required fields
    const point = data.trend[0]
    expect(point.id).toBeDefined()
    expect(point.startTime).toBeDefined()
    expect(point.status).toBeDefined()
    expect(point.totalTests).toBeGreaterThan(0)
    expect(typeof point.passedTests).toBe('number')
    expect(typeof point.failedTests).toBe('number')
    expect(typeof point.flakyTests).toBe('number')
    expect(typeof point.failureRate).toBe('number')
    expect(typeof point.flakyRate).toBe('number')
  })

  test('should return quality summary with correct stats', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/quality`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    const summary = data.summary

    expect(summary.totalRuns).toBeGreaterThanOrEqual(2)
    expect(summary.totalExecutions).toBeGreaterThan(0)
    expect(typeof summary.totalFlaky).toBe('number')
    expect(typeof summary.totalFailed).toBe('number')
    expect(typeof summary.overallFlakyRate).toBe('number')
    expect(typeof summary.overallPassRate).toBe('number')
    expect(typeof summary.overallFailureRate).toBe('number')
    expect(typeof summary.failureFreeStreak).toBe('number')

    // We submitted a clean second run so streak must be >= 1
    expect(summary.failureFreeStreak).toBeGreaterThanOrEqual(1)
  })

  test('should return quality trend data ordered chronologically', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/quality`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    const trend = data.trend

    // Each entry should be older than or equal to the next
    for (let i = 1; i < trend.length; i++) {
      const prev = new Date(trend[i - 1].startTime).getTime()
      const curr = new Date(trend[i].startTime).getTime()
      expect(prev).toBeLessThanOrEqual(curr)
    }
  })

  test('should return flaky-tests data', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/flaky-tests`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()

    expect(data).toHaveProperty('flakyTests')
    expect(data).toHaveProperty('failingTests')
    expect(data).toHaveProperty('neverFailed')
    expect(data).toHaveProperty('totalTestCases')

    expect(Array.isArray(data.flakyTests)).toBe(true)
    expect(Array.isArray(data.failingTests)).toBe(true)
    expect(typeof data.neverFailed).toBe('number')
    expect(typeof data.totalTestCases).toBe('number')
  })

  test('should identify flaky tests correctly', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/flaky-tests`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()

    // We submitted 2 flaky tests in run 1
    expect(data.flakyTests.length).toBeGreaterThanOrEqual(1)

    const flakyTest = data.flakyTests[0]
    expect(flakyTest.id).toBeDefined()
    expect(flakyTest.title).toBeDefined()
    expect(flakyTest.filePath).toBeDefined()
    expect(flakyTest.flakyCount).toBeGreaterThan(0)
    expect(flakyTest.totalRuns).toBeGreaterThan(0)
    expect(flakyTest.flakyRate).toBeGreaterThan(0)
    // Sorted by flakyCount descending
    if (data.flakyTests.length > 1) {
      expect(data.flakyTests[0].flakyCount).toBeGreaterThanOrEqual(data.flakyTests[1].flakyCount)
    }
  })

  test('should identify failing tests correctly', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/flaky-tests`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()

    // We submitted 1 failing test in run 1
    expect(data.failingTests.length).toBeGreaterThanOrEqual(1)

    const failingTest = data.failingTests[0]
    expect(failingTest.id).toBeDefined()
    expect(failingTest.title).toBeDefined()
    expect(failingTest.filePath).toBeDefined()
    expect(failingTest.failureCount).toBeGreaterThan(0)
    expect(failingTest.totalRuns).toBeGreaterThan(0)
    expect(failingTest.failureRate).toBeGreaterThan(0)
    // lastError should be captured
    expect(failingTest.lastError).toBeDefined()
    expect(failingTest.lastError).toContain('AssertionError')
  })

  test('should respect the runs query parameter for flaky-tests', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/flaky-tests?runs=1`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(Array.isArray(data.flakyTests)).toBe(true)

    // With runs=1 we only look at the most recent run (which is clean)
    // So flakyTests should be empty
    expect(data.flakyTests.length).toBe(0)
  })

  test('should handle quality endpoint for non-existent project', async ({ request }) => {
    const response = await request.get('/api/projects/99999/quality')
    expect(response.status()).toBe(404)
  })

  test('should handle flaky-tests endpoint for non-existent project', async ({ request }) => {
    const response = await request.get('/api/projects/99999/flaky-tests')
    expect(response.status()).toBe(404)
  })

  test('should respect the limit query parameter for quality endpoint', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/quality?limit=1`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.trend.length).toBeLessThanOrEqual(1)
  })
})
