import { pgTable, text, integer, serial, timestamp, jsonb, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';

// Projects table
export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull().unique(),
    label: text('label'), // Display label (defaults to name if not set)
    description: text('description'),
    diagnosisInstructions: text('diagnosis_instructions'),
    scmToken: text('scm_token'), // Per-project SCM token for GitHub/GitLab/Bitbucket API access
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    updatedAtIdx: index('idx_projects_updated_at').on(table.updatedAt),
  }),
);

// Test runs table
export const testRuns = pgTable(
  'test_runs',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    status: text('status').notNull(), // 'passed', 'failed', 'timedout', 'interrupted', 'running', 'cancelled', 'initialising', 'finalizing'
    startTime: timestamp('start_time', { mode: 'date' }).notNull(),
    duration: integer('duration'), // in milliseconds
    totalTests: integer('total_tests').notNull().default(0),
    passedTests: integer('passed_tests').notNull().default(0),
    failedTests: integer('failed_tests').notNull().default(0),
    skippedTests: integer('skipped_tests').notNull().default(0),
    flakyTests: integer('flaky_tests').notNull().default(0),
    avgTestDuration: integer('avg_test_duration'), // average test case duration in ms
    p90TestDuration: integer('p90_test_duration'), // 90th percentile test duration in ms

    environment: text('environment'), // Deployment environment (e.g. 'production', 'staging', 'development')
    metadata: jsonb('metadata'), // Additional metadata as JSON
    streamToken: text('stream_token'), // Token for authenticating streaming updates
    instanceId: text('instance_id'), // Unique identifier for the reporter instance that created this run
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    projectIdIdx: index('idx_test_runs_project_id').on(table.projectId),
    startTimeIdx: index('idx_test_runs_start_time').on(table.startTime),
  }),
);

// Test suites table - deduplicated describe block definitions, one row per unique path
export const testSuites = pgTable(
  'test_suites',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    suitePath: text('suite_path').notNull(), // \x1f-delimited full path, e.g. 'Auth\x1fLogin'
    mode: text('mode').notNull().default('default'), // 'parallel' | 'serial' | 'default'
    annotations: jsonb('annotations'), // Array<{ type, description? }>
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uniqueIdx: uniqueIndex('idx_test_suites_unique').on(table.projectId, table.filePath, table.suitePath),
  }),
);

// Test cases table - shared test definitions
export const testCases = pgTable(
  'test_cases',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    filePath: text('file_path').notNull(), // relative path from project root
    suitePath: text('suite_path').notNull().default(''), // \x1f-delimited describe block path, e.g. 'Auth\x1fLogin'
    suiteId: integer('suite_id').references(() => testSuites.id), // FK to immediate parent describe block (null for root-level tests)
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    projectIdIdx: index('idx_test_cases_project_id').on(table.projectId),
    filePathTitleIdx: index('idx_test_cases_file_path_title').on(
      table.projectId,
      table.filePath,
      table.suitePath,
      table.title,
    ),
  }),
);

// Failure clusters table - failed run cases grouped by normalized error fingerprint
export const failureClusters = pgTable(
  'failure_clusters',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(), // SHA-256 over FINGERPRINT_VERSION + normalized error signals (shared/error-fingerprint.ts)
    signature: text('signature').notNull(), // normalized first error line — human-readable cluster name
    errorType: text('error_type'), // 'timeout', 'assertion', 'strict-mode', 'navigation', 'crash', 'unknown'
    selector: text('selector'), // locator extracted from the error, if any
    sampleError: text('sample_error'), // one full raw error kept for display
    // Run ids are intentionally NOT foreign keys: runs are deleted independently
    // and clusters must survive them (stale ids are tolerated)
    firstSeenRunId: integer('first_seen_run_id').notNull(),
    lastSeenRunId: integer('last_seen_run_id').notNull(),
    status: text('status').notNull().default('open'), // 'open', 'resolved', 'ignored' — triage workflow
    triageNote: text('triage_note'), // Optional comment attached when triaging (status change)
    manualBaseCommit: text('manual_base_commit'), // user-pinned baseline commit SHA for AI diagnosis diff context
    occurrences: integer('occurrences').notNull().default(0), // denormalized count of linked test_runs_cases rows (not decremented on run deletion)
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    projectFingerprintIdx: uniqueIndex('idx_failure_clusters_project_fingerprint').on(
      table.projectId,
      table.fingerprint,
    ),
    projectLastSeenIdx: index('idx_failure_clusters_project_last_seen').on(table.projectId, table.lastSeenRunId),
  }),
);

// AI failure diagnoses - one per failure cluster, produced by the configured LLM provider
export const failureDiagnoses = pgTable(
  'failure_diagnoses',
  {
    id: serial('id').primaryKey(),
    clusterId: integer('cluster_id')
      .notNull()
      .references(() => failureClusters.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('running'), // 'running', 'completed', 'failed'
    provider: text('provider'), // 'anthropic', 'openai'
    model: text('model'), // model id that produced the diagnosis
    category: text('category'), // 'app-bug', 'test-bug', 'flaky-test', 'infrastructure', 'environment', 'unknown'
    confidence: text('confidence'), // 'high', 'medium', 'low'
    summary: text('summary'), // one-line diagnosis shown in lists
    rootCause: text('root_cause'), // short root-cause explanation
    details: jsonb('details'), // full structured result: evidence, suggestedFix, preventionTips
    error: text('error'), // failure reason when status = 'failed'
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    clusterIdIdx: uniqueIndex('idx_failure_diagnoses_cluster_id').on(table.clusterId),
  }),
);

// Application settings - key/value store for runtime-configurable settings (e.g. AI provider)
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Test runs cases table - junction table with run-specific data
export const testRunsCases = pgTable(
  'test_runs_cases',
  {
    id: serial('id').primaryKey(),
    testRunId: integer('test_run_id')
      .notNull()
      .references(() => testRuns.id),
    testCaseId: integer('test_case_id')
      .notNull()
      .references(() => testCases.id),
    status: text('status').notNull(), // 'passed', 'failed', 'timedout', 'skipped'
    duration: integer('duration'), // in milliseconds
    error: text('error'),
    failureClusterId: integer('failure_cluster_id').references(() => failureClusters.id), // set for failed rows with an error — groups rows sharing a fingerprint
    retries: integer('retries').default(0),
    line: integer('line'), // line number in file
    column: integer('column'), // column number in file
    steps: jsonb('steps'), // Array of { title, duration, category } step objects
    slowestStep: text('slowest_step'), // Title of the slowest step
    slowestStepDuration: integer('slowest_step_duration'), // Duration of the slowest step in ms
    networkRequests: jsonb('network_requests'), // Array of { method, url, status, duration, resourceType }
    webVitals: jsonb('web_vitals'), // { navigation: {...}, paint: {...} }
    consoleLogs: jsonb('console_logs'), // Array of { type, text, timestamp, location } console entries
    ariaSnapshot: text('aria_snapshot'), // ARIA snapshot of the page (YAML-like string from locator.ariaSnapshot())
    testSource: text('test_source'), // Source snippet around the failing assertion (sent by reporter)
    browser: jsonb('browser'), // Playwright project/browser config: { projectName, browserName, channel, viewport }
    testAnnotations: jsonb('test_annotations'), // Array<{ type, description? }> — runtime test marks (@fixme, @slow …)
    workerIndex: integer('worker_index'), // Parallel worker index (from Playwright's parallelIndex)
    startedAt: integer('started_at'), // Unix timestamp in ms when the test started
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    testRunIdIdx: index('idx_test_runs_cases_test_run_id').on(table.testRunId),
    testCaseIdIdx: index('idx_test_runs_cases_test_case_id').on(table.testCaseId),
    failureClusterIdIdx: index('idx_test_runs_cases_failure_cluster_id').on(table.failureClusterId),
    runCaseBrowserUnique: uniqueIndex('idx_test_runs_cases_run_browser').on(
      table.testRunId,
      table.testCaseId,
      table.retries,
      table.browser,
    ),
  }),
);

// Trace resources table - shared pool of individual resource files extracted from trace ZIPs
export const traceResources = pgTable(
  'trace_resources',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // filename as stored in resources/ dir, e.g. "abc123.net"
    path: text('path').notNull(), // project-{id}/trace-resources/{name}
    size: integer('size').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    projectNameIdx: uniqueIndex('idx_trace_resources_project_name').on(table.projectId, table.name),
  }),
);

// Trace blobs table - content-addressed storage deduplicating trace files across runs
export const traceBlobs = pgTable(
  'trace_blobs',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    hash: text('hash').notNull(), // SHA-256 hex digest of the trace file content
    path: text('path').notNull(), // content-addressed path: project-{id}/blobs/{hash}.zip
    size: integer('size').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    projectHashIdx: uniqueIndex('idx_trace_blobs_project_hash').on(table.projectId, table.hash),
  }),
);

// Files table - unified storage for all file references (reports, traces, screenshots, etc.)
export const files = pgTable(
  'files',
  {
    id: serial('id').primaryKey(),
    testRunId: integer('test_run_id').references(() => testRuns.id),
    testRunsCaseId: integer('test_runs_case_id').references(() => testRunsCases.id),
    type: text('type').notNull(), // 'report', 'trace', 'screenshot', etc.
    subtype: text('subtype'), // 'html', 'monocart', 'blob' for reports; null for traces
    label: text('label'), // Display label e.g. 'HTML Report'
    path: text('path').notNull(), // Relative path in storage
    size: integer('size'), // File/directory size in bytes
    blobId: integer('blob_id').references(() => traceBlobs.id), // Set when the file is a deduplicated trace blob
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    testRunIdIdx: index('idx_files_test_run_id').on(table.testRunId),
    testRunsCaseIdIdx: index('idx_files_test_runs_case_id').on(table.testRunsCaseId),
  }),
);

// Tags table - for labeling projects
export const tags = pgTable(
  'tags',
  {
    id: serial('id').primaryKey(),
    text: text('text').notNull().unique(),
    color: text('color').notNull().default('neutral'),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    updatedAtIdx: index('idx_tags_updated_at').on(table.updatedAt),
  }),
);

// Project tags junction table
export const projectTags = pgTable(
  'project_tags',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.tagId] }),
    projectIdIdx: index('idx_project_tags_project_id').on(table.projectId),
    tagIdIdx: index('idx_project_tags_tag_id').on(table.tagId),
  }),
);

// Users table - for authentication
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    username: text('username').notNull().unique(),
    password: text('password').notNull(), // hashed password (empty string for OAuth-only users)
    role: text('role').notNull(), // Role enum: 'administrator', 'reporter', 'user'
    name: text('name'), // Display name
    avatarUrl: text('avatar_url'), // Avatar from OAuth provider
    oauthProvider: text('oauth_provider'), // 'google', 'github', etc.
    oauthProviderId: text('oauth_provider_id'), // User ID from the OAuth provider
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    oauthIdx: uniqueIndex('idx_users_oauth').on(table.oauthProvider, table.oauthProviderId),
  }),
);

// API keys table - for reporter/CI authentication
export const apiKeys = pgTable(
  'api_keys',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // Human-readable label, e.g. "CI pipeline"
    keyHash: text('key_hash').notNull().unique(), // SHA-256 hash of the full key
    keyPrefix: text('key_prefix').notNull(), // First 8 chars after "pd_" prefix – shown in UI
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
    expiresAt: timestamp('expires_at', { mode: 'date' }),
  },
  (table) => ({
    userIdIdx: index('idx_api_keys_user_id').on(table.userId),
    keyHashIdx: index('idx_api_keys_key_hash').on(table.keyHash),
  }),
);

// Type exports for TypeScript
export type TestSuite = typeof testSuites.$inferSelect;
export type NewTestSuite = typeof testSuites.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type TestRun = typeof testRuns.$inferSelect;
export type NewTestRun = typeof testRuns.$inferInsert;
export type TestCase = typeof testCases.$inferSelect;
export type NewTestCase = typeof testCases.$inferInsert;
export type TestRunsCase = typeof testRunsCases.$inferSelect;
export type NewTestRunsCase = typeof testRunsCases.$inferInsert;
export type FailureCluster = typeof failureClusters.$inferSelect;
export type NewFailureCluster = typeof failureClusters.$inferInsert;
export type FailureDiagnosis = typeof failureDiagnoses.$inferSelect;
export type NewFailureDiagnosis = typeof failureDiagnoses.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type TraceBlob = typeof traceBlobs.$inferSelect;
export type NewTraceBlob = typeof traceBlobs.$inferInsert;
export type TraceResource = typeof traceResources.$inferSelect;
export type NewTraceResource = typeof traceResources.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type ProjectTag = typeof projectTags.$inferSelect;
export type NewProjectTag = typeof projectTags.$inferInsert;
