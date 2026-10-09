import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as schema from '../../server/database/schema.sqlite';
import { openTempDb, type TempDb } from './temp-db';
import type { McpContext } from '../../server/utils/mcp/tools';
import type { User } from '../../server/database/schema';
import { InstanceRole, ProjectRole, buildAccessSummary } from '#shared/permissions';
import { compileCodeowners, parseCodeowners } from '@piwitests/core/codeowners';

/**
 * The situation sentence an agent reads names the owner the execution page
 * names: explain_failure and get_fix_plan fall back to the repository's
 * CODEOWNERS for a failing test with no `piwi:owner` annotation.
 */

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the modules under test load.
delete process.env.PIWI_DATABASE_URL;

vi.mock('../../server/utils/scm', () => ({
  createScmProvider: async () => ({
    fetchCodeowners: async () => compileCodeowners(parseCodeowners('tests/checkout.spec.ts @payments\n')),
  }),
}));

const { MCP_TOOLS } = await import('../../server/utils/mcp/tools');

const tool = (name: string) => {
  const found = MCP_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found.handler;
};

const viewer: McpContext = {
  user: { id: 2, role: InstanceRole.MEMBER, name: 'Sam', username: 'sam' } as User,
  access: buildAccessSummary(InstanceRole.MEMBER, [{ projectId: 1, role: ProjectRole.VIEWER }]),
  scope: new Set([1]),
};

let db: TempDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await openTempDb());
  await db.insert(schema.projects).values({ id: 1, name: 'shop' });
  await db
    .insert(schema.testCases)
    .values({ id: 1, projectId: 1, title: 'pays by card', filePath: 'tests/checkout.spec.ts' });
  await db.insert(schema.testRuns).values({
    id: 1,
    projectId: 1,
    status: 'failed',
    startTime: new Date('2026-09-01T10:00:00Z'),
    metadata: { scm: { remoteUrl: 'https://github.com/acme/shop.git', branch: 'main' } },
  });
  await db.insert(schema.failureClusters).values({
    id: 1,
    projectId: 1,
    errorType: 'unknown',
    fingerprint: 'fp-1',
    signature: 'Error: card declined',
    firstSeenRunId: 1,
    lastSeenRunId: 1,
  });
  await db.insert(schema.testRunsCases).values({
    id: 10,
    testRunId: 1,
    testCaseId: 1,
    status: 'failed',
    error: 'Error: card declined',
    failureClusterId: 1,
  });
});

afterAll(async () => {
  await close();
});

describe('the owner in the situation an agent reads', () => {
  test('explain_failure names the CODEOWNERS owner', async () => {
    const result = (await tool('explain_failure')(db as never, { executionId: 10 }, viewer)) as { situation?: string };
    expect(result.situation).toMatch(/Owner @payments\.$/);
  });

  test("get_fix_plan's situation names the owner its ownership names", async () => {
    const result = (await tool('get_fix_plan')(db as never, { clusterId: 1 }, viewer)) as {
      situation?: string | null;
      ownership: { owner: string | null; source: string | null };
    };
    expect(result.ownership).toEqual({ owner: '@payments', source: 'codeowners' });
    expect(result.situation).toMatch(/Owner @payments\.$/);
  });
});
