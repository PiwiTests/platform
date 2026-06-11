import { test, expect, type APIRequestContext } from '@playwright/test'
import { PROJECT } from '../shared/test-project-names'

type RegressionCtx = {
  hasGreen: boolean
  lastGreenRunId?: number
  lastGreenRunAt?: string | null
  lastGreenCommit?: string | null
  lastGreenBranch?: string | null
  currentCommit?: string | null
  currentBranch?: string | null
  commitRange?: {
    fromSha: string
    toSha: string
    fromShort: string
    toShort: string
    repositoryUrl: string | null
    compareUrl: string | null
    gitCommand: string
  } | null
  metadataDiff?: Array<{ key: string, label: string, before: string | null, after: string | null }>
  newFailures?: number
}

async function submitRun(
  request: APIRequestContext,
  opts: {
    status: string
    cases: object[]
    commit?: string
    branch?: string
    remoteUrl?: string
    environment?: string
    browsers?: string[]
  }
) {
  const scm: Record<string, string> = {}
  if (opts.commit) scm.commit = opts.commit
  if (opts.branch) scm.branch = opts.branch
  if (opts.remoteUrl) scm.remoteUrl = opts.remoteUrl

  const passed = (opts.cases as Array<{ status: string }>).filter(c => c.status === 'passed').length
  const failed = opts.cases.length - passed

  const resp = await request.post('/api/test-runs/submit', {
    data: {
      projectName: PROJECT.REGRESSION_CONTEXT,
      status: opts.status,
      startTime: new Date().toISOString(),
      duration: 30000,
      totalTests: opts.cases.length,
      passedTests: passed,
      failedTests: failed,
      skippedTests: 0,
      environment: opts.environment ?? null,
      metadata: {
        ...(Object.keys(scm).length > 0 ? { scm } : {}),
        ...(opts.browsers
          ? { htmlReport: { projects: opts.browsers.map(b => ({ name: b, use: { browserName: b } })) } }
          : {})
      },
      testCases: opts.cases
    }
  })
  expect(resp.ok()).toBeTruthy()
  return await resp.json() as { testRunId: number, projectId: number }
}

test.describe.serial('Regression context endpoint', () => {
  let greenRunId: number
  let failingRunId: number

  test('returns hasGreen: false when no prior passing run exists', async ({ request }) => {
    const { testRunId } = await submitRun(request, {
      status: 'failed',
      cases: [{ title: 'test A', status: 'failed', location: 'tests/a.spec.ts:1:1', error: 'boom' }]
    })

    const resp = await request.get(`/api/test-runs/${testRunId}/regression-context`)
    expect(resp.ok()).toBeTruthy()
    const ctx: RegressionCtx = await resp.json()
    expect(ctx.hasGreen).toBe(false)
  })

  test('identifies last green run and counts new failures', async ({ request }) => {
    // Submit a passing run (green baseline)
    const { testRunId: greenId } = await submitRun(request, {
      status: 'passed',
      commit: 'aaa1111aaa1111a',
      branch: 'main',
      remoteUrl: 'https://github.com/example/repo.git',
      cases: [
        { title: 'test A', status: 'passed', location: 'tests/a.spec.ts:1:1' },
        { title: 'test B', status: 'passed', location: 'tests/b.spec.ts:1:1' }
      ]
    })
    greenRunId = greenId

    // Submit a failing run (regression)
    const { testRunId: failId } = await submitRun(request, {
      status: 'failed',
      commit: 'bbb2222bbb2222b',
      branch: 'main',
      remoteUrl: 'https://github.com/example/repo.git',
      cases: [
        { title: 'test A', status: 'failed', location: 'tests/a.spec.ts:1:1', error: 'Expected true but got false' },
        { title: 'test B', status: 'passed', location: 'tests/b.spec.ts:1:1' }
      ]
    })
    failingRunId = failId

    const resp = await request.get(`/api/test-runs/${failId}/regression-context`)
    expect(resp.ok()).toBeTruthy()
    const ctx: RegressionCtx = await resp.json()

    expect(ctx.hasGreen).toBe(true)
    expect(ctx.lastGreenRunId).toBe(greenRunId)
    expect(ctx.lastGreenRunAt).not.toBeNull()
    // One test (A) passed in green run but fails here
    expect(ctx.newFailures).toBe(1)
    expect(ctx.currentCommit).toBe('bbb2222bbb2222b')
    expect(ctx.lastGreenCommit).toBe('aaa1111aaa1111a')
    expect(ctx.currentBranch).toBe('main')
    expect(ctx.lastGreenBranch).toBe('main')
  })

  test('builds correct GitHub compare URL and git command', async ({ request }) => {
    const resp = await request.get(`/api/test-runs/${failingRunId}/regression-context`)
    const ctx: RegressionCtx = await resp.json()

    expect(ctx.hasGreen).toBe(true)
    expect(ctx.commitRange).not.toBeNull()

    const range = ctx.commitRange!
    expect(range.compareUrl).toBe('https://github.com/example/repo/compare/aaa1111aaa1111a...bbb2222bbb2222b')
    expect(range.gitCommand).toBe('git log --oneline aaa1111aaa1111a..bbb2222bbb2222b')
    expect(range.fromShort).toBe('aaa1111')
    expect(range.toShort).toBe('bbb2222')
    expect(range.repositoryUrl).toBe('https://github.com/example/repo')
  })

  test('SSH remote URL is normalized to HTTPS for compare link', async ({ request }) => {
    const { testRunId: greenId } = await submitRun(request, {
      status: 'passed',
      commit: 'ccc3333ccc3333c',
      remoteUrl: 'git@github.com:org/my-app.git',
      cases: [{ title: 'ssh test', status: 'passed', location: 'tests/ssh.spec.ts:1:1' }]
    })

    const { testRunId: failId } = await submitRun(request, {
      status: 'failed',
      commit: 'ddd4444ddd4444d',
      remoteUrl: 'git@github.com:org/my-app.git',
      cases: [{ title: 'ssh test', status: 'failed', location: 'tests/ssh.spec.ts:1:1', error: 'fail' }]
    })

    const resp = await request.get(`/api/test-runs/${failId}/regression-context`)
    const ctx: RegressionCtx = await resp.json()

    expect(ctx.hasGreen).toBe(true)
    expect(ctx.lastGreenRunId).toBe(greenId)
    expect(ctx.commitRange).not.toBeNull()
    expect(ctx.commitRange!.repositoryUrl).toBe('https://github.com/org/my-app')
    expect(ctx.commitRange!.compareUrl).toBe('https://github.com/org/my-app/compare/ccc3333ccc3333c...ddd4444ddd4444d')
  })

  test('metadata diff captures environment and branch changes', async ({ request }) => {
    // Submit a green run with no environment/branch
    await submitRun(request, {
      status: 'passed',
      cases: [{ title: 'cfg test', status: 'passed', location: 'tests/cfg.spec.ts:1:1' }]
    })

    // Submit a failing run with different environment and branch
    const { testRunId: failId } = await submitRun(request, {
      status: 'failed',
      environment: 'staging',
      branch: 'feature/new-thing',
      cases: [{ title: 'cfg test', status: 'failed', location: 'tests/cfg.spec.ts:1:1', error: 'fail' }]
    })

    const resp = await request.get(`/api/test-runs/${failId}/regression-context`)
    const ctx: RegressionCtx = await resp.json()

    expect(ctx.hasGreen).toBe(true)
    const envEntry = ctx.metadataDiff!.find(d => d.key === 'environment')
    expect(envEntry).toBeDefined()
    expect(envEntry!.before).toBeNull()
    expect(envEntry!.after).toBe('staging')

    const branchEntry = ctx.metadataDiff!.find(d => d.key === 'branch')
    expect(branchEntry).toBeDefined()
    expect(branchEntry!.after).toBe('feature/new-thing')
  })

  test('metadata diff is empty when nothing changed', async ({ request }) => {
    const { testRunId: _greenId } = await submitRun(request, {
      status: 'passed',
      environment: 'ci',
      branch: 'main',
      cases: [{ title: 'stable test', status: 'passed', location: 'tests/stable.spec.ts:1:1' }]
    })

    const { testRunId: failId } = await submitRun(request, {
      status: 'failed',
      environment: 'ci',
      branch: 'main',
      cases: [{ title: 'stable test', status: 'failed', location: 'tests/stable.spec.ts:1:1', error: 'fail' }]
    })

    const resp = await request.get(`/api/test-runs/${failId}/regression-context`)
    const ctx: RegressionCtx = await resp.json()

    expect(ctx.hasGreen).toBe(true)
    expect(ctx.metadataDiff).toHaveLength(0)
    // The test was passing in the green run but fails here
    expect(ctx.newFailures).toBe(1)
  })

  test('commitRange is null when commits are identical', async ({ request }) => {
    const SHA = 'eee5555eee5555e'
    await submitRun(request, {
      status: 'passed',
      commit: SHA,
      cases: [{ title: 'same sha', status: 'passed', location: 'tests/x.spec.ts:1:1' }]
    })

    const { testRunId: failId } = await submitRun(request, {
      status: 'failed',
      commit: SHA,
      cases: [{ title: 'same sha', status: 'failed', location: 'tests/x.spec.ts:1:1', error: 'fail' }]
    })

    const resp = await request.get(`/api/test-runs/${failId}/regression-context`)
    const ctx: RegressionCtx = await resp.json()

    expect(ctx.hasGreen).toBe(true)
    expect(ctx.commitRange).toBeNull()
  })

  test('returns 404 for unknown run ID', async ({ request }) => {
    const resp = await request.get('/api/test-runs/999999/regression-context')
    expect(resp.status()).toBe(404)
  })
})
