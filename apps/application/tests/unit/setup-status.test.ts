import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel (server/database/schema.ts) picks the PostgreSQL schema at
// import time when PIWI_DATABASE_URL is set, so clear it before the handler
// modules (which import the barrel) are loaded.
delete process.env.PIWI_DATABASE_URL;
const { getSetupStatus } = await import('../../shared/handlers/setup-status');
const { SETUP_CAPABILITIES } = await import('../../app/utils/setup-capabilities');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

async function freshDb(): Promise<Db> {
  const next = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(next, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  return next;
}

/** Capability ids that report `active: true`, as a set. */
async function activeIds(database: Db): Promise<Set<string>> {
  const { capabilities } = await getSetupStatus(database);
  return new Set(capabilities.filter((c) => c.active).map((c) => c.id));
}

beforeEach(async () => {
  db = await freshDb();
  delete process.env.PIWI_AI_API_KEY;
  delete process.env.PIWI_AI_MODEL;
});

describe('getSetupStatus', () => {
  test('reports nothing active on a fresh instance', async () => {
    const { capabilities } = await getSetupStatus(db);
    expect(capabilities.length).toBeGreaterThan(0);
    expect(capabilities.every((c) => c.active === false)).toBe(true);
  });

  test('a submitted run activates only the reporter capability', async () => {
    await db.insert(schema.projects).values({ id: 1, name: 'checkout' });
    await db.insert(schema.testRuns).values({
      projectId: 1,
      status: 'passed',
      startTime: new Date(),
      duration: 1000,
      totalTests: 1,
      passedTests: 1,
    });

    expect(await activeIds(db)).toEqual(new Set(['reporter']));
  });

  test('captured network requests activate the fixtures capability', async () => {
    await db.insert(schema.projects).values({ id: 1, name: 'checkout' });
    const [run] = await db
      .insert(schema.testRuns)
      .values({ projectId: 1, status: 'passed', startTime: new Date(), duration: 1, totalTests: 1, passedTests: 1 })
      .returning({ id: schema.testRuns.id });
    await db.insert(schema.testCases).values({ id: 1, projectId: 1, filePath: 'a.spec.ts', title: 'a' });
    const [runCase] = await db
      .insert(schema.testRunsCases)
      .values({ testRunId: run!.id, testCaseId: 1, status: 'passed', duration: 1 })
      .returning({ id: schema.testRunsCases.id });
    await db.insert(schema.networkRequests).values({
      testRunsCaseId: runCase!.id,
      testRunId: run!.id,
      url: 'https://example.test/api',
      method: 'GET',
      status: 200,
    });

    const active = await activeIds(db);
    expect(active.has('fixtures')).toBe(true);
    expect(active.has('locator-healing')).toBe(false);
    expect(active.has('backend-logs')).toBe(false);
  });

  test('a network request carrying server traces activates the backend-logs capability', async () => {
    await db.insert(schema.projects).values({ id: 1, name: 'checkout' });
    const [run] = await db
      .insert(schema.testRuns)
      .values({ projectId: 1, status: 'passed', startTime: new Date(), duration: 1, totalTests: 1, passedTests: 1 })
      .returning({ id: schema.testRuns.id });
    await db.insert(schema.testCases).values({ id: 1, projectId: 1, filePath: 'a.spec.ts', title: 'a' });
    const [runCase] = await db
      .insert(schema.testRunsCases)
      .values({ testRunId: run!.id, testCaseId: 1, status: 'passed', duration: 1 })
      .returning({ id: schema.testRunsCases.id });
    await db.insert(schema.networkRequests).values({
      testRunsCaseId: runCase!.id,
      testRunId: run!.id,
      url: 'https://example.test/api',
      method: 'GET',
      status: 200,
      serverTraces: [{ name: 'db.query', durationMs: 12 }],
    });

    expect((await activeIds(db)).has('backend-logs')).toBe(true);
  });

  test('detection is evidence-based, not config-based: a defined tag activates tags', async () => {
    await db.insert(schema.tags).values({ text: 'smoke' });

    expect(await activeIds(db)).toEqual(new Set(['tags']));
  });

  test('AI counts as active when pinned by environment, with no stored setting', async () => {
    expect((await activeIds(db)).has('ai')).toBe(false);

    process.env.PIWI_AI_MODEL = 'claude-sonnet-4-5';
    expect((await activeIds(db)).has('ai')).toBe(true);
  });

  test('AI counts as active from a stored setting, with no env var', async () => {
    await db.insert(schema.appSettings).values({ key: 'ai', value: { provider: 'anthropic' }, updatedAt: new Date() });

    expect((await activeIds(db)).has('ai')).toBe(true);
  });
});

describe('setup capability copy', () => {
  test('every detected capability has UI copy, and vice versa', async () => {
    const { capabilities } = await getSetupStatus(db);
    const detected = capabilities.map((c) => c.id).sort();
    const documented = SETUP_CAPABILITIES.map((c) => c.id).sort();

    expect(documented).toEqual(detected);
  });

  test('a capability that cannot be configured in-app still explains how to enable it', () => {
    for (const capability of SETUP_CAPABILITIES) {
      expect(capability.how.length).toBeGreaterThan(0);
      expect(capability.summary.length).toBeGreaterThan(0);
    }
  });
});
