import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the handler modules load.
delete process.env.PIWI_DATABASE_URL;
const { flakeCommand, flakeLabNextCommand, flakeLabNextStep, flakeLabTestState, getProjectFlakeLab } =
  await import('../../shared/handlers/flake-lab');

const HOUR_MS = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);
const at = (hours: number) => new Date(T0 + hours * HOUR_MS);

describe('where a test stands in the lab', () => {
  const e = (kind: string, verdict: string) => ({ kind, verdict });

  test('untested before any experiment', () => {
    expect(flakeLabTestState([], null)).toBe('untested');
  });

  test('a verified fix decides, holding or flaky again', () => {
    const list = [e('verify', 'verified'), e('reproduce', 'reproduced')];
    expect(flakeLabTestState(list, { flakedAgainAt: null })).toBe('verified');
    expect(flakeLabTestState(list, { flakedAgainAt: at(9).toISOString() })).toBe('flaked-again');
  });

  test('the newest verify that did not hold, else the newest reproduction', () => {
    expect(flakeLabTestState([e('verify', 'still-fails'), e('reproduce', 'reproduced')], null)).toBe('still-fails');
    expect(flakeLabTestState([e('verify', 'inconclusive'), e('reproduce', 'reproduced')], null)).toBe('inconclusive');
    expect(flakeLabTestState([e('reproduce', 'not-reproduced'), e('reproduce', 'reproduced')], null)).toBe(
      'reproduced',
    );
  });

  test('without a reproduction, the newest verdict', () => {
    expect(flakeLabTestState([e('reproduce', 'amplified'), e('reproduce', 'not-reproduced')], null)).toBe('amplified');
    expect(flakeLabTestState([e('reproduce', 'not-reproduced')], null)).toBe('not-reproduced');
  });

  test('the next step: verify once reproduced, reproduce otherwise, nothing once fixed', () => {
    for (const state of ['reproduced', 'still-fails', 'inconclusive'] as const) {
      expect(flakeLabNextStep(state)).toBe('verify');
    }
    for (const state of ['untested', 'not-reproduced', 'amplified', 'flaked-again'] as const) {
      expect(flakeLabNextStep(state)).toBe('reproduce');
    }
    expect(flakeLabNextStep('verified')).toBeNull();
    expect(flakeLabNextCommand(12, 'reproduced')).toBe('npx @piwitests/reporter flake verify 12');
    expect(flakeLabNextCommand(12, 'untested')).toBe(flakeCommand(12));
    expect(flakeLabNextCommand(12, 'verified')).toBeNull();
  });
});

describe('the project’s lab', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let runSeq = 0;

  /** One run at `hours`; each listed test fails then passes on retry, the others pass. */
  async function seedRun(hours: number, retryPassTests: number[]) {
    const runId = ++runSeq;
    await db.insert(schema.testRuns).values({
      id: runId,
      projectId: 1,
      status: 'passed',
      startTime: at(hours),
      duration: 60_000,
      totalTests: 3,
    });
    const attempt = (testCaseId: number, status: string, retries: number) => ({
      testRunId: runId,
      testCaseId,
      status,
      retries,
      duration: 2_000,
      browserName: 'chromium',
      browser: { projectName: 'chromium' },
    });
    const rows = [1, 2, 3].flatMap((id) =>
      retryPassTests.includes(id) ? [attempt(id, 'failed', 0), attempt(id, 'passed', 1)] : [attempt(id, 'passed', 0)],
    );
    await db.insert(schema.testRunsCases).values(rows);
  }

  /** A finished experiment with a control and one arm, the arm reproducing when the verdict says so. */
  async function experiment(testCaseId: number, kind: 'reproduce' | 'verify', verdict: string, hours: number) {
    const [row] = await db
      .insert(schema.flakeExperiments)
      .values({
        projectId: 1,
        testCaseId,
        kind,
        verdict,
        commit: 'fix1234abcd',
        source: 'cli',
        createdAt: at(hours - 0.1),
        finishedAt: at(hours),
      })
      .returning({ id: schema.flakeExperiments.id });
    const arm = (armKey: string, position: number, label: string) => ({
      experimentId: row!.id,
      armKey,
      position,
      label,
      conditions: [],
      runs: 5,
      matchingFailures: 0,
    });
    const [, condition] = await db
      .insert(schema.flakeArms)
      .values([
        arm('control', 0, 'control'),
        arm(kind === 'verify' ? 'verify' : 'suspect-1', 1, 'delay GET /api/cart 1.9 s'),
      ])
      .returning({ id: schema.flakeArms.id });
    if (verdict === 'reproduced' || kind === 'verify') {
      await db
        .update(schema.flakeExperiments)
        .set({ reproducingArmId: condition!.id })
        .where(eq(schema.flakeExperiments.id, row!.id));
    }
  }

  beforeEach(async () => {
    db = drizzle(createClient({ url: ':memory:' }), { schema });
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
    });
    await db.insert(schema.projects).values({ id: 1, name: 'checkout' });
    await db.insert(schema.testCases).values([
      { id: 1, projectId: 1, filePath: 'checkout.spec.ts', title: 'pays' },
      { id: 2, projectId: 1, filePath: 'checkout.spec.ts', title: 'refunds' },
      { id: 3, projectId: 1, filePath: 'orders.spec.ts', title: 'lists orders' },
    ]);
    runSeq = 0;
    // Tests 1 and 2 flake; test 3 always passes.
    for (let i = 0; i < 6; i++) await seedRun(i, [...(i % 2 === 0 ? [1] : []), ...(i === 1 || i === 3 ? [2] : [])]);
    await experiment(3, 'reproduce', 'not-reproduced', 6.5);
    await experiment(1, 'reproduce', 'reproduced', 7);
  });

  test('lists every flaky or tested test, a fix to verify first, with the command it needs', async () => {
    const lab = await getProjectFlakeLab(db as never, 1);

    expect(lab.tests.map((t) => [t.testCaseId, t.state])).toEqual([
      [1, 'reproduced'],
      [2, 'untested'],
      [3, 'not-reproduced'],
    ]);
    expect(lab.tests[0]).toMatchObject({
      title: 'pays',
      filePath: 'checkout.spec.ts',
      flaky: true,
      retryPassRuns: 3,
      reproducedBy: 'delay GET /api/cart 1.9 s',
      nextCommand: 'npx @piwitests/reporter flake verify 1',
      experiments: 1,
      lastExperimentAt: at(7).toISOString(),
    });
    expect(lab.tests[1]).toMatchObject({ nextCommand: 'npx @piwitests/reporter flake 2', lastExperimentAt: null });
    expect(lab.tests[2]).toMatchObject({ title: 'lists orders', flaky: false, retryPassRuns: null });
    expect(lab.counts).toEqual({ flaky: 2, untested: 1, awaitingFix: 1, verified: 0, experiments: 2 });
    expect(lab.experiments.map((e) => [e.testCaseId, e.title, e.verdict])).toEqual([
      [1, 'pays', 'reproduced'],
      [3, 'lists orders', 'not-reproduced'],
    ]);
  });

  test('a verified fix takes the test off the ranking and lists it last, with nothing to run', async () => {
    await experiment(1, 'verify', 'verified', 8);
    const lab = await getProjectFlakeLab(db as never, 1);

    expect(lab.tests.map((t) => t.testCaseId)).toEqual([2, 3, 1]);
    expect(lab.tests[2]).toMatchObject({
      state: 'verified',
      flaky: false,
      nextCommand: null,
      retryPassRuns: 3,
      verifiedFix: expect.objectContaining({ commit: 'fix1234abcd', flakedAgainAt: null }),
    });
    expect(lab.counts).toMatchObject({ flaky: 1, awaitingFix: 0, verified: 1, experiments: 3 });
  });

  test('a retry-pass after the verification sends it back to the lab', async () => {
    await experiment(1, 'verify', 'verified', 8);
    await seedRun(9, [1]);
    const lab = await getProjectFlakeLab(db as never, 1);
    expect(lab.tests.find((t) => t.testCaseId === 1)).toMatchObject({
      state: 'flaked-again',
      flaky: true,
      nextCommand: 'npx @piwitests/reporter flake 1',
    });
  });

  test('keeps the newest experiments to the limit, and counts them all', async () => {
    const lab = await getProjectFlakeLab(db as never, 1, { limit: 1 });
    expect(lab.experiments.map((e) => e.testCaseId)).toEqual([1]);
    expect(lab.counts.experiments).toBe(2);
  });

  test('refuses an unknown project', async () => {
    await expect(getProjectFlakeLab(db as never, 99)).rejects.toThrow('Project not found');
  });
});
