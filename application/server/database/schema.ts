// Conditional re-export: routes to the correct dialect at runtime.
// Both schemas are statically imported; the runtime selection is synchronous
// based on whether DATABASE_URL is set.
// TypeScript type-checking uses the SQLite schema as the canonical reference.

import * as sqliteSchema from './schema.sqlite';
import * as pgSchema from './schema.pg';

// Pick the appropriate schema tables at module initialization time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schema: typeof sqliteSchema = (process.env.DATABASE_URL ? pgSchema : sqliteSchema) as any;

export const {
  projects,
  testRuns,
  testCases,
  testRunsCases,
  failureClusters,
  failureDiagnoses,
  appSettings,
  files,
  traceResources,
  traceBlobs,
  tags,
  projectTags,
  users,
  apiKeys,
} = schema;

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
  FailureCluster,
  NewFailureCluster,
  FailureDiagnosis,
  NewFailureDiagnosis,
  AppSetting,
  NewAppSetting,
  File,
  NewFile,
  TraceResource,
  NewTraceResource,
  TraceBlob,
  NewTraceBlob,
  User,
  NewUser,
  ApiKey,
  NewApiKey,
  Tag,
  NewTag,
  ProjectTag,
  NewProjectTag,
} from './schema.sqlite';
