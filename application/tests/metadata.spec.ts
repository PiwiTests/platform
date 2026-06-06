import { test, expect } from '@playwright/test'
import { PROJECT } from '../shared/test-project-names'

test.describe('Metadata Tests', () => {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'

  test('should accept test run with metadata via JSON submission', async ({ request }) => {
    const response = await request.post(`${baseUrl}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.METADATA_TEST,
        projectDescription: 'Test project for metadata validation',
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        skippedTests: 0,
        metadata: {
          relatedIssue: 'JIRA-123',
          ciInfo: 'Jenkins Build #456',
          tags: ['regression', 'critical'],
          customData: {
            environment: 'staging',
            version: '1.2.3'
          },
          scm: {
            commit: 'abc123def456',
            branch: 'main',
            author: 'Test User'
          },
          ci: {
            provider: 'Jenkins',
            buildNumber: '456',
            buildUrl: 'https://jenkins.example.com/job/test/456'
          }
        },
        testCases: [
          {
            title: 'should pass test 1',
            location: 'tests/test.spec.ts:10:5',
            status: 'passed',
            duration: 1000
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

  test('should retrieve test run with metadata', async ({ request }) => {
    // First, create a test run with metadata
    const submitResponse = await request.post(`${baseUrl}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.METADATA_RETRIEVAL,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 3000,
        totalTests: 3,
        passedTests: 3,
        failedTests: 0,
        skippedTests: 0,
        metadata: {
          relatedIssue: 'PROJ-789',
          tags: ['smoke', 'ui'],
          scm: {
            commit: 'fedcba987654',
            branch: 'feature/test',
            author: 'Developer'
          }
        },
        testCases: [
          {
            title: 'test case 1',
            location: 'tests/example.spec.ts:5:3',
            status: 'passed',
            duration: 1000
          }
        ]
      }
    })

    expect(submitResponse.ok()).toBeTruthy()
    const submitData = await submitResponse.json()
    const testRunId = submitData.testRunId

    // Now retrieve the test run
    const getResponse = await request.get(`${baseUrl}/api/test-runs/${testRunId}`)
    expect(getResponse.ok()).toBeTruthy()

    const testRun = await getResponse.json()
    expect(testRun).toBeDefined()
    expect(testRun.metadata).toBeDefined()
    expect(testRun.metadata.relatedIssue).toBe('PROJ-789')
    expect(testRun.metadata.tags).toEqual(['smoke', 'ui'])
    expect(testRun.metadata.scm).toBeDefined()
    expect(testRun.metadata.scm.commit).toBe('fedcba987654')
    expect(testRun.metadata.scm.branch).toBe('feature/test')
    expect(testRun.metadata.scm.author).toBe('Developer')
  })

  test('should handle empty metadata gracefully', async ({ request }) => {
    const response = await request.post(`${baseUrl}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.EMPTY_METADATA,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        metadata: {},
        testCases: []
      }
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.success).toBe(true)
  })

  test('should handle missing metadata field', async ({ request }) => {
    const response = await request.post(`${baseUrl}/api/test-runs/submit`, {
      data: {
        projectName: PROJECT.NO_METADATA,
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

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.success).toBe(true)
  })

  test('reporter TypeScript definitions should include metadata options', async () => {
    const { readFileSync, existsSync } = await import('fs')
    const { join } = await import('path')

    const typeDefsPath = join(process.cwd(), '..', 'reporter', 'index.d.ts')
    expect(existsSync(typeDefsPath)).toBe(true)

    const typeDefs = readFileSync(typeDefsPath, 'utf-8')

    // Check that all metadata-related options are defined
    expect(typeDefs).toContain('projectDescription')
    expect(typeDefs).toContain('relatedIssue')
    expect(typeDefs).toContain('ciInfo')
    expect(typeDefs).toContain('tags')
    expect(typeDefs).toContain('customData')
    expect(typeDefs).toContain('collectScmInfo')
    expect(typeDefs).toContain('collectCiInfo')
  })
})
