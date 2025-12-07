// Data models for Playwright Dashboard

export interface Project {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface TestCase {
  id: string
  projectId: string
  title: string
  filePath: string
  line: number
  status?: 'passed' | 'failed' | 'skipped' | 'flaky'
}

export interface TestRun {
  id: string
  projectId: string
  status: 'running' | 'passed' | 'failed' | 'timedOut'
  startTime: string
  endTime?: string
  duration?: number
  totalTests: number
  passed: number
  failed: number
  skipped: number
  flaky: number
  reportPath?: string
}

export interface TestResult {
  testCaseId: string
  testRunId: string
  status: 'passed' | 'failed' | 'skipped' | 'timedOut'
  duration: number
  error?: string
  retry: number
  tracePath?: string
}

export interface Trace {
  id: string
  testRunId: string
  testCaseId: string
  path: string
  createdAt: string
}
