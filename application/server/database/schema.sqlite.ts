import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core'

// Projects table
export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  label: text('label'), // Display label (defaults to name if not set)
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

// Test runs table
export const testRuns = sqliteTable('test_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id),
  status: text('status').notNull(), // 'passed', 'failed', 'timedout', 'interrupted'
  startTime: integer('start_time', { mode: 'timestamp' }).notNull(),
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
  metadata: text('metadata', { mode: 'json' }), // Additional metadata as JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, table => ({
  projectIdIdx: index('idx_test_runs_project_id').on(table.projectId)
}))

// Test cases table - shared test definitions
export const testCases = sqliteTable('test_cases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id),
  filePath: text('file_path').notNull(), // relative path from project root
  title: text('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, table => ({
  projectIdIdx: index('idx_test_cases_project_id').on(table.projectId),
  filePathTitleIdx: index('idx_test_cases_file_path_title').on(table.filePath, table.title)
}))

// Test runs cases table - junction table with run-specific data
export const testRunsCases = sqliteTable('test_runs_cases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  testRunId: integer('test_run_id').notNull().references(() => testRuns.id),
  testCaseId: integer('test_case_id').notNull().references(() => testCases.id),
  status: text('status').notNull(), // 'passed', 'failed', 'timedout', 'skipped'
  duration: integer('duration'), // in milliseconds
  error: text('error'),
  retries: integer('retries').default(0),
  line: integer('line'), // line number in file
  column: integer('column'), // column number in file
  steps: text('steps', { mode: 'json' }), // Array of { title, duration, category } step objects
  slowestStep: text('slowest_step'), // Title of the slowest step
  slowestStepDuration: integer('slowest_step_duration'), // Duration of the slowest step in ms
  networkRequests: text('network_requests', { mode: 'json' }), // Array of { method, url, status, duration, resourceType }
  webVitals: text('web_vitals', { mode: 'json' }), // { navigation: {...}, paint: {...} }
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, table => ({
  testRunIdIdx: index('idx_test_runs_cases_test_run_id').on(table.testRunId),
  testCaseIdIdx: index('idx_test_runs_cases_test_case_id').on(table.testCaseId)
}))

// Reports table - stores multiple report types per test run
export const reports = sqliteTable('reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  testRunId: integer('test_run_id').notNull().references(() => testRuns.id),
  type: text('type').notNull(), // 'html', 'monocart', 'blob', etc.
  label: text('label').notNull(), // Display label e.g. 'HTML Report', 'Monocart Report'
  path: text('path').notNull(), // Relative path in storage (for browsable) or file path (for blob)
  size: integer('size'), // File/directory size in bytes
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, table => ({
  testRunIdIdx: index('idx_reports_test_run_id').on(table.testRunId)
}))

// Traces table (if exists, keeping for reference)
export const traces = sqliteTable('traces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  testRunsCaseId: integer('test_runs_case_id').notNull().references(() => testRunsCases.id),
  filePath: text('file_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, table => ({
  testRunsCaseIdIdx: index('idx_traces_test_runs_case_id').on(table.testRunsCaseId)
}))

// Tags table - for labeling projects
export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  text: text('text').notNull().unique(),
  color: text('color').notNull().default('neutral'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

// Project tags junction table
export const projectTags = sqliteTable('project_tags', {
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' })
}, table => ({
  pk: primaryKey({ columns: [table.projectId, table.tagId] }),
  projectIdIdx: index('idx_project_tags_project_id').on(table.projectId),
  tagIdIdx: index('idx_project_tags_tag_id').on(table.tagId)
}))

// Users table - for authentication
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password: text('password').notNull(), // hashed password
  role: text('role').notNull(), // 'administrator', 'reporter', 'user'
  name: text('name'), // Display name
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

// API keys table - for reporter/CI authentication
export const apiKeys = sqliteTable('api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // Human-readable label, e.g. "CI pipeline"
  keyHash: text('key_hash').notNull().unique(), // SHA-256 hash of the full key
  keyPrefix: text('key_prefix').notNull(), // First 8 chars after "pd_" prefix – shown in UI
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' })
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
