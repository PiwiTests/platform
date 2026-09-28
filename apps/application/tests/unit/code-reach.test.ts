import { beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the modules under test load.
delete process.env.PIWI_DATABASE_URL;
const { getCodeIndex, getCodeReachForFile, sanitizeCodeReach, upsertCodeReach, buildCodeReachGraph } =
  await import('../../server/utils/code-reach');
const { resolveImpact } = await import('../../server/utils/selection-impact');

let db: ReturnType<typeof drizzle<typeof schema>>;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);

async function run(id: number, branch: string | null, at: number) {
  await db.insert(schema.testRuns).values({
    id,
    projectId: 1,
    status: 'passed',
    startTime: new Date(at),
    branch,
    totalTests: 3,
    passedTests: 3,
  });
}

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  await db.insert(schema.projects).values({ id: 1, name: 'shop', defaultBranch: 'main' });
  await db.insert(schema.testCases).values([
    { id: 1, projectId: 1, filePath: 'tests/checkout.spec.ts', title: 'pays' },
    { id: 2, projectId: 1, filePath: 'tests/cart.spec.ts', title: 'adds to cart' },
    { id: 3, projectId: 1, filePath: 'tests/api.spec.ts', title: 'lists products' },
  ]);
  await run(10, 'main', T0);
  await run(11, 'main', T0 + HOUR);
  await run(12, 'feature/pay', T0 + 2 * HOUR);
  await run(9, 'main', T0 - HOUR);

  await upsertCodeReach(db as never, 1, [
    { testCaseId: 1, runId: 10, files: ['src/components/Pay.vue', 'src/lib/cart.ts'] },
    { testCaseId: 2, runId: 10, files: ['src/lib/cart.ts'] },
  ]);
  // A later run replaces test 1's rows on its branch; an older one changes nothing.
  await upsertCodeReach(db as never, 1, [{ testCaseId: 1, runId: 11, files: ['src/components/Pay.vue'] }]);
  await upsertCodeReach(db as never, 1, [{ testCaseId: 1, runId: 9, files: ['src/old.ts'] }]);
  // On a feature branch, test 2 reaches another file.
  await upsertCodeReach(db as never, 1, [
    { testCaseId: 2, runId: 12, files: ['src/lib/cart.ts', 'src/lib/coupon.ts'] },
  ]);

  // Server reach: test 3 called GET /api/products, which the Test Map knows is handled by server/api/products.get.ts.
  await db.insert(schema.graphEdges).values([
    { projectId: 1, fromKind: 'test', fromKey: '3', toKind: 'route', toKey: 'GET /api/products', kind: 'reaches' },
    {
      projectId: 1,
      fromKind: 'route',
      fromKey: 'GET /api/products',
      toKind: 'handler',
      toKey: 'server/api/products.get.ts',
      kind: 'handled-by',
    },
  ]);
});

describe('sanitizeCodeReach', () => {
  test('keeps repository-relative paths, sorted', () => {
    expect(sanitizeCodeReach(['src/b.ts', 'src/a.ts', 42, '/abs.ts', 'node_modules/x/y.js', '../up.ts'])).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
    expect(sanitizeCodeReach('src/a.ts')).toBeNull();
  });
});

describe('code reach', () => {
  test('the latest run on a branch replaces the rows; an older one does not', async () => {
    const reach = await getCodeReachForFile(db as never, 1, 'src/lib/cart.ts');
    expect(reach.tests.map((t) => [t.id, t.origin])).toEqual([[2, 'client']]);
    expect((await getCodeReachForFile(db as never, 1, 'src/old.ts')).tests).toEqual([]);
  });

  test('a path suffix matches, and server reach comes from the Test Map', async () => {
    expect((await getCodeReachForFile(db as never, 1, 'components/Pay.vue')).tests.map((t) => t.id)).toEqual([1]);
    const handler = await getCodeReachForFile(db as never, 1, 'server/api/products.get.ts');
    expect(handler.tests.map((t) => [t.id, t.origin])).toEqual([[3, 'server']]);
  });

  test("a branch reads its tests' own rows, and the default branch's for the others", async () => {
    const feature = await getCodeReachForFile(db as never, 1, 'src/lib/coupon.ts', 'feature/pay');
    expect(feature.branch).toBe('feature/pay');
    expect(feature.tests.map((t) => t.id)).toEqual([2]);
    expect((await getCodeReachForFile(db as never, 1, 'src/lib/coupon.ts')).tests).toEqual([]);
    expect(
      (await getCodeReachForFile(db as never, 1, 'src/components/Pay.vue', 'feature/pay')).tests.map((t) => t.id),
    ).toEqual([1]);
  });

  test('the code index lists files, tests and reach by position', async () => {
    const index = await getCodeIndex(db as never, 1);
    expect(index.files).toEqual(['server/api/products.get.ts', 'src/components/Pay.vue', 'src/lib/cart.ts']);
    const named = index.reach.map((r) => [index.files[r.file], r.tests.map((t) => index.tests[t]!.id), r.origin]);
    expect(named).toEqual([
      ['server/api/products.get.ts', [3], 'server'],
      ['src/components/Pay.vue', [1], 'client'],
      ['src/lib/cart.ts', [2], 'client'],
    ]);
    expect(index.builtAt).not.toBeNull();
    expect(index.truncated).toBe(false);
  });

  test('graph specs: file nodes with origin coverage, reaches edges from each test', () => {
    const specs = buildCodeReachGraph([{ testCaseId: 1, files: ['src/a.ts'] }]);
    expect(specs.nodes).toEqual([{ kind: 'file', key: 'src/a.ts', origin: 'coverage' }]);
    expect(specs.edges[0]).toMatchObject({
      fromKind: 'test',
      fromKey: '1',
      toKind: 'file',
      toKey: 'src/a.ts',
      kind: 'reaches',
    });
  });
});

describe('impact-from-diff with code reach', () => {
  test('a changed file maps to the tests that executed it', async () => {
    const impact = await resolveImpact(db as never, 1, ['src/components/Pay.vue']);
    expect(impact.impact.widened).toBe(false);
    expect(impact.tests.map((t) => t.testCaseId)).toEqual([1]);
  });

  test('an unreached file where code reach looks is listed, not widened; elsewhere it widens', async () => {
    const quiet = await resolveImpact(db as never, 1, ['src/lib/unused.ts']);
    expect(quiet.impact.widened).toBe(false);
    expect(quiet.impact.unreachedFiles).toEqual(['src/lib/unused.ts']);
    const outside = await resolveImpact(db as never, 1, ['scripts/build.ts']);
    expect(outside.impact.widened).toBe(true);
  });
});
