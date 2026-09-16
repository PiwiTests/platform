import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

/**
 * Fix verification against an in-memory SQLite database: the verdict, the
 * triage-status transitions it drives, the system lines it appends to the
 * triage note, and the notifications it emits. SCM is mocked so the diff can
 * corroborate (or not) the diagnosis without a network.
 */

const emitted: Array<{ event: string; payload: Record<string, unknown> }> = [];
vi.mock('../../server/utils/notifications/emit', () => ({
  emitNotification: async (_db: unknown, event: string, payload: Record<string, unknown>) => {
    emitted.push({ event, payload });
  },
}));

let changedFiles: string[] = [];
let commitAuthor: { name: string; email: string } | null = null;
vi.mock('../../server/utils/scm', () => ({
  createScmProvider: async () => ({
    fetchChanges: async () => ({ files: changedFiles.map((filename) => ({ filename })) }),
    getCommitAuthor: async () => commitAuthor,
  }),
}));

// The schema barrel (server/database/schema.ts) picks the PostgreSQL schema at
// import time when PIWI_DATABASE_URL is set, so clear it before the module
// under test (which imports the barrel) is loaded.
delete process.env.PIWI_DATABASE_URL;
const { verifyClusterFixes, appendTriageNote } = await import('../../server/utils/fix-verification');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;
let runSeq = 0;
let clusterSeq = 0;

const REMOTE = 'https://github.com/acme/shop.git';

async function insertRun(status: 'passed' | 'failed', commit: string, opts: { isFullRun?: boolean } = {}) {
  const id = ++runSeq;
  await db.insert(schema.testRuns).values({
    id,
    projectId: 1,
    status,
    startTime: new Date(Date.UTC(2026, 0, 1) + id * 3_600_000),
    isFullRun: opts.isFullRun === false ? 0 : 1,
    metadata: { scm: { commit, remoteUrl: REMOTE, branch: 'main' } },
  });
  return id;
}

async function insertCluster(opts: { status?: string; triageNote?: string | null; firstSeenRunId: number }) {
  const id = ++clusterSeq;
  await db.insert(schema.failureClusters).values({
    id,
    projectId: 1,
    fingerprint: `fp-${id}`,
    signature: `Error: card declined ${id}`,
    errorType: 'unknown',
    firstSeenRunId: opts.firstSeenRunId,
    lastSeenRunId: opts.firstSeenRunId,
    status: opts.status ?? 'open',
    triageNote: opts.triageNote ?? null,
  });
  return id;
}

async function insertCase(runId: number, status: 'passed' | 'failed', clusterId: number | null, testCaseId = 1) {
  await db.insert(schema.testRunsCases).values({ testRunId: runId, testCaseId, status, failureClusterId: clusterId });
}

async function markSeen(clusterId: number, runId: number) {
  await db.update(schema.failureClusters).set({ lastSeenRunId: runId }).where(eq(schema.failureClusters.id, clusterId));
}

async function insertDiagnosis(clusterId: number, file: string) {
  await db.insert(schema.failureDiagnoses).values({
    clusterId,
    scope: 'cluster',
    status: 'completed',
    details: { suggestedFix: { patch: `--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-a\n+b\n` } },
  });
}

async function cluster(id: number) {
  const [row] = await db.select().from(schema.failureClusters).where(eq(schema.failureClusters.id, id));
  return row!;
}

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  await db.insert(schema.projects).values({ id: 1, name: 'shop', label: 'Shop' });
  await db.insert(schema.testCases).values([
    { id: 1, projectId: 1, filePath: 'tests/checkout.spec.ts', title: 'pays' },
    { id: 2, projectId: 1, filePath: 'tests/checkout.spec.ts', title: 'refunds' },
  ]);
});

beforeEach(() => {
  emitted.length = 0;
  changedFiles = [];
  commitAuthor = null;
});

describe('appendTriageNote', () => {
  test('keeps what a person wrote and adds the system line below it', () => {
    expect(appendTriageNote('Closed by hand', 'Reopened automatically: regressed in run #3')).toBe(
      'Closed by hand\nReopened automatically: regressed in run #3',
    );
    expect(appendTriageNote('  ', 'line')).toBe('line');
    expect(appendTriageNote(null, 'line')).toBe('line');
  });
});

describe('verifyClusterFixes — status transitions', () => {
  test('a diagnosis-verified fix resolves an open cluster, notes why, and emits cluster.fixed', async () => {
    const failing = await insertRun('failed', 'aaa111');
    const clusterId = await insertCluster({ firstSeenRunId: failing });
    await insertCase(failing, 'failed', clusterId);
    await insertDiagnosis(clusterId, 'src/checkout.ts');
    changedFiles = ['src/checkout.ts'];

    const green = await insertRun('passed', 'bbb222');
    await insertCase(green, 'passed', null);

    const fixed = await verifyClusterFixes(db, green);
    expect(fixed.map((f) => [f.clusterId, f.verification])).toEqual([[clusterId, 'diagnosis-verified']]);

    const row = await cluster(clusterId);
    expect(row.fixVerification).toBe('diagnosis-verified');
    expect(row.fixLandedRunId).toBe(green);
    expect(row.status).toBe('resolved');
    expect(row.triageNote).toBe(`Resolved automatically: diagnosis verified in run #${green}`);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.event).toBe('cluster.fixed');
    expect(emitted[0]!.payload).toMatchObject({
      clusterId,
      projectId: 1,
      projectName: 'Shop',
      runId: green,
      verification: 'diagnosis-verified',
      commit: 'bbb222',
      resolved: true,
      testCount: 1,
    });
  });

  test('a stopped-failing fix leaves the triage status alone but still emits cluster.fixed', async () => {
    const failing = await insertRun('failed', 'ccc333');
    const clusterId = await insertCluster({ firstSeenRunId: failing, triageNote: 'Looking into it' });
    await insertCase(failing, 'failed', clusterId);
    // The diagnosis names a file the fixing commit did not touch.
    await insertDiagnosis(clusterId, 'src/checkout.ts');
    changedFiles = ['README.md'];

    const green = await insertRun('passed', 'ddd444');
    await insertCase(green, 'passed', null);
    await verifyClusterFixes(db, green);

    const row = await cluster(clusterId);
    expect(row.fixVerification).toBe('stopped-failing');
    expect(row.status).toBe('open');
    expect(row.triageNote).toBe('Looking into it');
    expect(emitted.map((e) => e.event)).toEqual(['cluster.fixed']);
    expect(emitted[0]!.payload).toMatchObject({ verification: 'stopped-failing', resolved: false });
  });

  test('a diagnosis-verified fix never touches an ignored cluster', async () => {
    const failing = await insertRun('failed', 'eee555');
    const clusterId = await insertCluster({ firstSeenRunId: failing, status: 'ignored', triageNote: 'Known, ignore' });
    await insertCase(failing, 'failed', clusterId);
    await insertDiagnosis(clusterId, 'src/checkout.ts');
    changedFiles = ['src/checkout.ts'];

    const green = await insertRun('passed', 'fff666');
    await insertCase(green, 'passed', null);
    await verifyClusterFixes(db, green);

    const row = await cluster(clusterId);
    expect(row.fixVerification).toBe('diagnosis-verified');
    expect(row.status).toBe('ignored');
    expect(row.triageNote).toBe('Known, ignore');
    expect(emitted[0]!.payload).toMatchObject({ resolved: false });
  });

  test('a regression reopens a resolved cluster with a note and emits cluster.regressed', async () => {
    const failing = await insertRun('failed', '111aaa');
    const clusterId = await insertCluster({ firstSeenRunId: failing });
    await insertCase(failing, 'failed', clusterId);
    await insertDiagnosis(clusterId, 'src/checkout.ts');
    changedFiles = ['src/checkout.ts'];

    const green = await insertRun('passed', '222bbb');
    await insertCase(green, 'passed', null);
    await verifyClusterFixes(db, green);
    expect((await cluster(clusterId)).status).toBe('resolved');
    emitted.length = 0;

    const red = await insertRun('failed', '333ccc');
    await insertCase(red, 'failed', clusterId);
    await markSeen(clusterId, red);
    const fixed = await verifyClusterFixes(db, red);
    expect(fixed).toEqual([]);

    const row = await cluster(clusterId);
    expect(row.fixVerification).toBe('regressed');
    expect(row.status).toBe('open');
    expect(row.triageNote).toBe(
      `Resolved automatically: diagnosis verified in run #${green}\nReopened automatically: regressed in run #${red}`,
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.event).toBe('cluster.regressed');
    expect(emitted[0]!.payload).toMatchObject({
      clusterId,
      projectName: 'Shop',
      runId: red,
      fixLandedRunId: green,
      reopened: true,
    });
  });

  test('a regression on a cluster that was still open only records the verdict', async () => {
    const failing = await insertRun('failed', '444ddd');
    const clusterId = await insertCluster({ firstSeenRunId: failing });
    await insertCase(failing, 'failed', clusterId);
    changedFiles = [];

    const green = await insertRun('passed', '555eee');
    await insertCase(green, 'passed', null);
    await verifyClusterFixes(db, green);
    expect((await cluster(clusterId)).status).toBe('open');
    emitted.length = 0;

    const red = await insertRun('failed', '666fff');
    await insertCase(red, 'failed', clusterId);
    await markSeen(clusterId, red);
    await verifyClusterFixes(db, red);

    const row = await cluster(clusterId);
    expect(row.fixVerification).toBe('regressed');
    expect(row.status).toBe('open');
    expect(row.triageNote).toBeNull();
    expect(emitted.map((e) => e.event)).toEqual(['cluster.regressed']);
    expect(emitted[0]!.payload).toMatchObject({ reopened: false });
  });

  test('a partial run that covers every affected test records the fix', async () => {
    // Cluster on test case 2 so it does not collide with the many case-1
    // clusters this serial suite accumulates.
    const failing = await insertRun('failed', '777aaa');
    const clusterId = await insertCluster({ firstSeenRunId: failing });
    await insertCase(failing, 'failed', clusterId, 2);

    // A filtered re-run of exactly the affected test, passing, is enough.
    const partial = await insertRun('passed', '888bbb', { isFullRun: false });
    await insertCase(partial, 'passed', null, 2);

    const fixed = await verifyClusterFixes(db, partial);
    expect(fixed.some((f) => f.clusterId === clusterId)).toBe(true);
    expect((await cluster(clusterId)).fixLandedRunId).toBe(partial);
  });

  test('a partial run that misses an affected test records nothing', async () => {
    const failing = await insertRun('failed', '999aaa');
    const clusterId = await insertCluster({ firstSeenRunId: failing });
    // The cluster covers two tests (1 and 2).
    await insertCase(failing, 'failed', clusterId, 1);
    await insertCase(failing, 'failed', clusterId, 2);

    // A filtered run that ran only one of them proves nothing: the other was
    // never shown to pass.
    const partial = await insertRun('passed', '999bbb', { isFullRun: false });
    await insertCase(partial, 'passed', null, 1);

    const fixed = await verifyClusterFixes(db, partial);
    expect(fixed.some((f) => f.clusterId === clusterId)).toBe(false);
    expect((await cluster(clusterId)).fixLandedRunId).toBeNull();
  });

  test('cluster.fixed carries the resolved fix author on the payload', async () => {
    const failing = await insertRun('failed', 'a10aaa');
    const clusterId = await insertCluster({ firstSeenRunId: failing });
    await insertCase(failing, 'failed', clusterId, 2);
    commitAuthor = { name: 'Ada Lovelace', email: 'ada@example.com' };

    const green = await insertRun('passed', 'a10bbb');
    await insertCase(green, 'passed', null, 2);
    await verifyClusterFixes(db, green);

    const mine = emitted.find((e) => (e.payload as { clusterId?: number }).clusterId === clusterId);
    expect(mine?.event).toBe('cluster.fixed');
    expect(mine?.payload).toMatchObject({ fixAuthor: { name: 'Ada Lovelace', email: 'ada@example.com' } });
  });
});
