import { pgTable, text, integer, serial, timestamp, jsonb, index, primaryKey } from 'drizzle-orm/pg-core'

// Projects table
export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  label: text('label'), // Display label (defaults to name if not set)
  description: text('description'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().$defaultFn(() => new Date())
})

// Test runs table
export const testRuns = pgTable('test_runs', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id),
  status: text('status').notNull(), // 'passed', 'failed', 'timedout', 'interrupted', 'running', 'cancelled'
  startTime: timestamp('start_time', { mode: 'date' }).notNull(),
  duration: integer('duration'), // in milliseconds
  totalTests: integer('total_tests').notNull().default(0),
  passedTests: integer('passed_tests').notNull().default(0),
  failedTests: integer('failed_tests').notNull().default(0),
  skippedTests: integer('skipped_tests').notNull().default(0),
  flakyTests: integer('flaky_tests').notNull().default(0),
  avgTestDuration: integer('avg_test_duration'), // average test case duration in ms
  p90TestDuration: integer('p90_test_duration'), // 90th percentile test duration in ms
  reportPath: text('report_path'),
  reportSize: integer('report_size'), // in bytes (decompressed size)
  environment: text('environment'), // Deployment environment (e.g. 'production', 'staging', 'development')
  metadata: jsonb('metadata'), // Additional metadata as JSON
  streamToken: text('stream_token'), // Token for authenticating streaming updates
  instanceId: text('instance_id'), // Unique identifier for the reporter instance that created this run
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at', { mode: 'date' }).$defaultFn(() => new Date())
}, table => ({
  projectIdIdx: index('idx_test_runs_project_id').on(table.projectId)
}))

// Test cases table - shared test definitions
export const testCases = pgTable('test_cases', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id),
  filePath: text('file_path').notNull(), // relative path from project root
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().$defaultFn(() => new Date())
}, table => ({
  projectIdIdx: index('idx_test_cases_project_id').on(table.projectId),
  filePathTitleIdx: index('idx_test_cases_file_path_title').on(table.projectId, table.filePath, table.title)
}))

// Test runs cases table - junction table with run-specific data
export const testRunsCases = pgTable('test_runs_cases', {
  id: serial('id').primaryKey(),
  testRunId: integer('test_run_id').notNull().references(() => testRuns.id),
  testCaseId: integer('test_case_id').notNull().references(() => testCases.id),
  status: text('status').notNull(), // 'passed', 'failed', 'timedout', 'skipped'
  duration: integer('duration'), // in milliseconds
  error: text('error'),
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
  workerIndex: integer('worker_index'), // Parallel worker index (from Playwright's parallelIndex)
  startedAt: integer('started_at'), // Unix timestamp in ms when the test started
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().$defaultFn(() => new Date())
}, table => ({
  testRunIdIdx: index('idx_test_runs_cases_test_run_id').on(table.testRunId),
  testCaseIdIdx: index('idx_test_runs_cases_test_case_id').on(table.testCaseId)
}))

// Reports table - stores multiple report types per test run
export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  testRunId: integer('test_run_id').notNull().references(() => testRuns.id),
  type: text('type').notNull(), // 'html', 'monocart', 'blob', etc.
  label: text('label').notNull(), // Display label e.g. 'HTML Report', 'Monocart Report'
  path: text('path').notNull(), // Relative path in storage (for browsable) or file path (for blob)
  size: integer('size'), // File/directory size in bytes
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().$defaultFn(() => new Date())
}, table => ({
  testRunIdIdx: index('idx_reports_test_run_id').on(table.testRunId)
}))

// Traces table
export const traces = pgTable('traces', {
  id: serial('id').primaryKey(),
  testRunsCaseId: integer('test_runs_case_id').notNull().references(() => testRunsCases.id),
  filePath: text('file_path').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().$defaultFn(() => new Date())
}, table => ({
  testRunsCaseIdIdx: index('idx_traces_test_runs_case_id').on(table.testRunsCaseId)
}))

// Tags table - for labeling projects
export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  text: text('text').notNull().unique(),
  color: text('color').notNull().default('neutral'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().$defaultFn(() => new Date())
})

// Project tags junction table
export const projectTags = pgTable('project_tags', {
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' })
}, table => ({
  pk: primaryKey({ columns: [table.projectId, table.tagId] }),
  projectIdIdx: index('idx_project_tags_project_id').on(table.projectId),
  tagIdIdx: index('idx_project_tags_tag_id').on(table.tagId)
}))

// Users table - for authentication
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(), // hashed password
  role: text('role').notNull(), // 'administrator', 'reporter', 'user'
  name: text('name'), // Display name
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().$defaultFn(() => new Date())
})

// API keys table - for reporter/CI authentication
export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // Human-readable label, e.g. "CI pipeline"
  keyHash: text('key_hash').notNull().unique(), // SHA-256 hash of the full key
  keyPrefix: text('key_prefix').notNull(), // First 8 chars after "pd_" prefix – shown in UI
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().$defaultFn(() => new Date()),
  lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
  expiresAt: timestamp('expires_at', { mode: 'date' })
}, table => ({
  userIdIdx: index('idx_api_keys_user_id').on(table.userId),
  keyHashIdx: index('idx_api_keys_key_hash').on(table.keyHash)
}))

// Type exports for TypeScript
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type TestRun = typeof testRuns.$inferSelect
export type NewTestRun = typeof testRuns.$inferInsert
export type TestCase = typeof testCases.$inferSelect
export type NewTestCase = typeof testCases.$inferInsert
export type TestRunsCase = typeof testRunsCases.$inferSelect
export type NewTestRunsCase = typeof testRunsCases.$inferInsert
export type Trace = typeof traces.$inferSelect
export type NewTrace = typeof traces.$inferInsert
export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert
export type Tag = typeof tags.$inferSelect
export type NewTag = typeof tags.$inferInsert
export type ProjectTag = typeof projectTags.$inferSelect
export type NewProjectTag = typeof projectTags.$inferInsert
