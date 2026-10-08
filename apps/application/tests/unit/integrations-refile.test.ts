import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';
import type { DbClient } from '../../server/database';

/**
 * Filing an issue for a cluster and keeping it, against a SQLite database and a
 * stubbed Jira: the cluster page and an execution of the cluster share one
 * filing, an issue whose link was removed no longer answers a new create, and
 * the sync's resolve and reopen policies act on a move of the ticket, never on
 * where it stands.
 */

delete process.env.PIWI_DATABASE_URL;
process.env.PIWI_SECRET_KEY = 'unit-test-secret-key-not-for-production';

const { createConnection } = await import('../../server/utils/integrations/connections');
const { writeProjectIntegration } = await import('../../server/utils/integrations/binding');
const { createIssue } = await import('../../server/utils/integrations/create');
const { syncTrackerLinks } = await import('../../server/utils/integrations/sync');
const { deleteLink } = await import('../../shared/handlers/links');

const SITE = 'https://refile.atlassian.net';

let created: string[] = [];
let issueSeq = 0;
/** The category each stub issue reads back with, by key. */
const categories = new Map<string, 'new' | 'indeterminate' | 'done'>();
const STATUS_NAME = { new: 'To Do', indeterminate: 'In Progress', done: 'Done' } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A stub Jira: an empty create screen, create, and read-back by key or id. */
async function jira(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (/\/rest\/api\/3\/issue\/createmeta\//.test(url.pathname)) return json({ total: 0, fields: [] });
  if (url.pathname === '/rest/api/3/issue' && init?.method === 'POST') {
    issueSeq += 1;
    const key = `PROJ-${issueSeq}`;
    created.push(key);
    categories.set(key, 'new');
    return json({ id: String(10000 + issueSeq), key }, 201);
  }
  const read = /\/rest\/api\/3\/issue\/([A-Z]+-\d+|\d+)$/.exec(url.pathname);
  if (read) {
    const ref = read[1]!;
    const key = /^\d+$/.test(ref) ? `PROJ-${Number(ref) - 10000}` : ref;
    const category = categories.get(key);
    if (!category) return json({ errorMessages: ['Not found'] }, 404);
    return json({
      id: String(10000 + Number(key.split('-')[1])),
      key,
      fields: { summary: 'Broken', status: { name: STATUS_NAME[category], statusCategory: { key: category } } },
    });
  }
  return json({ errorMessages: ['Not found'] }, 404);
}

let db: ReturnType<typeof drizzle<typeof schema>>;
let dbc: DbClient;
let client: ReturnType<typeof createClient>;
let tmpDir: string;
let connectionId = 0;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'piwi-refile-'));
  client = createClient({ url: `file:${join(tmpDir, 'test.db')}` });
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  dbc = db as unknown as DbClient;

  await db.insert(schema.projects).values({ id: 1, name: 'shop', label: 'Shop' });
  await db.insert(schema.testRuns).values({ id: 1, projectId: 1, status: 'failed', startTime: new Date() });
  for (const id of [1, 2, 3, 4]) {
    await db.insert(schema.testCases).values({ id, projectId: 1, title: `test ${id}`, filePath: 'tests/a.spec.ts' });
    await db.insert(schema.failureClusters).values({
      id,
      projectId: 1,
      fingerprint: `fp-${id}`,
      signature: `Error: broken ${id}`,
      errorType: 'unknown',
      firstSeenRunId: 1,
      lastSeenRunId: 1,
    });
    await db.insert(schema.testRunsCases).values({
      id: 100 + id,
      testRunId: 1,
      testCaseId: id,
      status: 'failed',
      error: `Error: broken ${id}`,
      failureClusterId: id,
    });
  }
  vi.stubGlobal('fetch', vi.fn(jira));
  const connection = await createConnection(dbc, {
    provider: 'jira',
    name: 'Refile Jira',
    baseUrl: SITE,
    credentials: { email: 'ci@example.com', apiToken: 'token' },
  });
  connectionId = connection.id;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await client.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  created = [];
});

function file(entityType: 'failure_cluster' | 'test_runs_case', entityId: number) {
  return createIssue(dbc, {
    entityType,
    entityId,
    connectionId,
    projectKey: 'PROJ',
    issueType: 'Bug',
    title: 'Broken',
  });
}

async function clusterLinks(clusterId: number) {
  return db.select().from(schema.entityLinks).where(eq(schema.entityLinks.failureClusterId, clusterId));
}

async function setPolicies(policies: { resolveOnClose?: boolean; reopenOnTicketReopen?: boolean }) {
  await writeProjectIntegration(dbc, 1, {
    connectionId,
    projectKey: 'PROJ',
    issueType: 'Bug',
    policies: { resolveOnClose: false, reopenOnTicketReopen: false, ...policies },
  });
}

async function clusterRow(id: number) {
  const [row] = await db.select().from(schema.failureClusters).where(eq(schema.failureClusters.id, id));
  return row!;
}

describe('filing once per cluster', () => {
  test('a create from an execution answers with the issue its cluster already has', async () => {
    const first = await file('failure_cluster', 1);
    expect(first).toMatchObject({ status: 'done', key: 'PROJ-1' });
    expect(first?.alreadyFiled).toBeUndefined();

    const again = await file('test_runs_case', 101);
    expect(again).toMatchObject({ status: 'done', key: 'PROJ-1', alreadyFiled: true });
    expect(created).toEqual(['PROJ-1']);
    expect(await clusterLinks(1)).toHaveLength(1);
  });

  test('a create from the cluster answers with the issue an execution filed', async () => {
    const first = await file('test_runs_case', 102);
    expect(first).toMatchObject({ status: 'done' });
    const again = await file('failure_cluster', 2);
    expect(again).toMatchObject({ status: 'done', key: first!.key, alreadyFiled: true });
    expect(created).toHaveLength(1);
  });

  test('the filing is recorded against the cluster', async () => {
    await file('test_runs_case', 103);
    const actions = await db.select().from(schema.integrationActions);
    const forCluster3 = actions.find((a) => a.dedupeKey === `create-issue:failure_cluster:3:conn${connectionId}`);
    expect(forCluster3).toMatchObject({ entityType: 'failure_cluster', entityId: 3, status: 'done' });
  });
});

describe('filing again after the link was removed', () => {
  test('files a new issue and links it, instead of answering with the unlinked one', async () => {
    const first = await file('failure_cluster', 4);
    const [link] = await clusterLinks(4);
    expect(link?.key).toBe(first!.key);

    await deleteLink(db as never, link!.id);
    const again = await file('failure_cluster', 4);
    expect(again?.status).toBe('done');
    expect(again?.alreadyFiled).toBeUndefined();
    expect(again?.key).not.toBe(first!.key);
    expect((await clusterLinks(4)).map((l) => l.key)).toEqual([again!.key]);

    // The first filing stays as history, under a retired key.
    const actions = await db.select().from(schema.integrationActions);
    const live = actions.filter((a) => a.dedupeKey === `create-issue:failure_cluster:4:conn${connectionId}`);
    expect(live).toHaveLength(1);
    expect(
      actions.some((a) => a.dedupeKey.startsWith(`create-issue:failure_cluster:4:conn${connectionId}:retired:`)),
    ).toBe(true);

    // The new filing is the answer from now on.
    const third = await file('test_runs_case', 104);
    expect(third).toMatchObject({ key: again!.key, alreadyFiled: true });
  });
});

describe('sync policies act on a move of the ticket', () => {
  async function linkOf(clusterId: number) {
    const [link] = await clusterLinks(clusterId);
    return link!;
  }

  test('a created link records the status category it was created with', async () => {
    const link = await linkOf(1);
    expect((link.metadata as { statusCategory?: string } | null)?.statusCategory).toBe('new');
  });

  test('a ticket moved to Done resolves the cluster once, and a reopened cluster stays open', async () => {
    await setPolicies({ resolveOnClose: true });
    const link = await linkOf(1);
    categories.set(link.key!, 'done');
    await syncTrackerLinks(dbc);
    expect((await clusterRow(1)).status).toBe('resolved');

    // A person reopens the cluster while the ticket stays Done: no move, no resolve.
    await db.update(schema.failureClusters).set({ status: 'open' }).where(eq(schema.failureClusters.id, 1));
    await syncTrackerLinks(dbc);
    expect((await clusterRow(1)).status).toBe('open');
  });

  test('a regressed cluster is not closed by its ticket moving to Done', async () => {
    await setPolicies({ resolveOnClose: true });
    await db
      .update(schema.failureClusters)
      .set({ fixVerification: 'regressed' })
      .where(eq(schema.failureClusters.id, 2));
    const link = await linkOf(2);
    categories.set(link.key!, 'done');
    await syncTrackerLinks(dbc);
    expect((await clusterRow(2)).status).toBe('open');
  });

  test('a cluster resolved by hand while its ticket is open is not reopened', async () => {
    await setPolicies({ reopenOnTicketReopen: true });
    await db.update(schema.failureClusters).set({ status: 'resolved' }).where(eq(schema.failureClusters.id, 3));
    await syncTrackerLinks(dbc, { now: new Date(Date.now() + 2 * 24 * 3600_000) });
    expect((await clusterRow(3)).status).toBe('resolved');

    // The ticket moving out of Done does reopen it.
    const link = await linkOf(3);
    categories.set(link.key!, 'done');
    await syncTrackerLinks(dbc, { now: new Date(Date.now() + 4 * 24 * 3600_000) });
    categories.set(link.key!, 'indeterminate');
    await syncTrackerLinks(dbc, { now: new Date(Date.now() + 6 * 24 * 3600_000) });
    expect((await clusterRow(3)).status).toBe('open');
  });
});
