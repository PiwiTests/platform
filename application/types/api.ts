/**
 * Shared types for API responses and requests
 * These types are used by both the server API and the app frontend
 */

import type { Role, FilterDetails } from '../shared/types';

// Re-export database types that are used in API responses
export type {
  Project as DbProject,
  TestRun as DbTestRun,
  TestCase as DbTestCase,
  TestRunsCase as DbTestRunsCase,
  User as DbUser,
  Tag as DbTag,
} from '../server/database/schema';

// ============================================================================
// Metadata types
// ============================================================================

/**
 * SCM (source control) metadata attached to a test run
 */
export interface TestRunScmMetadata {
  commit?: string | null;
  branch?: string | null;
  author?: string | null;
  commitMessage?: string | null;
}

/**
 * CI metadata attached to a test run
 */
export interface TestRunCiMetadata {
  provider?: string | null;
  buildNumber?: string | null;
  buildUrl?: string | null;
  jobName?: string | null;
  workflow?: string | null;
}

/**
 * Metadata attached to a test run
 */
export interface TestRunMetadata {
  scm?: TestRunScmMetadata;
  ci?: TestRunCiMetadata;
  projectDescription?: string | null;
  relatedIssue?: string | null;
  tags?: string[];
  customData?: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================================================
// Report types (API responses)
// ============================================================================

/**
 * Report attached to a test run
 */
export interface ReportInfo {
  id: number;
  type: string;
  label: string;
  path: string;
  size?: number | null;
}

/**
 * File stored in the unified files table
 */
export interface FileInfo {
  id: number;
  testRunId?: number | null;
  testRunsCaseId?: number | null;
  type: string;
  subtype?: string | null;
  label?: string | null;
  path: string;
  size?: number | null;
  createdAt: Date;
}

// ============================================================================
// Tag types (API responses)
// ============================================================================

/**
 * Tag used to label projects
 */
export interface TagInfo {
  id: number;
  text: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tags response from API
 */
export interface TagsResponse {
  tags: TagInfo[];
}

// ============================================================================
// Period and Range types (used for filtering and date range selection)
// ============================================================================

export type Period = '1d' | '7d' | '30d' | '90d' | '1y' | 'daily' | 'weekly' | 'monthly';

export interface Range {
  start: Date;
  end: Date;
}

// ============================================================================
// Project types (API responses)
// ============================================================================

/**
 * Slim project entry for sidebar navigation - returned by GET /api/projects/menu
 */
export interface ProjectMenuItem {
  id: number;
  name: string;
  label: string | null;
}

/**
 * Project with statistics - returned by GET /api/projects
 */
export interface ProjectWithStats {
  id: number;
  name: string;
  label?: string | null;
  description?: string | null;
  tags?: TagInfo[];
  createdAt: Date;
  updatedAt: Date;
  // Statistics added by API
  latestRun?: {
    id: number;
    status: string;
    startTime: string | Date;
    duration?: number | null;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    didNotRunTests: number;
    flakyTests: number;
    totalTests: number;
    reports?: ReportInfo[];
    avgTestDuration?: number | null;
    p90TestDuration?: number | null;
    metadata: TestRunMetadata;
  } | null;
  totalRuns: number;
  totalTestCases: number;
}

/**
 * A single run entry in a project overview (slim, for trend bars)
 */
export interface ProjectOverviewRun {
  id: number;
  status: string;
  passedTests: number;
  failedTests: number;
  flakyTests: number;
  totalTests: number;
  startTime: string | Date;
  environment?: string | null;
}

/**
 * Per-project overview with trend data - returned by GET /api/projects/overview
 */
export interface ProjectOverview {
  id: number;
  name: string;
  label: string | null;
  tags: TagInfo[];
  totalFullRuns: number;
  latestFullRun: {
    id: number;
    status: string;
    startTime: string | Date;
    duration: number | null;
    passedTests: number;
    failedTests: number;
    flakyTests: number;
    totalTests: number;
  } | null;
  recentRuns: ProjectOverviewRun[];
  tendency: 'passing' | 'flaky' | 'failing' | 'unknown';
}

/**
 * Project with test runs - returned by GET /api/projects/[id]
 */
export interface ProjectWithTestRuns {
  id: number;
  name: string;
  label?: string | null;
  description?: string | null;
  color?: string | null;
  tags?: TagInfo[];
  createdAt: Date;
  updatedAt: Date;
  testRuns: TestRunSummary[];
}

/**
 * Project details for editing - used in edit forms
 */
export interface ProjectDetails {
  id: number;
  name: string;
  label?: string | null;
  description?: string | null;
  diagnosisInstructions?: string | null;
  hasScmToken: boolean;
  color?: string | null;
  tags?: TagInfo[];
}

// ============================================================================
// Test Run types (API responses)
// ============================================================================

/**
 * Test run summary (without test cases)
 */
export interface TestRunSummary {
  id: number;
  projectId: number;
  status: string;
  startTime: string | Date;
  duration?: number | null;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  didNotRunTests: number;
  flakyTests: number;
  avgTestDuration?: number | null;
  p90TestDuration?: number | null;
  reports?: ReportInfo[];
  browsers?: string[];
  environment?: string | null;
  label?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any | null;
  isFullRun?: boolean;
  filterDetails?: FilterDetails | null;
  createdAt: Date;
}

/**
 * Test run with full details - returned by GET /api/test-runs/[id]
 */
export interface TestRunDetails {
  id: number;
  projectId: number;
  status: string;
  startTime: string | Date;
  duration?: number | null;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  didNotRunTests: number;
  flakyTests: number;
  avgTestDuration?: number | null;
  p90TestDuration?: number | null;
  shardTotal?: number | null;
  shardsFinished?: number;
  isFullRun?: boolean;
  filterDetails?: FilterDetails | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any | null;
  setupSteps?: TestStepEvent[] | null;
  environment?: string | null;
  label?: string | null;
  createdAt: Date;
  project?: {
    id: number;
    name: string;
    label?: string | null;
    latestRunId?: number | null;
    latestRunStatus?: string | null;
  };
  reports?: ReportInfo[];
  testCases?: TestCaseResult[];
  suites?: SuiteInfo[];
  storageStats?: {
    totalFiles: number;
    totalSize: number;
    reportSizes: Array<{ label: string; size: number }>;
    testCaseFilesSize: number;
    testCaseFilesCount: number;
  };
  links?: EntityLinkInfo[];
  /** Effective allowlist of glob patterns classifying waits as wasted time. */
  wastedWaitPatterns?: string[];
}

/**
 * Lightweight test run summary for comparison pages — omits heavy JSON blobs
 * returned by GET /api/test-runs/[id]/summary
 */
export interface TestRunForCompare {
  id: number;
  status: string;
  totalTests: number;
  testCases: Array<{
    title: string;
    status: string;
    duration?: number | null;
    location?: string;
  }>;
}

/**
 * Test run for charts and visualization
 */
export interface TestRunForChart {
  id: number;
  projectId?: number;
  projectName?: string;
  projectLabel?: string | null;
  status: string;
  startTime: string | Date;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  didNotRunTests: number;
  flakyTests: number;
  totalTests: number;
  duration?: number | null;
  avgTestDuration?: number | null;
  p90TestDuration?: number | null;
  isFullRun?: boolean;
  environment?: string | null;
}

// ============================================================================
// Performance types
// ============================================================================

/**
 * A single step recorded during test execution
 */
export interface PerformanceStep {
  title: string;
  duration: number;
  category: string;
}

/**
 * A hook/fixture step event with absolute timing, used by WorkersTimeline
 * to render segments alongside the test case bar.
 */
export interface TestStepEvent {
  title: string;
  category: 'hook' | 'fixture' | 'test.step' | 'expect' | 'wait';
  startedAt: number;
  duration: number;
  status: string;
  location?: string | null;
}

export interface ServerLogEntry {
  timestamp: number;
  level: string;
  category: string;
  message: string;
  stack?: string;
}

/**
 * A single network request recorded during test execution (via dashboard fixture)
 */
export interface NetworkRequest {
  method: string;
  url: string;
  status: number;
  duration: number;
  resourceType: string;
  contentType?: string | null;
  startTime?: number;
  serverLogs?: ServerLogEntry[];
}

/**
 * Browser performance / web vitals recorded via dashboard fixture
 */
export interface WebVitals {
  navigation?: {
    url: string;
    ttfb: number;
    domInteractive: number;
    domContentLoaded: number;
    loadComplete: number;
    transferSize?: number;
    encodedBodySize?: number;
    decodedBodySize?: number;
  } | null;
  paint?: {
    firstPaint?: number;
    firstContentfulPaint?: number;
  } | null;
}

/**
 * A single console message captured during test execution (via dashboard fixture)
 */
export interface ConsoleEntry {
  type: string;
  text: string;
  timestamp: number;
  location?: string | null;
}

/**
 * Grouped endpoint summary returned by GET /api/test-runs/[id]/network-requests
 */
export interface EndpointSummary {
  method: string;
  route: string;
  count: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  p90Duration: number;
  errorRate: number;
  testCases: string[];
}

// ============================================================================
// Test Case types (API responses)
// ============================================================================

/**
 * Suite (describe block) info — returned as a flat list alongside test cases,
 * one entry per unique describe path across all files in the run.
 */
export interface SuiteInfo {
  filePath: string;
  suitePath: string[];
  mode: string;
  annotations: Array<{ type: string; description?: string }>;
}

/**
 * Test case result (for a specific test run)
 */
export interface TestCaseResult {
  id: number;
  title: string;
  filePath?: string;
  suitePath?: string[];
  testAnnotations?: Array<{ type: string; description?: string }> | null;
  status: string;
  duration?: number | null;
  location?: string;
  error?: string | null;
  failureClusterId?: number | null;
  retries?: number | null;
  steps?: PerformanceStep[] | null;
  stepEvents?: TestStepEvent[] | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  wastedTimeMs?: number | null;
  networkRequests?: NetworkRequest[] | null;
  webVitals?: WebVitals | null;
  consoleLogs?: ConsoleEntry[] | null;
  ariaSnapshot?: string | null;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number;
  browser?: {
    projectName?: string;
    browserName?: string | null;
    channel?: string | null;
    viewport?: { width: number; height: number } | null;
  } | null;
  links?: EntityLinkInfo[];
  isNewRegression?: boolean | null;
  isNewFlaky?: boolean | null;
}

/**
 * One affected test case inside a failure group — part of GET /api/test-runs/[id]/failure-groups
 */
export interface FailureGroupCase {
  testRunsCaseId: number;
  testCaseId: number;
  title: string;
  filePath: string;
  retries: number;
  workerIndex: number | null;
  passedOnRetry: boolean;
}

/**
 * Failure group summary for a test run — returned by GET /api/test-runs/[id]/failure-groups
 */
export interface FailureGroup {
  clusterId: number;
  signature: string;
  title: string | null;
  errorType: string | null;
  selector: string | null;
  status: string;
  triageNote: string | null;
  caseCount: number;
  isNew: boolean;
  firstSeenRunId: number;
  firstSeenAt: string | null;
  occurrences: number;
  flaky: boolean;
  workerCorrelated: boolean;
  cases: FailureGroupCase[];
  diagnosis: DiagnosisCompact | null;
}

/**
 * Full failure cluster — returned by GET /api/failure-clusters/[id]
 */
export interface FailureClusterDetail {
  id: number;
  projectId: number;
  fingerprint: string;
  signature: string;
  title: string | null;
  errorType: string | null;
  selector: string | null;
  sampleError: string | null;
  status: string;
  triageNote: string | null;
  firstSeenRunId: number;
  lastSeenRunId: number;
  occurrences: number;
  affectedTests: number;
  lastSeenRunStatus: string | null;
  lastSeenAt: string | Date | null;
  diagnosis: DiagnosisCompact | null;
  project: { id: number; name: string; label: string | null } | null;
  affectedTestCases: Array<{
    testCaseId: number;
    title: string;
    filePath: string;
    runCount: number;
    recentTestRunsCaseId: number;
  }>;
}

/**
 * Failure cluster summary for a project page — returned by GET /api/projects/[id]/failure-clusters
 */
export interface ProjectFailureCluster {
  id: number;
  fingerprint: string;
  signature: string;
  title: string | null;
  errorType: string | null;
  selector: string | null;
  sampleError: string | null;
  status: string;
  triageNote: string | null;
  firstSeenRunId: number;
  lastSeenRunId: number;
  occurrences: number;
  affectedTests: number;
  lastSeenRunStatus: string | null;
  lastSeenAt: string | Date | null;
  diagnosis: DiagnosisCompact | null;
}

/**
 * Test case with statistics - returned by GET /api/projects/[id]/test-cases
 */
export interface TestCaseWithStats {
  id: number;
  filePath: string;
  title: string;
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  skippedRuns: number;
  timedOutRuns: number;
  flakyRuns: number;
  recentFlakyRuns?: number;
  avgDuration: number;
  lastRun: number;
  lastStatus: string;
}

// ============================================================================
// Authentication types
// ============================================================================

/**
 * Authenticated user
 */
export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  name?: string | null;
  avatarUrl?: string | null;
}

/**
 * Authentication state
 */
export interface AuthState {
  authenticated: boolean;
  user: AuthUser | null;
}

/**
 * User details (for user management)
 */
export interface UserDetails {
  id: number;
  username: string;
  role: Role;
  name?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  oauthProvider?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Users response from API
 */
export interface UsersResponse {
  users: UserDetails[];
  authEnabled: boolean;
}

// ============================================================================
// API key types
// ============================================================================

/**
 * API key summary (key hash/plaintext is never returned after creation)
 */
export interface ApiKeySummary {
  id: number;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt?: Date | null;
  expiresAt?: Date | null;
}

/**
 * Response from GET /api/users/[id]/api-keys
 */
export interface ApiKeysResponse {
  apiKeys: ApiKeySummary[];
}

/**
 * Response from POST /api/users/[id]/api-keys – key is shown ONCE
 */
export interface CreateApiKeyResponse {
  key: string;
  prefix: string;
  name: string;
}

// ============================================================================
// Project assignment types
// ============================================================================

/**
 * User's project assignments (GET /api/users/[id]/projects)
 */
export interface UserProjectAssignments {
  global: boolean;
  projectIds: number[];
}

/**
 * Project member entry (GET /api/projects/[id]/members)
 */
export interface ProjectMemberEntry {
  id: number;
  username: string;
  name: string | null;
  role: string;
  global: boolean;
}

/**
 * Project members response
 */
export interface ProjectMembersResponse {
  users: ProjectMemberEntry[];
}

// ============================================================================
// Admin types
// ============================================================================

/**
 * Storage statistics returned by GET /api/admin/stats
 */
export interface AdminStats {
  totalProjects: number;
  totalRuns: number;
  totalTestCases: number;
  totalRunsCases: number;
  totalFiles: number;
  totalFileSize: number;
  storageSizeOnDisk: number | null;
}

// ============================================================================
// Request body types
// ============================================================================

/**
 * Test run submission body for POST /api/test-runs/submit
 */
export interface TestRunSubmitBody {
  projectName: string;
  projectDescription?: string;
  status: string;
  startTime: string;
  duration?: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  didNotRunTests: number;
  flakyTests?: number;
  environment?: string;
  label?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
  testCases?: Array<{
    title: string;
    filePath: string;
    status: string;
    duration?: number;
    error?: string;
    retries?: number;
    line?: number;
    column?: number;
    steps?: PerformanceStep[];
    slowestStep?: string;
    slowestStepDuration?: number;
    networkRequests?: NetworkRequest[];
    webVitals?: WebVitals;
    workerIndex?: number;
  }>;
}

// ============================================================================
// Performance API response types
// ============================================================================

/**
 * Performance trend data point - returned by GET /api/projects/[id]/performance
 */
export interface PerformanceTrendPoint {
  id: number;
  startTime: string | Date;
  duration?: number | null;
  avgTestDuration?: number | null;
  p90TestDuration?: number | null;
  status: string;
  totalTests: number;
  commit?: string | null;
  branch?: string | null;
  isFullRun?: boolean;
}

/**
 * Test case history point - returned by GET /api/test-cases/[id]/history
 */
export interface TestCaseHistoryPoint {
  id: number;
  runId: number;
  status: string;
  duration: number | null;
  error: string | null;
  retries: number | null;
  startTime: string | Date;
  runStatus: string;
}

/**
 * Trace file attached to a test case result
 */
export interface TraceInfo {
  id: number;
  filePath: string;
  createdAt: Date;
}

/**
 * Attachment file (screenshot, video, custom) attached to a test case result
 */
export interface AttachmentInfo {
  id: number;
  name: string | null;
  contentType: string | null;
  path: string;
  size: number | null;
}

// ============================================================================
// Regression context types (Pillar 2)
// ============================================================================

/**
 * Commit range between last passing run and this run
 */
export interface RegressionContextCommitRange {
  fromSha: string;
  toSha: string;
  fromShort: string;
  toShort: string;
  repositoryUrl: string | null;
  compareUrl: string | null;
  gitCommand: string;
}

/**
 * A single field that changed between the last passing run and this run
 */
export interface RegressionContextMetaDiff {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
}

/**
 * Regression context for a test run — returned by GET /api/test-runs/[id]/regression-context.
 * hasGreen: false means no prior passing run exists for this project.
 */
export interface RegressionContext {
  hasGreen: boolean;
  lastGreenRunId?: number;
  lastGreenRunAt?: string | Date | null;
  lastGreenCommit?: string | null;
  lastGreenBranch?: string | null;
  currentCommit?: string | null;
  currentBranch?: string | null;
  commitRange?: RegressionContextCommitRange | null;
  metadataDiff?: RegressionContextMetaDiff[];
  newFailures?: number;
}

/**
 * Slow test entry - returned by GET /api/projects/[id]/slow-tests
 */
export interface SlowTest {
  id: number;
  title: string;
  filePath: string;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  runCount: number;
  trend: 'faster' | 'slower' | 'stable';
  latestDuration: number;
}

// ============================================================================
// AI Diagnosis types (Pillar 4)
// ============================================================================

/**
 * Compact diagnosis summary — inlined in failure-groups and failure-clusters responses
 */
export interface DiagnosisCompact {
  status: string;
  category: string | null;
  confidence: string | null;
  summary: string | null;
}

/**
 * SCM coverage metadata returned alongside the diagnosis context preview.
 * null means the regression context block was never reached (DB error or no lastSeenRun).
 */
export interface DiagnosisContextCoverage {
  scm: {
    hasLastGreen: boolean;
    hasCommitRange: boolean;
    /** Set when the user manually overrode the baseline commit SHA */
    baseCommitUsed: string | null;
    provider: 'github' | 'gitlab' | 'bitbucket' | null;
    commitsCount: number;
    filesCount: number;
    patchedFilesCount: number;
    patchesOmitted: boolean;
    patchesTruncated: boolean;
  } | null;
  /** True when the last passing run is newer than the cluster's lastSeen — test may already be fixed. */
  alreadyGreen?: boolean;
  /** Sections where data is not applicable (with reason), keyed by section id. Absent in coverage means "no data". */
  notApplicable?: Record<string, string>;
}

/**
 * A commit as returned by the failure-cluster commit-list endpoints and rendered
 * by the commit picker / browser. Shared so those components don't each redeclare it.
 */
export interface CommitListItem {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Changed file returned in SCM diff — mirrors ScmProvider.ChangedFile
 */
export interface ScmChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/**
 * Structured SCM changes returned alongside the context preview
 */
export interface ScmChanges {
  commits: { sha: string; message: string }[];
  files: ScmChangedFile[];
  patchesOmitted?: boolean;
}

/** Supported AI provider identifiers */
export type AiProvider = 'anthropic' | 'openai';

/**
 * Model metadata returned by the provider's models endpoint.
 * Shared between the server models endpoint and frontend model picker UI.
 */
export interface ModelInfo {
  id: string;
  label?: string;
  ownedBy?: string;
  contextLength?: number;
  maxTokens?: number;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
  modalities?: string[];
}

/**
 * The distinct model "slots" Piwi can call. Each role has its own complete
 * provider configuration (or reuses another role's credentials):
 * - `diagnosis`  — the main model that writes the final diagnosis (required root)
 * - `research`   — optional cheaper/faster pre-analysis pass (two-stage diagnosis)
 * - `embedding`  — optional embeddings model for semantic failure clustering
 */
export type AiModelRole = 'diagnosis' | 'research' | 'embedding';

/** A fully-resolved provider config for a single role (server-side; holds the raw key). */
export interface ResolvedAiRole {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string | null;
}

/**
 * Runtime AI configuration — built from env vars or DB settings.
 * Contains the raw API key; never sent to the client.
 * AiSettings is the client-facing equivalent (hasApiKey + envManaged instead).
 *
 * The top-level `provider`/`apiKey`/`model`/`baseUrl` fields mirror the
 * `diagnosis` role for back-compat with callers that take an AiConfig directly.
 */
export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string | null;
  autoDiagnose: boolean;
  source: 'env' | 'settings';
  /** Per-role resolved configs. `diagnosis` is always present; others are null when unconfigured. */
  roles: {
    diagnosis: ResolvedAiRole;
    research: ResolvedAiRole | null;
    embedding: ResolvedAiRole | null;
  };
}

/**
 * AI status — returned by GET /api/ai/status
 */
export interface AiStatus {
  configured: boolean;
  provider?: AiProvider | null;
  model?: string | null;
  autoDiagnose?: boolean;
  source?: string | null;
}

/**
 * Client-facing config for one model role (no raw secret — only `hasApiKey`).
 * A role with `reuse` set inherits its provider/key/baseUrl from another role.
 */
export interface AiRoleSettings {
  provider: AiProvider | null;
  model: string | null;
  baseUrl: string | null;
  reuse: AiModelRole | null;
  hasApiKey: boolean;
}

/**
 * AI settings — returned by GET /api/settings/ai.
 * Each model role carries a complete (or reused) provider config.
 */
export interface AiSettings {
  roles: {
    diagnosis: AiRoleSettings | null;
    research: AiRoleSettings | null;
    embedding: AiRoleSettings | null;
  };
  autoDiagnose: boolean;
  hasScmToken: boolean;
  envManaged: boolean;
  customInstructions: string | null;
}

// ============================================================================
// AI Settings request body types
// ============================================================================

/**
 * One role config as submitted by the client (apiKey is plaintext or omitted).
 */
export interface AiRoleConfigInput {
  provider?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  reuse?: AiModelRole | null;
}

/**
 * Request body for PUT /api/settings/ai
 */
export interface SaveAiSettingsBody {
  roles?: Partial<Record<AiModelRole, AiRoleConfigInput | null>> | null;
  autoDiagnose?: boolean;
  customInstructions?: string | null;
  scmToken?: string | null;
}

// ============================================================================
// Entity Link types (A.4)
// ============================================================================

/**
 * Entity link — attach an external URL to a run, test-case run, or test case.
 * API response type, mirrors the DB row minus internal-only fields.
 */
export interface EntityLinkInfo {
  id: number;
  testRunId?: number | null;
  testRunsCaseId?: number | null;
  testCaseId?: number | null;
  url: string;
  provider: string;
  key?: string | null;
  title?: string | null;
  statusText?: string | null;
  statusColor?: string | null;
  unfurledAt?: string | Date | null;
  createdBy?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Request body for POST /api/links
 */
export interface CreateLinkBody {
  entityType: 'test_run' | 'test_runs_case' | 'test_case';
  entityId: number;
  url: string;
  title?: string | null;
}

/**
 * Request body for PATCH /api/links/[id]
 */
export interface UpdateLinkBody {
  url?: string;
  title?: string | null;
}

/**
 * Links API response (list)
 */
export interface LinksResponse {
  links: EntityLinkInfo[];
}

/**
 * Single link API response
 */
export interface LinkResponse {
  link: EntityLinkInfo;
}

// ============================================================================
// Flaky tests types (Pillar 3)
// ============================================================================

/**
 * Flaky test entry — returned by GET /api/projects/[id]/flaky-tests
 */
export interface FlakyTest {
  testCaseId: number;
  latestRunsCaseId: number;
  title: string;
  filePath: string;
  totalRuns: number;
  failedRuns: number;
  retryPassRuns: number;
  alternations: number;
  failureRate: number;
  score: number;
  lastFlakeAt: string | Date | null;
  rootCause: string | null;
  impact: number;
  wastedCiMinutes: number;
  avgFailedDurationMs: number;
}
