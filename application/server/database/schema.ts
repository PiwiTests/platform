import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// Projects table
export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
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
  reportPath: text('report_path'),
  reportSize: integer('report_size'), // in bytes (unzipped size)
  metadata: text('metadata', { mode: 'json' }), // Additional metadata as JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

// Test cases table - shared test definitions
export const testCases = sqliteTable('test_cases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id),
  filePath: text('file_path').notNull(), // relative path from project root
  title: text('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

// Traces table (if exists, keeping for reference)
export const traces = sqliteTable('traces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  testRunsCaseId: integer('test_runs_case_id').notNull().references(() => testRunsCases.id),
  filePath: text('file_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

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
