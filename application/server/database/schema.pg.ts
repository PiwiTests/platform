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
      .references(() => projects.id, { onDelete: 'cascade' }),
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
    shardTotal: integer('shard_total'), // Total number of shards for sharded runs; null = not sharded
    shardsFinished: integer('shards_finished').notNull().default(0), // How many shards have finished

    environment: text('environment'), // Deployment environment (e.g. 'production', 'staging', 'development')
    metadata: jsonb('metadata'), // Additional metadata as JSON
    setupSteps: jsonb('setup_steps'), // Array of suite-level hook/fixture steps (beforeAll/afterAll) for the timeline
    label: text('label'), // Optional human-readable label (e.g. "v2.3.1 release")
    streamToken: text('stream_token'), // Token for authenticating streaming updates
    instanceId: text('instance_id'), // Unique identifier for the reporter instance that created this run
    playwrightVersion: text('playwright_version'), // Playwright framework version used for this run
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    projectIdIdx: index('idx_test_runs_project_id').on(table.projectId),
    projectStartTimeIdx: index('idx_test_runs_project_start').on(table.projectId, table.startTime),
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
      .references(() => projects.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(), // relative path from project root
    suitePath: text('suite_path').notNull().default(''), // \x1f-delimited describe block path, e.g. 'Auth\x1fLogin'
    suiteId: integer('suite_id').references(() => testSuites.id), // FK to immediate parent describe block (null for root-level tests)
    title: text('title').notNull(),
    flakyRootCause: text('flaky_root_cause'), // 'timing' | 'network' | 'assertion' | 'environment' | 'other'
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

// AI failure diagnoses - scope-aware diagnosis results
export const failureDiagnoses = pgTable(
  'failure_diagnoses',
  {
    id: serial('id').primaryKey(),
    clusterId: integer('cluster_id')
      .notNull()
      .references(() => failureClusters.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull().default('cluster'), // 'cluster', 'execution'
    testRunsCaseId: integer('test_runs_case_id').references(() => testRunsCases.id, { onDelete: 'cascade' }),
    contextSha: text('context_sha'), // hash of the context sent, for staleness detection
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
    feedback: text('feedback'), // 'up', 'down'
    feedbackNote: text('feedback_note'), // optional note from user
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    executionScopeIdx: uniqueIndex('idx_failure_diagnoses_execution_scope').on(table.testRunsCaseId, table.scope),
  }),
);

// Diagnosis version history — snapshotted on each re-diagnose
export const failureDiagnosisVersions = pgTable(
  'failure_diagnosis_versions',
  {
    id: serial('id').primaryKey(),
    diagnosisId: integer('diagnosis_id')
      .notNull()
      .references(() => failureDiagnoses.id, { onDelete: 'cascade' }),
    clusterId: integer('cluster_id')
      .notNull()
      .references(() => failureClusters.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull().default('cluster'),
    testRunsCaseId: integer('test_runs_case_id').references(() => testRunsCases.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('running'),
    provider: text('provider'),
    model: text('model'),
    category: text('category'),
    confidence: text('confidence'),
    summary: text('summary'),
    rootCause: text('root_cause'),
    details: jsonb('details'),
    error: text('error'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms'),
    contextSha: text('context_sha'),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    diagnosisIdIdx: index('idx_fdv_diagnosis_id').on(table.diagnosisId),
    clusterIdIdx: index('idx_fdv_cluster_id').on(table.clusterId),
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
      .references(() => testRuns.id, { onDelete: 'cascade' }),
    testCaseId: integer('test_case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    status: text('status').notNull(), // 'passed', 'failed', 'timedout', 'skipped'
    duration: integer('duration'), // in milliseconds
    error: text('error'),
    failureClusterId: integer('failure_cluster_id').references(() => failureClusters.id), // set for failed rows with an error — groups rows sharing a fingerprint
    retries: integer('retries').default(0),
    line: integer('line'), // line number in file
    column: integer('column'), // column number in file
    steps: jsonb('steps'), // Array of { title, duration, category } step objects
    stepEvents: jsonb('step_events'), // Array of { title, category, startedAt, duration, status, location } — hook/fixture steps for timeline
    slowestStep: text('slowest_step'), // Title of the slowest step
    slowestStepDuration: integer('slowest_step_duration'), // Duration of the slowest step in ms
    webVitals: jsonb('web_vitals'), // { navigation: {...}, paint: {...} }
    consoleLogs: jsonb('console_logs'), // Array of { type, text, timestamp, location } console entries
    ariaSnapshot: text('aria_snapshot'), // ARIA snapshot of the page (YAML-like string from locator.ariaSnapshot())
    testSource: text('test_source'), // Source snippet around the failing assertion (sent by reporter)
    browser: jsonb('browser'), // Playwright project/browser config: { projectName, browserName, channel, viewport }
    browserName: text('browser_name'), // Scalar browser identity (projectName) for index efficiency
    testAnnotations: jsonb('test_annotations'), // Array<{ type, description? }> — runtime test marks (@fixme, @slow …)
    workerIndex: integer('worker_index'), // Parallel worker index (from Playwright's parallelIndex)
    shardIndex: integer('shard_index'), // Shard index (1-based) for sharded runs; null = not sharded
    startedAt: integer('started_at'), // Unix timestamp in ms when the test started
    isNewRegression: integer('is_new_regression'), // boolean: passed in baseline, failed in this run
    isNewFlaky: integer('is_new_flaky'), // boolean: no retries in baseline, retry-pass in this run
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
      table.browserName,
    ),
  }),
);

// Network requests table - normalized child table of test_runs_cases
export const networkRequests = pgTable(
  'network_requests',
  {
    id: serial('id').primaryKey(),
    testRunsCaseId: integer('test_runs_case_id')
      .notNull()
      .references(() => testRunsCases.id, { onDelete: 'cascade' }),
    testRunId: integer('test_run_id')
      .notNull()
      .references(() => testRuns.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    url: text('url'),
    normalizedUrl: text('normalized_url'),
    status: integer('status').notNull(),
    duration: integer('duration'),
    resourceType: text('resource_type'),
    contentType: text('content_type'),
    serverLogs: jsonb('server_logs'),
  },
  (t) => ({
    runIdx: index('idx_nr_run').on(t.testRunId),
    caseStatusIdx: index('idx_nr_case').on(t.testRunsCaseId, t.status),
    normalizedUrlIdx: index('idx_nr_normalized_url').on(t.normalizedUrl),
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
    testRunId: integer('test_run_id').references(() => testRuns.id, { onDelete: 'cascade' }),
    testRunsCaseId: integer('test_runs_case_id').references(() => testRunsCases.id, { onDelete: 'cascade' }),
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

// Entity links table - attach external URLs (Jira, GitHub, etc.) to runs, test-case runs, or test cases
export const entityLinks = pgTable(
  'entity_links',
  {
    id: serial('id').primaryKey(),

    testRunId: integer('test_run_id').references(() => testRuns.id, { onDelete: 'cascade' }),
    testRunsCaseId: integer('test_runs_case_id').references(() => testRunsCases.id, { onDelete: 'cascade' }),
    testCaseId: integer('test_case_id').references(() => testCases.id, { onDelete: 'cascade' }),

    url: text('url').notNull(),

    // Detected nature — drives the icon
    provider: text('provider').notNull().default('generic'),

    // Smart-link enrichment (best-effort; null until/if unfurled)
    key: text('key'),
    title: text('title'),
    statusText: text('status_text'),
    statusColor: text('status_color'),
    metadata: jsonb('metadata'),
    unfurledAt: timestamp('unfurled_at', { withTimezone: true, mode: 'date' }),

    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('idx_entity_links_run').on(t.testRunId),
    caseRunIdx: index('idx_entity_links_case_run').on(t.testRunsCaseId),
    caseIdx: index('idx_entity_links_case').on(t.testCaseId),
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
    email: text('email'), // Email address (nullable; OAuth callback can populate it)
    emailVerified: integer('email_verified').notNull().default(0), // boolean (0/1)
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
    emailIdx: uniqueIndex('idx_users_email').on(table.email),
  }),
);

// Account tokens table - single-use, hashed, expiring tokens for reset / verify / invite
export const accountTokens = pgTable(
  'account_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(), // 'reset' | 'verify' | 'invite'
    tokenHash: text('token_hash').notNull(), // SHA-256 of the emailed token
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ hashIdx: uniqueIndex('idx_account_tokens_hash').on(t.tokenHash) }),
);

// Notification channels table - a configured delivery destination (email / Slack / webhook)
export const notificationChannels = pgTable(
  'notification_channels',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(), // 'email' | 'slack' | 'webhook'
    config: jsonb('config'), // { address } | { webhookUrl } | { url, secret (encrypted) }
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }), // null = global (admin-managed)
    verified: integer('verified').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    userIdx: index('idx_notification_channels_user').on(t.userId),
  }),
);

// Subscriptions table - who wants notifications for which projects/events
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    channelId: integer('channel_id')
      .notNull()
      .references(() => notificationChannels.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }), // null = all projects
    events: jsonb('events'), // string[] of event keys
    filters: jsonb('filters'), // { branches?, tags?, statuses?, defaultBranchOnly?, flakinessThreshold?, perfRegressionPct? }
    mode: text('mode').notNull().default('realtime'), // 'realtime' | 'digest'
    digestAt: text('digest_at'), // 'HH:mm' UTC for daily digest
    mutedUntil: timestamp('muted_until', { mode: 'date' }),
    active: integer('active').notNull().default(1),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    projectIdx: index('idx_subscriptions_project').on(t.projectId),
    userIdx: index('idx_subscriptions_user').on(t.userId),
    channelIdx: index('idx_subscriptions_channel').on(t.channelId),
  }),
);

// Notification deliveries table - outbox for reliability, retries, dedup, audit
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: serial('id').primaryKey(),
    subscriptionId: integer('subscription_id').references(() => subscriptions.id, { onDelete: 'cascade' }),
    channelId: integer('channel_id')
      .notNull()
      .references(() => notificationChannels.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload'),
    dedupeKey: text('dedupe_key'), // e.g. `${event}:${runId}:${channelId}` — prevents double-send
    status: text('status').notNull().default('pending'), // 'pending' | 'sent' | 'failed' | 'skipped'
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    scheduledFor: timestamp('scheduled_for', { mode: 'date' }), // digest batching / backoff
    sentAt: timestamp('sent_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    statusScheduledIdx: index('idx_notification_deliveries_status').on(t.status, t.scheduledFor),
    dedupeKeyIdx: uniqueIndex('idx_notification_deliveries_dedupe').on(t.dedupeKey),
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
export type AccountToken = typeof accountTokens.$inferSelect;
export type NewAccountToken = typeof accountTokens.$inferInsert;
export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type NewNotificationChannel = typeof notificationChannels.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDelivery = typeof notificationDeliveries.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type ProjectTag = typeof projectTags.$inferSelect;
export type NewProjectTag = typeof projectTags.$inferInsert;
export type EntityLink = typeof entityLinks.$inferSelect;
export type NewEntityLink = typeof entityLinks.$inferInsert;
export type NetworkRequest = typeof networkRequests.$inferSelect;
export type NewNetworkRequest = typeof networkRequests.$inferInsert;
