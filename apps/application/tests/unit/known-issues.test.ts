import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

/**
 * A cluster's known issue — the issue created from (or pinned to) one of its
 * failures — as the surfaces around an execution read it: the execution detail,
 * the run's failure groups and a test's recent executions, all against an
 * in-memory SQLite database.
 */

// The schema barrel picks PostgreSQL at import time when PIWI_DATABASE_URL is set.
delete process.env.PIWI_DATABASE_URL;
const { clusterKnownIssues, isTrackerLink } = await import('#shared/handlers/known-issues');
const { getTestRunCase, getTestCase } = await import('#shared/handlers/test-cases');
const { getFailureGroups } = await import('#shared/handlers/test-runs');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

const JIRA_URL = 'https://acme.atlassian.net/browse/PIWI-12';

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  await db.insert(schema.projects).values({ id: 1, name: 'shop', label: 'Shop' });
  await db.insert(schema.testCases).values([
    { id: 1, projectId: 1, title: 'pays by card', filePath: 'tests/checkout.spec.ts' },
    { id: 2, projectId: 1, title: 'pays by transfer', filePath: 'tests/checkout.spec.ts' },
  ]);
  await db.insert(schema.testRuns).values({
    id: 1,
    projectId: 1,
    status: 'failed',
    startTime: new Date('2026-09-01T10:00:00Z'),
  });
  await db.insert(schema.failureClusters).values([
    {
      id: 1,
      projectId: 1,
      fingerprint: 'fp-1',
      signature: 'Error: card declined',
      errorType: 'unknown',
      firstSeenRunId: 1,
      lastSeenRunId: 1,
    },
    {
      id: 2,
      projectId: 1,
      fingerprint: 'fp-2',
      signature: 'Error: transfer refused',
      errorType: 'unknown',
      firstSeenRunId: 1,
      lastSeenRunId: 1,
    },
  ]);
  await db.insert(schema.testRunsCases).values([
    { id: 10, testRunId: 1, testCaseId: 1, status: 'failed', error: 'Error: card declined', failureClusterId: 1 },
    { id: 11, testRunId: 1, testCaseId: 2, status: 'failed', error: 'Error: transfer refused', failureClusterId: 2 },
  ]);
  // Cluster 1: an older plain link, then the issue created from the failing test.
  await db.insert(schema.entityLinks).values([
    { failureClusterId: 1, url: 'https://docs.example.com/runbook', provider: 'generic', key: null },
    {
      failureClusterId: 1,
      url: JIRA_URL,
      provider: 'jira',
      key: 'PIWI-12',
      statusText: 'In Progress',
      statusColor: 'warning',
      origin: 'created',
    },
    // Cluster 2 only has a keyless link: no known issue.
    { failureClusterId: 2, url: 'https://github.com/acme/shop/pull/7', provider: 'github', key: null },
  ]);
});

describe('clusterKnownIssues', () => {
  test('returns the newest tracker link with a key, per cluster, in one call', async () => {
    const issues = await clusterKnownIssues(db as never, [1, 2, 1]);
    expect([...issues.keys()]).toEqual([1]);
    expect(issues.get(1)).toMatchObject({
      key: 'PIWI-12',
      url: JIRA_URL,
      provider: 'jira',
      status: 'In Progress',
      statusColor: 'warning',
      statusCategory: null,
      assignee: null,
      origin: 'created',
    });
  });

  test('an empty id list asks nothing', async () => {
    expect((await clusterKnownIssues(db as never, [])).size).toBe(0);
  });

  test('a tracker link needs a key and a Jira provider or a connection', () => {
    expect(isTrackerLink({ provider: 'jira', key: 'PIWI-1', connectionId: null })).toBe(true);
    expect(isTrackerLink({ provider: 'generic', key: 'OPS-3', connectionId: 4 })).toBe(true);
    expect(isTrackerLink({ provider: 'github', key: '#7', connectionId: null })).toBe(false);
    expect(isTrackerLink({ provider: 'jira', key: null, connectionId: null })).toBe(false);
  });
});

describe('the surfaces around an execution carry its cluster issue', () => {
  test('the execution detail carries it for the Issue line, and the situation leaves it to that line', async () => {
    const execution = (await getTestRunCase(db as never, 10)) as {
      failureCluster: { knownIssue: { key: string } | null; failureGoesOn: boolean | null } | null;
      situation: { text: string } | null;
    } | null;
    expect(execution?.failureCluster?.knownIssue?.key).toBe('PIWI-12');
    // Only a Done issue needs to know whether the failure goes on.
    expect(execution?.failureCluster?.failureGoesOn).toBeNull();
    expect(execution?.situation?.text).not.toContain('PIWI-12');

    const untracked = (await getTestRunCase(db as never, 11)) as {
      failureCluster: { knownIssue: unknown } | null;
    } | null;
    expect(untracked?.failureCluster?.knownIssue).toBeNull();
  });

  test("the run's failure groups carry it for the test rows", async () => {
    const groups = await getFailureGroups(db as never, 1);
    const byCluster = new Map(groups.map((g) => [g.clusterId, g.knownIssue?.key ?? null]));
    expect(byCluster.get(1)).toBe('PIWI-12');
    expect(byCluster.get(2)).toBeNull();
  });

  test("a test's recent executions carry it per execution", async () => {
    const detail = (await getTestCase(db as never, 1)) as {
      recentExecutions: Array<{ id: number; knownIssue: { key: string } | null }>;
    } | null;
    expect(detail?.recentExecutions.find((e) => e.id === 10)?.knownIssue?.key).toBe('PIWI-12');
  });

  test('a Done issue tells whether the failure goes on in the latest finished run', async () => {
    const read = async () =>
      ((await getTestRunCase(db as never, 10)) as { failureCluster: { failureGoesOn: boolean | null } | null } | null)
        ?.failureCluster?.failureGoesOn;
    const [link] = await db.select().from(schema.entityLinks).where(eq(schema.entityLinks.key, 'PIWI-12'));
    await db
      .update(schema.entityLinks)
      .set({ metadata: { statusCategory: 'done' } as never })
      .where(eq(schema.entityLinks.id, link!.id));
    try {
      // Run 1, the latest finished run, is where the cluster was last seen.
      expect(await read()).toBe(true);

      // A run still going does not count; a finished run without the failure does.
      await db
        .insert(schema.testRuns)
        .values([{ id: 2, projectId: 1, status: 'running', startTime: new Date('2026-09-02T10:00:00Z') }]);
      expect(await read()).toBe(true);
      await db
        .insert(schema.testRuns)
        .values([{ id: 3, projectId: 1, status: 'passed', startTime: new Date('2026-09-01T12:00:00Z') }]);
      expect(await read()).toBe(false);
    } finally {
      await db.delete(schema.testRuns).where(inArray(schema.testRuns.id, [2, 3]));
      await db.update(schema.entityLinks).set({ metadata: null }).where(eq(schema.entityLinks.id, link!.id));
    }
  });
});
