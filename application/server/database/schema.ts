// Conditional re-export: routes to the correct dialect at runtime.
// TypeScript type-checking uses the SQLite schema as the canonical reference;
// runtime will use either SQLite or PostgreSQL tables based on DATABASE_URL.

let schema: typeof import('./schema.sqlite')

if (process.env.DATABASE_URL) {
  // Using PostgreSQL — cast to SQLite types so TypeScript is happy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema = (await import('./schema.pg')) as any
} else {
  schema = await import('./schema.sqlite')
}

export const {
  projects,
  testRuns,
  testCases,
  testRunsCases,
  reports,
  traces,
  tags,
  projectTags,
  users,
  apiKeys
} = schema

// TypeScript type exports – always based on SQLite schema (the canonical reference)
export type {
  Project,
  NewProject,
  TestRun,
  NewTestRun,
  TestCase,
  NewTestCase,
  TestRunsCase,
  NewTestRunsCase,
  Trace,
  NewTrace,
  Report,
  NewReport,
  User,
  NewUser,
  ApiKey,
  NewApiKey,
  Tag,
  NewTag,
  ProjectTag,
  NewProjectTag
} from './schema.sqlite'
