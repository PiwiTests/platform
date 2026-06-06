import { test, expect } from '@playwright/test'
import { PROJECT } from '../shared/test-project-names'

/**
 * PostgreSQL integration tests.
 *
 * These tests require a running PostgreSQL server.
 * They are skipped automatically when `POSTGRES_TEST_URL` is not set, so running
 * `npm test` locally without a local PostgreSQL server works as expected.
 *
 * To run them locally, start PostgreSQL and export the variables below:
 *
 *   docker run -d -p 5432:5432 \
 *     -e POSTGRES_USER=postgres \
 *     -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=playwright_test \
 *     postgres:16-alpine
 *
 *   POSTGRES_TEST_URL=postgresql://postgres:postgres@localhost:5432/playwright_test \
 *     npx playwright test postgresql.spec.ts
 *
 * In CI, set `POSTGRES_TEST_URL` in the environment to enable these tests.
 */

const POSTGRES_TEST_URL = process.env.POSTGRES_TEST_URL
const PG_PORT = 3101

test.describe('PostgreSQL integration', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!POSTGRES_TEST_URL, 'Set POSTGRES_TEST_URL to run PostgreSQL tests (see postgresql.spec.ts header for instructions)')

  const baseURL = `http://localhost:${PG_PORT}`

  test('should submit test results via JSON API', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.PG_TEST,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 120000,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'should work with postgres',
            status: 'passed',
            duration: 1500,
            location: 'tests/pg.spec.ts:10:5',
            retries: 0
          },
          {
            title: 'should handle errors',
            status: 'failed',
            duration: 2300,
            location: 'tests/pg.spec.ts:20:5',
            error: 'Expected true but got false',
            retries: 1
          }
        ]
      }
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.testRunId).toBeDefined()
    expect(data.projectId).toBeDefined()
  })

  test('should get list of projects', async ({ request }) => {
    const response = await request.get(`${baseURL}/api/projects`)

    expect(response.ok()).toBeTruthy()
    const projects = await response.json()
    expect(Array.isArray(projects)).toBe(true)
    expect(projects.length).toBeGreaterThan(0)

    const project = projects.find((p: { name: string }) => p.name === PROJECT.PG_TEST)
    expect(project).toBeDefined()
  })

  test('should get project details with test runs', async ({ request }) => {
    const projectsResponse = await request.get(`${baseURL}/api/projects`)
    expect(projectsResponse.ok()).toBeTruthy()
    const projects = await projectsResponse.json()
    const project = projects.find((p: { name: string, id: number }) => p.name === PROJECT.PG_TEST)
    expect(project).toBeDefined()

    const response = await request.get(`${baseURL}/api/projects/${project!.id}`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.testRuns).toBeDefined()
    expect(data.testRuns.length).toBeGreaterThan(0)
  })

  test('should get test run details with test cases', async ({ request }) => {
    const projectsResponse = await request.get(`${baseURL}/api/projects`)
    expect(projectsResponse.ok()).toBeTruthy()
    const projects = await projectsResponse.json()
    const project = projects.find((p: { name: string, id: number }) => p.name === PROJECT.PG_TEST)
    expect(project).toBeDefined()

    const projectResponse = await request.get(`${baseURL}/api/projects/${project!.id}`)
    expect(projectResponse.ok()).toBeTruthy()
    const projectData = await projectResponse.json()
    expect(projectData.testRuns).toBeDefined()
    expect(projectData.testRuns.length).toBeGreaterThan(0)
    const runId = projectData.testRuns[0].id

    const response = await request.get(`${baseURL}/api/test-runs/${runId}`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.testCases).toBeDefined()
    expect(data.testCases.length).toBe(2)

    const passedCase = data.testCases.find((tc: { status: string }) => tc.status === 'passed')
    const failedCase = data.testCases.find((tc: { status: string }) => tc.status === 'failed')
    expect(passedCase).toBeDefined()
    expect(failedCase).toBeDefined()
    expect(failedCase.error).toBe('Expected true but got false')
  })

  test('should submit test results with metadata', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.PG_TEST,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 60000,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        metadata: { branch: 'main', commit: 'abc123', buildId: '42' },
        testCases: [
          {
            title: 'metadata test',
            status: 'failed',
            duration: 500,
            location: 'tests/meta.spec.ts:1:1',
            retries: 0,
            error: 'Assertion failed'
          }
        ]
      }
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.success).toBe(true)

    // Verify metadata is stored and returned
    const runResponse = await request.get(`${baseURL}/api/test-runs/${data.testRunId}`)
    expect(runResponse.ok()).toBeTruthy()
    const runData = await runResponse.json()
    expect(runData.metadata).toBeDefined()
    expect(runData.metadata.branch).toBe('main')
    expect(runData.metadata.commit).toBe('abc123')
  })

  test('should handle concurrent submissions', async ({ request }) => {
    const submissions = Array.from({ length: 5 }, (_, i) =>
      request.post(`${baseURL}/api/test-runs/submit`, {
        data: {
          projectName: PROJECT.PG_CONCURRENT,
          status: 'passed',
          startTime: new Date().toISOString(),
          duration: 1000 * (i + 1),
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0,
          testCases: [
            {
              title: `concurrent test ${i}`,
              status: 'passed',
              duration: 500,
              location: `tests/concurrent.spec.ts:${i}:1`,
              retries: 0
            }
          ]
        }
      })
    )

    const responses = await Promise.all(submissions)
    for (const response of responses) {
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.success).toBe(true)
    }
  })
})
