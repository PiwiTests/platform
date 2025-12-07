import type { TestRun } from '~/types'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  
  const testRun: TestRun = {
    id: body.id || `run-${Date.now()}`,
    projectId: body.projectId,
    status: body.status || 'running',
    startTime: body.startTime || new Date().toISOString(),
    endTime: body.endTime,
    duration: body.duration,
    totalTests: body.totalTests || 0,
    passed: body.passed || 0,
    failed: body.failed || 0,
    skipped: body.skipped || 0,
    flaky: body.flaky || 0,
    reportPath: body.reportPath,
  }
  
  await writeJSON(`test-runs/${testRun.id}.json`, testRun)
  
  return testRun
})
