import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';
import type { ServerProbeSettings } from '../../shared/server-probes';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set, so
// clear it before the handler modules (which import the barrel) are loaded.
delete process.env.PIWI_DATABASE_URL;
const { buildProbePlan, buildProbePlanForProject } = await import('../../shared/handlers/probes');
const { resolveProjectStates, setProjectDecisions } = await import('../../shared/handlers/capabilities');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

const ENABLED: ServerProbeSettings = {
  enabled: true,
  faults: ['status'],
  routes: [],
  dependencyOnStateChanging: false,
};

async function freshDb(): Promise<Db> {
  const next = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(next, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  return next;
}

/** A project that reaches one route, optionally with a server trace for it. */
async function seedProject(projectId: number, opts: { serverTrace: boolean }): Promise<void> {
  await db.insert(schema.projects).values({ id: projectId, name: `p${projectId}`, serverProbes: ENABLED });
  await db.insert(schema.testCases).values({ id: projectId, projectId, filePath: 'orders.spec.ts', title: 'orders' });
  await db.insert(schema.graphEdges).values({
    projectId,
    fromKind: 'test',
    fromKey: String(projectId),
    toKind: 'route',
    toKey: 'GET /api/orders',
    kind: 'reaches',
  });
  if (!opts.serverTrace) return;
  const [run] = await db
    .insert(schema.testRuns)
    .values({ projectId, status: 'passed', startTime: new Date(), duration: 1, totalTests: 1, passedTests: 1 })
    .returning({ id: schema.testRuns.id });
  const [runCase] = await db
    .insert(schema.testRunsCases)
    .values({ testRunId: run!.id, testCaseId: projectId, status: 'passed', duration: 1 })
    .returning({ id: schema.testRunsCases.id });
  await db.insert(schema.networkRequests).values({
    testRunsCaseId: runCase!.id,
    testRunId: run!.id,
    url: 'https://example.test/api/orders',
    method: 'GET',
    status: 200,
    serverTraces: [{ name: 'db.query', durationMs: 3 }],
  });
}

beforeEach(async () => {
  db = await freshDb();
});

describe('buildProbePlanForProject server-probes gating', () => {
  test('passes the project settings through when server-probes is applicable and undeclined', async () => {
    await seedProject(1, { serverTrace: true });

    // A server trace makes the capability applicable; enabled settings, no
    // decline and no evidence yet resolve to `available`.
    expect((await resolveProjectStates(db, 1))['server-probes']).toBe('available');

    // The gated plan is exactly the plan built with the project's own settings.
    const gated = await buildProbePlanForProject(db, 1);
    const withSettings = await buildProbePlan(db, 1, { serverProbes: ENABLED });
    expect(gated.items).toEqual(withSettings.items);
  });

  test('drops the server settings when the project declined server-probes', async () => {
    await seedProject(1, { serverTrace: true });
    await setProjectDecisions(db, 1, { 'server-probes': 'declined' });

    expect((await resolveProjectStates(db, 1))['server-probes']).toBe('declined');

    // The gated plan matches the client-only plan, and carries no server items.
    const gated = await buildProbePlanForProject(db, 1);
    const clientOnly = await buildProbePlan(db, 1, { serverProbes: undefined });
    expect(gated.items).toEqual(clientOnly.items);
    expect(gated.items.every((i) => i.level !== 'server')).toBe(true);
  });

  test('drops the server settings when there is no backend for it to be applicable', async () => {
    await seedProject(2, { serverTrace: false });

    // No server trace → not applicable, even though the settings enable the level.
    expect((await resolveProjectStates(db, 2))['server-probes']).toBe('not-applicable');

    const gated = await buildProbePlanForProject(db, 2);
    const clientOnly = await buildProbePlan(db, 2, { serverProbes: undefined });
    expect(gated.items).toEqual(clientOnly.items);
    expect(gated.items.every((i) => i.level !== 'server')).toBe(true);
  });
});
