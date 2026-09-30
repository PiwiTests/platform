import { beforeEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';
import type { ImportedRunCase, ParsedBlobReport } from '../../server/utils/blob-report';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the modules that import the barrel load.
delete process.env.PIWI_DATABASE_URL;
const { importBlobReportRun } = await import('#shared/handlers/import-runs');
const { persistRunCases } = await import('../../server/utils/persist-run-cases');
const { testCaseCache } = await import('../../server/utils/test-case-cache');
const { testSuiteCache } = await import('../../server/utils/test-suite-cache');

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Port = Parameters<typeof importBlobReportRun>[1];
let db: Db;

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  await db.insert(schema.projects).values({ id: 1, name: 'import-project' });
  testCaseCache.invalidate(1);
  testSuiteCache.invalidate(1);
});

function port(overrides: Partial<Port> = {}): Port {
  return {
    persistRunCases: (database, projectId, testRunId, cases) =>
      persistRunCases(database as never, projectId, testRunId, cases as never),
    storeFile: async ({ entryName }) => ({ path: `stored/${entryName}`, size: 1 }),
    readTraceConsole: async () => null,
    parseErrorContext: () => ({ ariaSnapshot: null, testSource: null }),
    publishRunSubmitted: () => {},
    publishRollupUpdated: () => {},
    ...overrides,
  };
}

function execution(title: string, screenshot: string): ImportedRunCase {
  return {
    case: { title, filePath: 'tests/checkout.spec.ts', status: 'passed', line: 10, column: 5, browser: 'chromium' },
    traces: [],
    attachments: [{ entry: `resources/${screenshot}`, name: 'screenshot', contentType: 'image/png' }],
  };
}

function report(cases: ImportedRunCase[]): ParsedBlobReport {
  return {
    blobVersion: 2,
    playwrightVersion: '1.55.0',
    startTime: new Date('2026-09-30T10:00:00Z'),
    duration: 1000,
    status: 'passed',
    totalTests: cases.length,
    passedTests: cases.length,
    failedTests: 0,
    timedOutTests: 0,
    skippedTests: 0,
    didNotRunTests: 0,
    flakyTests: 0,
    shard: null,
    projectNames: ['chromium'],
    cases,
  };
}

const readEntry = async (name: string) => new TextEncoder().encode(name);

describe('importBlobReportRun', () => {
  test('links each file to the execution of its own case when a repeated case is deduplicated', async () => {
    const result = await importBlobReportRun(db as never, port(), {
      projectId: 1,
      parsed: report([
        execution('adds to cart', 'cart.png'),
        execution('adds to cart', 'cart-again.png'),
        execution('pays', 'pays.png'),
      ]),
      readEntry,
      importHash: 'a'.repeat(64),
      source: 'report.zip',
    });

    const executions = await db
      .select({ id: schema.testRunsCases.id, title: schema.testCases.title })
      .from(schema.testRunsCases)
      .innerJoin(schema.testCases, eq(schema.testCases.id, schema.testRunsCases.testCaseId));
    const idOf = (title: string) => executions.find((e) => e.title === title)!.id;
    const linked = await db.select().from(schema.files);

    expect(result.attachmentCount).toBe(2);
    expect(linked.map((f) => [f.testRunsCaseId, f.path]).sort()).toEqual(
      [
        [idOf('adds to cart'), 'stored/resources/cart.png'],
        [idOf('pays'), 'stored/resources/pays.png'],
      ].sort(),
    );
  });
});
