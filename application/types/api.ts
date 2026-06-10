/**
 * Shared types for API responses and requests
 * These types are used by both the server API and the app frontend
 */

// Re-export database types that are used in API responses
export type {
  Project as DbProject,
  TestRun as DbTestRun,
  TestCase as DbTestCase,
  TestRunsCase as DbTestRunsCase,
  User as DbUser,
  Tag as DbTag
} from '../server/database/schema'

// ============================================================================
// Metadata types
// ============================================================================

/**
 * SCM (source control) metadata attached to a test run
 */
export interface TestRunScmMetadata {
  commit?: string | null
  branch?: string | null
  author?: string | null
  commitMessage?: string | null
}

/**
 * CI metadata attached to a test run
 */
export interface TestRunCiMetadata {
  provider?: string | null
  buildNumber?: string | null
  buildUrl?: string | null
  jobName?: string | null
  workflow?: string | null
}

/**
 * Metadata attached to a test run
 */
export interface TestRunMetadata {
  scm?: TestRunScmMetadata
  ci?: TestRunCiMetadata
  projectDescription?: string | null
  relatedIssue?: string | null
  tags?: string[]
  customData?: Record<string, unknown>
  [key: string]: unknown
}

// ============================================================================
// Report types (API responses)
// ============================================================================

/**
 * Report attached to a test run
 */
export interface ReportInfo {
  id: number
  type: string
  label: string
  path: string
  size?: number | null
}

/**
 * File stored in the unified files table
 */
export interface FileInfo {
  id: number
  testRunId?: number | null
  testRunsCaseId?: number | null
  type: string
  subtype?: string | null
  label?: string | null
  path: string
  size?: number | null
  createdAt: Date
}

// ============================================================================
// Tag types (API responses)
// ============================================================================

/**
 * Tag used to label projects
 */
export interface TagInfo {
  id: number
  text: string
  color: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Tags response from API
 */
export interface TagsResponse {
  tags: TagInfo[]
}

// ============================================================================
// Period and Range types (used for filtering and date range selection)
// ============================================================================

export type Period = '1d' | '7d' | '30d' | '90d' | '1y' | 'daily' | 'weekly' | 'monthly'

export interface Range {
  start: Date
  end: Date
}

// ============================================================================
// Project types (API responses)
// ============================================================================

/**
 * Project with statistics - returned by GET /api/projects
 */
export interface ProjectWithStats {
  id: number
  name: string
  label?: string | null
  description?: string | null
  tags?: TagInfo[]
  createdAt: Date
  updatedAt: Date
  // Statistics added by API
  latestRun?: {
    id: number
    status: string
    startTime: string | Date
    duration?: number | null
    passedTests: number
    failedTests: number
    skippedTests: number
    flakyTests: number
    totalTests: number
    reports?: ReportInfo[]
    avgTestDuration?: number | null
    p90TestDuration?: number | null
    metadata: TestRunMetadata
  } | null
  totalRuns: number
  totalTestCases: number
}

/**
 * Project with test runs - returned by GET /api/projects/[id]
 */
export interface ProjectWithTestRuns {
  id: number
  name: string
  label?: string | null
  description?: string | null
  color?: string | null
  tags?: TagInfo[]
  createdAt: Date
  updatedAt: Date
  testRuns: TestRunSummary[]
}

/**
 * Project details for editing - used in edit forms
 */
export interface ProjectDetails {
  id: number
  name: string
  label?: string | null
  description?: string | null
  color?: string | null
  tags?: TagInfo[]
}

// ============================================================================
// Test Run types (API responses)
// ============================================================================

/**
 * Test run summary (without test cases)
 */
export interface TestRunSummary {
  id: number
  projectId: number
  status: string
  startTime: string | Date
  duration?: number | null
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  flakyTests: number
  avgTestDuration?: number | null
  p90TestDuration?: number | null
  reports?: ReportInfo[]
  environment?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any | null
  createdAt: Date
}

/**
 * Test run with full details - returned by GET /api/test-runs/[id]
 */
export interface TestRunDetails {
  id: number
  projectId: number
  status: string
  startTime: string | Date
  duration?: number | null
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  flakyTests: number
  avgTestDuration?: number | null
  p90TestDuration?: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any | null
  environment?: string | null
  createdAt: Date
  project?: {
    id: number
    name: string
    label?: string | null
  }
  reports?: ReportInfo[]
  testCases?: TestCaseResult[]
  storageStats?: {
    totalFiles: number
    totalSize: number
  }
}

/**
 * Lightweight test run summary for comparison pages — omits heavy JSON blobs
 * returned by GET /api/test-runs/[id]/summary
 */
export interface TestRunForCompare {
  id: number
  status: string
  totalTests: number
  testCases: Array<{
    title: string
    status: string
    duration?: number | null
    location?: string
  }>
}

/**
 * Test run for charts and visualization
 */
export interface TestRunForChart {
  id: number
  status: string
  startTime: string | Date
  passedTests: number
  failedTests: number
  skippedTests: number
  flakyTests: number
  totalTests: number
  duration?: number | null
  avgTestDuration?: number | null
  p90TestDuration?: number | null
}

// ============================================================================
// Performance types
// ============================================================================

/**
 * A single step recorded during test execution
 */
export interface PerformanceStep {
  title: string
  duration: number
  category: string
}

/**
 * A single network request recorded during test execution (via dashboard fixture)
 */
export interface NetworkRequest {
  method: string
  url: string
  status: number
  duration: number
  resourceType: string
  startTime?: number
}

/**
 * Browser performance / web vitals recorded via dashboard fixture
 */
export interface WebVitals {
  navigation?: {
    url: string
    ttfb: number
    domInteractive: number
    domContentLoaded: number
    loadComplete: number
    transferSize?: number
    encodedBodySize?: number
    decodedBodySize?: number
  } | null
  paint?: {
    firstPaint?: number
    firstContentfulPaint?: number
  } | null
}

/**
 * A single console message captured during test execution (via dashboard fixture)
 */
export interface ConsoleEntry {
  type: string
  text: string
  timestamp: number
  location?: string | null
}

/**
 * Grouped endpoint summary returned by GET /api/test-runs/[id]/network-requests
 */
export interface EndpointSummary {
  method: string
  route: string
  count: number
  avgDuration: number
  maxDuration: number
  minDuration: number
  p90Duration: number
  errorRate: number
  testCases: string[]
}

// ============================================================================
// Test Case types (API responses)
// ============================================================================

/**
 * Test case result (for a specific test run)
 */
export interface TestCaseResult {
  id: number
  title: string
  status: string
  duration?: number | null
  location?: string
  error?: string | null
  failureClusterId?: number | null
  retries?: number | null
  steps?: PerformanceStep[] | null
  slowestStep?: string | null
  slowestStepDuration?: number | null
  networkRequests?: NetworkRequest[] | null
  webVitals?: WebVitals | null
  consoleLogs?: ConsoleEntry[] | null
  ariaSnapshot?: string | null
  workerIndex?: number | null
  startedAt?: number
}

/**
 * Failure group summary for a test run — returned by GET /api/test-runs/[id]/failure-groups
 */
export interface FailureGroup {
  id: number
  fingerprint: string
  signature: string
  errorType: string | null
  selector: string | null
  sampleError: string | null
  sameRunCaseCount: number
  isNew: boolean
  firstSeenRunId: number
  lastSeenRunId: number
  occurrences: number
  affectedCaseIds: number[]
}

/**
 * Failure cluster summary for a project page — returned by GET /api/projects/[id]/failure-clusters
 */
export interface ProjectFailureCluster {
  id: number
  fingerprint: string
  signature: string
  errorType: string | null
  selector: string | null
  sampleError: string | null
  firstSeenRunId: number
  lastSeenRunId: number
  occurrences: number
  lastSeenRunStatus: string | null
  lastSeenAt: string | Date | null
}

/**
 * Test case with statistics - returned by GET /api/projects/[id]/test-cases
 */
export interface TestCaseWithStats {
  id: number
  filePath: string
  title: string
  totalRuns: number
  passedRuns: number
  failedRuns: number
  skippedRuns: number
  timedOutRuns: number
  flakyRuns: number
  recentFlakyRuns?: number
  avgDuration: number
  lastRun: number
  lastStatus: string
}

// ============================================================================
// Authentication types
// ============================================================================

/**
 * Authenticated user
 */
export interface AuthUser {
  id: number
  username: string
  role: string
  name?: string | null
  avatarUrl?: string | null
}

/**
 * Authentication state
 */
export interface AuthState {
  authenticated: boolean
  user: AuthUser | null
}

/**
 * User details (for user management)
 */
export interface UserDetails {
  id: number
  username: string
  role: string
  name?: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Users response from API
 */
export interface UsersResponse {
  users: UserDetails[]
  authEnabled: boolean
}

// ============================================================================
// API key types
// ============================================================================

/**
 * API key summary (key hash/plaintext is never returned after creation)
 */
export interface ApiKeySummary {
  id: number
  name: string
  keyPrefix: string
  createdAt: Date
  lastUsedAt?: Date | null
  expiresAt?: Date | null
}

/**
 * Response from GET /api/users/[id]/api-keys
 */
export interface ApiKeysResponse {
  apiKeys: ApiKeySummary[]
}

/**
 * Response from POST /api/users/[id]/api-keys – key is shown ONCE
 */
export interface CreateApiKeyResponse {
  key: string
  prefix: string
  name: string
}

// ============================================================================
// Admin types
// ============================================================================

/**
 * Storage statistics returned by GET /api/admin/stats
 */
export interface AdminStats {
  totalProjects: number
  totalRuns: number
  totalTestCases: number
  totalRunsCases: number
  totalFiles: number
  totalFileSize: number
  storageSizeOnDisk: number | null
}

// ============================================================================
// Request body types
// ============================================================================

/**
 * Test run submission body for POST /api/test-runs/submit
 */
export interface TestRunSubmitBody {
  projectName: string
  projectDescription?: string
  status: string
  startTime: string
  duration?: number
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  flakyTests?: number
  environment?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any
  testCases?: Array<{
    title: string
    filePath: string
    status: string
    duration?: number
    error?: string
    retries?: number
    line?: number
    column?: number
    steps?: PerformanceStep[]
    slowestStep?: string
    slowestStepDuration?: number
    networkRequests?: NetworkRequest[]
    webVitals?: WebVitals
    workerIndex?: number
  }>
}

// ============================================================================
// Performance API response types
// ============================================================================

/**
 * Performance trend data point - returned by GET /api/projects/[id]/performance
 */
export interface PerformanceTrendPoint {
  id: number
  startTime: string | Date
  duration?: number | null
  avgTestDuration?: number | null
  p90TestDuration?: number | null
  status: string
  totalTests: number
  commit?: string | null
  branch?: string | null
}

/**
 * Test case history point - returned by GET /api/test-cases/[id]/history
 */
export interface TestCaseHistoryPoint {
  id: number
  runId: number
  status: string
  duration: number | null
  error: string | null
  retries: number | null
  startTime: string | Date
  runStatus: string
}

/**
 * Trace file attached to a test case result
 */
export interface TraceInfo {
  id: number
  filePath: string
  createdAt: Date
}

/**
 * Attachment file (screenshot, video, custom) attached to a test case result
 */
export interface AttachmentInfo {
  id: number
  name: string | null
  contentType: string | null
  path: string
  size: number | null
}

/**
 * Slow test entry - returned by GET /api/projects/[id]/slow-tests
 */
export interface SlowTest {
  id: number
  title: string
  filePath: string
  avgDuration: number
  maxDuration: number
  minDuration: number
  runCount: number
  trend: 'faster' | 'slower' | 'stable'
  latestDuration: number
}
