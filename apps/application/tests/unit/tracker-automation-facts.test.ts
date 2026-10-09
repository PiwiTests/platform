import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

/**
 * Whether automatic creation reads a cluster as tracked: the rule a new filing
 * follows (an issue that is not Done, or a Done one a regression reopens) plus a
 * filing the tracker has not answered yet, against an in-memory SQLite database.
 */

// The schema barrel picks PostgreSQL at import time when PIWI_DATABASE_URL is set.
delete process.env.PIWI_DATABASE_URL;
const { gatherAutoCreateFacts } = await import('#shared/handlers/tracker-automation');
const { knownIssueTracks } = await import('#shared/handlers/known-issues');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

const CLUSTERS = {
  inProgress: 1,
  done: 2,
  doneRegressed: 3,
  queued: 4,
  queuedFromExecution: 5,
  untracked: 6,
};

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  await db.insert(schema.projects).values({ id: 1, name: 'shop', label: 'Shop' });
  await db.insert(schema.testCases).values({ id: 1, projectId: 1, title: 'pays', filePath: 'tests/pay.spec.ts' });
  await db.insert(schema.testRuns).values({
    id: 1,
    projectId: 1,
    status: 'failed',
    startTime: new Date('2026-09-01T10:00:00Z'),
  });
  await db.insert(schema.failureClusters).values(
    Object.values(CLUSTERS).map((id) => ({
      id,
      projectId: 1,
      fingerprint: `fp-${id}`,
      signature: `Error: ${id}`,
      errorType: 'unknown',
      firstSeenRunId: 1,
      lastSeenRunId: 1,
      fixVerification: id === CLUSTERS.doneRegressed ? 'regressed' : null,
    })),
  );
  await db.insert(schema.testRunsCases).values(
    Object.values(CLUSTERS).map((id) => ({
      id: 100 + id,
      testRunId: 1,
      testCaseId: 1,
      status: 'failed',
      error: `Error: ${id}`,
      failureClusterId: id,
    })),
  );
  const jiraLink = (clusterId: number, key: string, statusCategory: string) => ({
    failureClusterId: clusterId,
    url: `https://acme.atlassian.net/browse/${key}`,
    provider: 'jira',
    key,
    origin: 'created',
    metadata: { statusCategory } as never,
  });
  await db
    .insert(schema.entityLinks)
    .values([
      jiraLink(CLUSTERS.inProgress, 'PIWI-1', 'indeterminate'),
      jiraLink(CLUSTERS.done, 'PIWI-2', 'done'),
      jiraLink(CLUSTERS.doneRegressed, 'PIWI-3', 'done'),
    ]);
  await db
    .insert(schema.integrationConnections)
    .values({ id: 1, provider: 'jira', name: 'Jira', baseUrl: 'https://acme.atlassian.net' });
  await db.insert(schema.integrationActions).values([
    {
      connectionId: 1,
      projectId: 1,
      kind: 'create-issue',
      entityType: 'failure_cluster',
      entityId: CLUSTERS.queued,
      dedupeKey: `create-issue:failure_cluster:${CLUSTERS.queued}:conn1`,
      status: 'pending',
      attempts: 1,
      payload: {} as never,
    },
    {
      connectionId: 1,
      projectId: 1,
      kind: 'create-issue',
      entityType: 'test_runs_case',
      entityId: 100 + CLUSTERS.queuedFromExecution,
      dedupeKey: `create-issue:test_runs_case:${100 + CLUSTERS.queuedFromExecution}:conn1`,
      status: 'pending',
      attempts: 1,
      payload: {} as never,
    },
  ]);
});

async function trackedClusters(reopenOnRegression: boolean): Promise<number[]> {
  const facts = await gatherAutoCreateFacts(db as never, Object.values(CLUSTERS), {
    defaultBranch: 'main',
    reopenOnRegression,
  });
  return [...facts.values()].filter((f) => f.tracked).map((f) => f.clusterId);
}

describe('the tracked fact automatic creation reads', () => {
  test('an issue that is not Done tracks the cluster; a Done one no longer does', async () => {
    const tracked = await trackedClusters(false);
    expect(tracked).toContain(CLUSTERS.inProgress);
    expect(tracked).not.toContain(CLUSTERS.done);
    expect(tracked).not.toContain(CLUSTERS.untracked);
  });

  test('a Done issue tracks a regressed cluster only when the binding reopens it on regression', async () => {
    expect(await trackedClusters(false)).not.toContain(CLUSTERS.doneRegressed);
    expect(await trackedClusters(true)).toContain(CLUSTERS.doneRegressed);
    expect(await trackedClusters(true)).not.toContain(CLUSTERS.done);
  });

  test('a filing waiting on the tracker counts, asked from the cluster or from one of its executions', async () => {
    const tracked = await trackedClusters(false);
    expect(tracked).toContain(CLUSTERS.queued);
    expect(tracked).toContain(CLUSTERS.queuedFromExecution);
  });
});

describe('knownIssueTracks', () => {
  const plain = { regressed: false, reopenOnRegression: false };

  test('no issue tracks nothing; an issue not Done tracks, whatever its category', () => {
    expect(knownIssueTracks(null, plain)).toBe(false);
    expect(knownIssueTracks({ statusCategory: 'new' }, plain)).toBe(true);
    expect(knownIssueTracks({ statusCategory: null }, plain)).toBe(true);
  });

  test('a Done issue tracks only a regressed cluster the binding reopens it for', () => {
    expect(knownIssueTracks({ statusCategory: 'done' }, plain)).toBe(false);
    expect(knownIssueTracks({ statusCategory: 'done' }, { regressed: true, reopenOnRegression: false })).toBe(false);
    expect(knownIssueTracks({ statusCategory: 'done' }, { regressed: false, reopenOnRegression: true })).toBe(false);
    expect(knownIssueTracks({ statusCategory: 'done' }, { regressed: true, reopenOnRegression: true })).toBe(true);
  });
});
