import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';
import type { FailureVerdict } from '#shared/failure-verdict';
import type { Situation } from '#shared/situation';
import type { NextStep } from '#shared/next-step';

/**
 * The execution detail of a test that passed on retry, against an in-memory
 * SQLite database: its verdict, the line under the headline and the next step
 * come from its failed attempt's row, and a retry pass whose failed attempt is
 * not stored still gets the retry pass's next step.
 */

// The schema barrel picks PostgreSQL at import time when PIWI_DATABASE_URL is set.
delete process.env.PIWI_DATABASE_URL;
const { getTestRunCase } = await import('#shared/handlers/test-cases');

type Detail = {
  verdict: FailureVerdict | null;
  situation: Situation | null;
  nextStep: NextStep | null;
};

const SETTINGS_ERROR = `Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "dark"
Received: "light"
    at tests/admin/settings.spec.ts:21:31`;

let db: ReturnType<typeof drizzle<typeof schema>>;

async function detail(id: number, opts: { aiConfigured?: boolean } = {}): Promise<Detail> {
  return (await getTestRunCase(db as never, id, null, opts)) as unknown as Detail;
}

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  await db.insert(schema.projects).values({ id: 1, name: 'admin' });
  await db.insert(schema.testCases).values([
    { id: 1, projectId: 1, title: 'toggles dark mode', filePath: 'tests/admin/settings.spec.ts' },
    { id: 2, projectId: 1, title: 'saves the profile', filePath: 'tests/admin/profile.spec.ts' },
  ]);
  await db.insert(schema.testRuns).values({
    id: 1,
    projectId: 1,
    status: 'passed',
    startTime: new Date('2026-09-01T10:00:00Z'),
    metadata: { scm: { commit: 'a1b2c3d4e5f6', branch: 'main', author: 'Alice Chen' } },
  });
  const failed = { retry: 0, status: 'failed', duration: 2400, startedAt: 1_000 };
  const passed = { retry: 1, status: 'passed', duration: 4800, startedAt: 4_000 };
  await db.insert(schema.testRunsCases).values([
    // The failed first attempt and the passing retry of one test, each its own row.
    {
      id: 10,
      testRunId: 1,
      testCaseId: 1,
      browserName: 'Chromium',
      status: 'failed',
      retries: 0,
      error: SETTINGS_ERROR,
      steps: [{ title: "expect(locator('html')).toHaveAttribute()", duration: 2000, failed: true }],
      attempts: [failed],
    },
    {
      id: 11,
      testRunId: 1,
      testCaseId: 1,
      browserName: 'Chromium',
      status: 'passed',
      retries: 1,
      isNewFlaky: 1,
      steps: [{ title: "expect(locator('html')).toHaveAttribute()", duration: 300 }],
      attempts: [failed, passed],
    },
    // A retry pass whose failed attempt was never stored as its own row.
    {
      id: 12,
      testRunId: 1,
      testCaseId: 2,
      browserName: 'Chromium',
      status: 'passed',
      retries: 1,
      attempts: [failed, passed],
    },
  ]);
});

describe('a test that passed on retry', () => {
  test("leads with its failed attempt's headline, naming that attempt", async () => {
    const d = await detail(11);
    expect(d.verdict?.headline).toBe((await detail(10)).verdict?.headline);
    expect(d.verdict?.headline).toBeTruthy();
    expect(d.verdict?.why).toBe('passed-on-retry');
    expect(d.verdict?.attempt).toEqual({ retry: 0, executionId: 10 });
    expect(d.verdict?.cluster).toBeNull();
  });

  test('says under the headline which attempt failed, linked to it', async () => {
    const since = (await detail(11)).situation!.since;
    expect(since.text).toBe('Newly flaky, failed on attempt 1, passed on attempt 2, on a1b2c3d by Alice Chen');
    expect(since.parts.find((p) => p.kind === 'attempt')).toMatchObject({ id: 10, href: '/test-run-cases/10' });
  });

  test('compares the attempts next, with or without an AI provider', async () => {
    expect((await detail(11)).nextStep?.kind).toBe('compare-attempts');
    expect((await detail(11, { aiConfigured: true })).nextStep?.kind).toBe('compare-attempts');
  });

  test('the failed attempt keeps its own headline, with no attempt named', async () => {
    const d = await detail(10);
    expect(d.verdict?.attempt).toBeNull();
    expect(d.situation?.since.text).not.toContain('attempt');
  });

  test('without its failed attempt stored: no headline, and still the retry pass next step', async () => {
    for (const aiConfigured of [false, true]) {
      const d = await detail(12, { aiConfigured });
      expect(d.verdict).toBeNull();
      expect(d.situation).toBeNull();
      expect(d.nextStep?.kind).toBe('compare-attempts');
    }
  });
});
